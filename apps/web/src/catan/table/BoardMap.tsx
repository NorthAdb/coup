import type { ReactElement } from "react";
import { axialCenter, hexCornerOffset, RESOURCE_NAMES, TERRAIN_RESOURCE } from "@coup/catan-domain";
import type { CatanGame, FloatChip, ResourceId } from "@coup/catan-domain";
import {
  CityPiece,
  HarborScene,
  NumberToken,
  RobberPiece,
  RoadPiece,
  SettlementPiece,
  TERRAIN_COLORS,
  TerrainArt,
  resourceGlyph,
} from "./pieces.js";

/**
 * 卡坦岛桌面地图：老海图式的海洋与海岸、9 座港口、19 块地形六边形、
 * 数字 Token、道路/村庄/城市/强盗棋子与建造交互层。
 * 全部在「布局单位」坐标（六边形外接圆半径 = 1）下绘制，由 viewBox 控制缩放。
 */

export type BuildMode = "road" | "settlement" | "city" | "robber" | null;

export interface ConfirmTarget {
  kind: "road" | "settlement" | "city";
  key: number;
  title: string;
  cost: Partial<Record<ResourceId, number>>;
  affordable: boolean;
}

interface BoardMapProps {
  game: CatanGame;
  myColor: string;
  buildMode: BuildMode;
  legalRoads: ReadonlySet<number>;
  legalSettlements: ReadonlySet<number>;
  legalCities: ReadonlySet<number>;
  hotTiles: ReadonlySet<number>;
  floatChips: ReadonlyArray<FloatChip>;
  freshPiece: { kind: "road" | "settlement" | "city"; key: number } | null;
  activeHarbors: ReadonlySet<number>;
  confirmTarget: ConfirmTarget | null;
  onTileClick: (tileId: number) => void;
  onEdgeClick: (edgeId: number) => void;
  onVertexClick: (vertexId: number) => void;
  onConfirm: (accept: boolean) => void;
  onVoidClick: () => void;
}

function hexPath(scale = 1): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const off = hexCornerOffset(i);
    pts.push(`${(off.x * scale).toFixed(4)} ${(off.y * scale).toFixed(4)}`);
  }
  return `M${pts.join(" L")} Z`;
}

const HEX_PATH = hexPath(1);

