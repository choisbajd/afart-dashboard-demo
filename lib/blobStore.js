import { put, list } from "@vercel/blob";

// 동기화된 매출 CSV를 보관할 고정 경로. 매번 이 경로를 덮어써서 "최신본 하나"만 유지한다.
const BLOB_PATHNAME = "sales/raw_query.csv";

export async function uploadSalesCsv(csvText) {
  const blob = await put(BLOB_PATHNAME, csvText, {
    access: "public",
    contentType: "text/csv; charset=utf-8",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return blob.url;
}

// Blob 스토어가 연결 안 돼있으면(BLOB_READ_WRITE_TOKEN 없음) null을 돌려줘서
// 호출부가 로컬 data/raw_query.csv로 자연스럽게 폴백하게 한다.
export async function findLatestSalesCsvUrl() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 1 });
    return blobs[0]?.url ?? null;
  } catch (err) {
    console.error("Vercel Blob 조회 실패, 로컬 CSV로 폴백:", err.message);
    return null;
  }
}
