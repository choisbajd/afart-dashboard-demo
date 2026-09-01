// 딜러유형(business_type) + 신차딜러 세부유형(business_sub_type) 기준 그룹 배정.
// 배치도 문서 기준: G1 = 신차딜러(수입/IMPORTED), G2 = 신차딜러(국산/DOMESTIC).
// business_sub_type이 없는 raw pull(구버전 CSV)에서는 신차딜러를 NEW로 하나로 묶는다.
export const GROUPS = [
  { code: "G1", label: "신차딜러(수입)" },
  { code: "G2", label: "신차딜러(국산)" },
  { code: "NEW", label: "신차딜러 (수입/국산 미구분)" },
  { code: "USED", label: "중고차딜러" },
  { code: "AGENT", label: "보험설계사" },
  { code: "AGENCY", label: "에이전시" },
  { code: "ETC", label: "미분류" },
];

const MAP = {
  USED_CAR_DEALER: "USED",
  INSURANCE_AGENT: "AGENT",
  AGENCY: "AGENCY",
};

export function groupOf(dealerType, businessSubType) {
  if (dealerType === "NEW_CAR_DEALER") {
    if (businessSubType === "IMPORTED") return GROUPS.find((g) => g.code === "G1");
    if (businessSubType === "DOMESTIC") return GROUPS.find((g) => g.code === "G2");
    return GROUPS.find((g) => g.code === "NEW");
  }
  const code = MAP[dealerType] || "ETC";
  return GROUPS.find((g) => g.code === code);
}
