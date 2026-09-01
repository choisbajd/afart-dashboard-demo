import fs from "fs";
import path from "path";
import { groupOf } from "./groups";
import { findLatestSalesCsvUrl } from "./blobStore";

const CSV_PATH = path.join(process.cwd(), "data", "raw_query.csv");
const PENDING_COMPLETED_CSV_PATH = path.join(process.cwd(), "data", "pending_to_completed.csv");

const HEADER_MAP = [
  "channel", // 유입채널
  "counselId", // 상담ID
  "customerId", // 고객ID
  "customerName", // 고객명 (마스킹됨)
  "phone", // 연락처 (마스킹됨)
  "plateNumber", // 차량번호
  "vin", // 차대번호
  "premium", // 보험료
  "insurer", // 가입보험사
  "joinType", // 가입유형 (CM/TM/OFFLINE)
  "insuranceKind", // 보험종류
  "vehicleKind", // 차량구분
  "contractDate", // 체결일자
  "expiryDate", // 만기일자
  "currentStatus", // 현재상태 (counsel_status)
  "statusHistory", // 상태전환이력 "A(MM-DD HH:MM) → B(MM-DD HH:MM) → ..."
  "giftName", // 주유권
  "dealerPhone", // 딜러연락처
  "dealerName", // 딜러이름
  "dealerId", // 딜러ID
  "dealerType", // 딜러유형 (business_type)
  "dealerStatus", // 딜러상태 (business_card_status)
  "managerName", // 상담(체결)매니저 (counsel_manager_id)
  "dealerManagerName", // 딜러전담매니저 (users.manager_id)
  "consultTypeRaw", // 상담구분(신규/갱신, counsel_application.is_renewal 기반) — 구버전 CSV(24컬럼)엔 없을 수 있음
  "dealerSubType", // 딜러세부유형(users.business_sub_type: IMPORTED/DOMESTIC) — 이 컬럼 없는 CSV엔 없을 수 있음
];

// 이 컬럼 개수 미만이면 파싱 자체가 불가능한 최소 요건(위 25번째 상담구분 컬럼은 선택값이라
// HEADER_MAP.length가 아니라 이 상수로 최소 요건을 따로 둔다 — 구버전 CSV 호환용).
const REQUIRED_COLUMN_COUNT = 24;

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < REQUIRED_COLUMN_COUNT) continue;
    const row = {};
    HEADER_MAP.forEach((key, idx) => {
      row[key] = (cols[idx] ?? "").trim().replace(/^"|"$/g, "");
    });
    row.premium = row.premium === "" ? null : Number(row.premium);
    if (Number.isNaN(row.premium)) row.premium = null;

    // 상담구분: is_renewal 기반 값(consultTypeRaw)이 있으면 그걸 신뢰. 구버전 CSV라 없으면
    // 유입채널(RENEWAL→갱신)로 근사 — 정확한 값이 아니니 새 export 받으면 자동으로 대체됨.
    row.consultType = row.consultTypeRaw || (row.channel === "갱신" ? "갱신" : "신규");

    // 매출인식일 보정: 상태이력에 지급대기(ACCUMULATE_PENDING) 로그가 한 번이라도 있으면
    // 지금 상태가 가입완료로 바뀌었더라도 그 가입완료 처리일이 아니라 "최초로 지급대기에
    // 도달한 시점"을 매출인식일로 삼는다. 지급대기 로그가 아예 없는 건(=지급대기 없이
    // 바로 가입완료)만 원래 체결일자(가입완료 로그 시점)를 그대로 쓴다.
    // 갱신 건은 비교견적~지급대기 사이 간격이 길게 벌어지는 경우가 많아(사전예약 등)
    // 이 보정을 안 하면 몇 달 전에 이미 인식됐어야 할 매출이 가입완료 처리되는 날
    // 갑자기 튀어나온 것처럼 잡힌다.
    const firstPending = parseHistory(row.statusHistory).find((e) => e.status === "ACCUMULATE_PENDING");
    if (firstPending) {
      row.contractDate = `2026-${firstPending.at.slice(0, 5)}`; // "MM-DD HH:MM" -> "2026-MM-DD"
    }

    rows.push(row);
  }
  return rows;
}

