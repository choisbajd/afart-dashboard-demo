// data/raw_query.csv 병합 로직 — scripts/merge_raw_query.js(CLI)와
// pages/api/admin/upload-sales.js(웹 업로드) 양쪽에서 공유해서 쓴다.
// 순수 문자열 in/out 함수라 파일시스템에 의존하지 않는다.

const KEY_COLUMNS = ["상담ID", "차량번호", "차대번호"];

function stripBom(text) {
  return text.replace(/^﻿/, "");
}

function parseTable(text) {
  const lines = stripBom(text)
    .split(/\r?\n/)
    .filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("빈 CSV입니다.");
  const header = lines[0].split(",");
  const rows = lines.slice(1).map((line) => line.split(","));
  return { header, rows };
}

function keyOf(header, row) {
  return KEY_COLUMNS.map((col) => {
    const idx = header.indexOf(col);
    return idx === -1 ? "" : (row[idx] ?? "").trim();
  }).join("|");
}

// baseText(기존 raw_query.csv 전체 내용)에 incrementalText(증분 CSV)를 병합해
// { text, stats } 를 돌려준다. 헤더가 다르면 에러를 던진다.
// 안전장치: base 안에 동일 키가 여러 개 있으면(원본 export 자체의 중복) 자동
// 치환하지 않고 그대로 둔 채 증분 행을 추가만 한다 — 데이터를 절대 지우지 않는다.
function mergeCsv(baseText, incrementalText) {
  const base = parseTable(baseText);
  const incremental = parseTable(incrementalText);

  if (base.header.join(",") !== incremental.header.join(",")) {
    const err = new Error("헤더가 서로 달라 병합할 수 없습니다. 컬럼 구성을 맞춰서 다시 시도해주세요.");
    err.baseHeader = base.header;
    err.incrementalHeader = incremental.header;
    throw err;
  }

  const indexByKey = new Map();
  base.rows.forEach((row, i) => {
    const key = keyOf(base.header, row);
    if (!indexByKey.has(key)) indexByKey.set(key, []);
    indexByKey.get(key).push(i);
  });

  const rows = [...base.rows];
  let updated = 0;
  let added = 0;
  const ambiguousKeys = [];

  for (const incRow of incremental.rows) {
    const key = keyOf(incremental.header, incRow);
    const matches = indexByKey.get(key) || [];
    if (matches.length === 1) {
      rows[matches[0]] = incRow;
      updated++;
    } else if (matches.length === 0) {
      rows.push(incRow);
      added++;
    } else {
      rows.push(incRow);
      ambiguousKeys.push(key);
    }
  }

  const text = [base.header.join(","), ...rows.map((r) => r.join(","))].join("\n") + "\n";
  return {
    text,
    stats: {
      baseCount: base.rows.length,
      incrementalCount: incremental.rows.length,
      updated,
      added,
      totalCount: rows.length,
      ambiguousKeys,
    },
  };
}

module.exports = { mergeCsv };
