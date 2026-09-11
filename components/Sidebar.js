import { signOut } from "next-auth/react";

// 참고 화면(보험사업부 사이드바)과 동일한 메뉴 구성. 지금은 "파이낸셜"(이 대시보드)만 실제로
// 만들어져 있어서 나머지는 비활성 표시만 해둔다 — 각 사업부 대시보드가 생기면 href를 연결한다.
const NAV_ITEMS = [
  { key: "all", label: "전체", sub: "구글 시트 기준", active: false },
  { key: "financial", label: "파이낸셜", sub: "자동차보험", active: true },
  { key: "partners", label: "파트너스", sub: "장기보험", active: false },
  { key: "insurance", label: "인슈어런스", sub: "GA", active: false },
  { key: "counselor", label: "상담사", sub: "콜·계약 월별", active: false },
];

export default function Sidebar() {
  return (
    <div className="sidebar">
      <div className="brand">
        <span className="badge">AJD</span>
        <span className="name">보험사업부</span>
      </div>
      <nav>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`nav-item ${item.active ? "active" : "disabled"}`}
            disabled={!item.active}
            title={item.active ? undefined : "준비중"}
          >
            <span>{item.label}</span>
            <span className="sub">{item.sub}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <button type="button" onClick={() => signOut({ callbackUrl: "/login" })}>
          로그아웃
        </button>
      </div>
    </div>
  );
}
