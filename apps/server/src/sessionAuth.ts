import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "coup_session";
export const SEAT_COOKIE = "coup_seat";
export const CSRF_HEADER = "x-csrf-token";

/**
 * 座位凭证 Cookie 的持久期（30 天）。它是对局/回席的唯一凭证，
 * 会话级 Cookie 在浏览器重启后丢失，客人将被锁在自己已占的座位外
 * （座位仍标记 remote_human，只能等房主手动重开）。持久化 + HttpOnly +
 * SameSite=Strict + 服务端只存哈希 + 回席轮换，是重连凭证的标准形态。
 */
export const SEAT_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60;

export type SessionRecord = {
  id: string;
  csrfToken: string;
};

export type SessionStore = {
  create(): SessionRecord;
  get(id: string): SessionRecord | null;
};

/** 公网部署防内存泄漏：会话总数上限（匿名会话无需注销，超限按创建序驱逐）。 */
export const MAX_SESSIONS = 10_000;

export function createSessionStore(cap: number = MAX_SESSIONS): SessionStore {
  const sessions = new Map<string, SessionRecord & { createdAt: number }>();
  return {
    create() {
      while (sessions.size >= cap) {
        const oldest = sessions.keys().next().value;
        if (oldest === undefined) break;
        sessions.delete(oldest);
      }
      const record: SessionRecord & { createdAt: number } = {
        id: randomBytes(24).toString("base64url"),
        csrfToken: randomBytes(24).toString("base64url"),
        createdAt: Date.now(),
      };
      sessions.set(record.id, record);
      return { id: record.id, csrfToken: record.csrfToken };
    },
    get(id) {
      return sessions.get(id) ?? null;
    },
  };
}

export function allowedOrigins(input: {
  port: number;
  lanHosts: string[];
}): string[] {
  const { port, lanHosts } = input;
  if (port <= 0) return [];
  const origins = [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    ...lanHosts.map((host) => `http://${host}:${port}`),
  ];
  return [...new Set(origins)];
}

export function parseCookies(
  header: string | undefined,
): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[name] = value;
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  options?: { path?: string; maxAgeSec?: number },
): string {
  const path = options?.path ?? "/";
  const maxAge =
    options?.maxAgeSec !== undefined ? `; Max-Age=${options.maxAgeSec}` : "";
  return `${name}=${value}; Path=${path}${maxAge}; HttpOnly; SameSite=Strict`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueSeatToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}
