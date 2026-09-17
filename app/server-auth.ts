import { env } from "cloudflare:workers";

export type AppRole = "Admin" | "Manager" | "Coordonator" | "Tehnician";

export type AuthenticatedAccount = {
  username: string;
  name: string;
  role: AppRole;
  active: boolean;
  jobs: number;
  passwordResetRequired: boolean;
};

type AuthEnvironment = {
  DB: D1Database;
  PROCONECT_ADMIN_PASSWORD?: string;
  PROCONECT_TECHNICIAN_PASSWORD?: string;
};

type StoredUser = {
  id: string;
  username: string;
  name: string;
  role: AppRole;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  password_reset_required: number;
  active: number;
  jobs: number;
  failed_attempts: number;
  locked_until: number | null;
};

const authEnvironment = env as unknown as AuthEnvironment;
const SESSION_COOKIE_NAME = "proconect_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 12;
// Cloudflare Workers currently rejects PBKDF2 requests above 100,000 iterations.
const PASSWORD_ITERATIONS = 100_000;
const MAX_FAILED_ATTEMPTS = 5;
const ACCOUNT_LOCK_MS = 10 * 60 * 1000;
const encoder = new TextEncoder();

function database() {
  if (!authEnvironment.DB) throw new Error("Baza de date pentru autentificare nu este disponibilă.");
  return authEnvironment.DB;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function randomHex(length: number) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(length)));
}

async function hashPassword(password: string, salt: string, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const digest = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(salt), iterations },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(digest));
}

async function hashSessionToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return bytesToHex(new Uint8Array(digest));
}

