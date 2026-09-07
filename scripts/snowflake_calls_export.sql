-- ============================================================================
-- 매니저별 "콜(상담 생성)" 데이터 export — 신규/갱신 체결률(코호트 방식) 계산용
--
-- 배경: 기존 raw_query.csv는 이미 결론이 난(지급대기/가입완료/가입취소) 상담만
-- 담고 있어서, 아직 진행중이거나 다른 이유로 멈춰있는 상담(=아직 결론 안 난 콜)은
-- 통째로 빠져 있다. "OO월에 새로 들어온 상담 중 몇 건이 결국 체결됐는가"를 보려면
-- 상태와 무관하게 그 달에 생성된 COUNSEL_APPLICATION을 전부 알아야 한다.
--
-- 집계 방식(코호트): 상담 "생성일" 기준으로 그룹을 묶고, 그 그룹이 최종적으로
-- (생성월이 지난 뒤라도) 체결됐는지를 본다. 예: 8월에 생성된 상담이 9월에
-- 가입완료로 처리돼도 "8월 콜"의 전환 건으로 센다. 이건 대시보드의 다른 집계
-- (체결일=매출인식일 기준 월별 실적)와는 기준이 다른, 별도 목적의 데이터다.
--
-- 그레인: 상담(counsel_application) 1건 = 1행. 같은 고객이 여러 번 상담해도
-- 각각 별도 콜로 센다 (고객 단위가 아니라 상담 단위가 맞다고 확인됨).
-- 차량(counsel_vehicle) 등록 여부와 무관하게 전부 포함해야 하므로, 기존
-- snowflake_sales_export.sql과 달리 COUNSEL_VEHICLE을 조인하지 않는다.
--
-- "전환 여부"는 대시보드가 최종상태(counsel_status)가 ACCUMULATE_PENDING 또는
-- JOIN_COMPLETED인 경우로 판단한다 (기존 매출 집계와 동일한 기준, lib/aggregate.js
-- 의 aggregateManagerFunnel 참고).
--
-- 사용법: 그대로 실행 → 결과창 "Download Results" → CSV 다운로드 →
-- afart-dashboard-demo/data/calls.csv로 교체.
-- ============================================================================

SELECT
  ca.counsel_id                                        AS "상담ID",
  TO_CHAR(ca.created_at, 'YYYY-MM-DD')                 AS "생성일자",
  m.name                                                AS "담당매니저",
  CASE WHEN ca.is_renewal THEN '갱신' ELSE '신규' END   AS "상담구분",
  ca.counsel_status                                     AS "최종상태"
FROM AJDCAR_PROD.PUBLIC.COUNSEL_APPLICATION ca
LEFT JOIN AJDCAR_PROD.PUBLIC.MANAGER m ON m.id = ca.counsel_manager_id
WHERE ca.is_deleted = FALSE
ORDER BY ca.created_at DESC;
