import { runSalesExportQuery } from "../../../lib/snowflakeClient";
import { uploadSalesCsv } from "../../../lib/blobStore";

function toCsvField(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function rowsToCsv(columns, rows) {
  const lines = rows.map((row) => columns.map((col) => toCsvField(row[col])).join(","));
  return [columns.join(","), ...lines].join("\n") + "\n";
}

// Vercel Cron이 주기적으로 호출 (vercel.json 참고). Snowflake에서 최신 매출 데이터를
// 받아와 Vercel Blob에 CSV로 저장해두면, 다음 ISR 재생성 때 대시보드가 이 데이터를 읽는다.
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
