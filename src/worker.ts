import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

// ─── Types ───────────────────────────────────────────────────────────────────

type Env = {
  ASSETS: Fetcher;
  DB: D1Database;
  SESSIONS: KVNamespace;
  RATE_LIMIT: KVNamespace;
};

type SessionData = {
  user_id: number;
  username: string;
  is_admin: number;
  display_name: string;
};

type TradeEvent = {
  id: number;
  event_type: string;
  title: string;
  payload: string;
  fund_balance: number | null;
  created_at: string;
};

// ─── Crypto helpers ──────────────────────────────────────────────────────────

async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function genSalt(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function genPassword(len = 12): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
}

// ─── TOTP ────────────────────────────────────────────────────────────────────

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(str: string): Uint8Array {
  const s = str.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of s) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

async function generateTOTPSecret(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return base32Encode(bytes);
}

async function verifyTOTP(secret: string, code: string): Promise<boolean> {
  const key = base32Decode(secret);
  const time = Math.floor(Date.now() / 1000 / 30);
  for (const step of [-1, 0, 1]) {
    const counter = time + step;
    const buf = new ArrayBuffer(8);
    new DataView(buf).setBigInt64(0, BigInt(counter), false);
    const cryptoKey = await crypto.subtle.importKey(
      "raw", key.buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, buf);
    const arr = new Uint8Array(sig);
    const offset = arr[19] & 0xf;
    const otp =
      (((arr[offset] & 0x7f) << 24) |
        (arr[offset + 1] << 16) |
        (arr[offset + 2] << 8) |
        arr[offset + 3]) %
      1000000;
    if (otp.toString().padStart(6, "0") === code) return true;
  }
  return false;
}

// ─── Session helpers ─────────────────────────────────────────────────────────

const SESSION_COOKIE = "kf_session";
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

