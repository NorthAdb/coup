import type { DevCard, GemColor, GemCount, Noble } from "@coup/splendor-domain";
import { GEM_NAMES, nobleName } from "../labels.js";

/**
 * 璀璨宝石设计系统组件：宝石筹码 / 发展卡 / 贵族牌。
 * 视觉目标——高级实体桌游的数字化：切面宝石、厚纸卡牌、金框贵族像。
 */

export function GemChip({
  color,
  size = "md",
  count,
  selected,
  dimmed,
  onClick,
  title,
}: {
  color: GemColor | "gold";
  size?: "xs" | "sm" | "md" | "lg";
  count?: number;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const cls = [
    "spl-gem",
    `spl-gem--${color}`,
    `spl-gem--${size}`,
    selected ? "is-selected" : "",
    dimmed ? "is-dimmed" : "",
    onClick ? "is-clickable" : "",
  ].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={!onClick}
      title={title ?? GEM_NAMES[color as GemColor] ?? (color === "gold" ? "黄金" : "")}
    >
      <span className="spl-gem-facet" aria-hidden="true" />
      <span className="spl-gem-shine" aria-hidden="true" />
      {count != null && count > 1 ? <span className="spl-gem-count">{count}</span> : null}
    </button>
  );
}

export function GemCostRow({ cost, shortfall }: { cost: GemCount; shortfall?: GemCount }) {
  const entries = (Object.entries(cost) as Array<[GemColor, number]>).filter(([, n]) => n > 0);
  return (
    <span className="spl-cost-row">
      {entries.map(([color, n]) => (
        <i
          key={color}
          className={`spl-cost-chip${shortfall && shortfall[color] > 0 ? " is-short" : ""}`}
          data-color={color}
        >
          {n}
        </i>
      ))}
    </span>
  );
}

/** 发展卡：等级越高越华丽（L3 金底重框）。 */
export function DevCardFace({
  card,
  shortfall,
  size = "md",
}: {
  card: Pick<DevCard, "id" | "level" | "color" | "points" | "cost">;
  shortfall?: GemCount | null;
  size?: "sm" | "md";
}) {
  return (
    <div className={`spl-card spl-card--l${card.level} spl-card--${size} spl-card--${card.color}`}>
      <span className="spl-card-sheen" aria-hidden="true" />
      <div className="spl-card-top">
        {card.points > 0 ? (
          <span className="spl-card-points" key={card.points}>
            <i>{card.points}</i>
          </span>
        ) : (
          <span className="spl-card-points spl-card-points--zero" />
        )}
        <GemChip color={card.color} size="sm" />
      </div>
      <div className="spl-card-figure" aria-hidden="true">
        <span className={`spl-card-motif spl-card-motif--${card.color}`} />
      </div>
      <div className="spl-card-bottom">
        <GemCostRow cost={card.cost} shortfall={shortfall ?? undefined} />
      </div>
    </div>
  );
}

/** 牌库背（层叠暗示剩余厚度）。 */
export function DeckStack({ level, count }: { level: 1 | 2 | 3; count: number }) {
  const layers = Math.min(3, Math.max(1, Math.ceil(count / 8)));
  return (
    <div className={`spl-deck spl-deck--l${level}`} title={`牌库剩余 ${count} 张`}>
      <span className="spl-deck-layers" aria-hidden="true">
        {Array.from({ length: layers }, (_, i) => (
          <i key={i} style={{ transform: `translate(${-i * 2}px, ${i * 2}px)` }} />
        ))}
      </span>
      <b>{count}</b>
    </div>
  );
}

/** 贵族牌：金框肖像 + 造访要求。 */
export function NobleTileFace({ noble, size = "md" }: { noble: Noble; size?: "sm" | "md" }) {
  return (
    <div className={`spl-noble spl-noble--${size}`}>
      <div className="spl-noble-frame">
        <div className="spl-noble-portrait" aria-hidden="true">
          <svg viewBox="0 0 64 72" className="spl-noble-crest">
            <defs>
              <linearGradient id={`noble-g-${noble.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f4e3b2" />
                <stop offset="0.55" stopColor="#caa64f" />
                <stop offset="1" stopColor="#8a6a2a" />
              </linearGradient>
            </defs>
            {/* 王冠 */}
            <path
              d="M18 34 L14 18 L24 26 L32 12 L40 26 L50 18 L46 34 Z"
              fill={`url(#noble-g-${noble.id})`}
              stroke="#6d511d"
              strokeWidth="1.2"
            />
            <rect x="17" y="36" width="30" height="5" rx="1.5" fill={`url(#noble-g-${noble.id})`} stroke="#6d511d" strokeWidth="1" />
            {/* 肖像剪影 */}
            <circle cx="32" cy="52" r="8.5" fill="#4a3820" opacity="0.85" />
            <path d="M18 72 C18 61 25 57 32 57 C39 57 46 61 46 72 Z" fill="#4a3820" opacity="0.85" />
          </svg>
        </div>
        <div className="spl-noble-name">{nobleName(noble.name)}</div>
        <div className="spl-noble-req">
          {(Object.entries(noble.requirements) as Array<[GemColor, number]>)
            .filter(([, n]) => n > 0)
            .map(([color, n]) => (
              <span key={color} className="spl-noble-req-item">
                <GemChip color={color} size="xs" />
                <b>{n}</b>
              </span>
            ))}
        </div>
      </div>
      <span className="spl-noble-points">{noble.points}</span>
    </div>
  );
}

/** 分数徽章（文艺复兴奖章样式）。 */
export function ScoreMedallion({ points, pulseKey }: { points: number; pulseKey?: number | string }) {
  return (
    <span className="spl-medallion" key={pulseKey ?? points}>
      <i>{points}</i>
      <em>分</em>
    </span>
  );
}
