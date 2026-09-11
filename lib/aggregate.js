// 순수 함수 모음 — 서버(getStaticProps)와 브라우저(필터 변경 시) 양쪽에서 동일하게 사용한다.
// 입력은 lib/data.js의 toClientRows()가 만든 압축 행 배열.

function isoWeekInfo(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - day);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (x) =>
    `${String(x.getUTCMonth() + 1).padStart(2, "0")}/${String(x.getUTCDate()).padStart(2, "0")}`;
  return { key: monday.toISOString().slice(0, 10), label: `${fmt(monday)}~${fmt(sunday)}` };
}

const monthOf = (d) => d.slice(0, 7);
const sumPremium = (rows) => rows.reduce((a, r) => a + (r.premium || 0), 0);

function bucketBy(rows, keyFn, labelFn) {
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  const out = [...map.entries()].map(([key, list]) => {
    const premiumSum = sumPremium(list);
    const withPremium = list.filter((r) => r.premium != null).length;
    return {
      key,
      label: labelFn ? labelFn(key, list) : key,
      count: list.length,
      premiumSum,
      avgPremium: withPremium > 0 ? Math.round(premiumSum / withPremium) : 0,
    };
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function filterRows(rows, { dateFrom, dateTo, manager }) {
  return rows.filter((r) => {
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo && r.date > dateTo) return false;
    if (manager && manager !== "ALL" && r.managerName !== manager) return false;
    return true;
  });
}

export function aggregate(rows) {
  const totals = {
    count: rows.length,
    joinCompletedCount: rows.filter((r) => r.currentStatus === "JOIN_COMPLETED").length,
    pendingCount: rows.filter((r) => r.currentStatus === "ACCUMULATE_PENDING").length,
    premiumSum: sumPremium(rows),
    dealerCount: new Set(rows.map((r) => r.dealerKey)).size,
    dateMin: rows.reduce((m, r) => (m === "" || r.date < m ? r.date : m), ""),
    dateMax: rows.reduce((m, r) => (m === "" || r.date > m ? r.date : m), ""),
  };
  totals.avgPremium = totals.count ? Math.round(totals.premiumSum / totals.count) : 0;

  const daily = bucketBy(rows, (r) => r.date);
  const weekly = bucketBy(rows, (r) => isoWeekInfo(r.date).key, (k, l) => isoWeekInfo(l[0].date).label);
  const monthly = bucketBy(rows, (r) => monthOf(r.date));

  // 보험사 x 가입유형 피벗 (원수보험료 합계 + 가입건수)
  const insurerSet = new Set();
  const typeSet = new Set();
  const pivotMap = new Map();
  const pivotCountMap = new Map();
  for (const r of rows) {
    insurerSet.add(r.insurer);
    typeSet.add(r.joinType);
    const k = r.insurer + "|" + r.joinType;
    pivotMap.set(k, (pivotMap.get(k) || 0) + (r.premium || 0));
    pivotCountMap.set(k, (pivotCountMap.get(k) || 0) + 1);
  }
  const typeOrder = ["CM", "TM", "OFFLINE"];
  const types = [...typeSet].sort((a, b) => typeOrder.indexOf(a) - typeOrder.indexOf(b));
  const insurerRows = [...insurerSet]
    .map((insurer) => {
      const byType = {};
      const byTypeCount = {};
      let total = 0;
      let totalCount = 0;
      for (const t of types) {
        const k = insurer + "|" + t;
        const v = pivotMap.get(k) || 0;
        const c = pivotCountMap.get(k) || 0;
        byType[t] = v;
        byTypeCount[t] = c;
        total += v;
        totalCount += c;
      }
      return { insurer, byType, byTypeCount, total, totalCount };
    })
    .sort((a, b) => b.total - a.total);
  const typeTotals = types.reduce((acc, t) => {
    acc[t] = insurerRows.reduce((s, row) => s + row.byType[t], 0);
    return acc;
  }, {});
  const typeCountTotals = types.reduce((acc, t) => {
    acc[t] = insurerRows.reduce((s, row) => s + row.byTypeCount[t], 0);
    return acc;
  }, {});
  const insurerPivot = {
    rows: insurerRows,
    types,
    typeTotals,
    typeCountTotals,
    grandTotal: insurerRows.reduce((s, r) => s + r.total, 0),
    grandCount: insurerRows.reduce((s, r) => s + r.totalCount, 0),
  };

  // 딜러별
  const dealerMap = new Map();
  for (const r of rows) {
    if (!dealerMap.has(r.dealerKey)) dealerMap.set(r.dealerKey, []);
    dealerMap.get(r.dealerKey).push(r);
  }
  const dealerRank = [...dealerMap.entries()]
    .map(([, list]) => ({
      dealerName: list[0].dealerName,
      managerName: list[0].managerName,
      group: list[0].group,
      count: list.length,
      premiumSum: sumPremium(list),
    }))
    .sort((a, b) => b.premiumSum - a.premiumSum);

  // 채널별
  const channelMap = new Map();
  for (const r of rows) {
    if (!channelMap.has(r.channel)) channelMap.set(r.channel, []);
    channelMap.get(r.channel).push(r);
  }
  const byChannel = [...channelMap.entries()]
    .map(([channel, list]) => ({ channel, count: list.length, premiumSum: sumPremium(list) }))
    .sort((a, b) => b.count - a.count);

  // 딜러유형 그룹별 (실제 business_type 기준) - 배정 딜러 수
  const groupMap = new Map();
  for (const r of rows) {
    if (!groupMap.has(r.group)) groupMap.set(r.group, new Set());
    groupMap.get(r.group).add(r.dealerKey);
  }

  // 비견(비교견적완료) 퍼널 — 이 raw pull은 성사된 건만 담고 있어 "손실 포함 전환율"은 계산할 수 없다.
  // 대신 체결 건 중 비교견적 단계를 거친 비율과, 단계별 평균 소요일을 본다.
  const comparisonRows = rows.filter((r) => r.hasComparison);
  const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
  const funnel = {
    comparisonCount: comparisonRows.length,
    comparisonRate: totals.count ? (comparisonRows.length / totals.count) * 100 : 0,
    avgProspectToCompDays: avg(
      comparisonRows.map((r) => r.prospectToCompDays).filter((v) => v != null)
    ),
    avgCompToJoinDays: avg(comparisonRows.map((r) => r.compToJoinDays).filter((v) => v != null)),
  };

  return {
    totals,
    periods: { daily, weekly, monthly },
    insurerPivot,
    dealerRank,
    byChannel,
    groupDealerCount: groupMap,
    funnel,
  };
}

const CONVERTED_STATUSES = new Set(["ACCUMULATE_PENDING", "JOIN_COMPLETED"]);

// 매니저별 신규/갱신 콜(상담 생성월 코호트) 체결률 + 원수보험료.
// callRows: lib/data.js의 loadCallRows() 결과 — "생성일" 기준 필터링.
// premiumRows: toClientRows()가 만든 압축 행(unpack된 것) — "체결일(매출인식일)" 기준 필터링.
// ⚠️ 두 입력의 기간 의미가 다르다 — 콜 쪽은 "그 달에 새로 들어온 상담", 원수보험료 쪽은
// "그 달에 매출로 인식된 건" 이라 같은 期간을 넣어도 서로 다른 상담 집합을 센다.
// "매출"(수수료 매출) 컬럼은 계산식이 아직 확정되지 않아 이 함수에서 만들지 않는다 —
// 화면에서 항상 "-"로 표시한다.
export function aggregateManagerFunnel(callRows, premiumRows, { dateFrom, dateTo }) {
  const calls = callRows.filter((r) => {
    if (dateFrom && r.createdDate < dateFrom) return false;
    if (dateTo && r.createdDate > dateTo) return false;
    return true;
  });
  const premium = premiumRows.filter((r) => {
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo && r.date > dateTo) return false;
    return true;
  });

  const premiumMap = new Map();
  for (const r of premium) {
    premiumMap.set(r.managerName, (premiumMap.get(r.managerName) || 0) + (r.premium || 0));
  }

  const managerMap = new Map();
  const ensure = (name) => {
    if (!managerMap.has(name)) {
      managerMap.set(name, { managerName: name, newCalls: 0, newDeals: 0, renewalCalls: 0, renewalDeals: 0 });
    }
    return managerMap.get(name);
  };
  for (const r of calls) {
    const m = ensure(r.managerName || "미배정");
    const converted = CONVERTED_STATUSES.has(r.finalStatus);
    if (r.consultType === "갱신") {
      m.renewalCalls += 1;
      if (converted) m.renewalDeals += 1;
    } else {
      m.newCalls += 1;
      if (converted) m.newDeals += 1;
    }
  }
  // 콜 데이터엔 없지만 원수보험료(매출인식) 쪽엔 있는 매니저도 행에 포함시킨다.
  for (const name of premiumMap.keys()) ensure(name);

  const rows = [...managerMap.values()]
    .map((m) => ({
      ...m,
      newRate: m.newCalls ? (m.newDeals / m.newCalls) * 100 : null,
      renewalRate: m.renewalCalls ? (m.renewalDeals / m.renewalCalls) * 100 : null,
      premiumSum: premiumMap.get(m.managerName) || 0,
    }))
    .sort((a, b) => b.premiumSum - a.premiumSum);

  const sumOf = (key) => rows.reduce((s, r) => s + r[key], 0);
  const totals = {
    managerName: "합계",
    newCalls: sumOf("newCalls"),
    newDeals: sumOf("newDeals"),
    renewalCalls: sumOf("renewalCalls"),
    renewalDeals: sumOf("renewalDeals"),
    premiumSum: sumOf("premiumSum"),
  };
  totals.newRate = totals.newCalls ? (totals.newDeals / totals.newCalls) * 100 : null;
  totals.renewalRate = totals.renewalCalls ? (totals.renewalDeals / totals.renewalCalls) * 100 : null;

  const n = rows.length || 1;
  const average = {
    managerName: "인당 평균",
    newCalls: totals.newCalls / n,
    newDeals: totals.newDeals / n,
    renewalCalls: totals.renewalCalls / n,
    renewalDeals: totals.renewalDeals / n,
    premiumSum: totals.premiumSum / n,
    newRate: totals.newRate,
    renewalRate: totals.renewalRate,
  };

  return { rows, totals, average, hasCallData: callRows.length > 0 };
}

// 주유권/지급대기/가입취소처럼 건수가 적은 리스트형 데이터를 기간·매니저로 거르는 공용 함수.
// (건 단위 배열이면 무엇이든 재사용 — 각 항목은 date, managerName 필드를 가진다고 가정)
export function filterListRows(list, { dateFrom, dateTo, manager }) {
  return list
    .filter((r) => {
      if (dateFrom && r.date < dateFrom) return false;
      if (dateTo && r.date > dateTo) return false;
      if (manager && manager !== "ALL" && r.managerName !== manager) return false;
      return true;
    })
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
}

// 주유권 리스트 전용 — filterListRows에 권종별 요약을 더한다.
export function filterGiftRows(giftRows, filters) {
  const list = filterListRows(giftRows, filters);
  const summaryMap = new Map();
  for (const r of list) summaryMap.set(r.giftName, (summaryMap.get(r.giftName) || 0) + 1);
  return {
    summary: [...summaryMap.entries()]
      .map(([giftName, count]) => ({ giftName, count }))
      .sort((a, b) => b.count - a.count),
    list,
  };
}

// 원수보험료 → 매출(수수료) 환산율. 실제 수수료 테이블이 없어 잠정 고정값을 쓴다.
export const REVENUE_RATE = 0.11;

// [체결 지표] 월별 접수/계약(신규·갱신 분리)/전환율/원수보험료/매출액 요약.
// ⚠️ 두 입력의 "월"이 서로 다른 기준이다 — 접수는 상담 생성월(callRows.createdDate),
// 계약/원수보험료는 매출인식(체결)월(rows.date) 기준. 같은 달이어도 서로 다른 상담 집합을 센다.
// 계약 건수는 확정 성사(JOIN_COMPLETED)만 센다 — 지급대기는 원수보험료 합계에는 들어가지만
// "계약"으로는 안 친다(참고 대시보드 실측 검증 기준과 동일).
export function aggregateContractSummary(rows, callRows, { dateFrom, dateTo, manager } = {}) {
  const calls = callRows.filter((r) => {
    if (dateFrom && r.createdDate < dateFrom) return false;
    if (dateTo && r.createdDate > dateTo) return false;
    if (manager && manager !== "ALL" && r.managerName !== manager) return false;
    return true;
  });
  const deals = rows.filter((r) => {
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo && r.date > dateTo) return false;
    if (manager && manager !== "ALL" && r.managerName !== manager) return false;
    return true;
  });

  const byMonth = new Map();
  const ensure = (m) => {
    if (!byMonth.has(m)) {
      byMonth.set(m, {
        month: m,
        receivedNew: 0,
        receivedRenewal: 0,
        dealsNew: 0,
        dealsRenewal: 0,
        premiumSum: 0,
      });
    }
    return byMonth.get(m);
  };

  for (const c of calls) {
    const m = ensure(c.createdDate.slice(0, 7));
    if (c.consultType === "갱신") m.receivedRenewal += 1;
    else m.receivedNew += 1;
  }
  for (const r of deals) {
    const m = ensure(r.date.slice(0, 7));
    if (r.currentStatus === "JOIN_COMPLETED" || r.currentStatus === "ACCUMULATE_PENDING") {
      m.premiumSum += r.premium || 0;
    }
    if (r.currentStatus === "JOIN_COMPLETED") {
      if (r.consultType === "갱신") m.dealsRenewal += 1;
      else m.dealsNew += 1;
    }
  }

  const withDerived = (m) => {
    const received = m.receivedNew + m.receivedRenewal;
    const dealsTotal = m.dealsNew + m.dealsRenewal;
    return {
      ...m,
      received,
      dealsTotal,
      conversionRate: received ? (dealsTotal / received) * 100 : 0,
      revenue: m.premiumSum * REVENUE_RATE,
    };
  };

  const months = [...byMonth.values()].map(withDerived).sort((a, b) => (a.month < b.month ? 1 : -1));

  const totalsRaw = [...byMonth.values()].reduce(
    (acc, m) => ({
      month: "전체",
      receivedNew: acc.receivedNew + m.receivedNew,
      receivedRenewal: acc.receivedRenewal + m.receivedRenewal,
      dealsNew: acc.dealsNew + m.dealsNew,
      dealsRenewal: acc.dealsRenewal + m.dealsRenewal,
      premiumSum: acc.premiumSum + m.premiumSum,
    }),
    { receivedNew: 0, receivedRenewal: 0, dealsNew: 0, dealsRenewal: 0, premiumSum: 0 }
  );

  return { months, totals: withDerived(totalsRaw) };
}

