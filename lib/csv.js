// Snowflake 쿼리 결과({columns, rows})와 기존 CSV 파이프라인(lib/data.js의 parseCsv) 사이의
// 공용 변환기. 동기화 배치(pages/api/cron/sync.js)와 실시간 조회(lib/data.js) 양쪽에서 쓴다.
export function toCsvField(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function rowsToCsv(columns, rows) {
  const lines = rows.map((row) => columns.map((col) => toCsvField(row[col])).join(","));
  return [columns.join(","), ...lines].join("\n") + "\n";
}
