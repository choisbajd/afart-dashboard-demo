-- ============================================================================
-- DB(가망 상담) 분석 전용 export 쿼리 (Snowflake)
--
-- "DB" = counsel_application에서 생성된 상담 건. 기본 grain은 1 counsel_id = 1행이다
-- (매출 쿼리처럼 COUNSEL_VEHICLE을 JOIN하지 않는다 — 차량이 여러 대인 상담이 여러 행으로
-- 늘어나면 DB 생성 건수/계약 건수가 중복 집계된다).
--
-- 매출 쿼리(snowflake_sales_export.sql)와 의도적으로 분리한 쿼리다:
--   - 매출 쿼리는 "최근 90일 활동" 증분 조건이 있어 건드리지 않는다(기존 실적 화면에 영향 X).
--   - 이 쿼리는 DB Aging(오래 방치된 미계약 DB)까지 봐야 해서 기간 조건을 아예 걸지 않는다
--     (WHERE에 last_activity_at 제한이 없다 — 전체 이력을 그대로 가져온다).
--
-- 원수보험료 중복 합산 방지: COUNSEL_VEHICLE을 먼저 counsel_id 기준으로 SUM해서
-- (vehicle_agg CTE) 1counsel_id=1행으로 만든 뒤에 LEFT JOIN한다. 그래서 차량이 2대인
-- 상담이 있어도 이 쿼리의 원수보험료는 2배로 잡히지 않는다.
--
-- 계약 인정 기준은 매출 쿼리와 동일: 지급대기(ACCUMULATE_PENDING) 최초 도달 시점을
-- 우선 쓰고, 없으면 가입완료(join_completed_at) 시점을 쓴다. 이 로직은 매출 쿼리와
-- 별개로 다시 짰지만 "계산 규칙 자체"는 새로 만들지 않고 기존과 동일하게 맞췄다.
-- ============================================================================

WITH vehicle_agg AS (
  -- 차량 단위로 흩어진 보험료를 counsel_id 기준으로 먼저 합쳐서(1counsel_id=1행)
  -- 나중에 JOIN해도 중복 SUM이 나지 않게 한다.
  SELECT
    cv.counsel_id,
    SUM(cv.contract_amount) AS premium_sum,
    COUNT(*)                AS vehicle_count
  FROM AJDCAR_PROD.PUBLIC.COUNSEL_VEHICLE cv
  WHERE cv.is_deleted = FALSE
  GROUP BY cv.counsel_id
),

status_agg AS (
  SELECT
    csl.counsel_id,
    MIN(CASE WHEN csl.new_counsel_status = 'ACCUMULATE_PENDING'
             THEN csl.created_at END)                                   AS pending_at,
    MAX(CASE WHEN csl.new_counsel_status = 'COMPARISON_COMPLETED'
             THEN 1 ELSE 0 END)                                         AS has_comparison,
    MAX(csl.created_at)                                                 AS last_activity_at
  FROM AJDCAR_PROD.PUBLIC.COUNSEL_STATUS_LOG csl
  GROUP BY csl.counsel_id
)

SELECT
  ca.counsel_id                                                        AS "상담ID",
  TO_CHAR(ca.created_at, 'YYYY-MM-DD')                                 AS "DB생성일",
  CASE ca.channel_path
    WHEN 'DEALER_APP' THEN '딜러앱'
    WHEN 'RENEWAL'    THEN '갱신'
    WHEN 'CS'         THEN 'CS'
    ELSE '기타'
  END                                                                   AS "채널",
  CASE WHEN ca.is_renewal THEN '갱신' ELSE '신규' END                   AS "상담구분",
  ca.counsel_status                                                     AS "현재상태",
  ca.counsel_manager_id                                                 AS "담당자ID",
  cm.name                                                                AS "담당매니저",
  -- 계약 인정: 매출 쿼리와 동일 기준(지급대기 또는 가입완료 현재상태).
  CASE WHEN ca.counsel_status IN ('ACCUMULATE_PENDING', 'JOIN_COMPLETED')
       THEN 1 ELSE 0 END                                                AS "계약여부",
  TO_CHAR(
    CASE WHEN sa.pending_at IS NOT NULL THEN sa.pending_at
         ELSE ca.join_completed_at
    END, 'YYYY-MM-DD'
  )                                                                     AS "계약일",
  COALESCE(sa.has_comparison, 0)                                        AS "비교견적여부",
  TO_CHAR(COALESCE(sa.last_activity_at, ca.created_at), 'YYYY-MM-DD')   AS "최종활동일",
  COALESCE(va.premium_sum, 0)                                           AS "원수보험료",
  COALESCE(va.vehicle_count, 0)                                         AS "차량건수"
FROM AJDCAR_PROD.PUBLIC.COUNSEL_APPLICATION ca
LEFT JOIN status_agg sa   ON sa.counsel_id = ca.counsel_id
LEFT JOIN vehicle_agg va  ON va.counsel_id = ca.counsel_id
LEFT JOIN AJDCAR_PROD.PUBLIC.MANAGER cm ON cm.id = ca.counsel_manager_id
WHERE ca.is_deleted = FALSE
ORDER BY ca.created_at DESC;
