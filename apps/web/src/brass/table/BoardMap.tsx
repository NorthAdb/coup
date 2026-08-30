import { useEffect, useRef } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { BrassState, IndustryType } from "@coup/brass-domain";
import { LINKS, linkEndpoints, LOCATIONS, MERCHANTS, TILE_SPECS, merchantSlotsFor, tileSpec } from "@coup/brass-domain";
import { BOARD_HEIGHT, BOARD_WIDTH, NODE_POS } from "./brassMap.js";
import { INDUSTRY_COLOR, INDUSTRY_SHORT, locationLabel, merchantBonusLabel, roman } from "../labels.js";

export type BoardMapProps = {
  state: BrassState;
  myPlayer: number | null;
  /** 可高亮集合。 */
  highlightedLocations?: Set<string>;
  highlightedLinks?: Set<number>;
  /** 已选中的目标。 */
  selectedLocation?: string | null;
  selectedLinkIndex?: number | null;
  onLocationClick?: (location: string) => void;
  onLinkClick?: (linkIndex: number) => void;
};

const PLAYER_COLORS = ["#a63d2f", "#c9971f", "#5d4a78", "#2e6e6a"];

export function playerColor(player: number): string {
  return PLAYER_COLORS[player % PLAYER_COLORS.length];
}

/** 产业瓦片外观（顶亮/底暗渐变 + 字色），对齐实体瓦片观感。 */
const INDUSTRY_TILE: Record<IndustryType, { top: string; bottom: string; ink: string }> = {
  cotton: { top: "#e8b06a", bottom: "#bd7d33", ink: "#3a2510" },
  manufacturer: { top: "#a48ac0", bottom: "#6d5290", ink: "#f3ecdc" },
  pottery: { top: "#67b4a3", bottom: "#3d7f72", ink: "#0e2924" },
  coal: { top: "#5c5750", bottom: "#2c2924", ink: "#e8dfc8" },
  iron: { top: "#d0703a", bottom: "#93421d", ink: "#3a1607" },
  brewery: { top: "#cfa96e", bottom: "#946e39", ink: "#3a2610" },
};

const FLIPPED_TILE = { top: "#a5906a", bottom: "#73603e", ink: "#2e2412" };

/** 空槽位产业字色（深底上可读的亮色版本；煤用浅灰避免看不见）。 */
const INDUSTRY_SLOT_INK: Record<IndustryType, string> = {
  cotton: "#e8b06a",
  manufacturer: "#b79ad4",
  pottery: "#6cc4b2",
  coal: "#b9b2a4",
  iron: "#e08a4e",
  brewery: "#d8b273",
};

function vpOf(industry: IndustryType, level: number): number {
  const spec = TILE_SPECS.find((s) => s.industry === industry && s.level === level);
  return spec?.vp ?? 0;
}

function linkPointsOf(industry: IndustryType, level: number): number {
  return tileSpec(industry, level).linkPoints;
}

/* ======================================================================
   产业徽标（24×24 网格，单色剪影，渲染时缩放）
   ====================================================================== */

function IndustryGlyph({ industry }: { industry: IndustryType }) {
  switch (industry) {
    case "cotton":
      return (
        <g>
          <circle cx={12} cy={6.8} r={2.8} />
          <circle cx={17.1} cy={10} r={2.8} />
          <circle cx={15.2} cy={15.9} r={2.8} />
          <circle cx={8.8} cy={15.9} r={2.8} />
          <circle cx={6.9} cy={10} r={2.8} />
          <circle cx={12} cy={12.2} r={3.1} />
        </g>
      );
    case "manufacturer":
      return (
        <g>
          <rect x={4.5} y={6} width={15} height={13.5} rx={1.4} />
          <path d="M6.2 7.8 17.8 17.7 M17.8 7.8 6.2 17.7" stroke="var(--glyph-brace, #000)" strokeWidth={1.5} fill="none" opacity={0.55} />
        </g>
      );
    case "pottery":
      return (
        <g>
          <path d="M10 3h4v2.1c2.9 1.3 4.4 3.6 4.4 6.5 0 4.4-2.7 7.9-6.4 7.9s-6.4-3.5-6.4-7.9c0-2.9 1.5-5.2 4.4-6.5V3z" />
          <rect x={8.6} y={20} width={6.8} height={1.7} rx={0.8} />
        </g>
      );
    case "coal":
      return (
        <g>
          <circle cx={8.8} cy={8.8} r={2} />
          <circle cx={12.3} cy={7.8} r={2.3} />
          <circle cx={15.7} cy={9} r={1.9} />
          <path d="M4.4 11h15.2l-2.5 7H6.9l-2.5-7z" />
          <circle cx={9} cy={19.8} r={1.7} />
          <circle cx={15} cy={19.8} r={1.7} />
        </g>
      );
    case "iron":
      return <path d="M5.5 4.5h13v3.4h-4.6v8.2h4.6v3.4h-13v-3.4h4.6V7.9H5.5V4.5z" />;
    case "brewery":
      return (
        <g>
          <path d="M8.2 4.4c2.5-1 5.1-1 7.6 0l.7 3.6c.5 2.7.5 5.6 0 8.3l-.7 3.5c-2.5 1-5.1 1-7.6 0l-.7-3.5c-.5-2.7-.5-5.6 0-8.3l.7-3.6z" />
          <path d="M7.3 9.6h9.4 M7.1 14.4h9.8" stroke="var(--glyph-brace, #000)" strokeWidth={1.4} fill="none" opacity={0.5} />
        </g>
      );
  }
}