// granularity별 버킷 키. "daily"=날짜 그대로, "weekly"=월요일 시작일, "monthly"=YYYY-MM.
function bucketKey(dateStr, granularity) {
  if (granularity === "monthly") return monthOf(dateStr);
  if (granularity === "weekly") return isoWeekInfo(dateStr).key;
  return dateStr;
}

// [고객 인입 지표] 일/주/월 × 채널 스택 데이터. status가 있으면 그 상태인 건만(예: JOIN_COMPLETED로
// "체결" 차트), 없으면 취소를 제외한 전 건(=최소 지급대기까지 진행된 건)을 "유입" 차트로 쓴다.
export function aggregateDailyByChannel(rows, { dateFrom, dateTo, manager, status, granularity = "daily" } = {}) {
  const filtered = rows.filter((r) => {
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo && r.date > dateTo) return false;
    if (manager && manager !== "ALL" && r.managerName !== manager) return false;
    if (status && r.currentStatus !== status) return false;
    return true;
  });

  const channels = [...new Set(filtered.map((r) => r.channel))].sort();
  const byBucket = new Map();
  for (const r of filtered) {
    const key = bucketKey(r.date, granularity);
    if (!byBucket.has(key)) byBucket.set(key, {});
    const bucket = byBucket.get(key);
    bucket[r.channel] = (bucket[r.channel] || 0) + 1;
  }

  const data = [...byBucket.keys()].sort().map((date) => {
    const bucket = byBucket.get(date);
    const total = channels.reduce((s, c) => s + (bucket[c] || 0), 0);
    return { date, total, ...bucket };
  });

  return { channels, data };
}

