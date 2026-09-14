import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../lib/authOptions";
import { loadRawRows, loadCallRows, toClientRows } from "../lib/data";
import { unpackRows } from "../lib/pack";
import {
  aggregateContractSummary,
  aggregateDailyByChannel,
  aggregateMembers,
  aggregateByManager,
  aggregateInsurerPivot,
  aggregateGroupBreakdown,
  REVENUE_RATE,
} from "../lib/aggregate";
import { formatWon, formatCount, formatPercent, formatDateLabel } from "../lib/format";
import { GROUPS } from "../lib/groups";
import FilterBar from "../components/FilterBar";
import Sidebar from "../components/Sidebar";
import ChannelStackedChart, { CHANNEL_PALETTE } from "../components/ChannelStackedChart";

// 방문마다 새로 실행된다(getServerSideProps) — loadRawRows()가 매번 Snowflake를 직접 조회하므로
// 화면은 항상 그 시점 최신 데이터를 보여준다. Snowflake 조회가 실패하면 lib/data.js가 자동으로
// Blob 스냅샷 → 로컬 CSV 순으로 폴백한다.
export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session) {
    return { redirect: { destination: "/login", permanent: false } };
  }

  const raw = await loadRawRows();
  const packedRows = toClientRows(raw);
  const callRows = loadCallRows();
  // 데이터가 아예 없으면(Snowflake·Blob·로컬 CSV 전부 실패/빈 상태) reduce가 빈 문자열을 돌려주는데,
  // 화면의 날짜 계산(daysAgoDate 등)이 그걸 그대로 new Date()에 넘기면 깨진다 — 오늘 날짜로 대체한다.
  const today = new Date().toISOString().slice(0, 10);
  const dateMin = packedRows.reduce((m, r) => (m === "" || r[0] < m ? r[0] : m), "") || today;
  const dateMax = packedRows.reduce((m, r) => (m === "" || r[0] > m ? r[0] : m), "") || today;
  const managers = [...new Set(raw.map((r) => r.managerName).filter(Boolean))].sort();
  return {
    props: {
      packedRows,
      callRows,
      managers,
      bounds: { min: dateMin, max: dateMax },
    },
  };
}