/* ======================================================================
   资源 token：煤立方 / 铁锭 / 啤酒桶（7×7 网格）
   ====================================================================== */

export function CoalCube({ s = 7 }: { s?: number }) {
  return (
    <g transform={`scale(${(s / 7).toFixed(3)})`}>
      <polygon points="3.5,0.4 6.6,2.1 3.5,3.8 0.4,2.1" fill="#585349" />
      <polygon points="0.4,2.1 3.5,3.8 3.5,6.9 0.4,5.2" fill="#1d1a15" />
      <polygon points="6.6,2.1 3.5,3.8 3.5,6.9 6.6,5.2" fill="#332f28" />
      <polygon points="3.5,0.4 6.6,2.1 3.5,3.8 0.4,2.1" fill="#ffffff" opacity={0.14} />
    </g>
  );
}

export function IronBeam({ s = 7 }: { s?: number }) {
  return (
    <g transform={`scale(${(s / 7).toFixed(3)})`}>
      <polygon points="0.9,2.9 6.1,2.9 7,6.6 0,6.6" fill="#a9531f" />
      <polygon points="0.9,2.9 6.1,2.9 5.8,4.3 1.2,4.3" fill="#ea9c5d" />
      <polygon points="6.1,2.9 7,6.6 6.2,6.6 5.8,4.3" fill="#7e3c15" />
    </g>
  );
}

export function BeerBarrel({ s = 7 }: { s?: number }) {
  return (
    <g transform={`scale(${(s / 7).toFixed(3)})`}>
      <rect x={0.8} y={0.7} width={5.4} height={5.8} rx={2.1} fill="#b9863f" />
      <rect x={0.8} y={2.2} width={5.4} height={0.95} fill="#6e4b1f" />
      <rect x={0.8} y={4.2} width={5.4} height={0.95} fill="#6e4b1f" />
      <rect x={1.5} y={1.1} width={1.5} height={1.3} rx={0.65} fill="#dcab61" />
    </g>
  );
}

/** 瓦片产出行：按顺序渲染煤/铁/酒 token。 */
function ProduceRow({ coal, iron, beer, s = 6.6, gap = 7.4 }: { coal: number; iron: number; beer: number; s?: number; gap?: number }) {
  const total = coal + iron + beer;
  if (total === 0) return null;
  const width = (total - 1) * gap;
  return (
    <g transform={`translate(${-width / 2}, 0)`}>
      {Array.from({ length: coal }, (_, i) => (
        <g key={`c${i}`} transform={`translate(${i * gap - s / 2 + gap / 2}, ${-s / 2})`}>
          <CoalCube s={s} />
        </g>
      ))}
      {Array.from({ length: iron }, (_, i) => (
        <g key={`i${i}`} transform={`translate(${(coal + i) * gap - s / 2 + gap / 2}, ${-s / 2})`}>
          <IronBeam s={s} />
        </g>
      ))}
      {Array.from({ length: beer }, (_, i) => (
        <g key={`b${i}`} transform={`translate(${(coal + iron + i) * gap - s / 2 + gap / 2}, ${-s / 2})`}>
          <BeerBarrel s={s} />
        </g>
      ))}
    </g>
  );
}

/* ======================================================================
   城市天际线（差异化剪影；基线 y=0，画在 ~36×20 内）
   ====================================================================== */

const SKY_FRONT = "#141009";
const SKY_WIN = "#d9b64a";

function WinDots({ at }: { at: [number, number][] }) {
  return (
    <>
      {at.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width={1.6} height={2.1} fill={SKY_WIN} opacity={0.55} />
      ))}
    </>
  );
}