// [회원(딜러) 지표] group(영업채널: 신차딜러 수입/국산·중고차딜러·보험설계사·에이전시)로 필터링해서
// 딜러별/채널별 현황을 만든다.
export function aggregateMembers(rows, { dateFrom, dateTo, channel } = {}) {
  const scoped = rows.filter((r) => {
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo && r.date > dateTo) return false;
    if (channel && channel !== "ALL" && r.group !== channel) return false;
    return true;
  });

  const dealerMap = new Map();
  for (const r of scoped) {
    if (!dealerMap.has(r.dealerKey)) {
      dealerMap.set(r.dealerKey, {
        dealerKey: r.dealerKey,
        dealerName: r.dealerName,
        group: r.group,
        managerName: r.managerName,
        count: 0,
        premiumSum: 0,
      });
    }
    const d = dealerMap.get(r.dealerKey);
    d.count += 1;
    d.premiumSum += r.premium || 0;
  }
  const dealers = [...dealerMap.values()].sort((a, b) => b.premiumSum - a.premiumSum);

  const byGroupMap = new Map();
  for (const r of scoped) {
    if (!byGroupMap.has(r.group)) byGroupMap.set(r.group, new Set());
    byGroupMap.get(r.group).add(r.dealerKey);
  }
  const byGroup = [...byGroupMap.entries()]
    .map(([group, set]) => ({ group, dealerCount: set.size }))
    .sort((a, b) => b.dealerCount - a.dealerCount);

  return { totalDealers: dealerMap.size, dealers, byGroup };
}
