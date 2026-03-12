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

type GRU = {
  l1_down: number; l1_flat: number; l1_up: number;
  l2_down: number; l2_flat: number; l2_up: number;
  l3_down: number; l3_flat: number; l3_up: number;
};

type VizState = {
  balance: number;
  balance_updated_at: string | null;
  total_units: number;
  nav: number;
  total_pnl: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  total_fills: number;
  avg_win: number | null;
  avg_loss: number | null;
  best_trade: number;
  worst_trade: number;
  total_contracts: number;
  by_side: { yes_wins: number; yes_losses: number; no_wins: number; no_losses: number; yes_pnl: number; no_pnl: number };
  today_pnl: number;
  today_wins: number;
  today_losses: number;
  equity_curve: { ts: string; balance: number; pnl: number }[];
  pnl_bars: { pnl: number; side: string; ts: string; ticker: string }[];
  recent_events: TradeEvent[];
  event_type_counts: Record<string, number>;
  gru: GRU;
  last_model_prob: number | null;
  last_signal_ts: string | null;
  last_signal_side: string | null;
  recent_probs: { prob: number; ts: string }[];
  skip_reasons: Record<string, number>;
};

// ─── Equity curve canvas ──────────────────────────────────────────────────────

function EquityChart({ points }: { points: { ts: string; balance: number; pnl: number }[] }) {
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
    const pad = { top: 16, right: 12, bottom: 20, left: 56 };

    const toX = (i: number) => pad.left + ((i / (points.length - 1)) * (W - pad.left - pad.right));
    const toY = (v: number) => pad.top + ((1 - (v - min) / range) * (H - pad.top - pad.bottom));

    ctx.strokeStyle = "#21262d"; ctx.lineWidth = 1;
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
      const v = min + (1 - f) * range;
      const y = pad.top + f * (H - pad.top - pad.bottom);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillStyle = "#484f58"; ctx.font = "10px sans-serif"; ctx.textAlign = "right";
      ctx.fillText("$" + v.toFixed(0), pad.left - 4, y + 4);
    });

    const isUp = vals[vals.length - 1] >= vals[0];
    const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    grad.addColorStop(0, isUp ? "rgba(63,185,80,0.3)" : "rgba(218,54,51,0.3)");
    grad.addColorStop(1, "rgba(0,0,0,0)");

    ctx.beginPath();
    ctx.moveTo(toX(0), toY(vals[0]));
    points.forEach((_, i) => { if (i > 0) ctx.lineTo(toX(i), toY(vals[i])); });
    ctx.lineTo(toX(points.length - 1), H - pad.bottom);
    ctx.lineTo(toX(0), H - pad.bottom);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath(); ctx.strokeStyle = isUp ? "#3fb950" : "#f85149"; ctx.lineWidth = 2;
    points.forEach((p, i) => { if (i === 0) ctx.moveTo(toX(i), toY(p.balance)); else ctx.lineTo(toX(i), toY(p.balance)); });
    ctx.stroke();

    points.forEach((p, i) => {
      const color = p.pnl > 0 ? "#3fb950" : p.pnl < 0 ? "#f85149" : "#484f58";
      ctx.beginPath(); ctx.arc(toX(i), toY(p.balance), 3, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    });
  }, [points]);

  if (points.length < 2)
    return <div style={{ color: "#484f58", fontSize: "0.8rem", textAlign: "center", padding: "2rem" }}>No trade history yet — waiting for first fill</div>;

  return <canvas ref={canvasRef} style={{ width: "100%", height: "140px", display: "block" }} />;
}

// ─── P&L Bars chart ───────────────────────────────────────────────────────────

