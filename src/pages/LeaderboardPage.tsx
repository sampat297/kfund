import { useState, useEffect, useCallback } from "react";
import { S } from "../App";

function fmt(n: number, d = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtUSD(n: number) { return "$" + fmt(n); }

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export default function LeaderboardPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/leaderboard");
      if (r.status === 401) { window.location.hash = "#/"; return; }
      setData(await r.json());
    } catch { setError("Failed to load"); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  if (error) return <div style={S.err}>{error}</div>;
  if (!data) return <div style={{ color: "#8b949e", padding: "2rem 0" }}>Loading…</div>;

  const { fund, investors } = data;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h2 style={{ color: "#e6edf3", fontSize: "1.4rem", fontWeight: 700 }}>Leaderboard</h2>
        <button style={S.btn("ghost")} onClick={load}>↻ Refresh</button>
      </div>

      {/* Fund summary strip */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "2rem" }}>
        {[
          { label: "Fund Balance", value: fmtUSD(fund.balance), color: "#58a6ff" },
          { label: "NAV per Unit", value: fmtUSD(fund.nav) },
          { label: "Total Units", value: fmt(fund.total_units, 2) },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ ...S.card, flex: 1, minWidth: 160 }}>
            <div style={{ color: "#8b949e", fontSize: "0.8rem", marginBottom: "0.25rem" }}>{label}</div>
            <div style={{ color: color || "#e6edf3", fontSize: "1.3rem", fontWeight: 700 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Leaderboard table */}
      <div style={S.card}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#8b949e", fontSize: "0.8rem", textTransform: "uppercase", borderBottom: "1px solid #30363d" }}>
              <th style={{ padding: "0.5rem 0.75rem", textAlign: "left" }}>Rank</th>
              <th style={{ padding: "0.5rem 0.75rem", textAlign: "left" }}>Name</th>
              <th style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>Value</th>
              <th style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>P&L %</th>
            </tr>
          </thead>
          <tbody>
            {investors.map((inv: any) => {
              const pnlColor = inv.pnl_pct >= 0 ? "#3fb950" : "#f85149";
              return (
                <tr
                  key={inv.rank}
                  style={{
                    borderBottom: "1px solid #21262d",
                    ...(inv.rank <= 3 ? { background: "rgba(88,166,255,0.03)" } : {}),
                  }}
                >
                  <td style={{ padding: "0.75rem", fontSize: "1.1rem" }}>
                    {MEDALS[inv.rank] || `#${inv.rank}`}
                  </td>
                  <td style={{ padding: "0.75rem", color: inv.is_private ? "#8b949e" : "#e6edf3", fontStyle: inv.is_private ? "italic" : "normal" }}>
                    {inv.display_name}
                  </td>
                  <td style={{ padding: "0.75rem", textAlign: "right", color: "#e6edf3" }}>
                    {inv.value != null ? fmtUSD(inv.value) : "—"}
                  </td>
                  <td style={{ padding: "0.75rem", textAlign: "right", color: pnlColor, fontWeight: 600 }}>
                    {inv.pnl_pct >= 0 ? "+" : ""}{fmt(inv.pnl_pct)}%
                  </td>
                </tr>
              );
            })}
            {investors.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: "2rem", textAlign: "center", color: "#8b949e" }}>No investors yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
