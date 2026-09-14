// DB(가망 상담) 전용 집계 — lib/dbData.js가 불러온 dbRows(1 counsel_id = 1행)를 다룬다.
// 매출/계약 집계(lib/aggregate.js)와 의도적으로 분리했다: 두 영역이 서로 다른 쿼리·다른 기간
// 조건(매출=최근 90일, DB=전체 이력)을 쓰기 때문에 같은 함수에 억지로 합치지 않는다.
import { bucketKey } from "./aggregate";

function filterDbRows(dbRows, { dateFrom, dateTo, manager, channel, consultType } = {}) {
  return dbRows.filter((r) => {
    if (dateFrom && r.createdDate < dateFrom) return false;
    if (dateTo && r.createdDate > dateTo) return false;
    if (manager && manager !== "ALL" && r.managerName !== manager) return false;
    if (channel && channel !== "ALL" && r.channel !== channel) return false;
    if (consultType && consultType !== "ALL" && r.consultType !== consultType) return false;
    return true;
  });
}

// [DB 현황] 상단 KPI — 생성/계약/미계약/배정·미배정/비교견적, 전환율 3종(추가5).
export function aggregateDbSummary(dbRows, filters = {}) {
  const scoped = filterDbRows(dbRows, filters);
  const created = scoped.length;
  const contracted = scoped.filter((r) => r.isContracted).length;
  const assigned = scoped.filter((r) => r.managerId).length;
  const comparisonRequested = scoped.filter((r) => r.hasComparison).length;
  const premiumSum = scoped.reduce((s, r) => s + (r.isContracted ? r.premium || 0 : 0), 0);

  return {
    created,
    contracted,
    uncontracted: created - contracted,
    assigned,
    unassigned: created - assigned,
    comparisonRequested,
    premiumSum,
    dbConversionRate: created ? (contracted / created) * 100 : 0,
    comparisonRate: created ? (comparisonRequested / created) * 100 : 0,
    comparisonToContractRate: comparisonRequested ? (contracted / comparisonRequested) * 100 : 0,
  };
}

// [DB 생성 추이] 일/주/월별 생성 건수 + 그 코호트(생성일 기준) 중 계약된 건수.
// 기간 기준은 요청대로 counsel_application.created_at(=createdDate) 하나로 통일한다.
export function aggregateDbTrend(dbRows, { dateFrom, dateTo, granularity = "daily", manager, channel } = {}) {
  const scoped = filterDbRows(dbRows, { dateFrom, dateTo, manager, channel });
  const byBucket = new Map();
  for (const r of scoped) {
    const key = bucketKey(r.createdDate, granularity);
    if (!byBucket.has(key)) byBucket.set(key, { created: 0, contracted: 0 });
    const b = byBucket.get(key);
    b.created += 1;
    if (r.isContracted) b.contracted += 1;
  }
  return [...byBucket.entries()]
    .map(([key, v]) => ({ key, ...v, conversionRate: v.created ? (v.contracted / v.created) * 100 : 0 }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

// [DB 유입경로 분석 / 매니저별 DB 활용] channel 또는 managerName 기준 그룹 집계.
export function aggregateDbByGroup(dbRows, { dateFrom, dateTo, groupBy = "channel" } = {}) {
  const scoped = filterDbRows(dbRows, { dateFrom, dateTo });
  const map = new Map();
  for (const r of scoped) {
    const key = r[groupBy] || (groupBy === "managerName" ? "미배정" : "기타");
    if (!map.has(key)) map.set(key, { key, created: 0, contracted: 0, premiumSum: 0 });
    const g = map.get(key);
    g.created += 1;
    if (r.isContracted) {
      g.contracted += 1;
      g.premiumSum += r.premium || 0;
    }
  }
  const total = scoped.length;
  const groups = [...map.values()]
    .map((g) => ({
      ...g,
      uncontracted: g.created - g.contracted,
      share: total ? (g.created / total) * 100 : 0,
      conversionRate: g.created ? (g.contracted / g.created) * 100 : 0,
    }))
    .sort((a, b) => b.created - a.created);
  return { groups, total };
}

// [DB Funnel] 실제로 값이 있는 단계만 쓴다 — "상담 진행중" 같은 중간 단계는 별도 플래그가
// 없어서(원 요청에 있었지만) 임의로 만들지 않고 뺐다. 생성 → 담당자배정 → 비교견적요청 →
// 계약(지급대기+가입완료) → 가입완료, 이렇게 실제로 계산 가능한 5단계만 보여준다.
export function aggregateDbFunnel(dbRows, filters = {}) {
  const scoped = filterDbRows(dbRows, filters);
  const created = scoped.length;
  const assigned = scoped.filter((r) => r.managerId).length;
  const comparisonRequested = scoped.filter((r) => r.hasComparison).length;
  const contracted = scoped.filter((r) => r.isContracted).length;
  const joinCompleted = scoped.filter((r) => r.currentStatus === "JOIN_COMPLETED").length;
  return [
    { stage: "DB 생성", count: created },
    { stage: "담당자 배정", count: assigned },
    { stage: "비교견적 요청", count: comparisonRequested },
    { stage: "계약(지급대기+가입완료)", count: contracted },
    { stage: "가입완료", count: joinCompleted },
  ];
}

const AGING_BUCKETS = [
  { key: "0", label: "0일", min: 0, max: 0 },
  { key: "1-3", label: "1~3일", min: 1, max: 3 },
  { key: "4-7", label: "4~7일", min: 4, max: 7 },
  { key: "8-14", label: "8~14일", min: 8, max: 14 },
  { key: "15-30", label: "15~30일", min: 15, max: 30 },
  { key: "31+", label: "31일 이상", min: 31, max: Infinity },
];

function daysBetween(fromDateStr, toDateStr) {
  const from = new Date(fromDateStr + "T00:00:00Z").getTime();
  const to = new Date(toDateStr + "T00:00:00Z").getTime();
  return Math.round((to - from) / 86400000);
}

// [DB Aging] 아직 결론(계약 또는 취소)이 안 난 DB를 생성일 기준 경과일수로 구간화.
// 취소(JOIN_CANCELLED)는 이미 결론이 난 건이라 "방치된 미계약"이 아니므로 제외한다.
// 이 함수에 넘기는 dbRows는 반드시 최근 90일 제한이 없는 scripts/snowflake_db_export.sql
// 결과여야 한다 — 안 그러면 오래된 미계약 건이 애초에 안 들어있어 집계가 왜곡된다.
export function aggregateDbAging(dbRows, { asOfDate, manager, channel } = {}) {
  const pending = filterDbRows(dbRows, { manager, channel }).filter(
    (r) => !r.isContracted && r.currentStatus !== "JOIN_CANCELLED"
  );
  const buckets = AGING_BUCKETS.map((b) => ({ ...b, count: 0 }));
  for (const r of pending) {
    const age = daysBetween(r.createdDate, asOfDate);
    const bucket = buckets.find((b) => age >= b.min && age <= b.max) || buckets[buckets.length - 1];
    bucket.count += 1;
  }
  const total = pending.length;
  return {
    total,
    buckets: buckets.map((b) => ({ ...b, share: total ? (b.count / total) * 100 : 0 })),
  };
}