// "YYYY-MM-DD"에서 n일 전 날짜를 돌려준다.
function daysAgoDate(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// "YYYY-MM-DD"가 속한 주(월요일)의 날짜를 돌려준다.
function startOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

const INFLOW_PRESETS = [
  { key: "7", label: "최근 7일" },
  { key: "14", label: "최근 14일" },
  { key: "30", label: "최근 30일" },
  { key: "all", label: "전체" },
];

const GRANULARITY_TABS = [
  { key: "daily", label: "일간" },
  { key: "weekly", label: "주간" },
  { key: "monthly", label: "월간" },
];

const MAIN_TABS = [
  { key: "summary", label: "실적(전체)" },
  { key: "sales", label: "② 영업현황(원수보험료)" },
  { key: "members", label: "③ 앱가입현황" },
  { key: "manager", label: "④ 매니저 실적" },
];

// "YYYY-MM"이 속한 달의 마지막 날짜("YYYY-MM-DD")를 돌려준다.
function monthEndDate(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export default function Home({ packedRows, callRows, managers, bounds }) {
  const rows = useMemo(() => unpackRows(packedRows), [packedRows]);

  // 날짜 범위를 직접 고르는 기간 필터 대신, 연도 하나만 선택해서 그 해 1/1 ~ (올해면 오늘, 지난해면
  // 12/31)까지를 기간으로 쓴다. bounds.min/max는 선택 가능한 연도 범위를 정하는 데만 쓴다.
  const maxYear = Number(bounds.max.slice(0, 4));
  const minYear = Number(bounds.min.slice(0, 4));
  const years = useMemo(() => {
    const arr = [];
    for (let y = maxYear; y >= minYear; y -= 1) arr.push(y);
    return arr;
  }, [maxYear, minYear]);
  const [year, setYear] = useState(maxYear);
  const dateFrom = `${year}-01-01`;
  const dateTo = year === maxYear ? bounds.max : `${year}-12-31`;
  const [manager, setManager] = useState("ALL");
  const [activeTab, setActiveTab] = useState("summary");

  const resetFilters = () => {
    setYear(maxYear);
    setManager("ALL");
  };

  // ── [1] 실적(전체) ─────────────────────────────────────────────
  const contractSummary = useMemo(
    () => aggregateContractSummary(rows, callRows, { dateFrom, dateTo, manager }),
    [rows, callRows, dateFrom, dateTo, manager]
  );
  const t = contractSummary.totals;

  // 월별 표에서 한 달을 클릭하면(또는 아래 "기간" 선택에서 고르면) 그 달의 채널별·상담사별
  // 상세로 화면이 바뀐다. year를 바꾸면 지금 보던 달이 그 해에 없을 수 있으니 초기화한다.
  const [monthFilter, setMonthFilter] = useState("ALL");
  useEffect(() => {
    setMonthFilter("ALL");
  }, [year]);
  const monthDetailRange = useMemo(() => {
    if (monthFilter === "ALL") return null;
    const end = monthEndDate(monthFilter);
    return { from: `${monthFilter}-01`, to: end > bounds.max ? bounds.max : end };
  }, [monthFilter, bounds.max]);
  const monthSummary = useMemo(
    () =>
      monthDetailRange
        ? aggregateContractSummary(rows, callRows, { dateFrom: monthDetailRange.from, dateTo: monthDetailRange.to, manager })
            .totals
        : null,
    [rows, callRows, monthDetailRange, manager]
  );
  const channelBreakdown = useMemo(
    () =>
      monthDetailRange
        ? aggregateGroupBreakdown(rows, { dateFrom: monthDetailRange.from, dateTo: monthDetailRange.to, manager, groupBy: "channel" })
        : null,
    [rows, monthDetailRange, manager]
  );
  const managerBreakdown = useMemo(
    () =>
      monthDetailRange
        ? aggregateGroupBreakdown(rows, { dateFrom: monthDetailRange.from, dateTo: monthDetailRange.to, manager, groupBy: "managerName" })
        : null,
    [rows, monthDetailRange, manager]
  );

  // ── [2] 고객 인입 지표 (상단 연도 선택과 별개로, 이 섹션만의 기간 선택을 쓴다) ──
  const [inflowPreset, setInflowPreset] = useState("14");
  const [inflowFrom, setInflowFrom] = useState(() => daysAgoDate(bounds.max, 13));
  const [inflowTo, setInflowTo] = useState(bounds.max);
  const [channelFilter, setChannelFilter] = useState(null); // null = 전체
  const [granularity, setGranularity] = useState("daily");

  const applyInflowPreset = (preset) => {
    setInflowPreset(preset);
    if (preset === "all") {
      setInflowFrom(bounds.min);
      setInflowTo(bounds.max);
      return;
    }
    const days = Number(preset);
    setInflowFrom(daysAgoDate(bounds.max, days - 1));
    setInflowTo(bounds.max);
  };

  const allChannels = useMemo(() => [...new Set(rows.map((r) => r.channel))].sort(), [rows]);
  const inflowRows = useMemo(
    () => (channelFilter ? rows.filter((r) => r.channel === channelFilter) : rows),
    [rows, channelFilter]
  );
  const inflowChart = useMemo(
    () => aggregateDailyByChannel(inflowRows, { dateFrom: inflowFrom, dateTo: inflowTo, granularity }),
    [inflowRows, inflowFrom, inflowTo, granularity]
  );
  const dealChart = useMemo(
    () =>
      aggregateDailyByChannel(inflowRows, {
        dateFrom: inflowFrom,
        dateTo: inflowTo,
        status: "JOIN_COMPLETED",
        granularity,
      }),
    [inflowRows, inflowFrom, inflowTo, granularity]
  );

  // ── [3] 회원 지표 ──────────────────────────────────────────────
  const [memberChannel, setMemberChannel] = useState("ALL");
  const members = useMemo(
    () => aggregateMembers(rows, { dateFrom, dateTo, channel: memberChannel }),
    [rows, dateFrom, dateTo, memberChannel]
  );
  const groupLabel = (code) => GROUPS.find((g) => g.code === code)?.label || code;

  // ── [4] 매니저 실적 ────────────────────────────────────────────
  const [managerPeriod, setManagerPeriod] = useState("daily");
  const managerPeriodRange = useMemo(() => {
    const today = bounds.max;
    if (managerPeriod === "monthly") return { from: `${today.slice(0, 7)}-01`, to: today };
    if (managerPeriod === "weekly") return { from: startOfWeek(today), to: today };
    return { from: today, to: today };
  }, [managerPeriod, bounds.max]);
  const managerSummary = useMemo(
    () => aggregateByManager(rows, callRows, { dateFrom: managerPeriodRange.from, dateTo: managerPeriodRange.to }),
    [rows, callRows, managerPeriodRange]
  );
  // 상단 필터바의 "매니저" 선택 = 본인 기준. 전체(ALL)일 땐 개인화 위젯을 숨긴다.
  const myMembers = useMemo(
    () => aggregateMembers(rows, { dateFrom, dateTo, manager }),
    [rows, dateFrom, dateTo, manager]
  );
  const myInsurerPivot = useMemo(
    () => aggregateInsurerPivot(rows, { dateFrom, dateTo, manager }),
    [rows, dateFrom, dateTo, manager]
  );

  return (
    <>
      <Head>
        <title>다이렉트 대시보드 for AFART</title>
        <meta name="robots" content="noindex, nofollow, noarchive" />
      </Head>

      <div className="app-shell">
        <Sidebar mainTabs={MAIN_TABS} activeMainTab={activeTab} onMainTabChange={setActiveTab} />
        <div className="app-main">
          <FilterBar
            year={year}
            years={years}
            onYear={setYear}
            manager={manager}
            onManager={setManager}
            managers={managers}
            onReset={resetFilters}
          />

          <div className="page">
            <div className="page-head">
              <div>
                <h1>파이낸셜</h1>
                <p className="sub">
                  체결(지급대기·가입완료) 기준 원수 데이터 · 원수보험료×{Math.round(REVENUE_RATE * 100)}% = 매출액
                </p>
              </div>
              <span className="range-chip">
                {dateFrom} ~ {dateTo}
              </span>
            </div>

        {/* ============ 1. 실적(전체) ============ */}
        {activeTab === "summary" && (
        <section className="section">
          <div className="section-head">
            <h2>실적(전체){manager !== "ALL" ? ` — ${manager}` : ""}</h2>
          </div>
          <p className="section-note">
            접수는 <b>상담이 생성된 달</b> 기준, 계약·원수보험료·매출액은 <b>매출로 인식된(체결) 달</b> 기준입니다 — 같은 달이어도 서로 다른
            건을 셉니다. 계약 건수는 가입완료(JOIN_COMPLETED)만 세고, 원수보험료는 가입완료+지급대기 합산입니다.
          </p>

          <div className="pill-block">
            <span className="pill-block-label">기간</span>
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              style={{ fontFamily: "inherit", fontSize: 13, padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 6 }}
            >
              <option value="ALL">전체 · 월별</option>
              {contractSummary.months.map((m) => (
                <option key={m.month} value={m.month}>
                  {formatDateLabel(m.month)}
                </option>
              ))}
            </select>
            {monthFilter !== "ALL" && (
              <button type="button" className="filter-reset" onClick={() => setMonthFilter("ALL")}>
                ← 월별 목록으로
              </button>
            )}
          </div>

          {(() => {
            const k = monthFilter === "ALL" ? t : monthSummary;
            return (
              <div className="kpi-row kpi-row-6">
                <div className="kpi-card">
                  <div className="label">접수</div>
                  <div className="value">
                    {k.received.toLocaleString("ko-KR")}
                    <span className="unit">건</span>
                  </div>
                </div>
                <div className="kpi-card">
                  <div className="label">계약</div>
                  <div className="value">
                    {k.dealsTotal.toLocaleString("ko-KR")}
                    <span className="unit">건</span>
                  </div>
                </div>
                <div className="kpi-card">
                  <div className="label">갱신</div>
                  <div className="value">
                    {k.dealsRenewal.toLocaleString("ko-KR")}
                    <span className="unit">건</span>
                  </div>
                </div>
                <div className="kpi-card">
                  <div className="label">전환율</div>
                  <div className="value">{formatPercent(k.conversionRate)}</div>
                </div>
                <div className="kpi-card">
                  <div className="label">원수보험료</div>
                  <div className="value" style={{ fontSize: 17 }}>
                    {formatWon(k.premiumSum)}
                  </div>
                </div>
                <div className="kpi-card">
                  <div className="label">매출액</div>
                  <div className="value" style={{ fontSize: 17 }}>
                    {formatWon(k.revenue)}
                  </div>
                </div>
              </div>
            );
          })()}

          {monthFilter === "ALL" ? (
            <div className="table-wrap table-scroll-6">
              <table className="data">
                <thead>
                  <tr>
                    <th>월</th>
                    <th>접수</th>
                    <th>계약</th>
                    <th>갱신</th>
                    <th>전환율</th>
                    <th>원수보험료</th>
                    <th>매출액</th>
                  </tr>
                </thead>
                <tbody>
                  {contractSummary.months.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", color: "var(--ink-faint)" }}>
                        선택한 기간에 데이터가 없습니다.
                      </td>
                    </tr>
                  )}
                  {contractSummary.months.map((m) => (
                    <tr key={m.month} className="row-clickable" onClick={() => setMonthFilter(m.month)}>
                      <td style={{ textAlign: "left" }}>{formatDateLabel(m.month)}</td>
                      <td>{formatCount(m.received)}</td>
                      <td>{formatCount(m.dealsTotal)}</td>
                      <td>{formatCount(m.dealsRenewal)}</td>
                      <td>{formatPercent(m.conversionRate)}</td>
                      <td>{formatWon(m.premiumSum)}</td>
                      <td>{formatWon(m.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ textAlign: "left" }}>합계</td>
                    <td>{formatCount(t.received)}</td>
                    <td>{formatCount(t.dealsTotal)}</td>
                    <td>{formatCount(t.dealsRenewal)}</td>
                    <td>{formatPercent(t.conversionRate)}</td>
                    <td>{formatWon(t.premiumSum)}</td>
                    <td>{formatWon(t.revenue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <>
              <p className="section-note">
                아래 채널별·상담사별 접수는 콜 생성 기준이 아니라 <b>{formatDateLabel(monthFilter)}에 원수 데이터상 진행된(취소 제외) 건수</b>
                입니다 — 콜 데이터에는 채널 정보가 없어서, 위 KPI의 접수(콜 생성 기준)와 아래 표의 접수 합계가 다를 수 있습니다.
              </p>

              <div className="group">
                <div className="section-head">
                  <h2>채널별</h2>
                </div>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>채널</th>
                        <th>접수</th>
                        <th>구성비</th>
                        <th>계약</th>
                        <th>전환율</th>
                        <th>원수보험료</th>
                        <th>매출액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {channelBreakdown.groups.length === 0 && (
                        <tr>
                          <td colSpan={7} style={{ textAlign: "center", color: "var(--ink-faint)" }}>
                            해당 월에 데이터가 없습니다.
                          </td>
                        </tr>
                      )}
                      {channelBreakdown.groups.map((g) => (
                        <tr key={g.key}>
                          <td style={{ textAlign: "left" }}>{g.key}</td>
                          <td>{formatCount(g.received)}</td>
                          <td>{formatPercent(g.share)}</td>
                          <td>{formatCount(g.dealsTotal)}</td>
                          <td>{formatPercent(g.conversionRate)}</td>
                          <td>{formatWon(g.premiumSum)}</td>
                          <td>{formatWon(g.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td style={{ textAlign: "left" }}>합계</td>
                        <td>{formatCount(channelBreakdown.totals.received)}</td>
                        <td>{formatPercent(channelBreakdown.totals.share)}</td>
                        <td>{formatCount(channelBreakdown.totals.dealsTotal)}</td>
                        <td>{formatPercent(channelBreakdown.totals.conversionRate)}</td>
                        <td>{formatWon(channelBreakdown.totals.premiumSum)}</td>
                        <td>{formatWon(channelBreakdown.totals.revenue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="group" style={{ marginTop: 24 }}>
                <div className="section-head">
                  <h2>상담사별</h2>
                </div>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>상담사</th>
                        <th>접수</th>
                        <th>계약</th>
                        <th>전환율</th>
                        <th>원수보험료</th>
                        <th>매출액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {managerBreakdown.groups.length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ textAlign: "center", color: "var(--ink-faint)" }}>
                            해당 월에 데이터가 없습니다.
                          </td>
                        </tr>
                      )}
                      {managerBreakdown.groups.map((g) => (
                        <tr key={g.key}>
                          <td style={{ textAlign: "left" }}>{g.key}</td>
                          <td>{formatCount(g.received)}</td>
                          <td>{formatCount(g.dealsTotal)}</td>
                          <td>{formatPercent(g.conversionRate)}</td>
                          <td>{formatWon(g.premiumSum)}</td>
                          <td>{formatWon(g.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td style={{ textAlign: "left" }}>합계</td>
                        <td>{formatCount(managerBreakdown.totals.received)}</td>
                        <td>{formatCount(managerBreakdown.totals.dealsTotal)}</td>
                        <td>{formatPercent(managerBreakdown.totals.conversionRate)}</td>
                        <td>{formatWon(managerBreakdown.totals.premiumSum)}</td>
                        <td>{formatWon(managerBreakdown.totals.revenue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
        )}

        {/* ============ 2. 영업현황(원수보험료) ============ */}
        {activeTab === "sales" && (
        <section className="section">
          <div className="section-head">
            <h2>고객 인입 지표</h2>
          </div>
          <p className="section-note">
            "유입"은 취소를 제외한 전체 진행 건(최소 지급대기까지 도달한 건 기준 — raw 데이터에 비교견적 등 진행중 상담이 없어 완전한
            원천 유입은 아닙니다), "체결"은 그중 가입완료(JOIN_COMPLETED)만입니다. 이 섹션의 기간은 상단 연도 선택과 별개입니다.
          </p>

          <div className="pill-block">
            <span className="pill-block-label">기간 단위</span>
            <div className="pill-group">
              {GRANULARITY_TABS.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  className={`pill ${granularity === g.key ? "active" : ""}`}
                  onClick={() => setGranularity(g.key)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pill-block">
            <span className="pill-block-label">조회 기간</span>
            <div className="pill-group">
              {INFLOW_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`pill ${inflowPreset === p.key ? "active" : ""}`}
                  onClick={() => applyInflowPreset(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="pill-daterange">
              <input
                type="date"
                value={inflowFrom}
                min={bounds.min}
                max={inflowTo}
                onChange={(e) => {
                  setInflowPreset(null);
                  setInflowFrom(e.target.value);
                }}
              />
              <span className="sep">~</span>
              <input
                type="date"
                value={inflowTo}
                min={inflowFrom}
                max={bounds.max}
                onChange={(e) => {
                  setInflowPreset(null);
                  setInflowTo(e.target.value);
                }}
              />
            </div>
          </div>

          <div className="pill-block" style={{ marginBottom: 20 }}>
            <span className="pill-block-label">표시 채널</span>
            <div className="pill-group">
              {allChannels.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  className={`pill ${channelFilter === c ? "active" : ""}`}
                  onClick={() => setChannelFilter(channelFilter === c ? null : c)}
                >
                  <span className="dot" style={{ background: CHANNEL_PALETTE[i % CHANNEL_PALETTE.length] }} />
                  {c}
                </button>
              ))}
              <button type="button" className={`pill ${!channelFilter ? "active" : ""}`} onClick={() => setChannelFilter(null)}>
                전체
              </button>
            </div>
            <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>채널을 누르면 그 채널만 봅니다</span>
          </div>

          <div className="grid-2" style={{ gridTemplateColumns: "1fr" }}>
            <div className="card">
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>유입</div>
              <ChannelStackedChart channels={inflowChart.channels} data={inflowChart.data} />
            </div>
            <div className="card" style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>체결</div>
              <ChannelStackedChart channels={dealChart.channels} data={dealChart.data} />
            </div>
          </div>

          <div className="group" style={{ marginTop: 28 }}>
            <div className="section-head">
              <h2>실적 제외 리스트</h2>
            </div>
            <div className="card" style={{ padding: "20px 20px", color: "var(--ink-muted)" }}>
              <p style={{ margin: "0 0 8px", fontSize: 13 }}>
                신규 가입보험사와 기존 가입보험사가 같은(자기전환) 건을 실적에서 빼서 여기 별도로 보여줄 예정입니다.
              </p>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-faint)" }}>
                지금 Snowflake 조회 쿼리에는 "기존 가입보험사" 값이 없어서 아직 판정을 못 합니다 — 이 필드를 조회에 추가하면 바로
                채우겠습니다.
              </p>
            </div>
          </div>
        </section>
        )}

        {/* ============ 3. 앱가입현황 ============ */}
        {activeTab === "members" && (
        <section className="section">
          <div className="section-head">
            <h2>회원 지표</h2>
            <div className="filter-field">
              <label>영업채널</label>
              <select value={memberChannel} onChange={(e) => setMemberChannel(e.target.value)}>
                <option value="ALL">전체</option>
                {GROUPS.map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="section-note">
            상단에서 선택한 연도({year}년, {dateFrom} ~ {dateTo}) 안에서 체결 이력이 있는 딜러(회원) 기준입니다. "영업채널"은 딜러유형(신차딜러
            수입/국산·중고차딜러·보험설계사·에이전시) 기준으로 분류됩니다.
          </p>

          <div className="kpi-row">
            <div className="kpi-card">
              <div className="label">전체 회원(딜러) 수</div>
              <div className="value">
                {members.totalDealers.toLocaleString("ko-KR")}
                <span className="unit">명</span>
              </div>
            </div>
            {members.byGroup.slice(0, 3).map((g) => (
              <div className="kpi-card" key={g.group}>
                <div className="label">{groupLabel(g.group)}</div>
                <div className="value">
                  {g.dealerCount.toLocaleString("ko-KR")}
                  <span className="unit">명</span>
                </div>
              </div>
            ))}
          </div>

          {members.byGroup.length > 3 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
              {members.byGroup.slice(3).map((g) => (
                <span key={g.group} className="chip">
                  {groupLabel(g.group)} {formatCount(g.dealerCount)}
                </span>
              ))}
            </div>
          )}

          <div className="table-wrap table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th rowSpan={2}>순위</th>
                  <th rowSpan={2}>딜러명</th>
                  <th rowSpan={2}>영업채널</th>
                  <th rowSpan={2}>체결 매니저</th>
                  <th rowSpan={2}>체결건수</th>
                  <th colSpan={3}>원수보험료</th>
                </tr>
                <tr>
                  <th>전체</th>
                  <th>신규</th>
                  <th>갱신</th>
                </tr>
              </thead>
              <tbody>
                {members.dealers.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", color: "var(--ink-faint)" }}>
                      해당 조건에 회원이 없습니다.
                    </td>
                  </tr>
                )}
                {members.dealers.slice(0, 50).map((d, i) => (
                  <tr key={d.dealerKey}>
                    <td>
                      <span className={`rank-badge ${i < 3 ? "top" : ""}`}>{i + 1}</span>
                    </td>
                    <td style={{ textAlign: "left" }}>{d.dealerName}</td>
                    <td>{groupLabel(d.group)}</td>
                    <td>{d.managerName}</td>
                    <td>{formatCount(d.count)}</td>
                    <td style={{ fontWeight: 600 }}>{formatWon(d.premiumSum)}</td>
                    <td>{formatWon(d.premiumSumNew)}</td>
                    <td>{formatWon(d.premiumSumRenewal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        )}

        {/* ============ 4. 매니저 실적 ============ */}
        {activeTab === "manager" && (
        <section className="section">
          <div className="section-head">
            <h2>기간별 매니저 실적</h2>
          </div>
          <p className="section-note">
            접수는 <b>상담 생성일</b>, 계약·원수보험료는 <b>체결(매출인식)일</b> 기준입니다. 일간=오늘, 주간=이번주(월~오늘),
            월간=이번달(1일~오늘) 데이터입니다.
          </p>

          <div className="pill-block">
            <div className="pill-group">
              {GRANULARITY_TABS.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  className={`pill ${managerPeriod === g.key ? "active" : ""}`}
                  onClick={() => setManagerPeriod(g.key)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div className="table-wrap table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th rowSpan={2}>매니저</th>
                  <th rowSpan={2}>접수</th>
                  <th colSpan={3}>계약</th>
                  <th rowSpan={2}>전환율</th>
                  <th colSpan={3}>원수보험료</th>
                </tr>
                <tr>
                  <th>신규</th>
                  <th>갱신</th>
                  <th>합계</th>
                  <th>전체</th>
                  <th>신규</th>
                  <th>갱신</th>
                </tr>
              </thead>
              <tbody>
                {managerSummary.managers.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: "center", color: "var(--ink-faint)" }}>
                      해당 기간에 데이터가 없습니다.
                    </td>
                  </tr>
                )}
                {managerSummary.managers.map((m) => (
                  <tr key={m.managerName}>
                    <td style={{ textAlign: "left" }}>{m.managerName}</td>
                    <td>{formatCount(m.received)}</td>
                    <td>{formatCount(m.dealsNew)}</td>
                    <td>{formatCount(m.dealsRenewal)}</td>
                    <td>{formatCount(m.dealsTotal)}</td>
                    <td>{formatPercent(m.conversionRate)}</td>
                    <td style={{ fontWeight: 600 }}>{formatWon(m.premiumSum)}</td>
                    <td>{formatWon(m.premiumSumNew)}</td>
                    <td>{formatWon(m.premiumSumRenewal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="group" style={{ marginTop: 28 }}>
            <div className="section-head">
              <h2>본인 담당 현황{manager !== "ALL" ? ` — ${manager}` : ""}</h2>
            </div>
            {manager === "ALL" ? (
              <div className="card" style={{ padding: "20px 20px", color: "var(--ink-muted)" }}>
                <p style={{ margin: 0, fontSize: 13 }}>
                  상단 필터바에서 매니저를 선택하면 본인 담당 그룹별 배정 회원수·보험사별 체결 원수보험료를 보여줍니다.
                </p>
              </div>
            ) : (
              <div className="grid-2">
                <div className="card">
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>G1~G5 그룹별 배정 회원수</div>
                  <table className="data" style={{ minWidth: 0 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>그룹</th>
                        <th>배정 회원수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myMembers.byGroup.length === 0 && (
                        <tr>
                          <td colSpan={2} style={{ textAlign: "center", color: "var(--ink-faint)" }}>
                            해당 기간에 배정 회원이 없습니다.
                          </td>
                        </tr>
                      )}
                      {myMembers.byGroup.map((g) => (
                        <tr key={g.group}>
                          <td style={{ textAlign: "left" }}>{groupLabel(g.group)}</td>
                          <td>{formatCount(g.dealerCount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="card">
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                    체결 보험사 × 가입유형별 원수보험료
                  </div>
                  <table className="data" style={{ minWidth: 0 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>보험사</th>
                        {myInsurerPivot.types.map((t) => (
                          <th key={t}>{t}</th>
                        ))}
                        <th>합계</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myInsurerPivot.rows.length === 0 && (
                        <tr>
                          <td colSpan={myInsurerPivot.types.length + 2} style={{ textAlign: "center", color: "var(--ink-faint)" }}>
                            해당 기간에 체결 건이 없습니다.
                          </td>
                        </tr>
                      )}
                      {myInsurerPivot.rows.map((r) => (
                        <tr key={r.insurer}>
                          <td style={{ textAlign: "left" }}>{r.insurer}</td>
                          {myInsurerPivot.types.map((t) => (
                            <td key={t}>{formatWon(r.byType[t])}</td>
                          ))}
                          <td style={{ fontWeight: 600 }}>{formatWon(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>
        )}
          </div>

          <footer className="foot">다이렉트 대시보드 for AFART · Snowflake 실시간 연동</footer>
        </div>
      </div>
    </>
  );
}