async function getSession(c: any): Promise<SessionData | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const raw = await c.env.SESSIONS.get(`session:${token}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function createSession(env: Env, data: SessionData): Promise<string> {
  const token = crypto.randomUUID();
  await env.SESSIONS.put(`session:${token}`, JSON.stringify(data), { expirationTtl: SESSION_TTL });
  return token;
}

function setSessionCookie(c: any, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_TTL,
    secure: true,
  });
}

// ─── NAV helper ──────────────────────────────────────────────────────────────

function calcNAV(balance: number, totalUnits: number): number {
  if (totalUnits <= 0) return 1.0;
  return balance / totalUnits;
}

// ─── App ─────────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

// ─── Rate limiting ───────────────────────────────────────────────────────────

async function checkRateLimit(kv: KVNamespace, ip: string): Promise<boolean> {
  const key = `rl:${ip}`;
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw) : 0;
  if (count >= 10) return false;
  await kv.put(key, String(count + 1), { expirationTtl: 900 }); // 15 min window
  return true;
}

// ─── Auth routes ─────────────────────────────────────────────────────────────

app.post("/api/auth/login", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  const allowed = await checkRateLimit(c.env.RATE_LIMIT, ip);
  if (!allowed) return c.json({ error: "Too many login attempts. Try again in 15 minutes." }, 429);

  const body = await c.req.json().catch(() => ({})) as any;
  const { username, password, totp_code } = body;

  if (!username || !password) return c.json({ error: "Username and password required" }, 400);

  const user = await c.env.DB
    .prepare("SELECT * FROM kf_users WHERE username = ?")
    .bind(username)
    .first() as any;

  if (!user) return c.json({ error: "Invalid username or password" }, 401);

  const hash = await hashPassword(password, user.password_salt);
  if (hash !== user.password_hash) return c.json({ error: "Invalid username or password" }, 401);

  if (user.totp_enabled) {
    if (!totp_code) return c.json({ ok: false, totp_required: true }, 200);
    const valid = await verifyTOTP(user.totp_secret, totp_code);
    if (!valid) return c.json({ error: "Invalid 2FA code" }, 401);
  }

  const sessionData: SessionData = {
    user_id: user.id,
    username: user.username,
    is_admin: user.is_admin,
    display_name: user.display_name,
  };
  const token = await createSession(c.env, sessionData);
  setSessionCookie(c, token);

  return c.json({
    ok: true,
    must_change_password: user.must_change_password === 1,
    is_admin: user.is_admin === 1,
    display_name: user.display_name,
  });
});

app.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.SESSIONS.delete(`session:${token}`);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/auth/me", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ ok: true, ...session });
});

// ─── Auth middleware ──────────────────────────────────────────────────────────

app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  if (
    path === "/api/auth/login" ||
    path === "/api/auth/logout" ||
    path === "/api/auth/me" ||
    path === "/api/events/push"
  ) return next();
  const session = await getSession(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  (c as any).set("session", session);
  return next();
});

// ─── Dashboard ───────────────────────────────────────────────────────────────

app.get("/api/dashboard", async (c) => {
  const session = (c.get as any)("session") as SessionData;
  const db = c.env.DB;

  const [fundRow, posRow, userRow, memberCount] = await Promise.all([
    db.prepare("SELECT * FROM kf_fund_state WHERE id = 1").first() as Promise<any>,
    db.prepare("SELECT * FROM kf_investor_positions WHERE user_id = ?").bind(session.user_id).first() as Promise<any>,
    db.prepare("SELECT display_name FROM kf_users WHERE id = ?").bind(session.user_id).first() as Promise<any>,
    db.prepare("SELECT COUNT(*) as cnt FROM kf_investor_positions").first() as Promise<any>,
  ]);

  const balance = fundRow?.balance ?? 0;
  const totalUnits = fundRow?.total_units ?? 0;
  const nav = calcNAV(balance, totalUnits);

  const units = posRow?.units ?? 0;
  const contributed = posRow?.contributed ?? 0;
  const navAtJoin = posRow?.nav_at_join ?? 1.0;
  const value = units * nav;
  const pnlDollars = value - contributed;
  const pnlPct = contributed > 0 ? (pnlDollars / contributed) * 100 : 0;
  const ownershipPct = totalUnits > 0 ? (units / totalUnits) * 100 : 0;

  return c.json({
    user: {
      display_name: userRow?.display_name ?? session.display_name,
      units,
      contributed,
      nav_at_join: navAtJoin,
    },
    fund: {
      balance,
      total_units: totalUnits,
      nav,
      member_count: memberCount?.cnt ?? 0,
    },
    portfolio: {
      value,
      pnl_dollars: pnlDollars,
      pnl_pct: pnlPct,
      ownership_pct: ownershipPct,
    },
  });
});

// ─── Leaderboard ─────────────────────────────────────────────────────────────

app.get("/api/leaderboard", async (c) => {
  const db = c.env.DB;

  const [fundRow, rows] = await Promise.all([
    db.prepare("SELECT * FROM kf_fund_state WHERE id = 1").first() as Promise<any>,
    db.prepare(
      `SELECT u.id, u.display_name, u.is_private, p.units, p.contributed, p.nav_at_join
       FROM kf_users u JOIN kf_investor_positions p ON u.id = p.user_id
       ORDER BY p.units DESC`
    ).all(),
  ]);

  const balance = fundRow?.balance ?? 0;
  const totalUnits = fundRow?.total_units ?? 0;
  const nav = calcNAV(balance, totalUnits);

  const investors = (rows.results as any[]).map((r: any, idx: number) => {
    const value = r.units * nav;
    const pnlDollars = value - r.contributed;
    const pnlPct = r.contributed > 0 ? (pnlDollars / r.contributed) * 100 : 0;
    return {
      rank: idx + 1,
      display_name: r.is_private ? "Anonymous" : r.display_name,
      is_private: r.is_private === 1,
      value: r.is_private ? null : value,
      pnl_pct: pnlPct,
      pnl_dollars: r.is_private ? null : pnlDollars,
      contributed: r.is_private ? null : r.contributed,
      units: r.is_private ? null : r.units,
    };
  });

  // Sort by value (nulls last)
  investors.sort((a, b) => {
    if (a.value === null && b.value === null) return 0;
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return b.value - a.value;
  });
  investors.forEach((inv, i) => { inv.rank = i + 1; });

  return c.json({
    fund: { balance, total_units: totalUnits, nav },
    investors,
  });
});

// ─── Feed ────────────────────────────────────────────────────────────────────

app.get("/api/feed", async (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const offset = (page - 1) * 20;
  const db = c.env.DB;

  const [rows, countRow] = await Promise.all([
    db.prepare("SELECT * FROM kf_trade_events ORDER BY created_at DESC LIMIT 20 OFFSET ?").bind(offset).all(),
    db.prepare("SELECT COUNT(*) as cnt FROM kf_trade_events").first() as Promise<any>,
  ]);

  const events = (rows.results as any[]).map((r: any) => ({
    ...r,
    payload: (() => { try { return JSON.parse(r.payload); } catch { return r.payload; } })(),
  }));

  return c.json({
    events,
    total: countRow?.cnt ?? 0,
    page,
    pages: Math.ceil((countRow?.cnt ?? 0) / 20),
  });
});

// ─── Settings ────────────────────────────────────────────────────────────────

app.post("/api/settings/password", async (c) => {
  const session = (c.get as any)("session") as SessionData;
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({})) as any;
  const { current_password, new_password } = body;

  if (!new_password || new_password.length < 8)
    return c.json({ error: "New password must be at least 8 characters" }, 400);

  const user = await db.prepare("SELECT * FROM kf_users WHERE id = ?").bind(session.user_id).first() as any;
  if (!user) return c.json({ error: "User not found" }, 404);

  if (!user.must_change_password) {
    if (!current_password) return c.json({ error: "Current password required" }, 400);
    const hash = await hashPassword(current_password, user.password_salt);
    if (hash !== user.password_hash) return c.json({ error: "Current password incorrect" }, 401);
  }

  const salt = genSalt();
  const newHash = await hashPassword(new_password, salt);

  await db
    .prepare("UPDATE kf_users SET password_hash = ?, password_salt = ?, must_change_password = 0 WHERE id = ?")
    .bind(newHash, salt, session.user_id)
    .run();

  return c.json({ ok: true });
});

app.post("/api/settings/username", async (c) => {
  const session = (c.get as any)("session") as SessionData;
  const body = await c.req.json().catch(() => ({})) as any;
  const name = (body.new_display_name || "").trim();
  if (name.length < 2 || name.length > 32)
    return c.json({ error: "Display name must be 2–32 characters" }, 400);
  await c.env.DB
    .prepare("UPDATE kf_users SET display_name = ? WHERE id = ?")
    .bind(name, session.user_id)
    .run();
  return c.json({ ok: true });
});

app.post("/api/settings/privacy", async (c) => {
  const session = (c.get as any)("session") as SessionData;
  const body = await c.req.json().catch(() => ({})) as any;
  const isPrivate = body.is_private ? 1 : 0;
  await c.env.DB
    .prepare("UPDATE kf_users SET is_private = ? WHERE id = ?")
    .bind(isPrivate, session.user_id)
    .run();
  return c.json({ ok: true });
});

app.get("/api/settings/totp/setup", async (c) => {
  const session = (c.get as any)("session") as SessionData;
  const secret = await generateTOTPSecret();
  await c.env.DB
    .prepare("INSERT OR REPLACE INTO kf_totp_pending (user_id, secret, created_at) VALUES (?, ?, datetime('now'))")
    .bind(session.user_id, secret)
    .run();
  const otpauthUri = `otpauth://totp/KFund:${encodeURIComponent(session.username)}?secret=${secret}&issuer=KFund&algorithm=SHA1&digits=6&period=30`;
  return c.json({ secret, otpauth_uri: otpauthUri });
});

