import { useState, useEffect } from "react";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import FeedPage from "./pages/FeedPage";
import SettingsPage from "./pages/SettingsPage";
import AdminPage from "./pages/AdminPage";

// ─── Shared styles ────────────────────────────────────────────────────────────

export const S = {
  card: {
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: 8,
    padding: "1.5rem",
  } as React.CSSProperties,
  btn: (variant: "primary" | "danger" | "ghost" | "warning" = "primary"): React.CSSProperties => ({
    padding: "0.5rem 1rem",
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "0.875rem",
    background:
      variant === "primary" ? "#238636" :
      variant === "danger" ? "#da3633" :
      variant === "warning" ? "#d29922" :
      "transparent",
    color:
      variant === "ghost" ? "#8b949e" : "#fff",
    ...(variant === "ghost" ? { border: "1px solid #30363d" } : {}),
  }),
  input: {
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 6,
    padding: "0.5rem 0.75rem",
    color: "#e6edf3",
    fontSize: "0.9rem",
    width: "100%",
  } as React.CSSProperties,
  label: {
    display: "block",
    marginBottom: "0.25rem",
    color: "#8b949e",
    fontSize: "0.85rem",
  } as React.CSSProperties,
  fieldset: {
    marginBottom: "1rem",
  } as React.CSSProperties,
  err: {
    background: "#3d1a1a",
    border: "1px solid #da3633",
    borderRadius: 6,
    padding: "0.75rem",
    color: "#f85149",
    marginBottom: "1rem",
    fontSize: "0.875rem",
  } as React.CSSProperties,
  ok: {
    background: "#1a2f1a",
    border: "1px solid #238636",
    borderRadius: 6,
    padding: "0.75rem",
    color: "#3fb950",
    marginBottom: "1rem",
    fontSize: "0.875rem",
  } as React.CSSProperties,
  badge: (color: string): React.CSSProperties => ({
    display: "inline-block",
    padding: "0.2rem 0.5rem",
    borderRadius: 4,
    fontSize: "0.75rem",
    fontWeight: 700,
    background: color,
    color: "#fff",
  }),
};

// ─── Session context ──────────────────────────────────────────────────────────

export type SessionInfo = {
  user_id: number;
  username: string;
  is_admin: number;
  display_name: string;
} | null;

// ─── NavBar ───────────────────────────────────────────────────────────────────

function NavBar({ session, onLogout }: { session: SessionInfo; onLogout: () => void }) {
  const hash = window.location.hash || "#/dashboard";

  const navLink = (label: string, href: string, style?: React.CSSProperties) => (
    <a
      key={href}
      href={href}
      style={{
        color: hash === href ? "#58a6ff" : "#8b949e",
        textDecoration: "none",
        fontWeight: hash === href ? 600 : 400,
        fontSize: "0.9rem",
        padding: "0.25rem 0",
        ...style,
      }}
    >
      {label}
    </a>
  );

  return (
    <nav
      style={{
        background: "#161b22",
        borderBottom: "1px solid #30363d",
        padding: "0.75rem 2rem",
        display: "flex",
        alignItems: "center",
        gap: "1.5rem",
      }}
    >
      <span style={{ color: "#58a6ff", fontWeight: 700, fontSize: "1rem", marginRight: "0.5rem" }}>
        📈 KFund
      </span>
      {navLink("Portfolio", "#/dashboard")}
      {navLink("Leaderboard", "#/leaderboard")}
      {navLink("Feed", "#/feed")}
      {navLink("Settings", "#/settings")}
      {session?.is_admin ? navLink("Admin", "#/admin", { color: hash === "#/admin" ? "#ffd700" : "#d29922" }) : null}
      <span style={{ flex: 1 }} />
      <span style={{ color: "#8b949e", fontSize: "0.8rem" }}>{session?.display_name}</span>
      <button onClick={onLogout} style={{ ...S.btn("ghost"), padding: "0.25rem 0.75rem" }}>
        Sign out
      </button>
    </nav>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState<SessionInfo>(null);
  const [loading, setLoading] = useState(true);
  const [hash, setHash] = useState(window.location.hash || "#/");

  useEffect(() => {
    const onHash = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data: any) => {
        if (data.ok) setSession(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession(null);
    window.location.hash = "#/";
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", color: "#8b949e" }}>
        Loading…
      </div>
    );
  }

  if (!session) {
    return <LoginPage onLogin={(s) => { setSession(s); }} />;
  }

  const page = hash.replace(/^#/, "") || "/";

  const renderPage = () => {
    if (page === "/" || page === "/dashboard") return <DashboardPage session={session} />;
    if (page === "/leaderboard") return <LeaderboardPage />;
    if (page === "/feed") return <FeedPage />;
    if (page === "/settings") return <SettingsPage session={session} onSessionUpdate={(s) => setSession(s)} />;
    if (page === "/admin") return session.is_admin ? <AdminPage /> : <div style={{ padding: "2rem", color: "#f85149" }}>Access denied</div>;
    return <DashboardPage session={session} />;
  };

  return (
    <div>
      <NavBar session={session} onLogout={handleLogout} />
      <main style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
        {renderPage()}
      </main>
    </div>
  );
}
