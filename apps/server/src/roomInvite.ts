/**
 * Room code + join link helpers (LAN invite).
 * Spec: 4-digit code; http://<lan-ipv4>:<port>/join?code=####
 */

export function isValidRoomCode(code: string): boolean {
  return /^\d{4}$/.test(code);
}

export function allocateRoomCode(
  taken: ReadonlySet<string>,
  random: () => number = Math.random,
): string {
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const n = Math.floor(random() * 10_000);
    const code = String(n).padStart(4, "0");
    if (!taken.has(code)) return code;
  }
  throw new Error("room_code_exhausted");
}

export function buildJoinUrl(input: {
  host: string;
  port: number;
  code: string;
}): string {
  return `http://${input.host}:${input.port}/join?code=${input.code}`;
}

export function parseJoinSearch(search: string): {
  code: string | null;
  ok: boolean;
  reason?: string;
} {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const code = params.get("code");
  if (!code || !isValidRoomCode(code)) {
    return { code: null, ok: false, reason: "invalid_room_code" };
  }
  return { code, ok: true };
}