app.post("/api/settings/totp/verify", async (c) => {
  const session = (c.get as any)("session") as SessionData;
  const body = await c.req.json().catch(() => ({})) as any;
  const { code } = body;
  if (!code) return c.json({ error: "Code required" }, 400);

  const pending = await c.env.DB
    .prepare("SELECT * FROM kf_totp_pending WHERE user_id = ?")
    .bind(session.user_id)
    .first() as any;
  if (!pending) return c.json({ error: "No pending TOTP setup" }, 400);

  const valid = await verifyTOTP(pending.secret, code);
  if (!valid) return c.json({ error: "Invalid code" }, 401);

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE kf_users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?")
      .bind(pending.secret, session.user_id),
    c.env.DB.prepare("DELETE FROM kf_totp_pending WHERE user_id = ?").bind(session.user_id),
  ]);

  return c.json({ ok: true });
});

app.post("/api/settings/totp/disable", async (c) => {
  const session = (c.get as any)("session") as SessionData;
  await c.env.DB
    .prepare("UPDATE kf_users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?")
    .bind(session.user_id)
    .run();
  return c.json({ ok: true });
});

app.get("/api/settings/me", async (c) => {
  const session = (c.get as any)("session") as SessionData;
  const user = await c.env.DB
    .prepare("SELECT id, username, display_name, totp_enabled, is_private, must_change_password FROM kf_users WHERE id = ?")
    .bind(session.user_id)
    .first() as any;
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json(user);
});

