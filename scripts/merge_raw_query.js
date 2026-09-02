#!/usr/bin/env node
// data/raw_query.csv에 증분 CSV(최근 90일 활동분)를 병합한다. 실제 병합 로직은
// lib/mergeCsv.js에 있다 — 웹 업로드(pages/api/admin/upload-sales.js)와 공유.
//
// 사용법: node scripts/merge_raw_query.js <증분_CSV_경로>
// data/raw_query.csv를 직접 덮어쓴다 (git으로 diff 확인 가능하니 커밋 전에 검토할 것).

const fs = require("fs");
const path = require("path");
const { mergeCsv } = require("../lib/mergeCsv");

const BASE_PATH = path.join(process.cwd(), "data", "raw_query.csv");

function main() {
  const incrementalPath = process.argv[2];
  if (!incrementalPath) {
    console.error("사용법: node scripts/merge_raw_query.js <증분_CSV_경로>");
    process.exit(1);
  }

  const baseText = fs.readFileSync(BASE_PATH, "utf-8");
  const incrementalText = fs.readFileSync(incrementalPath, "utf-8");

  let result;
  try {
    result = mergeCsv(baseText, incrementalText);
  } catch (err) {
    console.error(err.message);
    if (err.baseHeader) {
      console.error("base       :", err.baseHeader.join(","));
      console.error("incremental:", err.incrementalHeader.join(","));
    }
    process.exit(1);
  }

  fs.writeFileSync(BASE_PATH, result.text, "utf-8");

  const { baseCount, incrementalCount, updated, added, totalCount, ambiguousKeys } = result.stats;
  console.log(`병합 완료: 기존 ${baseCount}건, 증분 ${incrementalCount}건`);
  console.log(`  → 갱신된 건: ${updated}, 새로 추가된 건: ${added}, 최종 총 ${totalCount}건`);
  if (ambiguousKeys.length > 0) {
    console.log(`  ⚠ base에 키 중복이 있어 자동 치환을 못하고 그대로 추가만 한 건: ${ambiguousKeys.length}`);
    console.log(`    (${ambiguousKeys.join(", ")}) — 수기로 raw_query.csv에서 확인해주세요.`);
  }
}

main();
