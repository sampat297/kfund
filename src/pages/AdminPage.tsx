import { useState, useEffect, useCallback } from "react";
import { S } from "../App";

function fmt(n: number, d = 2) {
  return n != null ? n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
}
function fmtUSD(n: number | null) { return n != null ? "$" + fmt(n) : "—"; }

export default function AdminPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"users" | "add" | "deposit" | "balance">("users");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/users");
      if (r.status === 401) { window.location.hash = "#/"; return; }
      if (r.status === 403) { window.location.hash = "#/dashboard"; return; }
      setData(await r.json());
    } catch { setError("Failed to load"); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const tabs = [
    { key: "users", label: "👥 Roster" },
    { key: "add", label: "➕ Add Investor" },
    { key: "deposit", label: "💰 Deposit/Withdraw" },
    { key: "balance", label: "📊 Update Balance" },
  ] as const;

  return (
    <div>
      <h2 style={{ color: "#e6edf3", fontSize: "1.4rem", fontWeight: 700, marginBottom: "1.5rem" }}>Admin</h2>
      {error && <div style={S.err}>{error}</div>}

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {tabs.map(t => (
          <button
            key={t.key}
            style={{
              ...S.btn(tab === t.key ? "primary" : "ghost"),
              padding: "0.4rem 1rem",
            }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "users" && <UserRoster data={data} onRefresh={load} />}
      {tab === "add" && <AddInvestor onAdded={load} />}
      {tab === "deposit" && <RecordDeposit users={data?.users || []} onDone={load} />}
      {tab === "balance" && <UpdateBalance onDone={load} />}
    </div>
  );
}

function UserRoster({ data, onRefresh }: { data: any; onRefresh: () => void }) {
  if (!data) return <div style={{ color: "#8b949e" }}>Loading…</div>;
  const { users, nav, fund_balance } = data;

  return (
    <div>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        <div style={{ ...S.card, flex: 1, minWidth: 140 }}>
          <div style={{ color: "#8b949e", fontSize: "0.8rem" }}>Fund Balance</div>
          <div style={{ color: "#58a6ff", fontSize: "1.3rem", fontWeight: 700 }}>{fmtUSD(fund_balance)}</div>
        </div>
        <div style={{ ...S.card, flex: 1, minWidth: 140 }}>
          <div style={{ color: "#8b949e", fontSize: "0.8rem" }}>Current NAV</div>
          <div style={{ color: "#e6edf3", fontSize: "1.3rem", fontWeight: 700 }}>{fmtUSD(nav)}</div>
        </div>
        <div style={{ ...S.card, flex: 1, minWidth: 140 }}>
          <div style={{ color: "#8b949e", fontSize: "0.8rem" }}>Investors</div>
          <div style={{ color: "#e6edf3", fontSize: "1.3rem", fontWeight: 700 }}>{users.length}</div>
        </div>
      </div>

      <div style={{ ...S.card, overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
          <button style={S.btn("ghost")} onClick={onRefresh}>↻ Refresh</button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
          <thead>
            <tr style={{ color: "#8b949e", fontSize: "0.78rem", textTransform: "uppercase", borderBottom: "1px solid #30363d" }}>
              {["ID", "Username", "Display Name", "Units", "Contributed", "Value", "Admin", "2FA", "Temp PW"].map(h => (
                <th key={h} style={{ padding: "0.5rem 0.75rem", textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u: any) => (
              <tr key={u.id} style={{ borderBottom: "1px solid #21262d" }}>
                <td style={{ padding: "0.6rem 0.75rem", color: "#8b949e", fontSize: "0.85rem" }}>{u.id}</td>
                <td style={{ padding: "0.6rem 0.75rem", color: "#58a6ff", fontFamily: "monospace", fontSize: "0.85rem" }}>{u.username}</td>
                <td style={{ padding: "0.6rem 0.75rem", color: "#e6edf3" }}>{u.display_name}</td>
                <td style={{ padding: "0.6rem 0.75rem", color: "#e6edf3" }}>{u.units != null ? fmt(u.units, 4) : "—"}</td>
                <td style={{ padding: "0.6rem 0.75rem", color: "#e6edf3" }}>{fmtUSD(u.contributed)}</td>
                <td style={{ padding: "0.6rem 0.75rem", color: "#58a6ff" }}>{fmtUSD(u.current_value)}</td>
                <td style={{ padding: "0.6rem 0.75rem" }}>
                  {u.is_admin ? <span style={S.badge("#d29922")}>Admin</span> : "—"}
                </td>
                <td style={{ padding: "0.6rem 0.75rem" }}>
                  {u.totp_enabled ? <span style={S.badge("#238636")}>On</span> : <span style={{ color: "#8b949e" }}>Off</span>}
                </td>
                <td style={{ padding: "0.6rem 0.75rem" }}>
                  {u.must_change_password ? <span style={S.badge("#d29922")}>Yes</span> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddInvestor({ onAdded }: { onAdded: () => void }) {
  const [form, setForm] = useState({ display_name: "", username: "", contributed: "" });
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ temp_password: string; user_id: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setResult(null);
    setLoading(true);
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, contributed: parseFloat(form.contributed) }),
      });
      const d = await r.json() as any;
      if (!r.ok) { setErr(d.error || "Failed"); return; }
      setResult({ temp_password: d.temp_password, user_id: d.user_id });
      setForm({ display_name: "", username: "", contributed: "" });
      onAdded();
    } catch { setErr("Network error"); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ ...S.card, maxWidth: 500 }}>
      <h3 style={{ color: "#e6edf3", marginBottom: "1rem" }}>Add New Investor</h3>
      {err && <div style={S.err}>{err}</div>}
      {result && (
        <div style={{ background: "#1a2f1a", border: "1px solid #238636", borderRadius: 6, padding: "1rem", marginBottom: "1rem" }}>
          <div style={{ color: "#3fb950", fontWeight: 600, marginBottom: "0.5rem" }}>✅ Investor created! (User ID: {result.user_id})</div>
          <div style={{ color: "#8b949e", fontSize: "0.85rem" }}>Temporary password (show once):</div>
          <code style={{ color: "#d29922", fontSize: "1.1rem", fontFamily: "monospace" }}>{result.temp_password}</code>
        </div>
      )}
      <form onSubmit={submit}>
        <div style={S.fieldset}>
          <label style={S.label}>Display Name</label>
          <input style={S.input} type="text" value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} required />
        </div>
        <div style={S.fieldset}>
          <label style={S.label}>Username (login)</label>
          <input style={S.input} type="text" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} required />
        </div>
        <div style={S.fieldset}>
          <label style={S.label}>Contributed Amount ($)</label>
          <input style={S.input} type="number" step="0.01" value={form.contributed} onChange={e => setForm({ ...form, contributed: e.target.value })} required />
        </div>
        <button type="submit" style={S.btn("primary")} disabled={loading}>
          {loading ? "Creating…" : "Create Investor"}
        </button>
      </form>
    </div>
  );
}

function RecordDeposit({ users, onDone }: { users: any[]; onDone: () => void }) {
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setOk("");
    setLoading(true);
    try {
      const r = await fetch("/api/admin/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: parseInt(userId), amount: parseFloat(amount), note: note || undefined }),
      });
      const d = await r.json() as any;
      if (!r.ok) { setErr(d.error || "Failed"); return; }
      setOk(`Done! Units delta: ${d.units_delta.toFixed(4)} @ NAV ${fmtUSD(d.nav_used)}`);
      setAmount(""); setNote("");
      onDone();
    } catch { setErr("Network error"); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ ...S.card, maxWidth: 500 }}>
      <h3 style={{ color: "#e6edf3", marginBottom: "1rem" }}>Record Deposit / Withdrawal</h3>
      {err && <div style={S.err}>{err}</div>}
      {ok && <div style={S.ok}>{ok}</div>}
      <form onSubmit={submit}>
        <div style={S.fieldset}>
          <label style={S.label}>Investor</label>
          <select style={S.input} value={userId} onChange={e => setUserId(e.target.value)} required>
            <option value="">Select investor…</option>
            {users.filter((u: any) => u.units != null).map((u: any) => (
              <option key={u.id} value={u.id}>{u.display_name} ({u.username})</option>
            ))}
          </select>
        </div>
        <div style={S.fieldset}>
          <label style={S.label}>Amount (negative = withdrawal)</label>
          <input style={S.input} type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required placeholder="e.g. 1000 or -500" />
        </div>
        <div style={S.fieldset}>
          <label style={S.label}>Note (optional)</label>
          <input style={S.input} type="text" value={note} onChange={e => setNote(e.target.value)} />
        </div>
        <button type="submit" style={S.btn("primary")} disabled={loading || !userId}>
          {loading ? "Processing…" : "Record Transaction"}
        </button>
      </form>
    </div>
  );
}

function UpdateBalance({ onDone }: { onDone: () => void }) {
  const [balance, setBalance] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setOk("");
    setLoading(true);
    try {
      const r = await fetch("/api/admin/fund-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balance: parseFloat(balance) }),
      });
      const d = await r.json() as any;
      if (!r.ok) { setErr(d.error || "Failed"); return; }
      setOk("Fund balance updated!");
      setBalance("");
      onDone();
    } catch { setErr("Network error"); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ ...S.card, maxWidth: 400 }}>
      <h3 style={{ color: "#e6edf3", marginBottom: "0.75rem" }}>Sync Fund Balance</h3>
      <p style={{ color: "#8b949e", fontSize: "0.875rem", marginBottom: "1rem" }}>
        Directly update the fund's cash balance (e.g. after syncing from trading bot).
      </p>
      {err && <div style={S.err}>{err}</div>}
      {ok && <div style={S.ok}>{ok}</div>}
      <form onSubmit={submit}>
        <div style={S.fieldset}>
          <label style={S.label}>New Balance ($)</label>
          <input style={S.input} type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)} required />
        </div>
        <button type="submit" style={S.btn("warning")} disabled={loading}>
          {loading ? "Updating…" : "Update Balance"}
        </button>
      </form>
    </div>
  );
}