export function BoardMap(props: BoardMapProps): ReactElement {
  const {
    game,
    myColor,
    buildMode,
    legalRoads,
    legalSettlements,
    legalCities,
    hotTiles,
    floatChips,
    freshPiece,
    activeHarbors,
    confirmTarget,
    onTileClick,
    onEdgeClick,
    onVertexClick,
    onConfirm,
    onVoidClick,
  } = props;

  // viewBox：顶点包围盒 + 海环留白。
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of game.vertices) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  const sea = 2.35;
  const pad = 0.3;
  const vb = {
    x: minX - sea - pad,
    y: minY - sea - pad,
    w: maxX - minX + (sea + pad) * 2,
    h: maxY - minY + (sea + pad) * 2,
  };

  const tileById = new Map(game.tiles.map((t) => [t.id, t]));
  const robber = tileById.get(game.robberTile)!;
  const robberCenter = axialCenter(robber.q, robber.r);

  const roadByEdge = new Map(game.roads.map((r) => [r.edge, r]));
  const buildingByVertex = new Map(game.buildings.map((b) => [b.vertex, b]));

  const interactive = buildMode !== null;
  const robberMode = buildMode === "robber";

  return (
    <svg
      className={`ct-board-svg${interactive ? " is-interactive" : ""}`}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      role="img"
      aria-label="卡坦岛地图"
    >
      <defs>
        {game.tiles.map((t) => (
          <linearGradient key={t.id} id={`ct-terr-${t.id}`} x1="0" y1="0" x2="0.25" y2="1">
            <stop offset="0" stopColor={TERRAIN_COLORS[t.terrain].hi} />
            <stop offset="0.55" stopColor={TERRAIN_COLORS[t.terrain].mid} />
            <stop offset="1" stopColor={TERRAIN_COLORS[t.terrain].lo} />
          </linearGradient>
        ))}
        {game.tiles.map((t) => (
          <clipPath key={`clip-${t.id}`} id={`ct-clip-${t.id}`}>
            <path d={HEX_PATH} transform={`translate(${axialCenter(t.q, t.r).x} ${axialCenter(t.q, t.r).y})`} />
          </clipPath>
        ))}
        <radialGradient id="ct-token-wood" cx="0.38" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#8a6a3e" />
          <stop offset="0.72" stopColor="#6e5230" />
          <stop offset="1" stopColor="#4a3620" />
        </radialGradient>
        <radialGradient id="ct-sea" cx="0.5" cy="0.42" r="0.85">
          <stop offset="0" stopColor="#2e6273" />
          <stop offset="0.62" stopColor="#275668" />
          <stop offset="1" stopColor="#1d4353" />
        </radialGradient>
        <pattern id="ct-waves" width="2.2" height="1.7" patternUnits="userSpaceOnUse">
          <path
            d="M0 1.2 Q0.28 1.02 0.56 1.2 T1.12 1.2 M1.3 0.5 Q1.58 0.32 1.86 0.5 T2.42 0.5"
            fill="none"
            stroke="rgba(233,240,235,0.10)"
            strokeWidth="0.045"
            strokeLinecap="round"
          />
        </pattern>
        <filter id="ct-papergrain" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.15  0 0 0 0 0.12  0 0 0 0 0.06  0 0 0 0.05 0" />
          <feComposite operator="over" in2="SourceGraphic" />
        </filter>
        <clipPath id="ct-seaclip">
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} rx={1.5} />
        </clipPath>
      </defs>

      {/* 海面：圆角海图毯 + 铜线图框 */}
      <rect
        x={vb.x}
        y={vb.y}
        width={vb.w}
        height={vb.h}
        rx={1.5}
        fill="url(#ct-sea)"
        onPointerDown={onVoidClick}
      />
      <g clipPath="url(#ct-seaclip)" pointerEvents="none">
        <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#ct-waves)" />
        {/* 老海图经纬线 */}
        <g stroke="rgba(226,236,232,0.07)" strokeWidth={0.02}>
          {[-6, -4, -2, 0, 2, 4, 6].map((gx) => (
            <line key={`gx${gx}`} x1={gx} y1={vb.y} x2={gx} y2={vb.y + vb.h} />
          ))}
          {[-5, -3, -1, 1, 3, 5].map((gy) => (
            <line key={`gy${gy}`} x1={vb.x} y1={gy} x2={vb.x + vb.w} y2={gy} />
          ))}
        </g>
      </g>
      <g pointerEvents="none" fill="none">
        <rect x={vb.x + 0.22} y={vb.y + 0.22} width={vb.w - 0.44} height={vb.h - 0.44} rx={1.3} stroke="rgba(233,215,160,0.34)" strokeWidth={0.045} />
        <rect x={vb.x + 0.38} y={vb.y + 0.38} width={vb.w - 0.76} height={vb.h - 0.76} rx={1.2} stroke="rgba(233,215,160,0.16)" strokeWidth={0.025} />
      </g>
      <CompassRose x={vb.x + vb.w - 1.05} y={vb.y + vb.h - 1.05} />

      {/* 海岸：岛屿投影 → 沙滩 → 湿沙 */}
      <g pointerEvents="none">
        {game.tiles.map((t) => {
          const c = axialCenter(t.q, t.r);
          return (
            <path
              key={`shadow-${t.id}`}
              d={HEX_PATH}
              transform={`translate(${c.x} ${c.y + 0.14}) scale(1.34)`}
              fill="rgba(12,26,32,0.45)"
            />
          );
        })}
        {game.tiles.map((t) => {
          const c = axialCenter(t.q, t.r);
          return (
            <path
              key={`shore2-${t.id}`}
              d={HEX_PATH}
              transform={`translate(${c.x} ${c.y}) scale(1.24)`}
              fill="#c8b483"
              opacity={0.9}
            />
          );
        })}
        {game.tiles.map((t) => {
          const c = axialCenter(t.q, t.r);
          return (
            <path
              key={`shore1-${t.id}`}
              d={HEX_PATH}
              transform={`translate(${c.x} ${c.y}) scale(1.13)`}
              fill="#e2d2a2"
            />
          );
        })}
      </g>

      {/* 地块 */}
      {game.tiles.map((t) => {
        const c = axialCenter(t.q, t.r);
        const hot = hotTiles.has(t.id);
        const selectable = robberMode;
        return (
          <g
            key={t.id}
            className={`ct-tile${hot ? " is-hot" : ""}${selectable ? " is-selectable" : ""}`}
            onPointerDown={selectable ? () => onTileClick(t.id) : undefined}
          >
            <path d={HEX_PATH} transform={`translate(${c.x} ${c.y})`} fill={`url(#ct-terr-${t.id})`} stroke={TERRAIN_COLORS[t.terrain].lo} strokeWidth={0.045} />
            <g clipPath={`url(#ct-clip-${t.id})`}>
              <TerrainArt terrain={t.terrain} tileId={t.id} />
              {hot ? <path d={HEX_PATH} transform={`translate(${c.x} ${c.y})`} fill="rgba(255,224,130,0.16)" /> : null}
            </g>
            <path d={HEX_PATH} transform={`translate(${c.x} ${c.y}) scale(0.94)`} fill="none" stroke="rgba(255,246,220,0.16)" strokeWidth={0.05} />
            {t.value != null ? (
              <g transform={`translate(${c.x} ${c.y})`}>
                <NumberToken value={t.value} hot={hot} />
              </g>
            ) : null}
            {robberMode && t.id !== game.robberTile ? (
              <path
                d={HEX_PATH}
                transform={`translate(${c.x} ${c.y}) scale(0.9)`}
                className="ct-tile-hint"
                fill="rgba(255,244,214,0.05)"
                stroke="rgba(244,232,200,0.6)"
                strokeWidth={0.055}
                strokeDasharray="0.16 0.11"
              />
            ) : null}
          </g>
        );
      })}

      {/* 港口 */}
      {game.harbors.map((h) => {
        const e = game.edges[h.edge]!;
        const mx = (e.x1 + e.x2) / 2;
        const my = (e.y1 + e.y2) / 2;
        const len = Math.hypot(mx, my) || 1;
        const dist = 0.72;
        const x = mx + (mx / len) * dist;
        const y = my + (my / len) * dist;
        const angle = (Math.atan2(my, mx) * 180) / Math.PI;
        return <HarborScene key={h.id} x={x} y={y} angle={angle} kind={h.kind} active={activeHarbors.has(h.id)} />;
      })}

      {/* 道路 */}
      {game.roads.map((r) => {
        const e = game.edges[r.edge]!;
        const mx = (e.x1 + e.x2) / 2;
        const my = (e.y1 + e.y2) / 2;
        const angle = (Math.atan2(e.y2 - e.y1, e.x2 - e.x1) * 180) / Math.PI;
        const owner = game.players[r.owner]!;
        return (
          <RoadPiece
            key={`r${r.edge}`}
            x={mx}
            y={my}
            angle={angle}
            color={owner.color}
            fresh={freshPiece?.kind === "road" && freshPiece.key === r.edge}
          />
        );
      })}

      {/* 村庄与城市 */}
      {game.buildings.map((b) => {
        const v = game.vertices[b.vertex]!;
        const owner = game.players[b.owner]!;
        return b.city ? (
          <CityPiece
            key={`b${b.vertex}`}
            x={v.x}
            y={v.y}
            color={owner.color}
            fresh={freshPiece?.kind === "city" && freshPiece.key === b.vertex}
          />
        ) : (
          <SettlementPiece
            key={`b${b.vertex}`}
            x={v.x}
            y={v.y}
            color={owner.color}
            fresh={freshPiece?.kind === "settlement" && freshPiece.key === b.vertex}
          />
        );
      })}

      {/* 强盗 */}
      <RobberPiece x={robberCenter.x} y={robberCenter.y} />

      {/* 产出飘卡：从 token 处向上飘散 */}
      {floatChips.map((chip) => {
        const t = tileById.get(chip.tileId);
        if (!t) return null;
        const c = axialCenter(t.q, t.r);
        return (
          <g key={chip.id} transform={`translate(${c.x} ${c.y - 0.5})`} pointerEvents="none">
            <g className="ct-floatchip">
              <g transform="scale(0.34)">{resourceGlyph(chip.resource)}</g>
              {chip.n > 1 ? (
                <text y={0.52} textAnchor="middle" className="ct-floatchip-n">
                  +{chip.n}
                </text>
              ) : null}
            </g>
          </g>
        );
      })}

      {/* 建造交互层 */}
      {buildMode === "road" ? (
        <g className="ct-hotlayer">
          {game.edges
            .filter((e) => legalRoads.has(e.id) && !roadByEdge.has(e.id))
            .map((e) => {
              const mx = (e.x1 + e.x2) / 2;
              const my = (e.y1 + e.y2) / 2;
              const angle = (Math.atan2(e.y2 - e.y1, e.x2 - e.x1) * 180) / Math.PI;
              return (
                <g key={`lr${e.id}`} className="ct-hot-road" onPointerDown={() => onEdgeClick(e.id)}>
                  <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={myColor} strokeWidth={0.14} strokeDasharray="0.14 0.1" opacity={0.55} strokeLinecap="round" />
                  <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="transparent" strokeWidth={0.42} />
                  <rect x={mx - 0.05} y={my - 0.05} width={0.1} height={0.1} transform={`rotate(${angle} ${mx} ${my})`} fill={myColor} opacity={0.001} />
                </g>
              );
            })}
        </g>
      ) : null}

      {buildMode === "settlement" || buildMode === "city" ? (
        <g className="ct-hotlayer">
          {(buildMode === "settlement" ? game.vertices.filter((v) => legalSettlements.has(v.id)) : game.vertices.filter((v) => legalCities.has(v.id))).map(
            (v) => (
              <g key={`lv${v.id}`} className="ct-hot-vertex" onPointerDown={() => onVertexClick(v.id)}>
                {buildMode === "settlement" ? (
                  <circle cx={v.x} cy={v.y} r={0.16} fill={myColor} opacity={0.75} stroke="rgba(255,246,220,0.85)" strokeWidth={0.035} />
                ) : (
                  <circle cx={v.x} cy={v.y} r={0.2} fill="none" stroke={myColor} strokeWidth={0.07} opacity={0.85} />
                )}
                <circle cx={v.x} cy={v.y} r={0.3} fill="transparent" />
              </g>
            ),
          )}
        </g>
      ) : null}

      {/* 建造确认气泡 */}
      {confirmTarget ? <ConfirmBubble target={confirmTarget} game={game} onConfirm={onConfirm} /> : null}
      {/* 空白处的点击由最底层的海面矩形接收（onVoidClick），此处不再叠加遮罩。 */}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 建造确认气泡                                                        */
