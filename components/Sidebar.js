import { signOut } from "next-auth/react";

// "상담사"는 아직 실제로 만들어져 있지 않아 비활성 표시만 해둔다.
const TRAILING_ITEMS = [{ key: "counselor", label: "상담사", sub: "콜·계약 월별", active: false }];

// mainTabs(=실적(전체)/영업현황/앱가입현황/매니저실적)는 더 이상 "파이낸셜" 아래 옆 탭이 아니라
// 사이드바의 메인 메뉴 항목 그 자체로 나온다.
export default function Sidebar({ mainTabs, activeMainTab, onMainTabChange }) {
  return (
    <div className="sidebar">
      <div className="brand">
        <span className="badge">AJD</span>
        <span className="name">보험사업부</span>
      </div>
      <nav>
        {mainTabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            className={`nav-item ${activeMainTab === tb.key ? "active" : ""}`}
            onClick={() => onMainTabChange(tb.key)}
          >
            <span>{tb.label}</span>
          </button>
        ))}
        {TRAILING_ITEMS.map((item) => (
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
