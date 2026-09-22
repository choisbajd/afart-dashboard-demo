// fs를 쓰지 않는 순수 유틸이라 클라이언트 번들에도 안전하게 포함된다.
// lib/data.js의 CLIENT_ROW_FIELDS 순서로 packed된 배열을 다시 객체 배열로 복원한다.
export function unpackRows(packed) {
  return packed.map(
    ([
      date,
      premium,
      insurer,
      joinType,
      channel,
      dealerKey,
      dealerName,
      managerName,
      group,
      hasComparison,
      prospectToCompDays,
      compToJoinDays,
      currentStatus,
      dealerManagerName,
      consultType,
      dealerJoinDate,
      counselId,
    ]) => ({
      date,
      premium,
      insurer,
      joinType,
      channel,
      dealerKey,
      dealerName,
      managerName,
      group,
      hasComparison: !!hasComparison,
      prospectToCompDays,
      compToJoinDays,
      currentStatus,
      dealerManagerName,
      consultType,
      dealerJoinDate: dealerJoinDate || "",
      counselId,
    })
  );
}

// lib/dbData.js의 DB_CLIENT_FIELDS 순서로 packed된 배열을 복원한다.
export function unpackDbRows(packed) {
  return packed.map(
    ([
      counselId,
      createdDate,
      channel,
      consultType,
      currentStatus,
      managerId,
      managerName,
      isContracted,
      contractDate,
      hasComparison,
      lastActivityDate,
      premium,
      vehicleCount,
    ]) => ({
      counselId,
      createdDate,
      channel,
      consultType,
      currentStatus,
      managerId,
      managerName,
      isContracted: !!isContracted,
      contractDate,
      hasComparison: !!hasComparison,
      lastActivityDate,
      premium,
      vehicleCount,
    })
  );
}