/* ------------------------------------------------------------------ */

function ConfirmBubble({
  target,
  game,
  onConfirm,
}: {
  target: ConfirmTarget;
  game: CatanGame;
  onConfirm: (accept: boolean) => void;
}): ReactElement {
  let cx = 0;
  let cy = 0;
  if (target.kind === "road") {
    const e = game.edges[target.key]!;
    cx = (e.x1 + e.x2) / 2;
    cy = (e.y1 + e.y2) / 2;
  } else {
    const v = game.vertices[target.key]!;
    cx = v.x;
    cy = v.y;
  }
  const w = 2.5;
  const h = 1.28;
  // 气泡朝地图中心偏移，避免越出海岸。
  const len = Math.hypot(cx, cy) || 1;
  const bx = cx - (cx / len) * 1.35;
  const by = cy - (cy / len) * 1.35 - h / 2;
  const costText = (Object.keys(target.cost) as ResourceId[])
    .filter((r) => (target.cost[r] ?? 0) > 0)
    .map((r) => `${RESOURCE_NAMES[r]}×${target.cost[r]}`)
    .join("  ");
  return (
    <g className="ct-confirm" transform={`translate(${bx} ${by})`} onPointerDown={(e) => e.stopPropagation()}>
      <line x1={cx - bx} y1={cy - by} x2={w / 2 - (cx - bx) * 0} y2={h} stroke="rgba(240,230,206,0.6)" strokeWidth={0.02} pointerEvents="none" />
      <rect width={w} height={h} rx={0.14} className="ct-confirm-card" />
      <text x={w / 2} y={0.34} textAnchor="middle" className="ct-confirm-title">
        {target.title}
      </text>
      <text x={w / 2} y={0.66} textAnchor="middle" className={`ct-confirm-cost${target.affordable ? "" : " is-poor"}`}>
        {costText}
      </text>
      {!target.affordable ? (
        <text x={w / 2} y={0.66} textAnchor="middle" className="ct-confirm-poor-note" opacity={0}>
          资源不足
        </text>
      ) : null}
      <g className="ct-confirm-btn" onPointerDown={() => onConfirm(true)}>
        <rect x={0.35} y={0.8} width={0.85} height={0.32} rx={0.08} className={target.affordable ? "is-go" : "is-disabled"} />
        <text x={0.775} y={1.02} textAnchor="middle">
          建造
        </text>
      </g>
      <g className="ct-confirm-btn" onPointerDown={() => onConfirm(false)}>
        <rect x={1.3} y={0.8} width={0.85} height={0.32} rx={0.08} className="is-no" />
        <text x={1.725} y={1.02} textAnchor="middle">
          取消
        </text>
      </g>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* 罗盘装饰                                                            */
/* ------------------------------------------------------------------ */

function CompassRose({ x, y }: { x: number; y: number }): ReactElement {
  return (
    <g transform={`translate(${x} ${y})`} className="ct-compass" pointerEvents="none">
      <circle r={0.62} fill="none" stroke="rgba(226,236,232,0.28)" strokeWidth={0.035} />
      <circle r={0.5} fill="none" stroke="rgba(226,236,232,0.16)" strokeWidth={0.02} />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (Math.PI / 4) * i - Math.PI / 2;
        const long = i % 2 === 0;
        const r1 = long ? 0.56 : 0.34;
        const x1 = Math.cos(a) * r1;
        const y1 = Math.sin(a) * r1;
        return <line key={i} x1={0} y1={0} x2={x1} y2={y1} stroke="rgba(226,236,232,0.35)" strokeWidth={long ? 0.028 : 0.02} />;
      })}
      <path d="M0 -0.56 L0.09 0 L0 -0.12 L-0.09 0 Z" fill="rgba(233,215,160,0.75)" />
      <circle r={0.05} fill="rgba(233,215,160,0.8)" />
    </g>
  );
}

/** 计算人类玩家拥有的港口（用于高亮与交易率提示）。 */
export function ownedHarbors(game: CatanGame, player: number): Set<number> {
  const out = new Set<number>();
  for (const b of game.buildings) {
    if (b.owner !== player) continue;
    const harborId = game.vertices[b.vertex]!.harbor;
    if (harborId != null) out.add(harborId);
  }
  return out;
}

/** 地块资源名（提示条用）。 */
export function tileLabel(game: CatanGame, tileId: number): string {
  const t = game.tiles.find((x) => x.id === tileId)!;
  const res = TERRAIN_RESOURCE[t.terrain];
  return res ? RESOURCE_NAMES[res] : "沙漠";
}
