import { getServerSession } from "next-auth/next";
import { loadRawRows, toSalesRows } from "../../lib/data";
import { authOptions } from "../../lib/authOptions";

// 매출 로우 데이터 리스트 — 기간 파라미터로 걸러서 필요한 컬럼만 내려준다.
let cachedRows = null;
async function getRows() {
  if (!cachedRows) cachedRows = await loadRawRows();
  return cachedRows;
}

const MAX_RESULTS = 1000;

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "로그인이 필요합니다." });
  }

  const { from = "", to = "" } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: "from, to 파라미터가 필요합니다." });
  }

  const rows = toSalesRows(await getRows(), { dateFrom: from, dateTo: to });
  const truncated = rows.length > MAX_RESULTS;
  res.status(200).json({
    results: truncated ? rows.slice(0, MAX_RESULTS) : rows,
    total: rows.length,
    truncated,
  });
}
