import { useState, useEffect, useRef } from "react";
import { S, SessionInfo } from "../App";

// ─── Types ────────────────────────────────────────────────────────────────────

type TradeEvent = {
  id: number;
  event_type: string;
  title: string;
  payload: string;
  fund_balance: number | null;
  created_at: string;
};

type VizState = {
  balance: number;
  total_units: number;
  nav: number;
  total_pnl: number;
  session_fills: number;
  equity_curve: { ts: string; balance: number }[];
  recent_events: TradeEvent[];
  event_type_counts: Record<string, number>;
};

// ─── Equity curve canvas ──────────────────────────────────────────────────────

function EquityChart({ points }: { points: { ts: string; balance: number }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W * window.devicePixelRatio;
    canvas.height = H * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const vals = points.map((p) => p.balance);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const pad = { top: 16, right: 12, bottom: 20, left: 48 };

    const toX = (i: number) => pad.left + ((i / (points.length - 1)) * (W - pad.left - pad.right));
    const toY = (v: number) => pad.top + ((1 - (v - min) / range) * (H - pad.top - pad.bottom));

    // Grid lines
    ctx.strokeStyle = "#21262d";
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1].forEach((f) => {
      const y = pad.top + f * (H - pad.top - pad.bottom);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      const label = (max - f * range).toFixed(0);
      ctx.fillStyle = "#484f58"; ctx.font = "10px sans-serif"; ctx.textAlign = "right";
      ctx.fillText("$" + label, pad.left - 4, y + 4);
    });

    // Gradient fill
    const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    grad.addColorStop(0, "rgba(35,134,54,0.3)");
    grad.addColorStop(1, "rgba(35,134,54,0)");
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(vals[0]));
    points.forEach((_, i) => { if (i > 0) ctx.lineTo(toX(i), toY(vals[i])); });
    ctx.lineTo(toX(points.length - 1), H - pad.bottom);
    ctx.lineTo(toX(0), H - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = "#3fb950";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.moveTo(toX(0), toY(vals[0]));
    points.forEach((_, i) => { if (i > 0) ctx.lineTo(toX(i), toY(vals[i])); });
    ctx.stroke();

    // Latest dot
    const lx = toX(points.length - 1);
    const ly = toY(vals[vals.length - 1]);
    ctx.beginPath();
    ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#3fb950";
    ctx.fill();
  }, [points]);

  if (points.length < 2) {
    return (
      <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "#484f58", fontSize: "0.85rem" }}>
        Equity curve builds as the bot trades…
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: 160, display: "block" }}
    />
  );
}

// ─── Event type donut ─────────────────────────────────────────────────────────