function SkyMill({ h = 9, n = 3, chimney = true }: { h?: number; n?: number; chimney?: boolean }) {
  const w = 30;
  const tooth = w / n;
  return (
    <g>
      {chimney ? (
        <g>
          <rect x={w / 2 - 8} y={-h - 6} width={3} height={h + 6} fill={SKY_FRONT} />
          <circle cx={w / 2 - 6.5} cy={-h - 8.5} r={1.6} fill="#d8ccb0" opacity={0.4} />
        </g>
      ) : null}
      {Array.from({ length: n }, (_, i) => {
        const x = -w / 2 + i * tooth;
        return <path key={i} d={`M${x} 0 V${-h + 3.4} L${x + tooth * 0.62} ${-h} V0 Z`} fill={SKY_FRONT} />;
      })}
      <WinDots at={[[-w / 2 + 3, -4.5], [-w / 2 + tooth + 3, -4.5], [w / 2 - 14, -4.5]]} />
    </g>
  );
}

function SkyKiln() {
  return (
    <g>
      {[-12.5, 0.5, 13].map((x, i) => {
        const h = [-11, -13.5, -9][i];
        const r = 3.6;
        return <path key={i} d={`M${x - r} 0 V${h + 4} Q${x - r} ${h} ${x} ${h} Q${x + r} ${h} ${x + r} ${h + 4} V0 Z`} fill={SKY_FRONT} />;
      })}
      <WinDots at={[[-13.6, -3.5], [12, -3.5]]} />
    </g>
  );
}

function SkyMine() {
  return (
    <g>
      <path d="M-13 0 L-4.5 -12.5 L4 0" stroke={SKY_FRONT} strokeWidth={2.4} fill="none" />
      <circle cx={-4.5} cy={-14} r={3.4} stroke={SKY_FRONT} strokeWidth={1.5} fill="none" />
      <path d="M-4.5 -17.4 V-10.6 M-7.6 -14 H-1.4" stroke={SKY_FRONT} strokeWidth={1} />
      <rect x={6} y={-6.5} width={10} height={6.5} fill={SKY_FRONT} />
      <WinDots at={[[8.4, -4.6], [12.4, -4.6]]} />
    </g>
  );
}

function SkyFurnace() {
  return (
    <g>
      <path d="M-9 0 L-6.2 -14.5 L6.2 -14.5 L9 0 Z" fill={SKY_FRONT} />
      <rect x={-7.4} y={-16.6} width={14.8} height={2.4} fill={SKY_FRONT} />
      <rect x={10} y={-11} width={3.2} height={11} fill={SKY_FRONT} />
      <WinDots at={[[-2.4, -9.5], [0.8, -9.5], [-2.4, -5], [0.8, -5]]} />
    </g>
  );
}

function SkySpire() {
  return (
    <g>
      <rect x={-13} y={-6} width={15} height={6} fill={SKY_FRONT} />
      <rect x={2} y={-10} width={8} height={10} fill={SKY_FRONT} />
      <path d="M2 -10 L6 -19.5 L10 -10 Z" fill={SKY_FRONT} />
      <path d="M6 -22.4 V-19.2 M4.6 -21 H7.4" stroke={SKY_FRONT} strokeWidth={1.1} />
      <WinDots at={[[-9.5, -3.8], [-5.5, -3.8], [4.6, -7]]} />
    </g>
  );
}

function SkyCathedral() {
  return (
    <g>
      <rect x={-14} y={-4.5} width={28} height={4.5} fill={SKY_FRONT} />
      <rect x={-13} y={-11} width={5.4} height={11} fill={SKY_FRONT} />
      <rect x={7.6} y={-11} width={5.4} height={11} fill={SKY_FRONT} />
      <path d="M-13 -11 L-10.3 -15.5 L-7.6 -11 Z" fill={SKY_FRONT} />
      <path d="M7.6 -11 L10.3 -15.5 L13 -11 Z" fill={SKY_FRONT} />
      <path d="M-3.4 -4.5 L0.2 -18.5 L3.8 -4.5 Z" fill={SKY_FRONT} />
      <WinDots at={[[-11.2, -8.2], [9.4, -8.2], [-0.8, -8]]} />
    </g>
  );
}

function SkyCastle() {
  return (
    <g>
      <rect x={-14} y={-13} width={7} height={13} fill={SKY_FRONT} />
      <rect x={7} y={-13} width={7} height={13} fill={SKY_FRONT} />
      <rect x={-7} y={-6.5} width={14} height={6.5} fill={SKY_FRONT} />
      {[-14, -11.7, -9.4].map((x) => (
        <rect key={`l${x}`} x={x} y={-15.2} width={1.6} height={2.2} fill={SKY_FRONT} />
      ))}
      {[7, 9.3, 11.6].map((x) => (
        <rect key={`r${x}`} x={x} y={-15.2} width={1.6} height={2.2} fill={SKY_FRONT} />
      ))}
      <WinDots at={[[-11.6, -9.5], [-11.6, -4], [9.6, -9.5], [9.6, -4], [-2.4, -4]]} />
    </g>
  );
}

