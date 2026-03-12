import { useState, useEffect, useRef } from "react";
import { S, SessionInfo } from "../App";

// ─── Types ────────────────────────────────────────────────────────────────────

type TradeEvent = {
  id: number; event_type: string; title: string;
  payload: string; fund_balance: number | null; created_at: string;
};
type GRU = {
  l1_down: number; l1_flat: number; l1_up: number;
  l2_down: number; l2_flat: number; l2_up: number;
  l3_down: number; l3_flat: number; l3_up: number;
};
type VizState = {
  balance: number; balance_updated_at: string | null;
  total_units: number; nav: number;
  total_pnl: number; wins: number; losses: number; win_rate: number | null; total_fills: number;
  avg_win: number | null; avg_loss: number | null; best_trade: number; worst_trade: number;
  total_contracts: number;
  by_side: { yes_wins: number; yes_losses: number; no_wins: number; no_losses: number; yes_pnl: number; no_pnl: number };
  today_pnl: number; today_wins: number; today_losses: number;
  equity_curve: { ts: string; balance: number; pnl: number }[];
  pnl_bars: { pnl: number; side: string; ts: string; ticker: string }[];
  recent_events: TradeEvent[];
  event_type_counts: Record<string, number>;
  gru: GRU;
  last_model_prob: number | null; last_signal_ts: string | null;
  last_signal_side: string | null; last_elapsed_frac: number | null; last_regime_score: number | null;
  last_signal_shap: { f: string; v: number }[];
  last_feat_snapshot: Record<string, number>;
  recent_probs: { prob: number; ts: string }[];
  skip_reasons: Record<string, number>;
};

// ─── Equity curve ─────────────────────────────────────────────────────────────

function EquityChart({ points }: { points: { ts: string; balance: number; pnl: number }[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c || points.length < 2) return;
    const ctx = c.getContext("2d")!;
    const W = c.offsetWidth, H = c.offsetHeight;
    c.width = W * devicePixelRatio; c.height = H * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const vals = points.map(p => p.balance);
    const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
    const pad = { t: 14, r: 10, b: 20, l: 52 };
    const X = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
    const Y = (v: number) => pad.t + (1 - (v - min) / range) * (H - pad.t - pad.b);
    ctx.strokeStyle = "#21262d"; ctx.lineWidth = 1;
    [0, 0.5, 1].forEach(f => {
      const y = pad.t + f * (H - pad.t - pad.b);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      ctx.fillStyle = "#484f58"; ctx.font = "10px sans-serif"; ctx.textAlign = "right";
      ctx.fillText("$" + (min + (1 - f) * range).toFixed(0), pad.l - 4, y + 4);
    });
    const up = vals[vals.length - 1] >= vals[0];
    const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
    grad.addColorStop(0, up ? "rgba(63,185,80,0.25)" : "rgba(218,54,51,0.25)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath(); ctx.moveTo(X(0), Y(vals[0]));
    points.forEach((_, i) => { if (i > 0) ctx.lineTo(X(i), Y(vals[i])); });
    ctx.lineTo(X(points.length - 1), H - pad.b); ctx.lineTo(X(0), H - pad.b);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); ctx.strokeStyle = up ? "#3fb950" : "#f85149"; ctx.lineWidth = 2;
    points.forEach((p, i) => { if (i === 0) ctx.moveTo(X(i), Y(p.balance)); else ctx.lineTo(X(i), Y(p.balance)); });
    ctx.stroke();
    points.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(X(i), Y(p.balance), 3, 0, Math.PI * 2);
      ctx.fillStyle = p.pnl > 0 ? "#3fb950" : p.pnl < 0 ? "#f85149" : "#484f58";
      ctx.fill();
    });
  }, [points]);
  if (points.length < 2)
    return <div style={{ color: "#484f58", fontSize: "0.8rem", textAlign: "center", padding: "2rem" }}>Waiting for first fill…</div>;
  return <canvas ref={ref} style={{ width: "100%", height: 140, display: "block" }} />;
}

// ─── P&L Bars ─────────────────────────────────────────────────────────────────

