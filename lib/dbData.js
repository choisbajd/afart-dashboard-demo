import { hasSnowflakeCreds } from "./data";
import { runDbExportQuery } from "./snowflakeClient";

// scripts/snowflake_db_export.sql 실행 결과(컬럼명이 한글 alias)를 다루기 쉬운 필드명으로 바꾼다.
function mapDbRow(row) {
  return {
    counselId: row["상담ID"],
    createdDate: row["DB생성일"],
    channel: row["채널"] || "기타",
    consultType: row["상담구분"] || "신규",
    currentStatus: row["현재상태"],
    managerId: row["담당자ID"] || null,
    managerName: row["담당매니저"] || null,
    isContracted: Number(row["계약여부"]) === 1,
    contractDate: row["계약일"] || null,
    hasComparison: Number(row["비교견적여부"]) === 1,
    lastActivityDate: row["최종활동일"],
    premium: row["원수보험료"] != null ? Number(row["원수보험료"]) : 0,
    vehicleCount: row["차량건수"] != null ? Number(row["차량건수"]) : 0,
  };
}

// 매출 파이프라인(lib/data.js)과 달리 아직 Blob/로컬 CSV 백업 단계가 없다 — DB 분석은 이번에
// 새로 추가하는 영역이라 우선 "Snowflake 실시간 조회, 실패 시 빈 배열"로 단순하게 둔다.
// 매출 쪽처럼 스냅샷 백업이 필요해지면 lib/blobStore.js를 그대로 재사용하면 된다(새로 안 만들어도 됨).
export async function loadDbRows() {
  if (!hasSnowflakeCreds()) return [];
  try {
    const { rows } = await runDbExportQuery();
    return rows.map(mapDbRow);
  } catch (err) {
    console.error("DB 분석 쿼리 실패, 빈 데이터로 표시:", err.message);
    return [];
  }
}

// 클라이언트로 내려보낼 때 필드명을 6천여 번 반복하지 않도록 배열로 압축한다(unpackDbRows로 복원).
export const DB_CLIENT_FIELDS = [
  "counselId",
  "createdDate",
  "channel",
  "consultType",
  "currentStatus",
  "managerId",
  "managerName",
  "isContracted",
  "contractDate",
  "hasComparison",
  "lastActivityDate",
  "premium",
  "vehicleCount",
];

export function toDbClientRows(dbRows) {
  return dbRows.map((r) => [
    r.counselId,
    r.createdDate,
    r.channel,
    r.consultType,
    r.currentStatus,
    r.managerId,
    r.managerName,
    r.isContracted ? 1 : 0,
    r.contractDate,
    r.hasComparison ? 1 : 0,
    r.lastActivityDate,
    r.premium,
    r.vehicleCount,
  ]);
}