function EventDonut({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0);
  if (entries.length === 0) {
    return <div style={{ color: "#484f58", fontSize: "0.85rem", padding: "1rem 0" }}>No events yet</div>;
  }
  const colors = ["#238636", "#1f6feb", "#d29922", "#da3633", "#8957e5", "#2ea043", "#e3b341"];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let acc = 0;
  const segments = entries.map(([k, v], i) => {
    const pct = v / total;
    const start = acc;
    acc += pct;
    return { key: k, v, pct, start, color: colors[i % colors.length] };
  });

  const W = 120, H = 120, cx = W / 2, cy = H / 2, r = 48, ir = 30;
  const arc = (start: number, end: number, outer: number, inner: number) => {
    const s = (start * 2 * Math.PI) - Math.PI / 2;
    const e = (end * 2 * Math.PI) - Math.PI / 2;
    const x1 = cx + outer * Math.cos(s), y1 = cy + outer * Math.sin(s);
    const x2 = cx + outer * Math.cos(e), y2 = cy + outer * Math.sin(e);
    const x3 = cx + inner * Math.cos(e), y3 = cy + inner * Math.sin(e);
    const x4 = cx + inner * Math.cos(s), y4 = cy + inner * Math.sin(s);
    const large = (end - start) > 0.5 ? 1 : 0;
    return `M ${x1} ${y1} A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`;
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {segments.map((s) => (
          <path key={s.key} d={arc(s.start, s.start + s.pct, r, ir)} fill={s.color} />
        ))}
        <text x={cx} y={cy + 4} textAnchor="middle" fill="#e6edf3" fontSize="11" fontWeight="bold">{total}</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {segments.map((s) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem" }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ color: "#8b949e" }}>{s.key.replace(/_/g, " ")}</span>
            <span style={{ color: "#e6edf3", marginLeft: "auto", paddingLeft: 8 }}>{s.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main VizPage ─────────────────────────────────────────────────────────────

export default function VizPage({ session }: { session: SessionInfo }) {
  const [state, setState] = useState<VizState | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => {
    fetch("/api/viz/state")
      .then((r) => {
        if (!r.ok) throw new Error("Unauthorized");
        return r.json() as Promise<VizState>;
      })
      .then(setState)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  if (loading) return <div style={{ color: "#8b949e", padding: "2rem" }}>Loading dashboard…</div>;
  if (err) return <div style={S.err}>{err}</div>;
  if (!state) return null;

  const upPnl = state.total_pnl >= 0;

  return (
    <div>
      <h2 style={{ color: "#58a6ff", marginBottom: "1.5rem", fontSize: "1.2rem" }}>📊 Bot Trading Dashboard</h2>

      {/* ── Stat row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        {[
          { label: "Fund Balance", val: `$${state.balance.toFixed(2)}`, color: "#58a6ff" },
          { label: "NAV / Unit", val: `$${state.nav.toFixed(4)}`, color: "#e6edf3" },
          { label: "Total Units", val: state.total_units.toFixed(2), color: "#e6edf3" },
          { label: "Cumul. P&L", val: (upPnl ? "+" : "") + `$${state.total_pnl.toFixed(2)}`, color: upPnl ? "#3fb950" : "#f85149" },
          { label: "Total Trades", val: String(state.session_fills), color: "#e6edf3" },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ ...S.card, textAlign: "center" }}>
            <div style={{ color: "#8b949e", fontSize: "0.75rem", marginBottom: 4 }}>{label}</div>
            <div style={{ color, fontSize: "1.15rem", fontWeight: 700 }}>{val}</div>
          </div>
        ))}
      </div>

      {/* ── Equity curve ── */}
      <div style={{ ...S.card, marginBottom: "1.5rem" }}>
        <div style={{ color: "#8b949e", fontSize: "0.8rem", marginBottom: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Fund Equity Curve
        </div>
        <EquityChart points={state.equity_curve} />
      </div>

      {/* ── Bottom row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
        {/* Event type breakdown */}
        <div style={S.card}>
          <div style={{ color: "#8b949e", fontSize: "0.8rem", marginBottom: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Event Types
          </div>
          <EventDonut counts={state.event_type_counts} />
        </div>

        {/* Recent trade events */}
        <div style={S.card}>
          <div style={{ color: "#8b949e", fontSize: "0.8rem", marginBottom: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Recent Activity
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
            {state.recent_events.length === 0 && (
              <div style={{ color: "#484f58", fontSize: "0.85rem" }}>No events yet — bot activity appears here</div>
            )}
            {state.recent_events.map((ev) => {
              const isWin = ev.event_type === "order_fill" || ev.event_type === "settlement";
              const bal = ev.fund_balance != null ? ` · $${ev.fund_balance.toFixed(2)}` : "";
              return (
                <div key={ev.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, fontSize: "0.8rem", borderBottom: "1px solid #21262d", paddingBottom: 4 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: isWin ? "#3fb950" : "#8957e5", flexShrink: 0, marginTop: 2 }} />
                    <span style={{ color: "#e6edf3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.title}</span>
                  </div>
                  <div style={{ color: "#484f58", flexShrink: 0, fontSize: "0.72rem" }}>
                    {ev.created_at.replace("T", " ").slice(0, 16)}{bal}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ color: "#484f58", fontSize: "0.75rem", textAlign: "right" }}>
        Auto-refreshes every 15s · {session?.display_name}
      </div>
    </div>
  );
}