function PnLBars({ bars }: { bars: VizState["pnl_bars"] }) {
  if (!bars.length)
    return <div style={{ color: "#484f58", fontSize: "0.8rem", textAlign: "center", padding: "1.5rem" }}>No fills yet</div>;
  const max = Math.max(...bars.map(b => Math.abs(b.pnl)), 0.01);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 90, paddingTop: 8 }}>
      {bars.map((b, i) => {
        const h = Math.max(4, (Math.abs(b.pnl) / max) * 80);
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}
            title={`${b.ticker}\n${b.side.toUpperCase()} · ${b.pnl > 0 ? "+" : ""}$${b.pnl.toFixed(2)}\n${b.ts?.slice(0, 16)}`}>
            <div style={{ width: "100%", height: h, background: b.pnl > 0 ? "#3fb950" : "#da3633", borderRadius: "2px 2px 0 0", opacity: 0.9 }} />
            <div style={{ fontSize: "0.5rem", color: "#484f58", marginTop: 2, overflow: "hidden", whiteSpace: "nowrap", maxWidth: "100%", textAlign: "center" }}>
              {b.ticker?.split("-")[1]?.slice(-4) ?? `#${i + 1}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── SHAP chart ───────────────────────────────────────────────────────────────

function ShapChart({ shap, side }: { shap: { f: string; v: number }[]; side: string | null }) {
  if (!shap.length)
    return (
      <div style={{ color: "#484f58", fontSize: "0.8rem", padding: "0.75rem 0" }}>
        SHAP values appear after the next signal (installed ✓ — waiting for bot warmup)
      </div>
    );
  const maxAbs = Math.max(...shap.map(s => Math.abs(s.v)), 0.001);
  const posColor = "#3fb950";
  const negColor = "#da3633";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: "0.68rem", color: "#8b949e", marginBottom: 4 }}>
        <span style={{ color: side === "yes" ? "#3fb950" : "#58a6ff", fontWeight: 700 }}>{side?.toUpperCase() ?? "?"}</span>
        {" "}side signal · top {shap.length} features · positive=pushes model toward YES prediction
      </div>
      {shap.map((s) => {
        const pct = (Math.abs(s.v) / maxAbs) * 100;
        const isPos = s.v > 0;
        return (
          <div key={s.f} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.71rem" }}>
            <div style={{ width: 140, color: "#8b949e", textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={s.f}>{s.f.replace(/_/g, " ")}</div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", height: 16, background: "#21262d", borderRadius: 3, overflow: "hidden" }}>
              <div style={{
                width: `${pct}%`, height: "100%",
                background: isPos ? posColor : negColor,
                marginLeft: isPos ? "0" : "auto",
                transition: "width 0.5s",
                opacity: 0.85,
                boxShadow: pct > 60 ? `0 0 6px ${isPos ? "rgba(63,185,80,0.4)" : "rgba(218,54,51,0.4)"}` : "none",
              }} />
            </div>
            <div style={{ width: 56, color: isPos ? posColor : negColor, fontFamily: "monospace", fontSize: "0.68rem", textAlign: "right", flexShrink: 0 }}>
              {s.v > 0 ? "+" : ""}{s.v.toFixed(4)}
            </div>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: "0.68rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: posColor }} />
          <span style={{ color: "#8b949e" }}>+ pushes YES</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: negColor }} />
          <span style={{ color: "#8b949e" }}>− pulls away from YES</span>
        </div>
      </div>
    </div>
  );
}

// ─── Feature snapshot heatmap ─────────────────────────────────────────────────

function FeatureHeatmap({ snap }: { snap: Record<string, number> }) {
  const entries = Object.entries(snap);
  if (!entries.length)
    return <div style={{ color: "#484f58", fontSize: "0.8rem" }}>Feature values appear after next signal</div>;
  const vals = entries.map(([, v]) => v);
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const toHue = (v: number) => {
    const t = (v - min) / range;
    const hue = t < 0.5 ? 220 - t * 2 * 160 : 60 - (t - 0.5) * 2 * 60;
    return `hsl(${hue}, 70%, ${28 + t * 26}%)`;
  };
  const fmt = (v: number) => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4);
  return (
    <div>
      <div style={{ fontSize: "0.68rem", color: "#8b949e", marginBottom: 6 }}>
        {entries.length} features at last signal row · hover cell for exact value
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(68px, 1fr))", gap: 3 }}>
        {entries.map(([f, v]) => (
          <div key={f} title={`${f}: ${v}`}
            style={{ background: toHue(v), borderRadius: 3, padding: "3px 5px", cursor: "default", border: "1px solid rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: "0.58rem", color: "rgba(255,255,255,0.75)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {f.replace(/_/g, " ")}
            </div>
            <div style={{ fontSize: "0.63rem", color: "rgba(255,255,255,0.95)", fontFamily: "monospace", fontWeight: 700 }}>{fmt(v)}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 0, height: 7, marginTop: 10, borderRadius: 3, overflow: "hidden" }}>
        {Array.from({ length: 40 }, (_, i) => {
          const t = i / 39;
          const hue = t < 0.5 ? 220 - t * 2 * 160 : 60 - (t - 0.5) * 2 * 60;
          return <div key={i} style={{ flex: 1, background: `hsl(${hue}, 70%, ${28 + t * 26}%)` }} />;
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.62rem", color: "#484f58", marginTop: 2 }}>
        <span>Low ({min.toFixed(3)})</span><span>High ({max.toFixed(3)})</span>
      </div>
    </div>
  );
}

// ─── Signal prob sparkline ────────────────────────────────────────────────────

function ProbSparkline({ probs }: { probs: { prob: number; ts: string }[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c || !probs.length) return;
    const ctx = c.getContext("2d")!;
    const W = c.offsetWidth, H = c.offsetHeight;
    c.width = W * devicePixelRatio; c.height = H * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const mn = 0.5, mx = 1.0, r = mx - mn, pad = 8;
    const X = (i: number) => pad + (i / (probs.length - 1 || 1)) * (W - 2 * pad);
    const Y = (v: number) => pad + (1 - (Math.min(Math.max(v, mn), mx) - mn) / r) * (H - 2 * pad);
    [0.80, 0.90].forEach(t => {
      ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.strokeStyle = t >= 0.9 ? "rgba(63,185,80,0.3)" : "rgba(88,166,255,0.3)";
      ctx.beginPath(); ctx.moveTo(pad, Y(t)); ctx.lineTo(W - pad, Y(t)); ctx.stroke();
    });
    ctx.setLineDash([]);
    if (probs.length > 1) {
      ctx.beginPath(); ctx.strokeStyle = "rgba(88,166,255,0.35)"; ctx.lineWidth = 1.5;
      probs.forEach((p, i) => { if (i === 0) ctx.moveTo(X(i), Y(p.prob)); else ctx.lineTo(X(i), Y(p.prob)); });
      ctx.stroke();
    }
    probs.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(X(i), Y(p.prob), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = p.prob >= 0.90 ? "#3fb950" : p.prob >= 0.80 ? "#58a6ff" : "#d29922";
      ctx.fill();
    });
  }, [probs]);
  if (!probs.length) return <div style={{ color: "#484f58", fontSize: "0.8rem" }}>No signals yet</div>;
  return <canvas ref={ref} style={{ width: "100%", height: 90, display: "block" }} />;
}

// ─── Rolling win rate ─────────────────────────────────────────────────────────

function RollingWinRate({ curve }: { curve: { ts: string; balance: number; pnl: number }[] }) {
  const W_SIZE = 10;
  const ref = useRef<HTMLCanvasElement>(null);
  const points = curve.map((_, i) => {
    const window = curve.slice(Math.max(0, i - W_SIZE + 1), i + 1);
    return window.filter(p => p.pnl > 0).length / window.length;
  });
  useEffect(() => {
    const c = ref.current; if (!c || points.length < 2) return;
    const ctx = c.getContext("2d")!;
    const W = c.offsetWidth, H = c.offsetHeight;
    c.width = W * devicePixelRatio; c.height = H * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const pad = { t: 8, r: 10, b: 20, l: 36 };
    const X = (i: number) => pad.l + (i / (points.length - 1 || 1)) * (W - pad.l - pad.r);
    const Y = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = "rgba(72,79,88,0.6)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, Y(0.5)); ctx.lineTo(W - pad.r, Y(0.5)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#484f58"; ctx.font = "10px sans-serif"; ctx.textAlign = "right";
    ["100%", "50%", "0%"].forEach((l, fi) => {
      ctx.fillText(l, pad.l - 4, pad.t + fi * (H - pad.t - pad.b) / 2 + 4);
    });
    const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
    grad.addColorStop(0, "rgba(63,185,80,0.25)"); grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath(); ctx.moveTo(X(0), Y(points[0]));
    points.forEach((v, i) => { if (i > 0) ctx.lineTo(X(i), Y(v)); });
    ctx.lineTo(X(points.length - 1), H - pad.b); ctx.lineTo(X(0), H - pad.b);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.lineWidth = 2;
    for (let i = 1; i < points.length; i++) {
      const v = points[i];
      ctx.beginPath();
      ctx.strokeStyle = v >= 0.6 ? "#3fb950" : v >= 0.45 ? "#d29922" : "#f85149";
      ctx.moveTo(X(i - 1), Y(points[i - 1])); ctx.lineTo(X(i), Y(v)); ctx.stroke();
    }
    points.forEach((v, i) => {
      ctx.beginPath(); ctx.arc(X(i), Y(v), 3, 0, Math.PI * 2);
      ctx.fillStyle = v >= 0.6 ? "#3fb950" : v >= 0.45 ? "#d29922" : "#f85149";
      ctx.fill();
    });
  }, [curve]);
  if (points.length < 3)
    return <div style={{ color: "#484f58", fontSize: "0.8rem", textAlign: "center", padding: "1.5rem" }}>Need ≥3 fills for rolling win rate</div>;
  return <canvas ref={ref} style={{ width: "100%", height: 100, display: "block" }} />;
}

// ─── GRU Cascade ─────────────────────────────────────────────────────────────

function GRUCascade({ gru }: { gru: GRU }) {
  const hasData = Object.keys(gru).length > 0;
  const level = (label: string, d: number, f: number, u: number) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "#8b949e", marginBottom: 3 }}>
        <span style={{ fontFamily: "monospace" }}>{label}</span>
        <span style={{ color: u > d ? "#3fb950" : d > u ? "#da3633" : "#d29922" }}>
          ↑{(u * 100).toFixed(1)}% ↔{(f * 100).toFixed(1)}% ↓{(d * 100).toFixed(1)}%
        </span>
      </div>
      <div style={{ display: "flex", height: 20, borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${d * 100}%`, background: "#da3633", transition: "width 0.6s" }} />
        <div style={{ width: `${f * 100}%`, background: "#484f58", transition: "width 0.6s" }} />
        <div style={{ width: `${u * 100}%`, background: "#238636", transition: "width 0.6s" }} />
      </div>
    </div>
  );
  if (!hasData)
    return <div style={{ color: "#484f58", fontSize: "0.8rem" }}>GRU probs appear after first warm signal (≥788 bars)</div>;
  return (
    <div>
      {level("L1  30s", gru.l1_down, gru.l1_flat, gru.l1_up)}
      <div style={{ textAlign: "center", color: "#30363d", margin: "2px 0" }}>▼</div>
      {level("L2  60s", gru.l2_down, gru.l2_flat, gru.l2_up)}
      <div style={{ textAlign: "center", color: "#30363d", margin: "2px 0" }}>▼</div>
      {level("L3 300s", gru.l3_down, gru.l3_flat, gru.l3_up)}
      <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: "0.7rem" }}>
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
  if (!entries.length) return <div style={{ color: "#484f58", fontSize: "0.8rem" }}>No skipped signals yet</div>;
  const colors = ["#58a6ff", "#8957e5", "#d29922", "#3fb950", "#da3633", "#2ea043"];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let acc = 0;
  const segs = entries.map(([k, v], i) => {
    const pct = v / total, s = acc; acc += pct;
    return { k, v, pct, s, c: colors[i % colors.length] };
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
        {segs.map(s => <path key={s.k} d={arc(s.s, s.s + s.pct)} fill={s.c} />)}
        <text x={cx} y={cy + 4} textAnchor="middle" fill="#8b949e" fontSize="9" fontWeight="bold">{total}</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        {segs.map(s => (
          <div key={s.k} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.72rem" }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: s.c, flexShrink: 0 }} />
            <span style={{ color: "#8b949e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.k.replace(/_/g, " ")}</span>
            <span style={{ color: "#e6edf3", marginLeft: "auto", paddingLeft: 6, flexShrink: 0 }}>{s.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Side split ───────────────────────────────────────────────────────────────

function SideSplit({ by_side }: { by_side: VizState["by_side"] }) {
  const { yes_wins, yes_losses, no_wins, no_losses, yes_pnl, no_pnl } = by_side;
  if (yes_wins + yes_losses + no_wins + no_losses === 0)
    return <div style={{ color: "#484f58", fontSize: "0.8rem" }}>No data yet</div>;
  const Row = ({ label, wins, losses, pnl, color }: { label: string; wins: number; losses: number; pnl: number; color: string }) => {
    const t = wins + losses, wr = t > 0 ? ((wins / t) * 100).toFixed(0) : "–";
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", marginBottom: 4 }}>
          <span style={{ color, fontWeight: 700 }}>{label}</span>
          <span style={{ color: "#8b949e" }}>
            {wins}W / {losses}L ·{" "}
            <span style={{ color: parseInt(wr) >= 60 ? "#3fb950" : "#d29922" }}>{wr}%</span>
            {" · "}
            <span style={{ color: pnl >= 0 ? "#3fb950" : "#f85149", fontWeight: 700 }}>
              {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
            </span>
          </span>
        </div>
        {t > 0 && (
          <div style={{ display: "flex", height: 10, borderRadius: 4, overflow: "hidden", background: "#21262d" }}>
            <div style={{ width: `${(wins / t) * 100}%`, background: "#238636", transition: "width 0.6s" }} />
            <div style={{ width: `${(losses / t) * 100}%`, background: "#da3633", transition: "width 0.6s" }} />
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

// ─── Event feed ───────────────────────────────────────────────────────────────

function EventFeed({ events }: { events: TradeEvent[] }) {
  const icons: Record<string, string> = {
    order_fill: "✅", settlement: "🏁", order_place: "📋", order_error: "❌",
    session_start: "🟢", session_end: "🔴", risk_halt: "⛔", take_profit_fill: "🎯", flip_entry_fill: "🔄",
  };
  const colors: Record<string, string> = {
    order_fill: "#58a6ff", settlement: "#3fb950", order_error: "#f85149",
    risk_halt: "#da3633", session_start: "#2ea043", session_end: "#484f58",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 220, overflowY: "auto" }}>
      {!events.length && <div style={{ color: "#484f58", fontSize: "0.8rem" }}>Waiting for bot activity…</div>}
      {events.map(ev => {
        let pnlStr = "";
        try {
          const p = JSON.parse(ev.payload);
          if (typeof p?.net_pnl_usd === "number") pnlStr = (p.net_pnl_usd > 0 ? " +" : " ") + p.net_pnl_usd.toFixed(2);
        } catch { /* skip */ }
        return (
          <div key={ev.id} style={{ display: "flex", gap: 8, fontSize: "0.78rem", paddingBottom: 4, borderBottom: "1px solid #21262d" }}>
            <span style={{ flexShrink: 0 }}>{icons[ev.event_type] ?? "•"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: colors[ev.event_type] ?? "#e6edf3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
  const [tab, setTab] = useState<"overview" | "signals" | "features">("overview");

  const load = () => {
    fetch("/api/viz/state")
      .then(r => { if (!r.ok) throw new Error("Unauthorized"); return r.json() as Promise<VizState>; })
      .then(d => { setState(d); setLastRefresh(new Date()); setPulse(true); setTimeout(() => setPulse(false), 600); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); const id = setInterval(load, 15_000); return () => clearInterval(id); }, []);

  if (loading) return <div style={{ color: "#8b949e", padding: "2rem", display: "flex", alignItems: "center", gap: 8 }}>⏳ Loading…</div>;
  if (err) return <div style={S.err}>{err}</div>;
  if (!state) return null;

  const upPnl = state.total_pnl >= 0, upToday = state.today_pnl >= 0;
  const wrColor = state.win_rate == null ? "#8b949e" : state.win_rate >= 60 ? "#3fb950" : state.win_rate >= 45 ? "#d29922" : "#f85149";
  const balAge = state.balance_updated_at
    ? `Synced ${state.balance_updated_at.replace("T", " ").slice(0, 16)} UTC`
    : "Awaiting bot sync";

  const TabBtn = ({ id, label }: { id: typeof tab; label: string }) => (
    <button onClick={() => setTab(id)} style={{
      background: tab === id ? "#161b22" : "transparent",
      border: `1px solid ${tab === id ? "#30363d" : "transparent"}`,
      borderRadius: 6, color: tab === id ? "#e6edf3" : "#8b949e",
      cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, padding: "0.35rem 0.8rem",
    }}>{label}</button>
  );

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
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

      {/* ── Stat rows ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(115px, 1fr))", gap: "0.65rem", marginBottom: "0.65rem" }}>
        <Stat label="Fund Balance" val={`$${state.balance.toFixed(2)}`} sub={balAge} color="#58a6ff" />
        <Stat label="Total P&L" val={(upPnl ? "+" : "") + `$${state.total_pnl.toFixed(2)}`} color={upPnl ? "#3fb950" : "#f85149"} />
        <Stat label="Win Rate" val={state.win_rate != null ? `${state.win_rate}%` : "–"} sub={`${state.wins}W / ${state.losses}L`} color={wrColor} />
        <Stat label="Today P&L" val={(upToday ? "+" : "") + `$${state.today_pnl.toFixed(2)}`} sub={`${state.today_wins}W / ${state.today_losses}L`} color={upToday ? "#3fb950" : "#f85149"} />
        <Stat label="Fills" val={String(state.total_fills)} sub={`${state.total_contracts} contracts`} />
        <Stat label="NAV / Unit" val={`$${state.nav.toFixed(4)}`} sub={`${state.total_units.toFixed(1)} units`} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(115px, 1fr))", gap: "0.65rem", marginBottom: "1rem" }}>
        {state.avg_win != null && <Stat label="Avg Win" val={`+$${state.avg_win.toFixed(2)}`} color="#3fb950" />}
        {state.avg_loss != null && <Stat label="Avg Loss" val={`$${state.avg_loss.toFixed(2)}`} color="#f85149" />}
        {state.best_trade !== 0 && <Stat label="Best Trade" val={`+$${state.best_trade.toFixed(2)}`} color="#3fb950" />}
        {state.worst_trade !== 0 && <Stat label="Worst Trade" val={`$${state.worst_trade.toFixed(2)}`} color="#f85149" />}
        {state.last_model_prob != null && (
          <Stat label="Last Signal" val={`${(state.last_model_prob * 100).toFixed(1)}%`}
            sub={`${state.last_signal_side?.toUpperCase() ?? ""} · ${state.last_signal_ts?.slice(11, 16) ?? ""}z`}
            color={state.last_model_prob >= 0.9 ? "#3fb950" : "#d29922"} />
        )}
        <Stat label="Signals" val={String(state.event_type_counts?.signal ?? 0)} sub={`${state.event_type_counts?.no_signal ?? 0} skipped`} />
        {state.last_elapsed_frac != null && (
          <Stat label="Elapsed Frac" val={`${(state.last_elapsed_frac * 100).toFixed(1)}%`} sub="market completion" color="#8b949e" />
        )}
        {state.last_regime_score != null && (
          <Stat label="Regime" val={state.last_regime_score.toFixed(3)}
            sub={state.last_regime_score > 0.63 ? "very bullish" : state.last_regime_score > 0.5 ? "mild bull" : state.last_regime_score < 0.25 ? "very bearish" : "bearish"}
            color={state.last_regime_score > 0.5 ? "#3fb950" : "#d29922"} />
        )}
      </div>

      {/* ── Tab nav ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: "1rem", padding: "0.5rem", background: "#0d1117", borderRadius: 8, border: "1px solid #21262d" }}>
        <TabBtn id="overview" label="📈 Overview" />
        <TabBtn id="signals" label="🧠 Signals & GRU" />
        <TabBtn id="features" label="🔬 Feature Attribution" />
      </div>

      {/* ── Overview tab ── */}
      {tab === "overview" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <Section title="Equity Curve — balance per fill">
              <EquityChart points={state.equity_curve} />
            </Section>
            <Section title={`Per-trade P&L — ${state.pnl_bars.length} fills`}>
              <PnLBars bars={state.pnl_bars} />
            </Section>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <Section title="Rolling Win Rate — last 10-trade window">
              <RollingWinRate curve={state.equity_curve} />
            </Section>
            <Section title="YES vs NO Side Split">
              <SideSplit by_side={state.by_side} />
            </Section>
          </div>
          <Section title="Recent Activity">
            <EventFeed events={state.recent_events} />
          </Section>
        </>
      )}

      {/* ── Signals & GRU tab ── */}
      {tab === "signals" && (
        <>
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
          <Section title="Skip Reasons — why bot didn't trade">
            <SkipDonut reasons={state.skip_reasons} />
          </Section>
        </>
      )}

      {/* ── Feature Attribution tab ── */}
      {tab === "features" && (
        <>
          <Section title={`SHAP Feature Attribution — last ${state.last_signal_side?.toUpperCase() ?? "?"} signal · top ${state.last_signal_shap.length || 12} contributors`}>
            <ShapChart shap={state.last_signal_shap} side={state.last_signal_side} />
          </Section>
          <Section title={`Feature Snapshot — ${Object.keys(state.last_feat_snapshot).length} input values at last signal row (blue=low, red=high)`}>
            <FeatureHeatmap snap={state.last_feat_snapshot} />
          </Section>
        </>
      )}

      <div style={{ color: "#484f58", fontSize: "0.7rem", textAlign: "right", marginTop: "0.5rem" }}>
        Auto-refreshes every 15s · {session?.display_name} · eom_v10c · max 3 contracts
      </div>
    </div>
  );
}