// Snowflake와 자동 동기화되면(pages/api/cron/sync.js) Vercel Blob에 최신 CSV가 올라온다.
// 아직 연동 전이거나(BLOB_READ_WRITE_TOKEN 없음) Blob 조회가 실패하면 저장소에 커밋된
// data/raw_query.csv(수기 업데이트분)로 자연스럽게 폴백한다.
export async function loadRawRows() {
  const blobUrl = await findLatestSalesCsvUrl();
  if (blobUrl) {
    try {
      const res = await fetch(blobUrl, { cache: "no-store" });
      if (res.ok) return parseCsv(await res.text());
      console.error("Blob CSV 응답 실패, 로컬 CSV로 폴백:", res.status);
    } catch (err) {
      console.error("Blob CSV fetch 실패, 로컬 CSV로 폴백:", err.message);
    }
  }
  const text = fs.readFileSync(CSV_PATH, "utf-8");
  return parseCsv(text);
}

function dealerKey(r) {
  // 딜러ID가 비어있는 행이 있고, 마스킹된 딜러이름은 서로 다른 사람이 겹칠 수 있어
  // ID가 있으면 ID로, 없으면 이름+연락처로 묶는다.
  return r.dealerId || `${r.dealerName}|${r.dealerPhone}`;
}

// AFART 앱 회원(딜러) 집계 공통 규칙: 탈퇴(REJECTED)만 제외, APPROVED/PENDING(+미기재)은 포함.
// 이 raw pull엔 REJECTED가 아직 없어 사실상 전건 포함되지만, 규칙은 그대로 반영해둔다.
function isEligibleDealer(r) {
  return r.dealerStatus !== "REJECTED";
}

// "STATUS(MM-DD HH:MM) → STATUS(MM-DD HH:MM) → ..." 를 순서대로 파싱
const HISTORY_RE = /([A-Z_]+)\((\d{2}-\d{2} \d{2}:\d{2})\)/g;

function parseHistory(str) {
  if (!str) return [];
  return [...str.matchAll(HISTORY_RE)].map((m) => ({ status: m[1], at: m[2] }));
}

// 이력 타임스탬프엔 연도가 없다 — 이 raw pull은 전부 2026년이라 2026 고정으로 파싱한다.
function toTime(mmddhhmm) {
  const [md, hm] = mmddhhmm.split(" ");
  const [mm, dd] = md.split("-");
  const [hh, mi] = hm.split(":");
  return Date.UTC(2026, Number(mm) - 1, Number(dd), Number(hh), Number(mi));
}

function funnelOf(r) {
  const events = parseHistory(r.statusHistory);
  const prospect = events.find((e) => e.status === "PROSPECT_COUNSEL");
  const comparison = events.find((e) => e.status === "COMPARISON_COMPLETED");
  const final = events[events.length - 1];

  let prospectToCompDays = null;
  let compToJoinDays = null;
  if (comparison) {
    if (prospect) {
      prospectToCompDays = Math.max(0, (toTime(comparison.at) - toTime(prospect.at)) / 86400000);
    }
    if (final) {
      compToJoinDays = Math.max(0, (toTime(final.at) - toTime(comparison.at)) / 86400000);
    }
  }
  return { hasComparison: !!comparison, prospectToCompDays, compToJoinDays };
}

// 빌드 시점에 한 번만 계산해서 클라이언트로 내려줄 가벼운 행 목록을 만든다.
// 고객명/연락처/차대번호 같은 개인정보는 여기 담지 않는다 — 검색은 /api/search 서버 라우트에서 처리한다.
//
// 필드명을 6천여 번 반복하지 않도록(JSON 페이로드 절감) 배열 형태로 내려보내고,
// 클라이언트에서 unpackRows()로 다시 객체로 복원한다.
export const CLIENT_ROW_FIELDS = [
  "date",
  "premium",
  "insurer",
  "joinType",
  "channel",
  "dealerKey",
  "dealerName",
  "managerName",
  "group",
  "hasComparison",
  "prospectToCompDays",
  "compToJoinDays",
  "currentStatus",
  "dealerManagerName",
];

