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
  equity_curve: { ts: string; balance: number; pnl: number }[];
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

    // Grid
    ctx.strokeStyle = "#21262d";
    ctx.lineWidth = 1;
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
      const v = min + (1 - f) * range;
      const y = pad.top + f * (H - pad.top - pad.bottom);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillStyle = "#484f58"; ctx.font = "10px sans-serif"; ctx.textAlign = "right";
      ctx.fillText("$" + v.toFixed(0), pad.left - 4, y + 4);
    });

    // Gradient fill
    const isUp = vals[vals.length - 1] >= vals[0];
    const upColor = isUp ? "rgba(35,134,54,0.3)" : "rgba(218,54,51,0.3)";
    const lineColor = isUp ? "#3fb950" : "#f85149";
    const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    grad.addColorStop(0, upColor);
    grad.addColorStop(1, "rgba(0,0,0,0)");

    ctx.beginPath();
    ctx.moveTo(toX(0), toY(vals[0]));
    points.forEach((_, i) => { if (i > 0) ctx.lineTo(toX(i), toY(vals[i])); });
    ctx.lineTo(toX(points.length - 1), H - pad.bottom);
    ctx.lineTo(toX(0), H - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Win/loss dots on each trade
    points.forEach((p, i) => {
      if (p.pnl !== 0) {
        const cx = toX(i), cy = toY(p.balance);
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = p.pnl > 0 ? "#3fb950" : "#f85149";
        ctx.fill();
      }
    });

    // Line
    ctx.beginPath();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.moveTo(toX(0), toY(vals[0]));
    points.forEach((_, i) => { if (i > 0) ctx.lineTo(toX(i), toY(vals[i])); });
    ctx.stroke();

    // Latest label
    const lx = toX(points.length - 1);
    const ly = toY(vals[vals.length - 1]);
    ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.fillStyle = lineColor; ctx.fill();
  }, [points]);

  if (points.length < 2) {
    return (
      <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "#484f58", fontSize: "0.85rem", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: "1.5rem" }}>📈</span>
        Equity curve builds as the bot trades…
      </div>
    );
  }

  return <canvas ref={canvasRef} style={{ width: "100%", height: 180, display: "block" }} />;
}

// ─── Signal probability sparkline ─────────────────────────────────────────────

function ProbSparkline({ probs }: { probs: { prob: number; ts: string }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || probs.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    canvas.width = W * window.devicePixelRatio;
    canvas.height = H * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    const vals = probs.map((p) => p.prob ?? 0);
    const toX = (i: number) => (i / (vals.length - 1)) * W;
    const toY = (v: number) => H - (v * H * 0.85 + H * 0.05);

    // Threshold line at 0.80
    ctx.strokeStyle = "#484f58"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    const ty = toY(0.80);
    ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(W, ty); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#484f58"; ctx.font = "9px sans-serif"; ctx.textAlign = "left";
    ctx.fillText("0.80", 2, ty - 2);

    // Line
    ctx.beginPath(); ctx.strokeStyle = "#58a6ff"; ctx.lineWidth = 1.5;
    ctx.moveTo(toX(0), toY(vals[0]));
    vals.forEach((v, i) => { if (i > 0) ctx.lineTo(toX(i), toY(v)); });
    ctx.stroke();

    // Dots
    vals.forEach((v, i) => {
      ctx.beginPath(); ctx.arc(toX(i), toY(v), 2, 0, Math.PI * 2);
      ctx.fillStyle = v >= 0.9 ? "#3fb950" : v >= 0.8 ? "#58a6ff" : "#d29922";
      ctx.fill();
    });
  }, [probs]);

  if (probs.length < 2) return <div style={{ color: "#484f58", fontSize: "0.8rem" }}>No signals yet</div>;

  return <canvas ref={canvasRef} style={{ width: "100%", height: 80, display: "block" }} />;
}

// ─── GRU cascade bars ─────────────────────────────────────────────────────────

