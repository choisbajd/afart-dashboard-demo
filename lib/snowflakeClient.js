import snowflake from "snowflake-sdk";
import fs from "fs";
import path from "path";

// scripts/snowflake_sales_export.sql 는 이미 실제 스키마로 검증된 매출 export 쿼리 원본이다.
// 수기 다운로드용 쿼리와 동기화용 쿼리가 서로 어긋나지 않도록 이 파일 하나만 참조한다.
const EXPORT_SQL_PATH = path.join(process.cwd(), "scripts", "snowflake_sales_export.sql");

function buildConnectionOptions() {
  const {
    SNOWFLAKE_ACCOUNT,
    SNOWFLAKE_USERNAME,
    SNOWFLAKE_PRIVATE_KEY,
    SNOWFLAKE_PRIVATE_KEY_PASSPHRASE,
    SNOWFLAKE_WAREHOUSE,
    SNOWFLAKE_ROLE,
    SNOWFLAKE_DATABASE,
    SNOWFLAKE_SCHEMA,
  } = process.env;

  if (!SNOWFLAKE_ACCOUNT || !SNOWFLAKE_USERNAME || !SNOWFLAKE_PRIVATE_KEY) {
    throw new Error(
      "Snowflake 연동 환경변수가 없습니다 (SNOWFLAKE_ACCOUNT / SNOWFLAKE_USERNAME / SNOWFLAKE_PRIVATE_KEY). .env.example 참고."
    );
  }

  return {
    account: SNOWFLAKE_ACCOUNT,
    username: SNOWFLAKE_USERNAME,
    authenticator: "SNOWFLAKE_JWT",
    // Vercel 환경변수는 개행을 못 담아서 \n 으로 이스케이프해 저장 — 실행 시 실제 개행으로 복원.
    privateKey: SNOWFLAKE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    privateKeyPass: SNOWFLAKE_PRIVATE_KEY_PASSPHRASE || undefined,
    warehouse: SNOWFLAKE_WAREHOUSE,
    role: SNOWFLAKE_ROLE,
    database: SNOWFLAKE_DATABASE,
    schema: SNOWFLAKE_SCHEMA,
  };
}

function connect(options) {
  return new Promise((resolve, reject) => {
    const connection = snowflake.createConnection(options);
    connection.connect((err, conn) => (err ? reject(err) : resolve(conn)));
  });
}

function execute(connection, sqlText) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText,
      complete: (err, stmt, rows) => (err ? reject(err) : resolve({ stmt, rows })),
    });
  });
}

// scripts/snowflake_sales_export.sql를 그대로 실행해 { columns, rows }를 돌려준다.
// columns는 SELECT에 적힌 순서 그대로(= 대시보드 CSV 컬럼 순서와 동일)이고,
// rows의 각 값은 컬럼명(한글 alias)을 키로 갖는 객체다.
export async function runSalesExportQuery() {
  const sqlText = fs.readFileSync(EXPORT_SQL_PATH, "utf-8");
  const connection = await connect(buildConnectionOptions());
  try {
    const { stmt, rows } = await execute(connection, sqlText);
    const columns = stmt.getColumns().map((c) => c.getName());
    return { columns, rows };
  } finally {
    connection.destroy(() => {});
  }
}