export function toClientRows(rawRows) {
  return rawRows
    .filter((r) => r.contractDate && r.currentStatus !== "JOIN_CANCELLED" && isEligibleDealer(r))
    .map((r) => {
      const f = funnelOf(r);
      return [
        r.contractDate,
        r.premium,
        r.insurer || "미상",
        r.joinType || "기타",
        r.channel || "기타",
        dealerKey(r),
        r.dealerName || "미상",
        r.managerName || "미배정",
        groupOf(r.dealerType, r.dealerSubType).code,
        f.hasComparison ? 1 : 0,
        f.prospectToCompDays,
        f.compToJoinDays,
        r.currentStatus,
        r.dealerManagerName || "미배정",
      ];
    });
}

// 주유권 발송 리스트는 건수가 적어(수십 건) 필요한 필드를 그대로 내려도 부담이 없다.
export function toGiftRows(rawRows) {
  return rawRows
    .filter((r) => r.contractDate && r.giftName && r.currentStatus !== "JOIN_CANCELLED" && isEligibleDealer(r))
    .map((r) => ({
      date: r.contractDate,
      customerName: r.customerName || "",
      phone: r.phone || "",
      giftName: r.giftName,
      dealerName: r.dealerName || "미상",
      managerName: r.managerName || "미배정",
    }));
}

// '지급대기' 전환 리스트 — 현재상태가 ACCUMULATE_PENDING인 실제 건.
export function toPendingRows(rawRows) {
  return rawRows
    .filter((r) => r.currentStatus === "ACCUMULATE_PENDING" && isEligibleDealer(r))
    .map((r) => {
      const events = parseHistory(r.statusHistory);
      const last = [...events].reverse().find((e) => e.status === "ACCUMULATE_PENDING");
      return {
        date: r.contractDate,
        transitionAt: last ? `2026-${last.at.replace(" ", " ")}` : r.contractDate,
        customerName: r.customerName || "",
        phone: r.phone || "",
        premium: r.premium,
        managerName: r.managerName || "미배정",
        dealerName: r.dealerName || "미상",
      };
    });
}

const PENDING_COMPLETED_HEADER_MAP = [
  "pendingAt", // 지급대기일자
  "customerName", // 고객명
  "managerName", // 상담(체결)담당자
  "phone", // 고객연락처
  "changedAt", // 상태변경일
  "currentStatus", // 현재상담상태
  "dealerType", // 딜러유형
  "dealerId", // 딜러아이디
  "dealerName", // 딜러이름
  "premium", // 보험료
  "insurer", // 가입보험사
  "previousInsurer", // 기존보험사 (갱신이면 채워짐)
];

function parsePendingCompletedCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < PENDING_COMPLETED_HEADER_MAP.length) continue;
    const row = {};
    PENDING_COMPLETED_HEADER_MAP.forEach((key, idx) => {
      row[key] = (cols[idx] ?? "").trim().replace(/^"|"$/g, "");
    });
    row.premium = row.premium === "" ? null : Number(row.premium);
    if (Number.isNaN(row.premium)) row.premium = null;
    rows.push(row);
  }
  return rows;
}

// '지급대기 → 가입완료' 전환 리스트(갱신 리스트) — data/raw_query.csv의 상태이력에서
// 유추하면 실제로 반영된 전환이 누락되는 경우가 있어(2026-09-01 확인됨), 별도로
// 수기 업데이트하는 data/pending_to_completed.csv를 그대로 신뢰해서 보여준다.
export function toPendingCompletedRows() {
  const text = fs.readFileSync(PENDING_COMPLETED_CSV_PATH, "utf-8");
  return parsePendingCompletedCsv(text).map((r) => ({
    date: r.changedAt,
    pendingAt: r.pendingAt,
    changedAt: r.changedAt,
    customerName: r.customerName || "",
    phone: r.phone || "",
    managerName: r.managerName || "미배정",
    currentStatus: r.currentStatus,
  }));
}

