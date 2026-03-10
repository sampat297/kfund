import { useState, useEffect, useCallback } from "react";
import { S } from "../App";

const EVENT_COLORS: Record<string, string> = {
  order_fill: "#238636",
  settlement: "#238636",
  flip_primary_exit: "#da3633",
  stop_exit: "#da3633",
  flip_signal: "#d29922",
  info: "#8b949e",
};

function eventColor(type: string): string {
  return EVENT_COLORS[type] || "#8b949e";
}

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts + "Z").getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function EventCard({ ev }: { ev: any }) {
  const [expanded, setExpanded] = useState(false);
  const color = eventColor(ev.event_type);
  return (
    <div style={{ ...S.card, marginBottom: "0.75rem", borderLeft: `3px solid ${color}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span style={S.badge(color)}>{ev.event_type}</span>
        <span style={{ color: "#e6edf3", fontWeight: 600, flex: 1 }}>{ev.title}</span>
        {ev.fund_balance != null && (
          <span style={{ color: "#58a6ff", fontSize: "0.85rem" }}>
            Fund: ${ev.fund_balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </span>
        )}
        <span style={{ color: "#8b949e", fontSize: "0.8rem" }}>{timeAgo(ev.created_at)}</span>
        <button
          style={{ ...S.btn("ghost"), padding: "0.15rem 0.5rem", fontSize: "0.75rem" }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "▲" : "▼"}
        </button>
      </div>
      {expanded && (
        <pre
          style={{
            marginTop: "0.75rem",
            background: "#0d1117",
            border: "1px solid #30363d",
            borderRadius: 4,
            padding: "0.75rem",
            fontSize: "0.8rem",
            color: "#8b949e",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {typeof ev.payload === "string" ? ev.payload : JSON.stringify(ev.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function FeedPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/feed?page=${p}`);
      if (r.status === 401) { window.location.hash = "#/"; return; }
      const d = await r.json() as any;
      setEvents(d.events);
      setPages(d.pages);
      setPage(p);
    } catch { setError("Failed to load feed"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load(1);
    const id = setInterval(() => load(1), 30000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h2 style={{ color: "#e6edf3", fontSize: "1.4rem", fontWeight: 700 }}>Trade Feed</h2>
        <button style={S.btn("ghost")} onClick={() => load(page)} disabled={loading}>
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {error && <div style={S.err}>{error}</div>}

      {events.length === 0 && !loading && (
        <div style={{ ...S.card, textAlign: "center", color: "#8b949e", padding: "3rem" }}>
          No trade events yet.
        </div>
      )}

      {events.map((ev) => <EventCard key={ev.id} ev={ev} />)}

      {pages > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "1rem" }}>
          <button style={S.btn("ghost")} onClick={() => load(page - 1)} disabled={page <= 1}>← Prev</button>
          <span style={{ color: "#8b949e", lineHeight: "2rem" }}>Page {page} / {pages}</span>
          <button style={S.btn("ghost")} onClick={() => load(page + 1)} disabled={page >= pages}>Next →</button>
        </div>
      )}
    </div>
  );
}