function GRUCascade({ gru }: { gru: GRU }) {
  const hasData = Object.values(gru).some((v) => v !== 0);

  const level = (label: string, down: number, flat: number, up: number) => {
    const total = down + flat + up || 1;
    const d = (down / total) * 100, f = (flat / total) * 100, u = (up / total) * 100;
    const conf = Math.max(d, f, u);
    const dir = d >= f && d >= u ? "↓" : u >= f && u >= d ? "↑" : "→";
    const dirColor = d >= f && d >= u ? "#f85149" : u >= f ? "#3fb950" : "#8b949e";
    const glow = conf > 60;
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, fontSize: "0.78rem" }}>
          <span style={{ color: "#8b949e", width: 50, flexShrink: 0 }}>{label}</span>
          <span style={{ color: dirColor, fontWeight: 700, fontSize: "0.9rem" }}>{dir}</span>
          <span style={{ color: conf > 60 ? dirColor : "#8b949e", fontSize: "0.75rem" }}>{conf.toFixed(0)}%</span>
        </div>
        <div style={{
          display: "flex", height: 22, borderRadius: 4, overflow: "hidden",
          boxShadow: glow ? `0 0 12px ${d >= u ? "rgba(248,81,73,0.4)" : "rgba(63,185,80,0.4)"}` : "none",
          transition: "box-shadow 0.4s",
        }}>
          <div style={{ width: `${d}%`, background: "#da3633", transition: "width 0.6s" }} title={`Down ${down.toFixed(3)}`} />
          <div style={{ width: `${f}%`, background: "#484f58", transition: "width 0.6s" }} title={`Flat ${flat.toFixed(3)}`} />
          <div style={{ width: `${u}%`, background: "#238636", transition: "width 0.6s" }} title={`Up ${up.toFixed(3)}`} />
        </div>
      </div>
    );
  };

  if (!hasData) {
    return (
      <div style={{ color: "#484f58", fontSize: "0.8rem", padding: "0.5rem 0" }}>
        GRU probs appear after first signal with warm GRU (≥788 bars)
      </div>
    );
  }

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
    <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 240, overflowY: "auto" }}>
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
  const winRateColor = state.win_rate == null ? "#8b949e" : state.win_rate >= 60 ? "#3fb950" : state.win_rate >= 45 ? "#d29922" : "#f85149";
  const balanceAge = state.balance_updated_at
    ? `Updated ${state.balance_updated_at.replace("T", " ").slice(0, 16)} UTC`
    : "Static (awaiting bot sync)";

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

      {/* ── Stat row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
        <Stat label="Fund Balance" val={`$${state.balance.toFixed(2)}`} sub={balanceAge} color="#58a6ff" />
        <Stat label="Cumul. P&L" val={(upPnl ? "+" : "") + `$${state.total_pnl.toFixed(2)}`} color={upPnl ? "#3fb950" : "#f85149"} />
        <Stat
          label="Win Rate"
          val={state.win_rate != null ? `${state.win_rate}%` : "–"}
          sub={`${state.wins}W / ${state.losses}L`}
          color={winRateColor}
        />
        <Stat label="Fills" val={String(state.total_fills)} sub="all time" />
        <Stat label="NAV / Unit" val={`$${state.nav.toFixed(4)}`} sub={`${state.total_units.toFixed(1)} units`} />
        {state.last_model_prob != null && (
          <Stat
            label="Last Signal"
            val={`${(state.last_model_prob * 100).toFixed(1)}%`}
            sub={`${state.last_signal_side?.toUpperCase() ?? ""} · ${state.last_signal_ts?.slice(11, 16) ?? ""} UTC`}
            color={state.last_model_prob >= 0.9 ? "#3fb950" : "#d29922"}
          />
        )}
      </div>

      {/* ── Equity curve ── */}
      <Section title="Fund Equity Curve — $PnL per trade (green=win, red=loss)">
        <EquityChart points={state.equity_curve} />
      </Section>

      {/* ── Signal prob history + GRU cascade ── */}
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

      {/* ── Skip reasons + Event feed ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
        <Section title="Skip Reasons — why bot didn't trade">
          <SkipDonut reasons={state.skip_reasons} />
        </Section>

        <Section title="Recent Activity">
          <EventFeed events={state.recent_events} />
        </Section>
      </div>

      {/* ── Footer ── */}
      <div style={{ color: "#484f58", fontSize: "0.7rem", textAlign: "right" }}>
        Auto-refreshes every 15s · {session?.display_name} · eom_v10c
      </div>
    </div>
  );
}
