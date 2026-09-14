import { signOut } from "next-auth/react";

// 지금은 "파이낸셜"(이 대시보드)만 실제로 만들어져 있어서 "상담사"는 비활성 표시만 해둔다.
// 전체(구글 시트 기준)·파트너스·인슈어런스는 필요 없어 제거했다.
const NAV_ITEMS = [
  { key: "financial", label: "파이낸셜", sub: "자동차보험", active: true },
  { key: "counselor", label: "상담사", sub: "콜·계약 월별", active: false },
];

// mainTabs가 주어지면(=파이낸셜 대시보드의 ①~④ 리포트 탭), "파이낸셜" 항목 바로 아래에
// 옆 탭(side tab)으로 붙여서 보여준다. 상단 가로 탭바 대신 사이드바 안에 세로로 배치.
export default function Sidebar({ mainTabs, activeMainTab, onMainTabChange }) {
  return (
    <div className="sidebar">
      <div className="brand">
        <span className="badge">AJD</span>
        <span className="name">보험사업부</span>
      </div>
      <nav>
        {NAV_ITEMS.map((item) => (
          <div key={item.key} className="nav-group">
            <button
              type="button"
              className={`nav-item ${item.active ? "active" : "disabled"}`}
              disabled={!item.active}
              title={item.active ? undefined : "준비중"}
            >
              <span>{item.label}</span>
              <span className="sub">{item.sub}</span>
            </button>
            {item.active && mainTabs && (
              <div className="nav-subtabs">
                {mainTabs.map((tb) => (
                  <button
                    key={tb.key}
                    type="button"
                    className={`nav-subtab ${activeMainTab === tb.key ? "active" : ""}`}
                    onClick={() => onMainTabChange(tb.key)}
                  >
                    {tb.label}
                    {tb.soon && <span className="soon">준비중</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
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
