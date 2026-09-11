import { useMemo, useState } from "react";
import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../lib/authOptions";
import { loadRawRows, loadCallRows, toClientRows } from "../lib/data";
import { unpackRows } from "../lib/pack";
import {
  aggregateContractSummary,
  aggregateDailyByChannel,
  aggregateMembers,
  REVENUE_RATE,
} from "../lib/aggregate";
import { formatWon, formatCompactWon, formatCount, formatPercent, formatDateLabel } from "../lib/format";
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

export default function Home({ packedRows, callRows, managers, bounds }) {
  const rows = useMemo(() => unpackRows(packedRows), [packedRows]);

  // 기본 기간 = 이번 달 1일 ~ 오늘(=데이터상 최신일). bounds.min/max는 date input의 선택 가능 범위로만 쓴다.
  const defaultDateTo = bounds.max;
  const defaultDateFrom = `${defaultDateTo.slice(0, 7)}-01`;
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [manager, setManager] = useState("ALL");

  const resetFilters = () => {
    setDateFrom(defaultDateFrom);
    setDateTo(defaultDateTo);
    setManager("ALL");
  };

  // ── [1] 체결 지표 ──────────────────────────────────────────────
  const contractSummary = useMemo(
    () => aggregateContractSummary(rows, callRows, { dateFrom, dateTo, manager }),
    [rows, callRows, dateFrom, dateTo, manager]
  );
  const t = contractSummary.totals;

  // ── [2] 고객 인입 지표 (전역 기간 필터와 별개로, 이 섹션만의 기간 선택을 쓴다) ──
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

  return (
    <>
      <Head>
        <title>다이렉트 대시보드 for AFART</title>
        <meta name="robots" content="noindex, nofollow, noarchive" />
      </Head>

      <div className="app-shell">
        <Sidebar />
        <div className="app-main">
          <FilterBar
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFrom={setDateFrom}
            onDateTo={setDateTo}
            manager={manager}
            onManager={setManager}
            managers={managers}
            bounds={bounds}
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

        {/* ============ 1. 체결 지표 ============ */}
        <section className="section">
          <div className="section-head">
            <h2>체결 지표{manager !== "ALL" ? ` — ${manager}` : ""}</h2>
          </div>
          <p className="section-note">
            접수는 <b>상담이 생성된 달</b> 기준, 계약·원수보험료·매출액은 <b>매출로 인식된(체결) 달</b> 기준입니다 — 같은 달이어도 서로 다른
            건을 셉니다. 계약 건수는 가입완료(JOIN_COMPLETED)만 세고, 원수보험료는 가입완료+지급대기 합산입니다.
          </p>

          <div className="kpi-row">
            <div className="kpi-card">
              <div className="label">전체 접수</div>
              <div className="value">
                {t.received.toLocaleString("ko-KR")}
                <span className="unit">건</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="label">신규 접수</div>
              <div className="value">
                {t.receivedNew.toLocaleString("ko-KR")}
                <span className="unit">건</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="label">갱신 접수</div>
              <div className="value">
                {t.receivedRenewal.toLocaleString("ko-KR")}
                <span className="unit">건</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="label">전환율</div>
              <div className="value">{formatPercent(t.conversionRate)}</div>
            </div>
          </div>

          <div className="kpi-row">
            <div className="kpi-card">
              <div className="label">전체 계약</div>
              <div className="value">
                {t.dealsTotal.toLocaleString("ko-KR")}
                <span className="unit">건</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="label">신규 계약</div>
              <div className="value">
                {t.dealsNew.toLocaleString("ko-KR")}
                <span className="unit">건</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="label">갱신 계약</div>
              <div className="value">
                {t.dealsRenewal.toLocaleString("ko-KR")}
                <span className="unit">건</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="label">원수보험료</div>
              <div className="value" style={{ fontSize: 19 }}>
                {formatCompactWon(t.premiumSum)}
              </div>
            </div>
            <div className="kpi-card">
              <div className="label">매출액</div>
              <div className="value" style={{ fontSize: 19 }}>
                {formatCompactWon(t.revenue)}
              </div>
            </div>
          </div>

          <div className="table-wrap table-scroll-6">
            <table className="data">
              <thead>
                <tr>
                  <th>월</th>
                  <th>접수</th>
                  <th>신규계약</th>
                  <th>갱신계약</th>
                  <th>계약(합계)</th>
                  <th>전환율</th>
                  <th>원수보험료</th>
                  <th>매출액</th>
                </tr>
              </thead>
              <tbody>
                {contractSummary.months.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", color: "var(--ink-faint)" }}>
                      선택한 기간에 데이터가 없습니다.
                    </td>
                  </tr>
                )}
                {contractSummary.months.map((m) => (
                  <tr key={m.month}>
                    <td style={{ textAlign: "left" }}>{formatDateLabel(m.month)}</td>
                    <td>{formatCount(m.received)}</td>
                    <td>{formatCount(m.dealsNew)}</td>
                    <td>{formatCount(m.dealsRenewal)}</td>
                    <td>{formatCount(m.dealsTotal)}</td>
                    <td>{formatPercent(m.conversionRate)}</td>
                    <td>{formatCompactWon(m.premiumSum)}</td>
                    <td>{formatCompactWon(m.revenue)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ textAlign: "left" }}>합계</td>
                  <td>{formatCount(t.received)}</td>
                  <td>{formatCount(t.dealsNew)}</td>
                  <td>{formatCount(t.dealsRenewal)}</td>
                  <td>{formatCount(t.dealsTotal)}</td>
                  <td>{formatPercent(t.conversionRate)}</td>
                  <td>{formatCompactWon(t.premiumSum)}</td>
                  <td>{formatCompactWon(t.revenue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* ============ 2. 고객 인입 지표 ============ */}
        <section className="section">
          <div className="section-head">
            <h2>고객 인입 지표</h2>
          </div>
          <p className="section-note">
            "유입"은 취소를 제외한 전체 진행 건(최소 지급대기까지 도달한 건 기준 — raw 데이터에 비교견적 등 진행중 상담이 없어 완전한
            원천 유입은 아닙니다), "체결"은 그중 가입완료(JOIN_COMPLETED)만입니다. 이 섹션의 기간은 상단 전역 필터와 별개입니다.
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
        </section>

        {/* ============ 3. 회원 지표 ============ */}
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
            상단 전역 기간 필터({dateFrom} ~ {dateTo}) 안에서 체결 이력이 있는 딜러(회원) 기준입니다. "영업채널"은 딜러유형(신차딜러
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
                  <th>순위</th>
                  <th>딜러명</th>
                  <th>영업채널</th>
                  <th>체결 매니저</th>
                  <th>체결건수</th>
                  <th>원수보험료</th>
                </tr>
              </thead>
              <tbody>
                {members.dealers.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "var(--ink-faint)" }}>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
          </div>

          <footer className="foot">다이렉트 대시보드 for AFART · Snowflake 실시간 연동</footer>
        </div>
      </div>
    </>
  );
}
