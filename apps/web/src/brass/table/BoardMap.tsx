import type { BrassState, IndustryType } from "@coup/brass-domain";
import { LINKS, linkEndpoints, LOCATIONS, MERCHANTS } from "@coup/brass-domain";
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

function slotIndustries(slot: { industries: IndustryType[] }): IndustryType[] {
  return slot.industries;
}

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

  return (
    <svg
      className="brass-board"
      viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="伯明翰版图"
    >
      <defs>
        <pattern id="parchment" width="80" height="80" patternUnits="userSpaceOnUse">
          <rect width="80" height="80" fill="#efe6d2" />
          <circle cx="20" cy="24" r="1" fill="#e2d5ba" />
          <circle cx="60" cy="60" r="1.2" fill="#e2d5ba" />
          <circle cx="44" cy="12" r="0.8" fill="#e2d5ba" />
        </pattern>
      </defs>
      <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="url(#parchment)" rx="18" />

      {/* 连线 */}
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
        return (
          <g
            key={def.id}
            data-link={index}
            role={clickable ? "button" : undefined}
            aria-label={clickable ? `铺线 ${def.id}` : undefined}
            onClick={clickable ? () => onLinkClick?.(index) : undefined}
            className={clickable ? "brass-link clickable" : "brass-link"}
          >
            {/* 运河：实线暖蓝 */}
            {def.canal ? (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#5a7d8c" strokeWidth={highlighted ? 9 : 5} strokeLinecap="round" opacity={0.55} />
            ) : null}
            {/* 铁路：深褐虚线 */}
            {def.rail ? (
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#4a3b2c"
                strokeWidth={highlighted ? 5 : 3}
                strokeDasharray="10 7"
                strokeLinecap="round"
                opacity={0.6}
              />
            ) : null}
            {highlighted && !occupied.length ? (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#d9b64a" strokeWidth={12} strokeLinecap="round" opacity={0.28} />
            ) : null}
            {selected ? (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#a63d2f" strokeWidth={10} strokeLinecap="round" opacity={0.5} />
            ) : null}
            {/* 已放置的 Link 板块 */}
            {occupied.map((link) => (
              <g key={link.id} transform={`translate(${mid.x},${mid.y}) rotate(${(Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI})`}>
                <rect x={-14} y={-7} width={28} height={14} rx={3} fill={playerColor(link.player)} stroke="#3a3128" strokeWidth={1.5} />
                <rect x={-10} y={-4} width={20} height={8} rx={2} fill="none" stroke="#ffffff" strokeOpacity={0.35} strokeWidth={1} />
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
        const w = farm ? 46 : def.slots.length >= 4 ? 128 : def.slots.length >= 3 ? 104 : 88;
        const h = farm ? 34 : 56;
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
            {highlighted ? <rect x={-w / 2 - 6} y={-h / 2 - 6} width={w + 12} height={h + 12} rx={12} fill="#d9b64a" opacity={0.3} /> : null}
            {selected ? <rect x={-w / 2 - 6} y={-h / 2 - 6} width={w + 12} height={h + 12} rx={12} fill="none" stroke="#a63d2f" strokeWidth={3} /> : null}
            <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={8} fill={farm ? "#e6d9bc" : "#f6efdd"} stroke="#8a795d" strokeWidth={1.6} />
            <rect x={-w / 2} y={-h / 2} width={w} height={16} rx={8} fill="#6b5a41" />
            <text y={farm ? -3 : -16} textAnchor="middle" fontSize={farm ? 8.5 : 11} fill="#f3ead6" fontWeight={700}>
              {locationLabel(id)}
            </text>
            {/* 槽位 */}
            {!farm
              ? def.slots.map((slot, slotIndex) => {
                  const tile = tileAt(id, slotIndex);
                  const slotW = 18;
                  const gap = 6;
                  const total = def.slots.length * slotW + (def.slots.length - 1) * gap;
                  const x = -total / 2 + slotIndex * (slotW + gap);
                  return (
                    <g key={slotIndex} transform={`translate(${x + slotW / 2}, ${h / 2 - 16})`}>
                      <rect x={-slotW / 2} y={-11} width={slotW} height={22} rx={4} fill="#e9dfc6" stroke="#a4936f" strokeWidth={1} />
                      {slotIndustries(slot).map((ind, i, arr) => {
                        const offset = (i - (arr.length - 1) / 2) * 7;
                        return (
                          <circle key={ind} cx={offset} cy={i === (arr.length - 1) / 2 && arr.length === 1 ? 0 : 0} r={i === (arr.length - 1) / 2 && arr.length === 1 ? 6 : 4.5} fill={INDUSTRY_COLOR[ind]} opacity={0.85} />
                        );
                      })}
                      {tile ? (
                        <g>
                          <rect x={-slotW / 2} y={-11} width={slotW} height={22} rx={4} fill={playerColor(tile.player)} stroke="#3a3128" strokeWidth={1.5} />
                          <text y={tile.flipped ? 5 : 4} textAnchor="middle" fontSize={9} fontWeight={800} fill="#fff7e6">
                            {tile.flipped ? `★${roman(tile.level)}` : roman(tile.level)}
                          </text>
                          {tile.coal > 0 ? <circle cx={-slotW / 2 + 3} cy={-13} r={3} fill="#2f2c28" stroke="#efe6d2" strokeWidth={0.8} /> : null}
                          {tile.iron > 0 ? <circle cx={-slotW / 2 + 3} cy={-13} r={3} fill="#b05f2c" stroke="#efe6d2" strokeWidth={0.8} /> : null}
                          {tile.beer > 0 ? <circle cx={-slotW / 2 + 3} cy={-13} r={3} fill="#d08a2e" stroke="#efe6d2" strokeWidth={0.8} /> : null}
                        </g>
                      ) : null}
                    </g>
                  );
                })
              : (() => {
                  const tile = tileAt(id, 0);
                  return tile ? (
                    <g transform={`translate(0, 6)`}>
                      <rect x={-14} y={-8} width={28} height={16} rx={4} fill={playerColor(tile.player)} stroke="#3a3128" strokeWidth={1.5} />
                      <text y={4} textAnchor="middle" fontSize={9} fontWeight={800} fill="#fff7e6">
                        {tile.flipped ? `★${roman(tile.level)}` : roman(tile.level)}
                      </text>
                      {tile.beer > 0 ? <circle cx={-10} cy={-10} r={3} fill="#d08a2e" stroke="#efe6d2" strokeWidth={0.8} /> : null}
                    </g>
                  ) : null;
                })()}
          </g>
        );
      })}

      {/* 商人位 */}
      {Object.entries(MERCHANTS).map(([id, def]) => {
        const pos = NODE_POS[id];
        if (!pos) return null;
        const slots = Array.from({ length: def.slots }, (_, i) => `${id}#${i + 1}`);
        return (
          <g key={id} transform={`translate(${pos.x},${pos.y})`}>
            <circle r={20} fill="#5d6b52" stroke="#3d4a37" strokeWidth={2} />
            <text y={-2} textAnchor="middle" fontSize={10} fontWeight={800} fill="#f3ead6">
              {locationLabel(id)}
            </text>
            <text y={10} textAnchor="middle" fontSize={9} fill="#d9cfa8">
              {merchantBonusLabel(id)}
            </text>
            {slots.map((slotId, i) => {
              const tile = merchantTileAt(slotId);
              return (
                <g key={slotId} transform={`translate(${(i - (slots.length - 1) / 2) * 24}, 34)`}>
                  <rect x={-10} y={-9} width={20} height={18} rx={4} fill="#e9dfc6" stroke="#6b5a41" strokeWidth={1.2} />
                  {tile ? (
                    tile.blank ? (
                      <text y={4} textAnchor="middle" fontSize={11} fill="#8a795d">
                        ✕
                      </text>
                    ) : (
                      <>
                        {tile.goods.map((g, gi, arr) => (
                          <circle key={g} cx={(gi - (arr.length - 1) / 2) * 8} cy={0} r={3.4} fill={INDUSTRY_COLOR[g as IndustryType]} />
                        ))}
                        {tile.beer ? <circle cx={8} cy={-8} r={3} fill="#d08a2e" stroke="#efe6d2" strokeWidth={0.8} /> : null}
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

export { linkEndpoints };
