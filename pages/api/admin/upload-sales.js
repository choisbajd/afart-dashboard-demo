import { loadRawText } from "../../../lib/data";
import { uploadSalesCsv } from "../../../lib/blobStore";
import { mergeCsv } from "../../../lib/mergeCsv";

// 기본 body 크기 제한(1mb)으로는 전체 매출 CSV(현재 2MB 안팎, 계속 늘어남)를 못 받는다.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "15mb",
    },
  },
};

// 관리자가 대시보드에서 CSV를 올리면(증분 export), 기존 데이터에 병합해서
// Vercel Blob에 저장한다. 대시보드 화면(pages/index.js)은 이제 Snowflake를 직접 조회하므로
// 평소엔 이 Blob 스냅샷을 안 쓰지만, Snowflake 조회가 실패했을 때의 폴백 데이터를
// 최신으로 유지해두는 용도로 남겨둔다.
//
// 필수: BLOB_READ_WRITE_TOKEN이 연결돼 있어야 병합 결과가 실제로 저장된다
// (없으면 다음 배포 때 사라짐 — Vercel 프로젝트 Storage 탭에서 Blob 스토어 연결 필요).
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST만 지원합니다." });
  }

  if (!process.env.UPLOAD_SECRET) {
    return res.status(503).json({
      error: "업로드 기능이 아직 설정되지 않았습니다 (UPLOAD_SECRET 환경변수 필요).",
    });
  }

  const { secret, csvText } = req.body || {};
  if (secret !== process.env.UPLOAD_SECRET) {
    return res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });
  }
  if (!csvText || typeof csvText !== "string") {
    return res.status(400).json({ error: "csvText가 비어있습니다." });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({
      error: "Vercel Blob이 아직 연결되지 않아 업로드를 저장할 곳이 없습니다. 프로젝트 Storage 탭에서 Blob 스토어를 연결해주세요.",
    });
  }

  try {
    const baseText = await loadRawText();
    const { text, stats } = mergeCsv(baseText, csvText);
    await uploadSalesCsv(text);

    return res.status(200).json({ ok: true, stats });
  } catch (err) {
    console.error("업로드 병합 실패:", err);
    return res.status(400).json({ error: err.message });
  }
}
