import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "coup_session";
export const SEAT_COOKIE = "coup_seat";
export const CSRF_HEADER = "x-csrf-token";

export type SessionRecord = {
  id: string;
  csrfToken: string;
};

export type SessionStore = {
  create(): SessionRecord;
  get(id: string): SessionRecord | null;
};

export function createSessionStore(): SessionStore {
  const sessions = new Map<string, SessionRecord>();
  return {
    create() {
      const record: SessionRecord = {
        id: randomBytes(24).toString("base64url"),
        csrfToken: randomBytes(24).toString("base64url"),
      };
      sessions.set(record.id, record);
      return record;
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
  options?: { path?: string },
): string {
  const path = options?.path ?? "/";
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Strict`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueSeatToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}