function SkyHall({ grand = false }: { grand?: boolean }) {
  return (
    <g>
      <rect x={-15} y={-8.5} width={30} height={8.5} fill={SKY_FRONT} />
      <path d={grand ? "M-15 -8.5 L0 -14.5 L15 -8.5 Z" : "M-15 -8.5 L0 -13.5 L15 -8.5 Z"} fill={SKY_FRONT} />
      {grand ? <path d="M-3.4 -13.8 A3.4 3.4 0 0 1 3.4 -13.8 Z" fill={SKY_FRONT} /> : null}
      {[-10, -4.4, 1.2, 6.8].map((x) => (
        <rect key={x} x={x} y={-6.4} width={2} height={6.4} fill="#3a3227" />
      ))}
      <WinDots at={[[12.4, -6.2], [-13.2, -6.2]]} />
    </g>
  );
}

function SkyWharf() {
  return (
    <g>
      <rect x={-14} y={-7.5} width={15} height={7.5} fill={SKY_FRONT} />
      <path d="M-14 -7.5 L-6.5 -12.8 L1 -7.5 Z" fill={SKY_FRONT} />
      <path d="M4 0 V-9 L11.5 -11.5 M4 -9 L-0.5 -6.5" stroke={SKY_FRONT} strokeWidth={1.7} fill="none" />
      <WinDots at={[[-11.8, -5], [-8, -5], [-4.4, -5]]} />
    </g>
  );
}

function SkyBrewhouse() {
  return (
    <g>
      <rect x={-14} y={-6.5} width={12.5} height={6.5} fill={SKY_FRONT} />
      <path d="M-14 -6.5 L-7.75 -12 L-1.5 -6.5 Z" fill={SKY_FRONT} />
      <rect x={2.5} y={-15} width={5.4} height={15} rx={1} fill={SKY_FRONT} />
      <circle cx={11.5} cy={-3.2} r={2.6} fill={SKY_FRONT} />
      <circle cx={5.2} cy={-17} r={1.5} fill="#d8ccb0" opacity={0.4} />
      <WinDots at={[[-11.6, -4.2], [-7.4, -4.2]]} />
    </g>
  );
}

function SkyBarn() {
  return (
    <g>
      <rect x={-12} y={-6.5} width={15} height={6.5} fill={SKY_FRONT} />
      <path d="M-12 -6.5 L-4.5 -12.5 L3 -6.5 Z" fill={SKY_FRONT} />
      <rect x={7} y={-11} width={5.4} height={11} fill={SKY_FRONT} />
      <path d="M7 -11 A2.7 2.7 0 0 1 12.4 -11 Z" fill={SKY_FRONT} />
    </g>
  );
}

/** 每城一座剪影，参考真实城市的标志建筑。 */
const CITY_SKYLINE: Record<string, () => ReactElement> = {
  belper: () => <SkyMill h={9} n={3} />,
  derby: () => <SkySpire />,
  leek: () => <SkyMill h={8} n={2} />,
  "stoke-on-trent": () => <SkyKiln />,
  stone: () => <SkyWharf />,
  uttoxeter: () => <SkySpire />,
  stafford: () => <SkyHall />,
  "burton-on-trent": () => <SkyBrewhouse />,
  cannock: () => <SkyMine />,
  tamworth: () => <SkyCastle />,
  walsall: () => <SkyMill h={7} n={3} />,
  wolverhampton: () => <SkyMill h={10} n={3} />,
  coalbrookdale: () => <SkyFurnace />,
  dudley: () => <SkyCastle />,
  birmingham: () => <SkyHall grand />,
  nuneaton: () => <SkyMill h={8} n={3} />,
  coventry: () => <SkyCathedral />,
  kidderminster: () => <SkyMill h={7} n={2} />,
  worcester: () => <SkyCathedral />,
  redditch: () => <SkyFurnace />,
};

function CitySkyline({ id, farm }: { id: string; farm: boolean }) {
  const build = farm ? () => <SkyBarn /> : CITY_SKYLINE[id];
  if (!build) return null;
  return <g transform="translate(0, -8.5)">{build()}</g>;
}

/* ======================================================================
   主组件
   ====================================================================== */

/** 追踪新落子 / 新翻面，驱动局内动效。 */
type TileMemo = Map<string, { flipped: boolean }>;

