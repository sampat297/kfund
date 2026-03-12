import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import { S, SessionInfo } from "../App";

export default function SettingsPage({
  session,
  onSessionUpdate,
}: {
  session: SessionInfo;
  onSessionUpdate: (s: SessionInfo) => void;
}) {
  const [me, setMe] = useState<any>(null);

  useEffect(() => {
    fetch("/api/settings/me")
      .then(r => r.json())
      .then(setMe)
      .catch(() => {});
  }, []);

  if (!me) return <div style={{ color: "#8b949e" }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 600 }}>
      <h2 style={{ color: "#e6edf3", fontSize: "1.4rem", fontWeight: 700, marginBottom: "1.5rem" }}>Settings</h2>
      {me.must_change_password === 1 && (
        <div style={{ background: "#3d2a00", border: "1px solid #d29922", borderRadius: 6, padding: "0.75rem", marginBottom: "1.5rem", color: "#d29922" }}>
          ⚠️ You must change your password before continuing.
        </div>
      )}
      <ChangePassword mustChange={me.must_change_password === 1} onChanged={() => {
        setMe({ ...me, must_change_password: 0 });
        onSessionUpdate(session);
      }} />
      <ChangeDisplayName current={me.display_name} />
      <PrivacyToggle current={me.is_private === 1} />
      <TOTPSection totpEnabled={me.totp_enabled === 1} onChanged={() => setMe({ ...me, totp_enabled: me.totp_enabled === 1 ? 0 : 1 })} />
    </div>
  );
}

function ChangePassword({ mustChange, onChanged }: { mustChange: boolean; onChanged: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setOk("");
    if (next !== confirm) { setErr("Passwords do not match"); return; }
    if (next.length < 8) { setErr("Password must be at least 8 characters"); return; }
    setLoading(true);
    try {
      const body: any = { new_password: next };
      if (!mustChange) body.current_password = current;
      const r = await fetch("/api/settings/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json() as any;
      if (!r.ok) { setErr(d.error || "Failed"); return; }
      setOk("Password updated!");
      setCurrent(""); setNext(""); setConfirm("");
      onChanged();
    } catch { setErr("Network error"); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ ...S.card, marginBottom: "1rem" }}>
      <h3 style={{ color: "#e6edf3", marginBottom: "1rem" }}>🔑 Change Password</h3>
      {err && <div style={S.err}>{err}</div>}
      {ok && <div style={S.ok}>{ok}</div>}
      <form onSubmit={submit}>
        {!mustChange && (
          <div style={S.fieldset}>
            <label style={S.label}>Current Password</label>
            <input style={S.input} type="password" value={current} onChange={e => setCurrent(e.target.value)} required />
          </div>
        )}
        <div style={S.fieldset}>
          <label style={S.label}>New Password</label>
          <input style={S.input} type="password" value={next} onChange={e => setNext(e.target.value)} required />
        </div>
        <div style={S.fieldset}>
          <label style={S.label}>Confirm New Password</label>
          <input style={S.input} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
        </div>
        <button type="submit" style={S.btn("primary")} disabled={loading}>
          {loading ? "Saving…" : "Update Password"}
        </button>
      </form>
    </div>
  );
}

function ChangeDisplayName({ current }: { current: string }) {
  const [name, setName] = useState(current);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setOk("");
    setLoading(true);
    try {
      const r = await fetch("/api/settings/username", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ new_display_name: name }) });
      const d = await r.json() as any;
      if (!r.ok) { setErr(d.error || "Failed"); return; }
      setOk("Display name updated!");
    } catch { setErr("Network error"); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ ...S.card, marginBottom: "1rem" }}>
      <h3 style={{ color: "#e6edf3", marginBottom: "1rem" }}>✏️ Change Display Name</h3>
      {err && <div style={S.err}>{err}</div>}
      {ok && <div style={S.ok}>{ok}</div>}
      <form onSubmit={submit}>
        <div style={S.fieldset}>
          <label style={S.label}>Display Name</label>
          <input style={S.input} type="text" value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={32} required />
        </div>
        <button type="submit" style={S.btn("primary")} disabled={loading}>
          {loading ? "Saving…" : "Update Name"}
        </button>
      </form>
    </div>
  );
}

