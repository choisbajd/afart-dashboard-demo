import snowflake from "snowflake-sdk";
import fs from "fs";
import path from "path";

// scripts/snowflake_sales_export.sql 는 이미 실제 스키마로 검증된 매출 export 쿼리 원본이다.
// 수기 다운로드용 쿼리와 동기화용 쿼리가 서로 어긋나지 않도록 이 파일 하나만 참조한다.
const EXPORT_SQL_PATH = path.join(process.cwd(), "scripts", "snowflake_sales_export.sql");

function buildConnectionOptions() {
  const {
    SNOWFLAKE_ACCOUNT,
    // Vercel 프로젝트 설정에 SNOWFLAKE_USER로 등록된 경우도 있어 둘 다 받는다.
    SNOWFLAKE_USERNAME = process.env.SNOWFLAKE_USER,
    SNOWFLAKE_PRIVATE_KEY,
    SNOWFLAKE_PRIVATE_KEY_PASSPHRASE,
    SNOWFLAKE_WAREHOUSE,
    SNOWFLAKE_ROLE,
    SNOWFLAKE_DATABASE,
    SNOWFLAKE_SCHEMA,
  } = process.env;

  if (!SNOWFLAKE_ACCOUNT || !SNOWFLAKE_USERNAME || !SNOWFLAKE_PRIVATE_KEY) {
    throw new Error(
      "Snowflake 연동 환경변수가 없습니다 (SNOWFLAKE_ACCOUNT / SNOWFLAKE_USERNAME 또는 SNOWFLAKE_USER / SNOWFLAKE_PRIVATE_KEY). .env.example 참고."
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

// 대시보드가 방문마다 직접 조회하므로(getServerSideProps), 요청마다 새로 접속하면 매번
// JWT 핸드셰이크 지연이 붙는다. 같은(warm) 서버리스 인스턴스 안에서는 연결을 재사용하고,
// 끊어진 것으로 확인되면(쿼리 실패) 한 번만 새로 연결해 재시도한다.
let cachedConnection = null;

async function getConnection() {
  if (!cachedConnection) {
    cachedConnection = await connect(buildConnectionOptions());
  }
  return cachedConnection;
}

async function runQuery(connection, sqlText) {
  const { stmt, rows } = await execute(connection, sqlText);
  const columns = stmt.getColumns().map((c) => c.getName());
  return { columns, rows };
}

// scripts/snowflake_sales_export.sql를 그대로 실행해 { columns, rows }를 돌려준다.
// columns는 SELECT에 적힌 순서 그대로(= 대시보드 CSV 컬럼 순서와 동일)이고,
// rows의 각 값은 컬럼명(한글 alias)을 키로 갖는 객체다.
export async function runSalesExportQuery() {
  const sqlText = fs.readFileSync(EXPORT_SQL_PATH, "utf-8");
  try {
    return await runQuery(await getConnection(), sqlText);
  } catch (err) {
    // 캐시된 연결이 끊어졌을 수 있으니 한 번 새로 연결해서 재시도.
    cachedConnection = null;
    return await runQuery(await getConnection(), sqlText);
  }
}
