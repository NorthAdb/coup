import { useEffect, useRef } from "react";
import type { BrassState, IndustryType } from "@coup/brass-domain";
import { LINKS, linkEndpoints, LOCATIONS, MERCHANTS, TILE_SPECS, merchantSlotsFor, tileSpec } from "@coup/brass-domain";
import { BOARD_HEIGHT, BOARD_WIDTH, FARM_NODES, MERCHANT_NODES, NODE_POS } from "./brassMap.js";
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

  // 与上一 stateVersion 比对：新瓦片弹入、翻面闪烁。
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
        <filter id="b-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
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

      {/* 版图底：羊皮纸 + 纸纹 + 暗角 + 双框 */}
      <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} rx={20} fill="url(#b-parchment)" />
      <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} rx={20} filter="url(#b-grain)" opacity={0.28} />
      <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} rx={20} fill="url(#b-vignette)" pointerEvents="none" />
      <rect x={7} y={7} width={BOARD_WIDTH - 14} height={BOARD_HEIGHT - 14} rx={15} fill="none" stroke="#3f3423" strokeWidth={2.5} opacity={0.75} />
      <rect x={13} y={13} width={BOARD_WIDTH - 26} height={BOARD_HEIGHT - 26} rx={11} fill="none" stroke="#a8863c" strokeWidth={1.2} opacity={0.6} />

      {/* 连线（运河水系 + 铁路枕木） */}
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
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#5c7f90" strokeWidth={11} strokeLinecap="round" opacity={0.28} />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#7fa2b2" strokeWidth={5} strokeLinecap="round" opacity={0.85} />
              </>
            ) : null}
            {def.rail ? (
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#43351f"
                strokeWidth={3.4}
                strokeDasharray="11 7"
                strokeLinecap="round"
                opacity={0.8}
              />
            ) : null}
            {highlighted && !occupied.length ? (
              <line className="b-ants" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#e8b83c" strokeWidth={8.5} strokeLinecap="round" strokeDasharray="13 9" opacity={0.95} />
            ) : null}
            {selected ? (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#a63d2f" strokeWidth={9} strokeLinecap="round" opacity={0.55} />
            ) : null}
            {clickable ? (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={18} strokeLinecap="round" />
            ) : null}
            {/* 已放置的 Link 板块 */}
            {occupied.map((link) => (
              <g key={link.id} transform={`translate(${mid.x},${mid.y}) rotate(${angle})`}>
                <g className={`b-anim ${newLinkIds.has(link.id) ? "b-pop" : ""}`}>
                  <rect x={-23} y={-9} width={46} height={18} rx={4.5} fill={playerColor(link.player)} stroke="#241f16" strokeWidth={1.6} />
                  <rect x={-19} y={-6} width={38} height={6} rx={3} fill="#ffffff" opacity={0.22} />
                  <circle cx={0} cy={2.5} r={2.4} fill="#e8c96a" stroke="#241f16" strokeWidth={0.7} />
                </g>
              </g>
            ))}
          </g>
        );
      })}

      {/* 建造地点 */}
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
        const h = farm ? 40 : 70;
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
            {/* 石板地块 */}
            <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={9} fill="url(#b-plot-face)" stroke="#221c13" strokeWidth={1.8} />
            <rect x={-w / 2 + 2.5} y={-h / 2 + 2.5} width={w - 5} height={10} rx={6} fill="#ffffff" opacity={0.07} />
            <text
              y={farm ? -h / 2 + 15 : -h / 2 + 16}
              textAnchor="middle"
              fontSize={farm ? 10 : id === "stoke-on-trent" || id === "burton-on-trent" || id === "wolverhampton" || id === "coalbrookdale" || id === "kidderminster" ? 10.5 : 12}
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
                    <g key={slotIndex} transform={`translate(${x}, -6)`}>
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
                    <g transform="translate(-13, -10)">
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
                            x={5 + gi * 7}
                            y={h / 2 - 3.5}
                            width={5.5}
                            height={7}
                            rx={1.5}
                            fill={INDUSTRY_COLOR[g as IndustryType]}
                            stroke="#191510"
                            strokeWidth={0.6}
                          />
                        ))}
                        {tile.beer ? <circle cx={w - 6} cy={5.5} r={3.4} fill="#d08a2e" stroke="#efe6d2" strokeWidth={0.9} /> : null}
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

/** 产业瓦片：未翻面 = 产业色块 + 等级；翻面 = 褐背 + VP + 连线点。 */
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
            <text x={5} y={12} fontSize={9} fontWeight={800} fill={face.ink} opacity={0.85}>
              {INDUSTRY_SHORT[tile.industry]}
            </text>
            <text x={s / 2} y={s / 2 + 6.5} textAnchor="middle" fontSize={s * 0.42} fontWeight={800} fill={face.ink}>
              {roman(tile.level)}
            </text>
            {tile.coal + tile.iron + tile.beer > 0 ? (
              <g transform={`translate(${s / 2 - ((tile.coal + tile.iron + tile.beer) * 6 - 3) / 2}, ${s - 5})`}>
                {Array.from({ length: tile.coal }, (_, i) => (
                  <circle key={`c${i}`} cx={i * 6} cy={0} r={2.3} fill="#191713" stroke="#efe6d2" strokeWidth={0.6} />
                ))}
                {Array.from({ length: tile.iron }, (_, i) => (
                  <circle key={`i${i}`} cx={(tile.coal + i) * 6} cy={0} r={2.3} fill="#c56a32" stroke="#efe6d2" strokeWidth={0.6} />
                ))}
                {Array.from({ length: tile.beer }, (_, i) => (
                  <circle key={`b${i}`} cx={(tile.coal + tile.iron + i) * 6} cy={0} r={2.3} fill="#d08a2e" stroke="#efe6d2" strokeWidth={0.6} />
                ))}
              </g>
            ) : null}
          </>
        )}
      </g>
    </g>
  );
}

export { linkEndpoints };