function PrivacyToggle({ current }: { current: boolean }) {
  const [isPrivate, setIsPrivate] = useState(current);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const toggle = async () => {
    setErr(""); setOk("");
    const newVal = !isPrivate;
    try {
      const r = await fetch("/api/settings/privacy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_private: newVal }) });
      const d = await r.json() as any;
      if (!r.ok) { setErr(d.error || "Failed"); return; }
      setIsPrivate(newVal);
      setOk(newVal ? "Your profile is now private on the leaderboard." : "Your profile is now public on the leaderboard.");
    } catch { setErr("Network error"); }
  };

  return (
    <div style={{ ...S.card, marginBottom: "1rem" }}>
      <h3 style={{ color: "#e6edf3", marginBottom: "0.75rem" }}>🔒 Leaderboard Privacy</h3>
      {err && <div style={S.err}>{err}</div>}
      {ok && <div style={S.ok}>{ok}</div>}
      <p style={{ color: "#8b949e", fontSize: "0.875rem", marginBottom: "1rem" }}>
        When private, your name shows as "Anonymous" and your portfolio value is hidden on the leaderboard.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <span style={{ color: isPrivate ? "#d29922" : "#3fb950", fontWeight: 600 }}>
          {isPrivate ? "🔒 Private" : "🌐 Public"}
        </span>
        <button style={S.btn(isPrivate ? "primary" : "ghost")} onClick={toggle}>
          {isPrivate ? "Make Public" : "Make Private"}
        </button>
      </div>
    </div>
  );
}

function TOTPSection({ totpEnabled, onChanged }: { totpEnabled: boolean; onChanged: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);
  const qrRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (setup?.otpauth_uri && qrRef.current) {
      QRCode.toCanvas(qrRef.current, setup.otpauth_uri, { width: 200, margin: 2, color: { dark: "#000", light: "#fff" } });
    }
  }, [setup]);

  const startSetup = async () => {
    setErr(""); setOk("");
    setLoading(true);
    try {
      const r = await fetch("/api/settings/totp/setup");
      const d = await r.json() as any;
      if (!r.ok) { setErr(d.error || "Failed"); return; }
      setSetup(d);
    } catch { setErr("Network error"); }
    finally { setLoading(false); }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setOk("");
    setLoading(true);
    try {
      const r = await fetch("/api/settings/totp/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const d = await r.json() as any;
      if (!r.ok) { setErr(d.error || "Invalid code"); return; }
      setOk("2FA enabled successfully!");
      setSetup(null); setCode("");
      onChanged();
    } catch { setErr("Network error"); }
    finally { setLoading(false); }
  };

  const disable = async () => {
    if (!confirm("Disable 2FA?")) return;
    setLoading(true);
    try {
      const r = await fetch("/api/settings/totp/disable", { method: "POST" });
      const d = await r.json() as any;
      if (!r.ok) { setErr(d.error || "Failed"); return; }
      setOk("2FA disabled.");
      onChanged();
    } catch { setErr("Network error"); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ ...S.card, marginBottom: "1rem" }}>
      <h3 style={{ color: "#e6edf3", marginBottom: "0.75rem" }}>🔐 Two-Factor Authentication</h3>
      {err && <div style={S.err}>{err}</div>}
      {ok && <div style={S.ok}>{ok}</div>}

      {totpEnabled && !setup ? (
        <div>
          <p style={{ color: "#3fb950", marginBottom: "1rem" }}>✅ 2FA is enabled on your account.</p>
          <button style={S.btn("danger")} onClick={disable} disabled={loading}>Disable 2FA</button>
        </div>
      ) : setup ? (
        <div>
          <p style={{ color: "#8b949e", fontSize: "0.875rem", marginBottom: "0.75rem" }}>
            Scan with Google Authenticator, Authy, or any TOTP app:
          </p>
          <div style={{ background: "#fff", display: "inline-block", padding: 8, borderRadius: 8, marginBottom: "1rem" }}>
            <canvas ref={qrRef} />
          </div>
          <p style={{ color: "#8b949e", fontSize: "0.875rem", marginBottom: "0.75rem" }}>
            Or enter manually: <code style={{ color: "#d29922" }}>{setup.secret}</code>
          </p>
          <form onSubmit={verify} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Enter 6-digit code to confirm</label>
              <input
                style={{ ...S.input, letterSpacing: "0.3em" }}
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
            </div>
            <button type="submit" style={S.btn("primary")} disabled={loading || code.length !== 6}>
              {loading ? "Verifying…" : "Verify & Enable"}
            </button>
          </form>
        </div>
      ) : (
        <div>
          <p style={{ color: "#8b949e", fontSize: "0.875rem", marginBottom: "1rem" }}>
            Add two-factor authentication for extra security.
          </p>
          <button style={S.btn("primary")} onClick={startSetup} disabled={loading}>
            {loading ? "Loading…" : "Set up 2FA"}
          </button>
        </div>
      )}
    </div>
  );
}
