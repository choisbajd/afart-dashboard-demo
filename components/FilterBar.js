export default function FilterBar({ year, years, onYear, manager, onManager, managers, onReset }) {
  return (
    <div className="filter-bar">
      <div className="filter-field">
        <label>연도</label>
        <select value={year} onChange={(e) => onYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
      </div>

      <div className="filter-field">
        <label>매니저</label>
        <select value={manager} onChange={(e) => onManager(e.target.value)}>
          <option value="ALL">전체 (관리자 보기)</option>
          {managers.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <button className="filter-reset" onClick={onReset}>
        필터 초기화
      </button>

      <div className="filter-scope">
        {manager === "ALL" ? (
          <>현재 <b>전체 매니저</b> 기준으로 보고 있습니다</>
        ) : (
          <>현재 <b>{manager}</b> 매니저 본인 기준으로 보고 있습니다</>
        )}
      </div>
    </div>
  );
}
