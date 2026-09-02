#!/usr/bin/env node
// data/raw_query.csv를 통째로 덮어쓰지 않고, 증분 CSV(최근 90일 활동분)를
// 상담ID + 차량번호 + 차대번호 기준으로 병합한다. 겹치는 상담은 증분 파일 값으로
// 갱신되고, 증분 파일에 없는(=최근 활동이 없어 재추출 대상이 아니었던) 과거 데이터는
// 그대로 남는다.
//
// 안전장치: 절대 기존 행을 "그냥 없애는" 방식으로 병합하지 않는다. 키가 같은 행이
// base에 2개 이상 있으면(실제로 원본 export에 이런 중복이 존재함 — 같은 상담/차량인데
// 보험료 유무만 다른 행이 섞여 나오는 경우가 있었음) 어느 쪽을 지워야 할지 판단할 수
// 없으므로 건드리지 않고 그대로 두고, 증분 행은 추가로 덧붙인 뒤 경고를 띄운다 —
// 수기로 확인해서 정리해야 한다.
//
// 사용법: node scripts/merge_raw_query.js <증분_CSV_경로>
// data/raw_query.csv를 직접 덮어쓴다 (git으로 diff 확인 가능하니 커밋 전에 검토할 것).

const fs = require("fs");
const path = require("path");

const BASE_PATH = path.join(process.cwd(), "data", "raw_query.csv");
const KEY_COLUMNS = ["상담ID", "차량번호", "차대번호"];

function stripBom(text) {
  return text.replace(/^﻿/, "");
}

function parseTable(text) {
  const lines = stripBom(text)
    .split(/\r?\n/)
    .filter((l) => l.length > 0);
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

function main() {
  const incrementalPath = process.argv[2];
  if (!incrementalPath) {
    console.error("사용법: node scripts/merge_raw_query.js <증분_CSV_경로>");
    process.exit(1);
  }

  const base = parseTable(fs.readFileSync(BASE_PATH, "utf-8"));
  const incremental = parseTable(fs.readFileSync(incrementalPath, "utf-8"));

  if (base.header.join(",") !== incremental.header.join(",")) {
    console.error("헤더가 서로 달라서 병합을 중단합니다 — 컬럼 구성을 맞춘 뒤 다시 시도하세요.");
    console.error("base       :", base.header.join(","));
    console.error("incremental:", incremental.header.join(","));
    process.exit(1);
  }

  // key -> base.rows의 인덱스 목록 (중복 키가 있을 수 있어 배열로 관리)
  const indexByKey = new Map();
  base.rows.forEach((row, i) => {
    const key = keyOf(base.header, row);
    if (!indexByKey.has(key)) indexByKey.set(key, []);
    indexByKey.get(key).push(i);
  });

  const rows = [...base.rows]; // 결과물 (in-place 치환 + 뒤에 추가)
  let updated = 0;
  let added = 0;
  const ambiguous = [];

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
      // base 안에 이미 같은 키가 여러 개 있어 어느 걸 바꿔야 할지 알 수 없음 — 건드리지 않고 추가만.
      rows.push(incRow);
      ambiguous.push(key);
    }
  }

  const outLines = [base.header.join(","), ...rows.map((r) => r.join(","))];
  fs.writeFileSync(BASE_PATH, outLines.join("\n") + "\n", "utf-8");

  console.log(`병합 완료: 기존 ${base.rows.length}건, 증분 ${incremental.rows.length}건`);
  console.log(`  → 갱신된 건: ${updated}, 새로 추가된 건: ${added}, 최종 총 ${rows.length}건`);
  if (ambiguous.length > 0) {
    console.log(`  ⚠ base에 키 중복이 있어 자동 치환을 못하고 그대로 추가만 한 건: ${ambiguous.length}`);
    console.log(`    (${ambiguous.join(", ")}) — 수기로 raw_query.csv에서 확인해주세요.`);
  }
}

main();
