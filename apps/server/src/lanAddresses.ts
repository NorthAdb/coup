/**
 * Enumerate LAN IPv4 candidates for join links.
 * Spec: non-loopback Preferred IPv4; heuristic default RFC1918 order;
 * exclude common virtual adapter names when other candidates exist.
 */

export type NetAddress = {
  address: string;
  family: string | number;
  internal: boolean;
};

export type NetIfaceMap = Record<string, NetAddress[] | undefined>;

export type LanCandidate = {
  address: string;
  iface: string;
};

const VIRTUAL_IFACE =
  /^(vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|br-|virbr)/i;

function isIpv4(family: string | number): boolean {
  return family === "IPv4" || family === 4;
}

function isPrivateRfc1918(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  return false;
}

function rfc1918Rank(address: string): number {
  const parts = address.split(".").map(Number);
  const [a, b] = parts;
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 1;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return 2;
  return 3;
}

export function listLanIpv4Candidates(ifaces: NetIfaceMap): LanCandidate[] {
  const raw: LanCandidate[] = [];
  for (const [iface, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (!isIpv4(addr.family) || addr.internal) continue;
      if (addr.address.startsWith("169.254.")) continue;
      raw.push({ address: addr.address, iface });
    }
  }

  const nonVirtual = raw.filter((c) => !VIRTUAL_IFACE.test(c.iface));
  return nonVirtual.length > 0 ? nonVirtual : raw;
}

export function pickDefaultLanIpv4(
  candidates: readonly LanCandidate[],
): string | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort(
    (a, b) => rfc1918Rank(a.address) - rfc1918Rank(b.address),
  );
  const best = sorted[0];
  return best && isPrivateRfc1918(best.address) ? best.address : best?.address ?? null;
}
