import { useState } from "react";
import { S, SessionInfo } from "../App";

export default function LoginPage({ onLogin }: { onLogin: (s: SessionInfo) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const body: any = { username, password };
      if (totpRequired) body.totp_code = totpCode;
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json() as any;
      if (!r.ok) { setError(data.error || "Login failed"); return; }
      if (data.totp_required) { setTotpRequired(true); return; }
      if (data.ok) {
        // fetch full session
        const me = await fetch("/api/auth/me").then(r => r.json()) as any;
        onLogin(me);
        if (data.must_change_password) window.location.hash = "#/settings";
        else window.location.hash = "#/dashboard";
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      <div style={{ ...S.card, width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>📈</div>
          <h1 style={{ color: "#58a6ff", fontSize: "1.5rem", fontWeight: 700 }}>KFund</h1>
          <p style={{ color: "#8b949e", fontSize: "0.85rem", marginTop: "0.25rem" }}>Investor Portal</p>
        </div>

        {error && <div style={S.err}>{error}</div>}

        <form onSubmit={handleSubmit}>
          {!totpRequired ? (
            <>
              <div style={S.fieldset}>
                <label style={S.label}>Username</label>
                <input
                  style={S.input}
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div style={S.fieldset}>
                <label style={S.label}>Password</label>
                <input
                  style={S.input}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>
            </>
          ) : (
            <div style={S.fieldset}>
              <div style={{ ...S.ok, marginBottom: "1rem" }}>
                Enter the 6-digit code from your authenticator app.
              </div>
              <label style={S.label}>2FA Code</label>
              <input
                style={{ ...S.input, letterSpacing: "0.3em", textAlign: "center", fontSize: "1.2rem" }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={totpCode}
                onChange={e => setTotpCode(e.target.value.replace(/\D/g, ""))}
                autoFocus
                required
              />
            </div>
          )}

          <button type="submit" style={{ ...S.btn("primary"), width: "100%", padding: "0.75rem" }} disabled={loading}>
            {loading ? "Signing in…" : totpRequired ? "Verify" : "Sign in"}
          </button>

          {totpRequired && (
            <button
              type="button"
              style={{ ...S.btn("ghost"), width: "100%", marginTop: "0.5rem" }}
              onClick={() => { setTotpRequired(false); setTotpCode(""); }}
            >
              ← Back
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