function equalConstantTime(first: string, second: string) {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

function toPublicAccount(user: StoredUser): AuthenticatedAccount {
  return {
    username: user.username,
    name: user.name,
    role: user.role,
    active: Boolean(user.active),
    jobs: user.jobs,
    passwordResetRequired: Boolean(user.password_reset_required),
  };
}

async function makeUserRow(input: {
  username: string;
  name: string;
  role: AppRole;
  password: string;
  jobs?: number;
  passwordResetRequired?: boolean;
}) {
  const salt = randomHex(16);
  const passwordHash = await hashPassword(input.password, salt);
  const now = Date.now();

  return {
    id: crypto.randomUUID(),
    username: input.username.trim().toLowerCase(),
    name: input.name.trim(),
    role: input.role,
    passwordHash,
    passwordSalt: salt,
    passwordIterations: PASSWORD_ITERATIONS,
    passwordResetRequired: input.passwordResetRequired ? 1 : 0,
    jobs: input.jobs ?? 0,
    createdAt: now,
    updatedAt: now,
  };
}

function insertUserStatement(user: Awaited<ReturnType<typeof makeUserRow>>) {
  return database()
    .prepare(
      "INSERT INTO app_users (id, username, name, role, password_hash, password_salt, password_iterations, password_reset_required, active, jobs, failed_attempts, locked_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, NULL, ?, ?)",
    )
    .bind(
      user.id,
      user.username,
      user.name,
      user.role,
      user.passwordHash,
      user.passwordSalt,
      user.passwordIterations,
      user.passwordResetRequired,
      user.jobs,
      user.createdAt,
      user.updatedAt,
    );
}

export async function ensureInitialAccounts() {
  const existing = await database()
    .prepare("SELECT username FROM app_users WHERE username IN (?, ?)")
    .bind("vladimir.carlan", "vlad")
    .all<{ username: string }>();
  const present = new Set((existing.results ?? []).map((user: { username: string }) => user.username));
  const missing: Awaited<ReturnType<typeof makeUserRow>>[] = [];

  if (!present.has("vladimir.carlan")) {
    if (!authEnvironment.PROCONECT_ADMIN_PASSWORD) throw new Error("Parola inițială a administratorului nu este configurată.");
    missing.push(
      await makeUserRow({
        username: "vladimir.carlan",
        name: "Vladimir",
        role: "Admin",
        password: authEnvironment.PROCONECT_ADMIN_PASSWORD,
      }),
    );
  }

  if (!present.has("vlad")) {
    if (!authEnvironment.PROCONECT_TECHNICIAN_PASSWORD) throw new Error("Parola inițială a tehnicianului nu este configurată.");
    missing.push(
      await makeUserRow({
        username: "vlad",
        name: "Vlad",
        role: "Tehnician",
        password: authEnvironment.PROCONECT_TECHNICIAN_PASSWORD,
        jobs: 4,
        passwordResetRequired: authEnvironment.PROCONECT_TECHNICIAN_PASSWORD.length < 8,
      }),
    );
  }

  if (missing.length) await database().batch(missing.map(insertUserStatement));
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function sessionTokenFromRequest(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const entry = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  return entry?.slice(SESSION_COOKIE_NAME.length + 1) || null;
}

export async function currentSession(request: Request) {
  const token = sessionTokenFromRequest(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;

  const tokenHash = await hashSessionToken(token);
  const row = await database()
    .prepare(
      "SELECT app_users.*, app_sessions.id AS session_id FROM app_sessions INNER JOIN app_users ON app_users.id = app_sessions.user_id WHERE app_sessions.token_hash = ? AND app_sessions.expires_at > ? AND app_users.active = 1 LIMIT 1",
    )
    .bind(tokenHash, Date.now())
    .first<StoredUser & { session_id: string }>();

  if (!row) return null;
  return { account: toPublicAccount(row), sessionId: row.session_id, userId: row.id };
}

function cookieHeader(value: string, maxAge: number) {
  return `${SESSION_COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function expiredSessionCookie() {
  return cookieHeader("", 0);
}

export async function signIn(username: string, password: string) {
  const normalizedUsername = username.trim().toLowerCase();
  const user = await database()
    .prepare("SELECT * FROM app_users WHERE username = ? AND active = 1 LIMIT 1")
    .bind(normalizedUsername)
    .first<StoredUser>();

  if (!user) return { error: "Username sau parolă incorectă.", status: 401 as const };
  if (user.locked_until && user.locked_until > Date.now()) {
    return { error: "Cont blocat temporar. Încearcă din nou peste câteva minute.", status: 429 as const };
  }

  const candidateHash = await hashPassword(password, user.password_salt, user.password_iterations);
  if (!equalConstantTime(candidateHash, user.password_hash)) {
    const failedAttempts = user.failed_attempts + 1;
    const lockedUntil = failedAttempts >= MAX_FAILED_ATTEMPTS ? Date.now() + ACCOUNT_LOCK_MS : null;
    await database()
      .prepare("UPDATE app_users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?")
      .bind(lockedUntil ? 0 : failedAttempts, lockedUntil, Date.now(), user.id)
      .run();
    return { error: "Username sau parolă incorectă.", status: 401 as const };
  }

  const token = randomHex(32);
  const tokenHash = await hashSessionToken(token);
  const now = Date.now();
  await database().batch([
    database().prepare("UPDATE app_users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?").bind(now, user.id),
    database()
      .prepare("INSERT INTO app_sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), user.id, tokenHash, now, now + SESSION_DURATION_SECONDS * 1000),
    database().prepare("DELETE FROM app_sessions WHERE expires_at <= ?").bind(now),
  ]);

  return {
    account: toPublicAccount(user),
    cookie: cookieHeader(token, SESSION_DURATION_SECONDS),
  };
}

export async function signOut(request: Request) {
  const session = await currentSession(request);
  if (session) await database().prepare("DELETE FROM app_sessions WHERE id = ?").bind(session.sessionId).run();
}

export async function updatePassword(request: Request, password: string) {
  const session = await currentSession(request);
  if (!session) return { error: "Sesiunea a expirat. Autentifică-te din nou.", status: 401 as const };
  if (password.length < 8) return { error: "Parola nouă trebuie să conțină minimum 8 caractere.", status: 400 as const };

  const salt = randomHex(16);
  const passwordHash = await hashPassword(password, salt);
  await database().batch([
    database()
      .prepare("UPDATE app_users SET password_hash = ?, password_salt = ?, password_iterations = ?, password_reset_required = 0, updated_at = ? WHERE id = ?")
      .bind(passwordHash, salt, PASSWORD_ITERATIONS, Date.now(), session.userId),
    database().prepare("DELETE FROM app_sessions WHERE user_id = ? AND id != ?").bind(session.userId, session.sessionId),
  ]);

  return { account: { ...session.account, passwordResetRequired: false } };
}

export async function listAccounts() {
  const result = await database()
    .prepare("SELECT username, name, role, active, jobs, password_reset_required FROM app_users ORDER BY CASE WHEN role = 'Admin' THEN 0 ELSE 1 END, name")
    .all<Pick<StoredUser, "username" | "name" | "role" | "active" | "jobs" | "password_reset_required">>();

  return (result.results ?? []).map((user: Pick<StoredUser, "username" | "name" | "role" | "active" | "jobs" | "password_reset_required">) => ({
    username: user.username,
    name: user.name,
    role: user.role,
    active: Boolean(user.active),
    jobs: user.jobs,
    passwordResetRequired: Boolean(user.password_reset_required),
  }));
}

export async function addAccount(input: { username: string; name: string; role: AppRole; password: string }) {
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(username)) {
    return { error: "Username-ul trebuie să conțină între 2 și 64 de litere, cifre, punct, liniuță sau underscore.", status: 400 as const };
  }
  if (input.name.trim().length < 2) return { error: "Numele utilizatorului este obligatoriu.", status: 400 as const };
  if (input.password.length < 8) return { error: "Parola temporară trebuie să aibă minimum 8 caractere.", status: 400 as const };
  if (!["Admin", "Manager", "Coordonator", "Tehnician"].includes(input.role)) {
    return { error: "Rolul selectat nu este valid.", status: 400 as const };
  }

  const existing = await database().prepare("SELECT id FROM app_users WHERE username = ? LIMIT 1").bind(username).first();
  if (existing) return { error: "Username-ul este deja folosit.", status: 409 as const };

  const user = await makeUserRow({ ...input, username, passwordResetRequired: true });
  await insertUserStatement(user).run();
  return {
    account: {
      username: user.username,
      name: user.name,
      role: user.role,
      active: true,
      jobs: user.jobs,
      passwordResetRequired: true,
    },
  };
}
