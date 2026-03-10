import { useState, useEffect, useCallback } from "react";
import { S, SessionInfo } from "../App";

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ ...S.card, flex: 1, minWidth: 160 }}>
      <div style={{ color: "#8b949e", fontSize: "0.8rem", marginBottom: "0.35rem" }}>{label}</div>
      <div style={{ color: color || "#e6edf3", fontSize: "1.4rem", fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ color: "#8b949e", fontSize: "0.75rem", marginTop: "0.25rem" }}>{sub}</div>}
    </div>
  );
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtUSD(n: number) {
  return "$" + fmt(n);
}

export default function DashboardPage({ session }: { session: SessionInfo }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/dashboard");
      if (r.status === 401) { window.location.hash = "#/"; return; }
      const d = await r.json() as any;
      setData(d);
    } catch {
      setError("Failed to load dashboard");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  if (error) return <div style={S.err}>{error}</div>;
  if (!data) return <div style={{ color: "#8b949e", padding: "2rem 0" }}>Loading…</div>;

  const { user, fund, portfolio } = data;
  const pnlColor = portfolio.pnl_dollars >= 0 ? "#3fb950" : "#f85149";
  const fundPnlDollars = fund.balance - (fund.total_units * 1); // simplified

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h2 style={{ color: "#e6edf3", fontSize: "1.4rem", fontWeight: 700 }}>
          Welcome back, {user.display_name}
        </h2>
        <button style={S.btn("ghost")} onClick={load}>↻ Refresh</button>
      </div>

      {/* Portfolio cards */}
      <h3 style={{ color: "#8b949e", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
        Your Portfolio
      </h3>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "2rem" }}>
        <StatCard label="Portfolio Value" value={fmtUSD(portfolio.value)} color="#58a6ff" />
        <StatCard label="Total Contributed" value={fmtUSD(user.contributed)} />
        <StatCard
          label="P&L"
          value={`${portfolio.pnl_dollars >= 0 ? "+" : ""}${fmtUSD(portfolio.pnl_dollars)}`}
          sub={`${portfolio.pnl_pct >= 0 ? "+" : ""}${fmt(portfolio.pnl_pct)}%`}
          color={pnlColor}
        />
        <StatCard label="Units Held" value={fmt(user.units, 4)} />
        <StatCard label="Entry NAV" value={fmtUSD(user.nav_at_join)} />
        <StatCard label="Current NAV" value={fmtUSD(fund.nav)} />
        <StatCard label="Ownership" value={`${fmt(portfolio.ownership_pct, 2)}%`} />
      </div>

      {/* Fund overview */}
      <h3 style={{ color: "#8b949e", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
        Fund Overview
      </h3>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <StatCard label="Fund Balance" value={fmtUSD(fund.balance)} color="#58a6ff" />
        <StatCard label="Total Units" value={fmt(fund.total_units, 2)} />
        <StatCard label="NAV per Unit" value={fmtUSD(fund.nav)} />
        <StatCard label="Members" value={String(fund.member_count)} />
      </div>
    </div>
  );
}