// ─── Admin middleware ─────────────────────────────────────────────────────────

app.use("/api/admin/*", async (c, next) => {
  if (c.req.path === "/api/admin/init-db") return next();
  const session = (c.get as any)("session") as SessionData;
  if (!session?.is_admin) return c.json({ error: "Admin required" }, 403);
  return next();
});

// ─── Admin routes ─────────────────────────────────────────────────────────────

app.get("/api/admin/users", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.is_admin, u.totp_enabled, u.must_change_password, u.is_private,
              p.units, p.contributed, p.nav_at_join
       FROM kf_users u LEFT JOIN kf_investor_positions p ON u.id = p.user_id
       ORDER BY u.id`
    )
    .all();

  const fundRow = await c.env.DB.prepare("SELECT * FROM kf_fund_state WHERE id = 1").first() as any;
  const balance = fundRow?.balance ?? 0;
  const totalUnits = fundRow?.total_units ?? 0;
  const nav = calcNAV(balance, totalUnits);

  const users = (rows.results as any[]).map((u: any) => ({
    ...u,
    current_value: u.units != null ? u.units * nav : null,
  }));

  return c.json({ users, nav, fund_balance: balance });
});

app.post("/api/admin/users", async (c) => {
  const session = (c.get as any)("session") as SessionData;
  if (!session?.is_admin) return c.json({ error: "Admin required" }, 403);

  const body = await c.req.json().catch(() => ({})) as any;
  const { display_name, username, contributed, nav_at_join } = body;
  if (!display_name || !username || contributed == null)
    return c.json({ error: "display_name, username, contributed required" }, 400);

  const fundRow = await c.env.DB.prepare("SELECT * FROM kf_fund_state WHERE id = 1").first() as any;
  const balance = fundRow?.balance ?? 0;
  const totalUnits = fundRow?.total_units ?? 0;
  const nav = calcNAV(balance, totalUnits);
  const joinNav = nav_at_join ?? nav;
  const units = body.units != null ? body.units : contributed / joinNav;

  const tempPassword = genPassword(12);
  const salt = genSalt();
  const hash = await hashPassword(tempPassword, salt);

  const result = await c.env.DB
    .prepare(
      `INSERT INTO kf_users (username, display_name, password_hash, password_salt, must_change_password)
       VALUES (?, ?, ?, ?, 1)`
    )
    .bind(username, display_name, hash, salt)
    .run();

  const userId = result.meta?.last_row_id;

  await c.env.DB
    .prepare(
      `INSERT INTO kf_investor_positions (user_id, units, contributed, nav_at_join)
       VALUES (?, ?, ?, ?)`
    )
    .bind(userId, units, contributed, joinNav)
    .run();

  // Update fund state
  const newTotalUnits = totalUnits + units;
  const newBalance = balance + contributed;
  await c.env.DB
    .prepare(
      `INSERT INTO kf_fund_state (id, balance, total_units, updated_at)
       VALUES (1, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET balance = excluded.balance, total_units = excluded.total_units, updated_at = excluded.updated_at`
    )
    .bind(newBalance, newTotalUnits)
    .run();

  return c.json({ ok: true, temp_password: tempPassword, user_id: userId });
});

app.post("/api/admin/deposit", async (c) => {
  const session = (c.get as any)("session") as SessionData;
  if (!session?.is_admin) return c.json({ error: "Admin required" }, 403);

  const body = await c.req.json().catch(() => ({})) as any;
  const { user_id, amount, note } = body;
  if (!user_id || amount == null) return c.json({ error: "user_id and amount required" }, 400);

  const fundRow = await c.env.DB.prepare("SELECT * FROM kf_fund_state WHERE id = 1").first() as any;
  const balance = fundRow?.balance ?? 0;
  const totalUnits = fundRow?.total_units ?? 0;
  const nav = calcNAV(balance, totalUnits);

  const unitsDelta = amount / nav;

  await c.env.DB.batch([
    c.env.DB
      .prepare("UPDATE kf_investor_positions SET units = units + ?, contributed = contributed + ? WHERE user_id = ?")
      .bind(unitsDelta, amount, user_id),
    c.env.DB
      .prepare("INSERT INTO kf_deposits (user_id, amount, units_delta, nav_used, note, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
      .bind(user_id, amount, unitsDelta, nav, note ?? null),
    c.env.DB
      .prepare("UPDATE kf_fund_state SET balance = balance + ?, total_units = total_units + ?, updated_at = datetime('now') WHERE id = 1")
      .bind(amount, unitsDelta),
  ]);

  return c.json({ ok: true, units_delta: unitsDelta, nav_used: nav });
});

app.post("/api/admin/fund-balance", async (c) => {
  const session = (c.get as any)("session") as SessionData;
  if (!session?.is_admin) return c.json({ error: "Admin required" }, 403);

  const body = await c.req.json().catch(() => ({})) as any;
  if (body.balance == null) return c.json({ error: "balance required" }, 400);

  await c.env.DB
    .prepare(
      `INSERT INTO kf_fund_state (id, balance, total_units, updated_at)
       VALUES (1, ?, COALESCE((SELECT total_units FROM kf_fund_state WHERE id = 1), 0), datetime('now'))
       ON CONFLICT(id) DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at`
    )
    .bind(body.balance)
    .run();

  return c.json({ ok: true });
});

app.post("/api/admin/init-db", async (c) => {
  const session = await getSession(c);
  if (!session?.is_admin) return c.json({ error: "Admin required" }, 403);
  const initSecret = c.req.header("x-init-secret");
  if (initSecret !== "kfund-init-2026") return c.json({ error: "Invalid init secret" }, 403);

  const db = c.env.DB;
  const statements = [
    `CREATE TABLE IF NOT EXISTS kf_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      totp_secret TEXT,
      totp_enabled INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      must_change_password INTEGER DEFAULT 0,
      is_private INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS kf_investor_positions (
      user_id INTEGER PRIMARY KEY,
      units REAL NOT NULL DEFAULT 0,
      contributed REAL NOT NULL DEFAULT 0,
      nav_at_join REAL NOT NULL DEFAULT 1.0,
      FOREIGN KEY (user_id) REFERENCES kf_users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS kf_fund_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      balance REAL NOT NULL DEFAULT 0,
      total_units REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS kf_trade_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      payload TEXT NOT NULL,
      fund_balance REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS kf_totp_pending (
      user_id INTEGER PRIMARY KEY,
      secret TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES kf_users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS kf_deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      units_delta REAL NOT NULL,
      nav_used REAL NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES kf_users(id)
    )`,
  ];

  for (const sql of statements) {
    await db.prepare(sql).run();
  }

  return c.json({ ok: true, message: "DB initialized" });
});

// ─── Bot event push ───────────────────────────────────────────────────────────

app.post("/api/events/push", async (c) => {
  const token = c.req.header("x-bot-token");
  if (token !== "kfund-bot-2026") return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => ({})) as any;
  const { event_type, title, payload, fund_balance } = body;
  if (!event_type || !title || !payload)
    return c.json({ error: "event_type, title, payload required" }, 400);

  const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload);
  const db = c.env.DB;

  // Prune old signal/no_signal rows to keep table lean (keep only latest 500 each)
  if (event_type === "signal" || event_type === "no_signal" || event_type === "balance_refresh") {
    await db.prepare(
      `DELETE FROM kf_trade_events WHERE event_type = ? AND id NOT IN (SELECT id FROM kf_trade_events WHERE event_type = ? ORDER BY id DESC LIMIT 500)`
    ).bind(event_type, event_type).run().catch(() => {});
  }

  await db
    .prepare("INSERT INTO kf_trade_events (event_type, title, payload, fund_balance, created_at) VALUES (?, ?, ?, ?, datetime('now'))")
    .bind(event_type, title, payloadStr, fund_balance ?? null)
    .run();

  // Sync live balance into kf_fund_state on balance_refresh
  if (event_type === "balance_refresh" && typeof fund_balance === "number" && fund_balance > 0) {
    await db
      .prepare("UPDATE kf_fund_state SET balance = ?, updated_at = datetime('now') WHERE id = 1")
      .bind(fund_balance)
      .run();
  }

  return c.json({ ok: true });
});

// ─── Viz API ─────────────────────────────────────────────────────────────────

app.get("/api/viz/state", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const db = c.env.DB;

  const [fundRow, fillsAll, recentEvents, countRows] = await Promise.all([
    db.prepare("SELECT balance, total_units, updated_at FROM kf_fund_state WHERE id = 1").first<any>(),
    db.prepare("SELECT payload, fund_balance, created_at FROM kf_trade_events WHERE event_type IN ('order_fill','settlement') ORDER BY id ASC").all<TradeEvent>(),
    db.prepare("SELECT id, event_type, title, payload, fund_balance, created_at FROM kf_trade_events WHERE event_type NOT IN ('no_signal','signal','balance_refresh') ORDER BY id DESC LIMIT 25").all<TradeEvent>(),
    db.prepare("SELECT event_type, COUNT(*) as cnt FROM kf_trade_events GROUP BY event_type").all<{ event_type: string; cnt: number }>(),
  ]);

  // ── Balance & NAV ──
  const balance = fundRow?.balance ?? 0;
  const total_units = fundRow?.total_units ?? 0;
  const nav = total_units > 0 ? balance / total_units : 1.0;
  const balance_updated_at = fundRow?.updated_at ?? null;

  // ── Fills analysis ──
  let wins = 0, losses = 0, total_pnl = 0;
  let win_pnl = 0, loss_pnl = 0;
  let best_trade = 0, worst_trade = 0;
  let yes_wins = 0, yes_losses = 0, no_wins = 0, no_losses = 0;
  let yes_pnl = 0, no_pnl = 0;
  let total_contracts = 0;
  const equity_curve: { ts: string; balance: number; pnl: number }[] = [];
  const pnl_bars: { pnl: number; side: string; ts: string; ticker: string }[] = [];
  let running_pnl = 0;
  const today_utc = new Date().toISOString().slice(0, 10);
  let today_pnl = 0, today_wins = 0, today_losses = 0;

  for (const ev of fillsAll.results ?? []) {
    try {
      const p = typeof ev.payload === "string" ? JSON.parse(ev.payload) : ev.payload as any;
      const pnl = typeof p?.net_pnl_usd === "number" ? p.net_pnl_usd : 0;
      const side = (p?.side ?? "unknown") as string;
      const ticker = (p?.ticker ?? "") as string;
      const contracts = typeof p?.contracts === "number" ? p.contracts : 0;
      total_pnl += pnl;
      running_pnl += pnl;
      total_contracts += contracts;
      if (pnl > 0) { wins++; win_pnl += pnl; if (pnl > best_trade) best_trade = pnl; }
      else if (pnl < 0) { losses++; loss_pnl += pnl; if (pnl < worst_trade) worst_trade = pnl; }
      if (side === "yes") { yes_pnl += pnl; if (pnl > 0) yes_wins++; else if (pnl < 0) yes_losses++; }
      else if (side === "no") { no_pnl += pnl; if (pnl > 0) no_wins++; else if (pnl < 0) no_losses++; }
      if (ev.created_at?.slice(0, 10) === today_utc) {
        today_pnl += pnl;
        if (pnl > 0) today_wins++; else if (pnl < 0) today_losses++;
      }
      const bal_point = typeof ev.fund_balance === "number" && ev.fund_balance > 0
        ? ev.fund_balance : (balance - total_pnl + running_pnl);
      equity_curve.push({ ts: ev.created_at, balance: parseFloat(bal_point.toFixed(2)), pnl: parseFloat(pnl.toFixed(2)) });
      pnl_bars.push({ pnl: parseFloat(pnl.toFixed(2)), side, ts: ev.created_at, ticker });
    } catch { /* skip */ }
  }

  // ── Last signal for GRU probs ──
  const lastSignal = await db
    .prepare("SELECT payload FROM kf_trade_events WHERE event_type = 'signal' ORDER BY id DESC LIMIT 1")
    .first<{ payload: string }>();
  let gru: Record<string, number> = {};
  let last_model_prob: number | null = null;
  let last_signal_ts: string | null = null;
  let last_signal_side: string | null = null;
  if (lastSignal) {
    try {
      const p = JSON.parse(lastSignal.payload) as any;
      last_model_prob = p.model_prob ?? null;
      last_signal_side = p.side ?? null;
      last_signal_ts = p.timestamp ?? null;
      if (p.gru_p_down_30s !== undefined) {
        gru = {
          l1_down: p.gru_p_down_30s, l1_flat: p.gru_p_flat_30s, l1_up: p.gru_p_up_30s,
          l2_down: p.gru_p_down_60s, l2_flat: p.gru_p_flat_60s, l2_up: p.gru_p_up_60s,
          l3_down: p.gru_p_down_300s, l3_flat: p.gru_p_flat_300s, l3_up: p.gru_p_up_300s,
        };
      }
    } catch { /* ignore */ }
  }

  // ── Recent model probs (last 50 signals) ──
  const probRows = await db
    .prepare("SELECT fund_balance, created_at FROM kf_trade_events WHERE event_type = 'signal' ORDER BY id DESC LIMIT 50")
    .all<{ fund_balance: number; created_at: string }>();
  const recent_probs = (probRows.results ?? []).reverse().map(r => ({
    prob: r.fund_balance, ts: r.created_at
  }));

  // ── Skip reasons (last 200 no_signal) ──
  const skipRows = await db
    .prepare("SELECT payload FROM kf_trade_events WHERE event_type = 'no_signal' ORDER BY id DESC LIMIT 200")
    .all<{ payload: string }>();
  const skip_reasons: Record<string, number> = {};
  for (const row of skipRows.results ?? []) {
    try {
      const p = JSON.parse(row.payload) as any;
      const reason = p.skip_reason ?? "unknown";
      skip_reasons[reason] = (skip_reasons[reason] ?? 0) + 1;
    } catch { /* skip */ }
  }

  const event_type_counts: Record<string, number> = {};
  for (const r of countRows.results ?? []) {
    event_type_counts[r.event_type] = r.cnt;
  }

  return c.json({
    balance,
    balance_updated_at,
    total_units,
    nav,
    total_pnl: parseFloat(total_pnl.toFixed(2)),
    wins,
    losses,
    win_rate: wins + losses > 0 ? parseFloat(((wins / (wins + losses)) * 100).toFixed(1)) : null,
    total_fills: wins + losses,
    avg_win: wins > 0 ? parseFloat((win_pnl / wins).toFixed(2)) : null,
    avg_loss: losses > 0 ? parseFloat((loss_pnl / losses).toFixed(2)) : null,
    best_trade: parseFloat(best_trade.toFixed(2)),
    worst_trade: parseFloat(worst_trade.toFixed(2)),
    total_contracts,
    by_side: { yes_wins, yes_losses, no_wins, no_losses, yes_pnl: parseFloat(yes_pnl.toFixed(2)), no_pnl: parseFloat(no_pnl.toFixed(2)) },
    today_pnl: parseFloat(today_pnl.toFixed(2)),
    today_wins,
    today_losses,
    equity_curve,
    pnl_bars,
    recent_events: recentEvents.results ?? [],
    event_type_counts,
    gru,
    last_model_prob,
    last_signal_ts,
    last_signal_side,
    recent_probs,
    skip_reasons,
  });
});

app.get("/api/viz/events", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 100);
  const rows = await c.env.DB
    .prepare("SELECT id, event_type, title, payload, fund_balance, created_at FROM kf_trade_events WHERE event_type NOT IN ('no_signal','signal','balance_refresh') ORDER BY id DESC LIMIT ?")
    .bind(limit)
    .all<TradeEvent>();
  return c.json(rows.results ?? []);
});

// ─── Static assets fallback ───────────────────────────────────────────────────

app.all("/*", async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw);
  if (response.status === 404) {
    return c.env.ASSETS.fetch(
      new Request(new URL("/index.html", c.req.url).toString(), c.req.raw)
    );
  }
  return response;
});

export default app;