export function BoardMap({
  state,
  myPlayer,
  highlightedLocations,
  highlightedLinks,
  selectedLocation,
  selectedLinkIndex,
  onLocationClick,
  onLinkClick,
}: BoardMapProps) {
  const tileAt = (location: string, slotIndex: number) =>
    state.placedTiles.find((t) => t.location === location && t.slotIndex === slotIndex);

  const linkTilesAt = (linkIndex: number) => state.placedLinks.filter((l) => l.linkIndex === linkIndex);

  const merchantTileAt = (slotId: string) => state.merchantTiles.find((m) => m.slotId === slotId);

  const memoRef = useRef<{ version: number; tiles: TileMemo; links: Set<string> }>({
    version: -1,
    tiles: new Map(),
    links: new Set(),
  });
  const newTileIds = new Set<string>();
  const flippedTileIds = new Set<string>();
  const newLinkIds = new Set<string>();
  if (memoRef.current.version !== state.stateVersion) {
    for (const t of state.placedTiles) {
      const was = memoRef.current.tiles.get(t.id);
      if (!was) newTileIds.add(t.id);
      else if (!was.flipped && t.flipped) flippedTileIds.add(t.id);
    }
    for (const l of state.placedLinks) {
      if (!memoRef.current.links.has(l.id)) newLinkIds.add(l.id);
    }
  }
  useEffect(() => {
    memoRef.current = {
      version: state.stateVersion,
      tiles: new Map(state.placedTiles.map((t) => [t.id, { flipped: t.flipped }])),
      links: new Set(state.placedLinks.map((l) => l.id)),
    };
  }, [state.stateVersion, state.placedTiles, state.placedLinks]);

  return (
    <svg
      className="brass-board"
      viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="伯明翰版图"
    >
      <defs>
        <radialGradient id="b-parchment" cx="50%" cy="42%" r="80%">
          <stop offset="0%" stopColor="#f3ead4" />
          <stop offset="62%" stopColor="#eadfc4" />
          <stop offset="100%" stopColor="#dccfae" />
        </radialGradient>
        <radialGradient id="b-vignette" cx="50%" cy="45%" r="72%">
          <stop offset="58%" stopColor="rgba(43,32,14,0)" />
          <stop offset="100%" stopColor="rgba(43,32,14,0.38)" />
        </radialGradient>
        <filter id="b-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.32  0 0 0 0 0.26  0 0 0 0 0.16  0 0 0 0.5 0"
          />
        </filter>
        <linearGradient id="b-plot-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#544a3d" />
          <stop offset="100%" stopColor="#39322a" />
        </linearGradient>
        <linearGradient id="b-merchant-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5c6c50" />
          <stop offset="100%" stopColor="#3c4a36" />
        </linearGradient>
      </defs>

      {/* 版图底：羊皮纸 + 纸纹 + 地形晕染 + 暗角 + 双框 */}
      <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} rx={20} fill="url(#b-parchment)" />
      <ellipse cx={175} cy={430} rx={215} ry={160} fill="#6b7a55" opacity={0.07} />
      <ellipse cx={965} cy={330} rx={205} ry={145} fill="#7a6b45" opacity={0.06} />
      <ellipse cx={520} cy={820} rx={260} ry={110} fill="#6b7a55" opacity={0.05} />
      <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} rx={20} filter="url(#b-grain)" opacity={0.28} />
      <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} rx={20} fill="url(#b-vignette)" pointerEvents="none" />
      <rect x={7} y={7} width={BOARD_WIDTH - 14} height={BOARD_HEIGHT - 14} rx={15} fill="none" stroke="#3f3423" strokeWidth={2.5} opacity={0.75} />
      <rect x={13} y={13} width={BOARD_WIDTH - 26} height={BOARD_HEIGHT - 26} rx={11} fill="none" stroke="#a8863c" strokeWidth={1.2} opacity={0.6} />

      {/* 角落装饰：罗盘 + 铭牌 */}
      <g transform="translate(1124, 47)" opacity={0.85}>
        <circle r={23} fill="#e9dcbc" stroke="#8a795d" strokeWidth={1.4} />
        <circle r={18.5} fill="none" stroke="#a8863c" strokeWidth={0.7} opacity={0.7} />
        <polygon points="0,-16 4,0 0,16 -4,0" fill="#a63d2f" opacity={0.85} />
        <polygon points="-16,0 0,-4 16,0 0,4" fill="#3f3423" opacity={0.85} />
        <circle r={2.2} fill="#3f3423" />
        <text y={-26} textAnchor="middle" fontSize={9} fontWeight={800} fill="#5d5142">
          N
        </text>
      </g>
      <g transform="translate(38, 866)">
        <rect x={0} y={0} width={186} height={46} rx={8} fill="#f2e7cb" stroke="#3f3423" strokeWidth={1.6} opacity={0.92} />
        <rect x={4} y={4} width={178} height={38} rx={5} fill="none" stroke="#a8863c" strokeWidth={0.8} opacity={0.8} />
        <text x={93} y={21} textAnchor="middle" fontSize={14.5} fontWeight={800} fill="#3f3423" letterSpacing={2} fontFamily='"Palatino Linotype", "Songti SC", Georgia, serif'>
          工业革命 · 伯明翰
        </text>
        <text x={93} y={37} textAnchor="middle" fontSize={7.5} fill="#7a6b4c" letterSpacing={2.4}>
          BRASS : BIRMINGHAM · MIDLAND WORKS
        </text>
      </g>

      {/* 连线：运河水系 / 铁路枕木 */}
      {LINKS.map((def, index) => {
        const a = NODE_POS[def.a];
        const b = NODE_POS[def.b];
        if (!a || !b) return null;
        const occupied = linkTilesAt(index);
        const highlighted = highlightedLinks?.has(index) ?? false;
        const selected = selectedLinkIndex === index;
        const clickable = Boolean(onLinkClick && highlighted && occupied.length === 0);
        const via = def.via ? NODE_POS[def.via] : null;
        const mid = via
          ? { x: (a.x + via.x) / 2, y: (a.y + via.y) / 2 }
          : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        return (
          <g
            key={def.id}
            data-link={index}
            role={clickable ? "button" : undefined}
            aria-label={clickable ? `铺线 ${def.id}` : undefined}
            onClick={clickable ? () => onLinkClick?.(index) : undefined}
            className={clickable ? "brass-link clickable" : "brass-link"}
          >
            {def.canal ? (
              <>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#4e7183" strokeWidth={12} strokeLinecap="round" opacity={0.3} />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#7fa2b2" strokeWidth={6.4} strokeLinecap="round" opacity={0.9} />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#b7d0d9" strokeWidth={1.7} strokeLinecap="round" strokeDasharray="12 14" opacity={0.65} />
              </>
            ) : null}
            {def.rail ? (
              <>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#241c11" strokeWidth={7.4} strokeLinecap="round" opacity={0.9} />
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#8a6f42"
                  strokeWidth={7.4}
                  strokeDasharray="2.4 7.6"
                  strokeLinecap="butt"
                  opacity={0.95}
                />
              </>
            ) : null}
            {highlighted && !occupied.length ? (
              <line className="b-ants" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#e8b83c" strokeWidth={9} strokeLinecap="round" strokeDasharray="13 9" opacity={0.95} />
            ) : null}
            {selected ? (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#a63d2f" strokeWidth={9} strokeLinecap="round" opacity={0.55} />
            ) : null}
            {clickable ? (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={18} strokeLinecap="round" />
            ) : null}
            {/* 已放置的 Link 板块：木梁 + 轨道纹 */}
            {occupied.map((link) => (
              <g key={link.id} transform={`translate(${mid.x},${mid.y}) rotate(${angle})`}>
                <g className={`b-anim ${newLinkIds.has(link.id) ? "b-pop" : ""}`}>
                  <rect x={-23} y={-9.5} width={46} height={19} rx={4.5} fill={playerColor(link.player)} stroke="#241f16" strokeWidth={1.6} />
                  <rect x={-19} y={-6.5} width={38} height={5.5} rx={2.6} fill="#ffffff" opacity={0.2} />
                  <line x1={-19} y1={2.6} x2={19} y2={2.6} stroke="#241f16" strokeWidth={5.4} strokeDasharray="2.2 5.6" opacity={0.32} />
                  <line x1={-19} y1={2.6} x2={19} y2={2.6} stroke="#f3e7c8" strokeWidth={1.1} opacity={0.6} />
                  <circle cx={0} cy={-3.4} r={2} fill="#e8c96a" stroke="#241f16" strokeWidth={0.7} />
                </g>
              </g>
            ))}
          </g>
        );
      })}

      {/* 建造地点：石板地块 + 城市剪影 + 槽位 */}
      {Object.entries(LOCATIONS).map(([id, def]) => {
        const pos = NODE_POS[id];
        if (!pos) return null;
        const farm = Boolean(def.farm);
        const highlighted = highlightedLocations?.has(id) ?? false;
        const selected = selectedLocation === id;
        const clickable = Boolean(onLocationClick && highlighted);
        const slotW = 32;
        const slotGap = 7;
        const innerW = farm ? 40 : def.slots.length * slotW + (def.slots.length - 1) * slotGap + 18;
        const w = farm ? 52 : Math.max(104, innerW);
        const h = farm ? 50 : 95;
        const longName = !farm && (id === "stoke-on-trent" || id === "burton-on-trent" || id === "wolverhampton" || id === "coalbrookdale" || id === "kidderminster");
        return (
          <g
            key={id}
            data-loc={id}
            role={clickable ? "button" : undefined}
            aria-label={clickable ? `建造于 ${locationLabel(id)}` : undefined}
            transform={`translate(${pos.x},${pos.y})`}
            onClick={clickable ? () => onLocationClick?.(id) : undefined}
            className={clickable ? "brass-loc clickable" : "brass-loc"}
          >
            {highlighted ? (
              <rect className="b-plot-glow" x={-w / 2 - 7} y={-h / 2 - 7} width={w + 14} height={h + 14} rx={13} fill="#e8b83c" opacity={0.4} />
            ) : null}
            {selected ? (
              <rect x={-w / 2 - 7} y={-h / 2 - 7} width={w + 14} height={h + 14} rx={13} fill="none" stroke="#a63d2f" strokeWidth={3.2} />
            ) : null}
            <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={9} fill="url(#b-plot-face)" stroke="#221c13" strokeWidth={1.8} />
            <rect x={-w / 2 + 2.5} y={-h / 2 + 2.5} width={w - 5} height={11} rx={6} fill="#ffffff" opacity={0.07} />
            {/* 城市剪影（地名下方） */}
            <g style={{ pointerEvents: "none" }}>
              <CitySkyline id={id} farm={farm} />
            </g>
            <text
              y={farm ? -h / 2 + 15 : -h / 2 + 15.5}
              textAnchor="middle"
              fontSize={farm ? 10 : longName ? 10.5 : 12}
              fill="#f3ead6"
              fontWeight={800}
              letterSpacing={farm ? 1 : 1.4}
              style={{ pointerEvents: "none" }}
            >
              {farm ? (id === "farm-north" ? "酒厂·北" : "酒厂·南") : locationLabel(id)}
            </text>
            {/* 槽位 */}
            {!farm
              ? def.slots.map((slot, slotIndex) => {
                  const tile = tileAt(id, slotIndex);
                  const total = def.slots.length * slotW + (def.slots.length - 1) * slotGap;
                  const x = -total / 2 + slotIndex * (slotW + slotGap);
                  return (
                    <g key={slotIndex} transform={`translate(${x}, 4)`}>
                      <rect x={0} y={0} width={slotW} height={slotW} rx={5} fill="#262019" stroke="#141009" strokeWidth={1} />
                      {tile ? null : (
                        slot.industries.map((ind, i, arr) => {
                          const count = arr.length;
                          const cx = slotW / 2 + (i - (count - 1) / 2) * 13;
                          return (
                            <text
                              key={ind}
                              x={cx}
                              y={slotW / 2 + 4.5}
                              textAnchor="middle"
                              fontSize={count === 1 ? 14 : 12}
                              fontWeight={700}
                              fill={INDUSTRY_SLOT_INK[ind]}
                              stroke="#0f0c07"
                              strokeWidth={0.4}
                              paintOrder="stroke"
                            >
                              {INDUSTRY_SHORT[ind]}
                            </text>
                          );
                        })
                      )}
                      {tile ? (
                        <IndustryTile
                          tile={tile}
                          x={1.5}
                          y={1.5}
                          size={slotW - 3}
                          isNew={newTileIds.has(tile.id)}
                          isFlippedNow={flippedTileIds.has(tile.id)}
                        />
                      ) : null}
                    </g>
                  );
                })
              : (() => {
                  const tile = tileAt(id, 0);
                  return tile ? (
                    <g transform="translate(-13, -6)">
                      <IndustryTile tile={tile} x={0} y={0} size={26} isNew={newTileIds.has(tile.id)} isFlippedNow={flippedTileIds.has(tile.id)} />
                    </g>
                  ) : null;
                })()}
          </g>
        );
      })}

      {/* 商人位（按人数过滤：2p/3p 不足人数的商人位不显示板槽） */}
      {Object.entries(MERCHANTS).map(([id, def]) => {
        const pos = NODE_POS[id];
        if (!pos) return null;
        const active = merchantSlotsFor(state.playerCount as 2 | 3 | 4).some((s) => s.location === id);
        const slots = active
          ? Array.from({ length: def.slots }, (_, i) => `${id}#${i + 1}`)
          : [];
        return (
          <g key={id} transform={`translate(${pos.x},${pos.y})`} opacity={active ? 1 : 0.4}>
            <circle r={31} fill="url(#b-merchant-face)" stroke="#1d170e" strokeWidth={2.4} />
            <circle r={26} fill="none" stroke="#c8a94f" strokeWidth={1.1} opacity={0.75} />
            <text y={-4} textAnchor="middle" fontSize={11} fontWeight={800} fill="#f3ead6" letterSpacing={0.8} style={{ pointerEvents: "none" }}>
              {locationLabel(id)}
            </text>
            <text y={11} textAnchor="middle" fontSize={10} fill="#e8c96a" fontWeight={600} style={{ pointerEvents: "none" }}>
              {merchantBonusLabel(id)}
            </text>
            {slots.map((slotId, i) => {
              const tile = merchantTileAt(slotId);
              const w = 26;
              const h = 20;
              const x = (i - (slots.length - 1) / 2) * (w + 6) - w / 2;
              return (
                <g key={slotId} transform={`translate(${x}, 40)`}>
                  <rect x={0} y={0} width={w} height={h} rx={4} fill="#2a241c" stroke="#8a795d" strokeWidth={1.2} />
                  {tile ? (
                    tile.blank ? (
                      <text x={w / 2} y={h / 2 + 4.5} textAnchor="middle" fontSize={12} fill="#9a8c6d" fontWeight={700}>
                        ✕
                      </text>
                    ) : (
                      <>
                        {tile.goods.map((g, gi) => (
                          <rect
                            key={g}
                            x={4.5 + gi * 7}
                            y={h / 2 - 3.5}
                            width={5.5}
                            height={7}
                            rx={1.5}
                            fill={INDUSTRY_COLOR[g as IndustryType]}
                            stroke="#191510"
                            strokeWidth={0.6}
                          />
                        ))}
                        {tile.beer ? (
                          <g transform={`translate(${w - 8.4}, 1.6)`}>
                            <BeerBarrel s={6.6} />
                          </g>
                        ) : null}
                      </>
                    )
                  ) : null}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/** 产业瓦片：未翻面 = 产业色块 + 徽标 + 等级 + 产量 token；翻面 = 褐背 + VP + 连线点。 */
function IndustryTile({
  tile,
  x,
  y,
  size,
  isNew,
  isFlippedNow,
}: {
  tile: { id: string; industry: IndustryType; level: number; player: number; flipped: boolean; coal: number; iron: number; beer: number };
  x: number;
  y: number;
  size: number;
  isNew: boolean;
  isFlippedNow: boolean;
}) {
  const face = tile.flipped ? FLIPPED_TILE : INDUSTRY_TILE[tile.industry];
  const s = size;
  const vp = vpOf(tile.industry, tile.level);
  const lp = linkPointsOf(tile.industry, tile.level);
  const glyphScale = 0.46;
  return (
    <g transform={`translate(${x},${y})`} style={{ pointerEvents: "none" }}>
      <g className={`b-anim b-tile ${isNew ? "b-pop" : ""} ${isFlippedNow ? "b-flip" : ""}`}>
        <defs>
          <linearGradient id={`b-tile-${tile.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={face.top} />
            <stop offset="100%" stopColor={face.bottom} />
          </linearGradient>
        </defs>
        <rect x={0.5} y={0.5} width={s - 1} height={s - 1} rx={5} fill={`url(#b-tile-${tile.id})`} stroke="#1c160d" strokeWidth={1.6} />
        <rect x={2.5} y={2} width={s - 5} height={s * 0.32} rx={3.5} fill="#ffffff" opacity={0.18} />
        {tile.flipped ? (
          <>
            <text x={s / 2 - (String(vp).length > 1 ? 3 : 0)} y={s / 2 + 5} textAnchor="middle" fontSize={s * 0.46} fontWeight={800} fill={face.ink}>
              {vp}
            </text>
            {lp > 0 ? (
              <g transform={`translate(${s - 6}, ${s - 5})`}>
                <line x1={-5} y1={-1.6} x2={2} y2={-1.6} stroke={face.ink} strokeWidth={1.6} strokeLinecap="round" />
                <line x1={-5} y1={1.6} x2={2} y2={1.6} stroke={face.ink} strokeWidth={1.6} strokeLinecap="round" />
                <text x={5.5} y={3.6} textAnchor="middle" fontSize={8.5} fontWeight={800} fill={face.ink}>
                  {lp}
                </text>
              </g>
            ) : null}
          </>
        ) : (
          <>
            <g
              transform={`translate(2.6, 2.4) scale(${glyphScale})`}
              fill={face.ink}
              style={{ "--glyph-brace": face.bottom } as CSSProperties}
            >
              <IndustryGlyph industry={tile.industry} />
            </g>
            <text x={s / 2} y={s / 2 + 6.5} textAnchor="middle" fontSize={s * 0.42} fontWeight={800} fill={face.ink}>
              {roman(tile.level)}
            </text>
            <g transform={`translate(${s / 2}, ${s - 4.6})`}>
              <ProduceRow coal={tile.coal} iron={tile.iron} beer={tile.beer} />
            </g>
          </>
        )}
      </g>
    </g>
  );
}

export { linkEndpoints };
