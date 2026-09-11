import { runSalesExportQuery } from "../../../lib/snowflakeClient";
import { uploadSalesCsv } from "../../../lib/blobStore";
import { rowsToCsv } from "../../../lib/csv";

// 대시보드 본 화면(pages/index.js)은 이제 방문마다 Snowflake를 직접 조회한다(getServerSideProps).
// 이 cron은 그게 실패했을 때(네트워크 문제 등) 쓸 "최근 스냅샷"을 Vercel Blob에 남겨두는
// 백업 용도다 — vercel.json의 스케줄대로 주기 실행된다.
export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const expected = `Bearer ${process.env.CRON_SECRET}`;
    if (req.headers.authorization !== expected) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  try {
    const { columns, rows } = await runSalesExportQuery();
    const csv = rowsToCsv(columns, rows);
    const url = await uploadSalesCsv(csv);

    return res.status(200).json({
      ok: true,
      rows: rows.length,
      url,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Snowflake 동기화 실패:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