function PnLBars({ bars }: { bars: { pnl: number; side: string; ts: string; ticker: string }[] }) {
  if (bars.length === 0)
    return <div style={{ color: "#484f58", fontSize: "0.8rem", textAlign: "center", padding: "1.5rem" }}>No fills yet</div>;

  const max = Math.max(...bars.map((b) => Math.abs(b.pnl)), 0.01);

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 90, paddingTop: 8 }}>
      {bars.map((b, i) => {
        const h = Math.max(4, (Math.abs(b.pnl) / max) * 80);
        const color = b.pnl > 0 ? "#3fb950" : "#da3633";
        const label = b.ticker?.split("_")[2]?.slice(-4) ?? `#${i + 1}`;
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}
            title={`${b.ticker}\n${b.side.toUpperCase()} · ${b.pnl > 0 ? "+" : ""}$${b.pnl.toFixed(2)}\n${b.ts?.slice(0, 16)}`}>
            <div style={{ width: "100%", height: h, background: color, borderRadius: "2px 2px 0 0", opacity: 0.9, transition: "height 0.4s" }} />
            <div style={{ fontSize: "0.55rem", color: "#484f58", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%", textAlign: "center" }}>
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Signal probability sparkline ────────────────────────────────────────────

function ProbSparkline({ probs }: { probs: { prob: number; ts: string }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || probs.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    canvas.width = W * window.devicePixelRatio; canvas.height = H * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const min = 0.5, max = 1.0, range = max - min;
    const pad = { top: 8, right: 8, bottom: 8, left: 8 };
    const toX = (i: number) => pad.left + (i / (probs.length - 1 || 1)) * (W - pad.left - pad.right);
    const toY = (v: number) => pad.top + (1 - (Math.min(Math.max(v, min), max) - min) / range) * (H - pad.top - pad.bottom);

    // Draw threshold lines
    [0.80, 0.90].forEach(thresh => {
      const y = toY(thresh);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = thresh >= 0.90 ? "rgba(63,185,80,0.3)" : "rgba(88,166,255,0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    });
    ctx.setLineDash([]);

    probs.forEach((p) => {
      const color = p.prob >= 0.90 ? "#3fb950" : p.prob >= 0.80 ? "#58a6ff" : "#d29922";
      const x = toX(probs.indexOf(p));
      const y = toY(p.prob);
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    });

    if (probs.length > 1) {
      ctx.beginPath(); ctx.strokeStyle = "rgba(88,166,255,0.4)"; ctx.lineWidth = 1.5;
      probs.forEach((p, i) => { if (i === 0) ctx.moveTo(toX(i), toY(p.prob)); else ctx.lineTo(toX(i), toY(p.prob)); });
      ctx.stroke();
    }
  }, [probs]);

  if (probs.length === 0)
    return <div style={{ color: "#484f58", fontSize: "0.8rem", padding: "0.5rem 0" }}>No signals yet</div>;

  return <canvas ref={canvasRef} style={{ width: "100%", height: "90px", display: "block" }} />;
}

// ─── GRU Cascade bars ─────────────────────────────────────────────────────────

function GRUCascade({ gru }: { gru: GRU }) {
  const hasData = Object.keys(gru).length > 0;

  const level = (label: string, down: number, flat: number, up: number, glow?: boolean) => {
    const d = (down * 100).toFixed(1), f = (flat * 100).toFixed(1), u = (up * 100).toFixed(1);
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "#8b949e", marginBottom: 3 }}>
          <span style={{ fontFamily: "monospace" }}>{label}</span>
          <span style={{ color: parseFloat(u) > parseFloat(d) ? "#3fb950" : parseFloat(d) > parseFloat(u) ? "#da3633" : "#d29922" }}>
            ↑{u}% ↔{f}% ↓{d}%
          </span>
        </div>
        <div style={{
          display: "flex", height: 22, borderRadius: 4, overflow: "hidden",
          boxShadow: glow ? `0 0 12px ${parseFloat(d) >= parseFloat(u) ? "rgba(248,81,73,0.4)" : "rgba(63,185,80,0.4)"}` : "none",
          transition: "box-shadow 0.4s",
        }}>
          <div style={{ width: `${d}%`, background: "#da3633", transition: "width 0.6s" }} title={`Down ${down.toFixed(3)}`} />
          <div style={{ width: `${f}%`, background: "#484f58", transition: "width 0.6s" }} title={`Flat ${flat.toFixed(3)}`} />
          <div style={{ width: `${u}%`, background: "#238636", transition: "width 0.6s" }} title={`Up ${up.toFixed(3)}`} />
        </div>
      </div>
    );
  };

  if (!hasData)
    return <div style={{ color: "#484f58", fontSize: "0.8rem", padding: "0.5rem 0" }}>GRU probs appear after first signal with warm GRU (≥788 bars)</div>;

  return (
    <div>
      {level("L1  30s", gru.l1_down, gru.l1_flat, gru.l1_up)}
      <div style={{ textAlign: "center", fontSize: "12px", color: "#30363d", margin: "2px 0" }}>▼</div>
      {level("L2  60s", gru.l2_down, gru.l2_flat, gru.l2_up)}
      <div style={{ textAlign: "center", fontSize: "12px", color: "#30363d", margin: "2px 0" }}>▼</div>
      {level("L3 300s", gru.l3_down, gru.l3_flat, gru.l3_up)}
      <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: "0.72rem" }}>
        {[["#da3633", "Down"], ["#484f58", "Flat"], ["#238636", "Up"]].map(([c, l]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} />
            <span style={{ color: "#8b949e" }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Skip reason donut ────────────────────────────────────────────────────────

function SkipDonut({ reasons }: { reasons: Record<string, number> }) {
  const entries = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (entries.length === 0) return <div style={{ color: "#484f58", fontSize: "0.8rem" }}>No skipped signals yet</div>;
  const colors = ["#58a6ff", "#8957e5", "#d29922", "#3fb950", "#da3633", "#2ea043"];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let acc = 0;
  const segs = entries.map(([k, v], i) => {
    const pct = v / total;
    const s = acc; acc += pct;
    return { k, v, pct, s, color: colors[i % colors.length] };
  });
  const W = 100, H = 100, cx = 50, cy = 50, r = 42, ir = 26;
  const arc = (s: number, e: number) => {
    const sa = s * 2 * Math.PI - Math.PI / 2, ea = e * 2 * Math.PI - Math.PI / 2;
    const x1 = cx + r * Math.cos(sa), y1 = cy + r * Math.sin(sa);
    const x2 = cx + r * Math.cos(ea), y2 = cy + r * Math.sin(ea);
    const x3 = cx + ir * Math.cos(ea), y3 = cy + ir * Math.sin(ea);
    const x4 = cx + ir * Math.cos(sa), y4 = cy + ir * Math.sin(sa);
    const lg = (e - s) > 0.5 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${lg} 1 ${x2} ${y2} L ${x3} ${y3} A ${ir} ${ir} 0 ${lg} 0 ${x4} ${y4} Z`;
  };

  return (
    <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ flexShrink: 0 }}>
        {segs.map((s) => <path key={s.k} d={arc(s.s, s.s + s.pct)} fill={s.color} />)}
        <text x={cx} y={cy + 4} textAnchor="middle" fill="#8b949e" fontSize="9" fontWeight="bold">{total}</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        {segs.map((s) => (
          <div key={s.k} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.72rem" }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ color: "#8b949e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.k.replace(/_/g, " ")}</span>
            <span style={{ color: "#e6edf3", marginLeft: "auto", paddingLeft: 6, flexShrink: 0 }}>{s.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Side split bars ──────────────────────────────────────────────────────────

function SideSplit({ by_side }: { by_side: VizState["by_side"] }) {
  const { yes_wins, yes_losses, no_wins, no_losses, yes_pnl, no_pnl } = by_side;
  const yes_total = yes_wins + yes_losses;
  const no_total = no_wins + no_losses;
  if (yes_total + no_total === 0) return <div style={{ color: "#484f58", fontSize: "0.8rem" }}>No data yet</div>;

  const Row = ({ label, wins, losses, pnl, color }: { label: string; wins: number; losses: number; pnl: number; color: string }) => {
    const total = wins + losses;
    const wr = total > 0 ? ((wins / total) * 100).toFixed(0) : "–";
    const pnlStr = (pnl > 0 ? "+" : "") + "$" + pnl.toFixed(2);
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", marginBottom: 4 }}>
          <span style={{ color, fontWeight: 700 }}>{label}</span>
          <span style={{ color: "#8b949e" }}>{wins}W / {losses}L · <span style={{ color: wr !== "–" && parseInt(wr) >= 60 ? "#3fb950" : "#d29922" }}>{wr}%</span> · <span style={{ color: pnl >= 0 ? "#3fb950" : "#f85149", fontWeight: 700 }}>{pnlStr}</span></span>
        </div>
        {total > 0 && (
          <div style={{ display: "flex", height: 10, borderRadius: 4, overflow: "hidden", background: "#21262d" }}>
            <div style={{ width: `${(wins / total) * 100}%`, background: "#238636", transition: "width 0.6s" }} />
            <div style={{ width: `${(losses / total) * 100}%`, background: "#da3633", transition: "width 0.6s" }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <Row label="YES trades" wins={yes_wins} losses={yes_losses} pnl={yes_pnl} color="#3fb950" />
      <Row label="NO  trades" wins={no_wins} losses={no_losses} pnl={no_pnl} color="#58a6ff" />
    </div>
  );
}

// ─── Recent events feed ───────────────────────────────────────────────────────

function EventFeed({ events }: { events: TradeEvent[] }) {
  const iconMap: Record<string, string> = {
    order_fill: "✅", settlement: "🏁", order_place: "📋", order_error: "❌",
    session_start: "🟢", session_end: "🔴", risk_halt: "⛔", take_profit_fill: "🎯",
    flip_entry_fill: "🔄", momentum_exit_fill: "💨", trailing_exit_fill: "📉",
  };
  const colorMap: Record<string, string> = {
    order_fill: "#58a6ff", settlement: "#3fb950", order_error: "#f85149",
    risk_halt: "#da3633", session_start: "#2ea043", session_end: "#484f58",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 220, overflowY: "auto" }}>
      {events.length === 0 && <div style={{ color: "#484f58", fontSize: "0.8rem" }}>Waiting for bot activity…</div>}
      {events.map((ev) => {
        let pnlStr = "";
        try {
          const p = JSON.parse(ev.payload);
          if (typeof p?.net_pnl_usd === "number") pnlStr = (p.net_pnl_usd > 0 ? " +" : " ") + p.net_pnl_usd.toFixed(2);
        } catch { /* skip */ }
        return (
          <div key={ev.id} style={{ display: "flex", gap: 8, fontSize: "0.78rem", paddingBottom: 4, borderBottom: "1px solid #21262d" }}>
            <span style={{ flexShrink: 0 }}>{iconMap[ev.event_type] ?? "•"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: colorMap[ev.event_type] ?? "#e6edf3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {ev.title}
                {pnlStr && <span style={{ color: pnlStr.includes("+") ? "#3fb950" : "#f85149", marginLeft: 6, fontWeight: 700 }}>{pnlStr}</span>}
              </div>
              <div style={{ color: "#484f58", fontSize: "0.68rem" }}>{ev.created_at?.slice(0, 16)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function Stat({ label, val, sub, color = "#e6edf3" }: { label: string; val: string; sub?: string; color?: string }) {
  return (
    <div style={{ ...S.card, textAlign: "center", padding: "1rem" }}>
      <div style={{ color: "#8b949e", fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontSize: "1.2rem", fontWeight: 800, lineHeight: 1.1 }}>{val}</div>
      {sub && <div style={{ color: "#484f58", fontSize: "0.68rem", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ ...S.card, marginBottom: "1rem" }}>
      <div style={{ color: "#8b949e", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.75rem" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ─── Main VizPage ─────────────────────────────────────────────────────────────

export default function VizPage({ session }: { session: SessionInfo }) {
  const [state, setState] = useState<VizState | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [pulse, setPulse] = useState(false);

  const load = () => {
    fetch("/api/viz/state")
      .then((r) => { if (!r.ok) throw new Error("Unauthorized"); return r.json() as Promise<VizState>; })
      .then((d) => {
        setState(d);
        setLastRefresh(new Date());
        setPulse(true);
        setTimeout(() => setPulse(false), 600);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  if (loading) return <div style={{ color: "#8b949e", padding: "2rem", display: "flex", alignItems: "center", gap: 8 }}><span>⏳</span> Loading dashboard…</div>;
  if (err) return <div style={S.err}>{err}</div>;
  if (!state) return null;

  const upPnl = state.total_pnl >= 0;
  const upToday = state.today_pnl >= 0;
  const winRateColor = state.win_rate == null ? "#8b949e" : state.win_rate >= 60 ? "#3fb950" : state.win_rate >= 45 ? "#d29922" : "#f85149";
  const balanceAge = state.balance_updated_at
    ? `Synced ${state.balance_updated_at.replace("T", " ").slice(0, 16)} UTC`
    : "Awaiting balance sync";

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem" }}>
        <h2 style={{ color: "#58a6ff", fontSize: "1.15rem", fontWeight: 700 }}>📊 Bot Trading Dashboard</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.75rem", color: "#484f58" }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: pulse ? "#3fb950" : "#2ea043",
            boxShadow: pulse ? "0 0 8px #3fb950" : "none",
            transition: "all 0.3s",
          }} />
          Live · {lastRefresh ? lastRefresh.toLocaleTimeString() : "–"}
        </div>
      </div>

      {/* ── Stat row 1: balance + performance ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <Stat label="Fund Balance" val={`$${state.balance.toFixed(2)}`} sub={balanceAge} color="#58a6ff" />
        <Stat label="Total P&L" val={(upPnl ? "+" : "") + `$${state.total_pnl.toFixed(2)}`} color={upPnl ? "#3fb950" : "#f85149"} />
        <Stat
          label="Win Rate"
          val={state.win_rate != null ? `${state.win_rate}%` : "–"}
          sub={`${state.wins}W / ${state.losses}L`}
          color={winRateColor}
        />
        <Stat label="Today P&L" val={(upToday ? "+" : "") + `$${state.today_pnl.toFixed(2)}`}
          sub={`${state.today_wins}W / ${state.today_losses}L today`}
          color={upToday ? "#3fb950" : "#f85149"} />
        <Stat label="Fills" val={String(state.total_fills)} sub={`${state.total_contracts} contracts`} />
        <Stat label="NAV / Unit" val={`$${state.nav.toFixed(4)}`} sub={`${state.total_units.toFixed(1)} units`} />
      </div>

      {/* ── Stat row 2: edge stats ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
        {state.avg_win != null && <Stat label="Avg Win" val={`+$${state.avg_win.toFixed(2)}`} color="#3fb950" />}
        {state.avg_loss != null && <Stat label="Avg Loss" val={`$${state.avg_loss.toFixed(2)}`} color="#f85149" />}
        {state.best_trade !== 0 && <Stat label="Best Trade" val={`+$${state.best_trade.toFixed(2)}`} color="#3fb950" />}
        {state.worst_trade !== 0 && <Stat label="Worst Trade" val={`$${state.worst_trade.toFixed(2)}`} color="#f85149" />}
        {state.last_model_prob != null && (
          <Stat
            label="Last Signal"
            val={`${(state.last_model_prob * 100).toFixed(1)}%`}
            sub={`${state.last_signal_side?.toUpperCase() ?? ""} · ${state.last_signal_ts?.slice(11, 16) ?? ""} UTC`}
            color={state.last_model_prob >= 0.9 ? "#3fb950" : "#d29922"}
          />
        )}
        <Stat label="Signals" val={String(state.event_type_counts?.signal ?? 0)} sub={`${state.event_type_counts?.no_signal ?? 0} skipped`} />
      </div>

      {/* ── Equity curve + P&L bars ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
        <Section title="Equity Curve — balance per fill">
          <EquityChart points={state.equity_curve} />
        </Section>

        <Section title={`Per-trade P&L — ${state.pnl_bars.length} fills (green=win, red=loss)`}>
          <PnLBars bars={state.pnl_bars} />
        </Section>
      </div>

      {/* ── Signal probs + GRU cascade ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
        <Section title={`Signal Probabilities — last ${state.recent_probs.length} signals`}>
          <ProbSparkline probs={state.recent_probs} />
          <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: "0.7rem" }}>
            {[["#3fb950", "≥0.90"], ["#58a6ff", "≥0.80"], ["#d29922", "<0.80"]].map(([c, l]) => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />
                <span style={{ color: "#8b949e" }}>{l}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="GRU Cascade — last signal">
          <GRUCascade gru={state.gru} />
        </Section>
      </div>

      {/* ── Side split + Skip reasons ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
        <Section title="YES vs NO Split — win rates by side">
          <SideSplit by_side={state.by_side} />
        </Section>

        <Section title="Skip Reasons — why bot didn't trade">
          <SkipDonut reasons={state.skip_reasons} />
        </Section>
      </div>

      {/* ── Activity feed ── */}
      <Section title="Recent Activity">
        <EventFeed events={state.recent_events} />
      </Section>

      {/* ── Footer ── */}
      <div style={{ color: "#484f58", fontSize: "0.7rem", textAlign: "right" }}>
        Auto-refreshes every 15s · {session?.display_name} · eom_v10c · max 3 contracts
      </div>
    </div>
  );
}
