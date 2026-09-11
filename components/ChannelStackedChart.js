import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LabelList } from "recharts";
import { formatCount, formatDateLabel } from "../lib/format";

// 채널이 여러 개여도 구분 가능하도록 고정 팔레트 순환 — 채널 개수가 늘어도 깨지지 않는다.
// 채널 토글 버튼(pages/index.js)에서도 같은 색을 써야 해서 export한다.
export const CHANNEL_PALETTE = ["#2452d9", "#c0392b", "#c97a22", "#2e7d5b", "#8b92a0", "#7b5ea7", "#1f9e9e"];
const PALETTE = CHANNEL_PALETTE;

function ChannelTooltip({ active, payload, label, channels }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload;
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        boxShadow: "var(--shadow)",
        minWidth: 140,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{formatDateLabel(label)}</div>
      {channels.map((c, i) => (
        <div key={c} style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "var(--ink-muted)" }}>
          <span>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 2,
                background: PALETTE[i % PALETTE.length],
                marginRight: 6,
              }}
            />
            {c}
          </span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCount(row[c] || 0)}</span>
        </div>
      ))}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 4,
          paddingTop: 4,
          borderTop: "1px solid var(--border)",
          fontWeight: 700,
          color: "var(--ink)",
        }}
      >
        <span>합계</span>
        <span>{formatCount(row.total)}</span>
      </div>
    </div>
  );
}

// 일자 × 채널 스택 막대 그래프. data는 aggregateDailyByChannel()의 { channels, data } 형태를 그대로 받는다.
// 막대 위 숫자 = 그 날짜의 총합 (channels 중 가장 마지막 시리즈에만 라벨을 붙여 스택 맨 위에 뜨게 한다).
export default function ChannelStackedChart({ channels, data }) {
  if (!data.length) {
    return (
      <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-faint)", fontSize: 13 }}>
        선택한 기간에 데이터가 없습니다.
      </div>
    );
  }
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 24, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDateLabel}
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--ink-faint)" }}
            axisLine={false}
            tickLine={false}
            width={32}
            allowDecimals={false}
          />
          <Tooltip content={<ChannelTooltip channels={channels} />} cursor={{ fill: "rgba(36,82,217,0.06)" }} />
          {channels.map((c, i) => (
            <Bar
              key={c}
              dataKey={c}
              stackId="s"
              fill={PALETTE[i % PALETTE.length]}
              name={c}
              radius={i === channels.length - 1 ? [3, 3, 0, 0] : 0}
              maxBarSize={36}
            >
              {i === channels.length - 1 && (
                <LabelList dataKey="total" position="top" style={{ fontSize: 11, fontWeight: 700, fill: "var(--ink)" }} />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