// '가입취소' 리스트 — 현재상태가 실제로 가입취소(JOIN_CANCELLED)인 건만 보여준다.
// 이 raw pull은 counsel_status IN (ACCUMULATE_PENDING, JOIN_COMPLETED)인 최종 성사 건만
// 담고 있어 실제로는 항상 비어 보인다 — 실 서비스 데이터가 붙으면 정상적으로 채워진다.
export function toCancelledRows(rawRows) {
  return rawRows
    .filter((r) => r.currentStatus === "JOIN_CANCELLED" && isEligibleDealer(r))
    .map((r) => {
      const events = parseHistory(r.statusHistory);
      const cancelled = [...events].reverse().find((e) => e.status === "JOIN_CANCELLED");
      // 체결까지 못 가고 취소된 건은 체결일자(contractDate)가 비어있을 수 있어, 상단 날짜
      // 필터에 걸리는 기준일은 항상 가입취소일시로 삼는다 (date/cancelledAt 동일 값).
      const cancelledAt = cancelled ? `2026-${cancelled.at.replace(" ", " ")}` : r.contractDate;
      return {
        date: cancelledAt,
        cancelledAt,
        customerName: r.customerName || "",
        phone: r.phone || "",
        contractDate: r.contractDate || "",
        insurer: r.insurer || "미상",
        joinType: r.joinType || "기타",
        premium: r.premium,
        managerName: r.managerName || "미배정",
        dealerName: r.dealerName || "미상",
        dealerManagerName: r.dealerManagerName || "미배정",
      };
    });
}

// 매출 로우 데이터 리스트(/api/sales)용 — 기간으로 걸러 필요한 컬럼만 내려준다.
// 차량(차대)번호는 차량번호가 있으면 그걸, 없으면 차대번호를 보여준다 (둘 다 비어있는 행도 있음).
export function toSalesRows(rawRows, { dateFrom, dateTo }) {
  return rawRows
    .filter((r) => {
      if (!r.contractDate || r.currentStatus === "JOIN_CANCELLED" || !isEligibleDealer(r)) return false;
      if (dateFrom && r.contractDate < dateFrom) return false;
      if (dateTo && r.contractDate > dateTo) return false;
      return true;
    })
    .map((r) => ({
      channel: r.channel || "기타",
      customerName: r.customerName || "",
      vin: r.plateNumber || r.vin || "",
      expiryDate: r.expiryDate || "",
      premium: r.premium,
      contractDate: r.contractDate,
      counselManagerName: r.managerName || "미배정",
      dealerName: r.dealerName || "미상",
      dealerManagerName: r.dealerManagerName || "미배정",
      consultType: r.consultType,
    }))
    .sort((a, b) => (a.contractDate > b.contractDate ? -1 : a.contractDate < b.contractDate ? 1 : 0));
}

// 갱신 관리 — 만기일자가 있는 가입완료 건을 후보로 두고, 화면에서 "오늘로부터 정확히 N일 후" 필터를 건다.
// 지급대기/가입취소 건은 아직 실제로 계약이 살아있는 게 아니라 갱신 안내 대상이 아니다.
export function toRenewalRows(rawRows) {
  return rawRows
    .filter((r) => r.expiryDate && r.currentStatus === "JOIN_COMPLETED" && isEligibleDealer(r))
    .map((r) => ({
      dueDate: r.expiryDate,
      customerName: r.customerName || "",
      phone: r.phone || "",
      insurer: r.insurer || "",
      dealerName: r.dealerName || "미상",
      managerName: r.managerName || "미배정",
    }));
}
