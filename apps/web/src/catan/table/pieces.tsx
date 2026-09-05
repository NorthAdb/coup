import type { ReactElement } from "react";
import { DEV_NAMES, RESOURCE_NAMES, type DevCardKind, type ResourceId, type Terrain } from "../mock/types.ts";

/**
 * 卡坦岛设计系统棋子：地形插画 / 数字 Token / 道路 / 村庄 / 城市 / 强盗 / 港口 /
 * 资源图标 / 资源卡 / 发展卡 / 骰子。
 *
 * SVG 棋子在「布局单位」下绘制（六边形外接圆半径 = 1），由 BoardMap 的 viewBox 缩放；
 * 卡牌与骰子是 HTML 组件，供手牌/交易/行动面板使用。
 * 视觉目标：高级实体桌游的数字化——低饱和自然色、克制的立体感、纸与木的材质。
 */

/** 玩家主题色（低饱和、彼此可区分，同时用于建筑/道路/徽章）。 */
export const PLAYER_COLORS = ["#b3573f", "#3f6d8e", "#5d7048", "#c9973f"] as const;
export const PLAYER_COLOR_NAMES = ["陶红", "黛蓝", "橄榄", "赭金"] as const;

export const RESOURCES: readonly ResourceId[] = ["wood", "brick", "wool", "wheat", "ore"];

/** 地形主色（hi/mid/lo 三段，用于六边形分层上色）。 */
export const TERRAIN_COLORS: Record<Terrain, { hi: string; mid: string; lo: string }> = {
  forest: { hi: "#5b8a4a", mid: "#41693a", lo: "#2c4a29" },
  pasture: { hi: "#a9bd77", mid: "#8ba55f", lo: "#678246" },
  fields: { hi: "#e5c765", mid: "#d0a94a", lo: "#a98432" },
  hills: { hi: "#c07850", mid: "#a55c3a", lo: "#7e4128" },
  mountains: { hi: "#a9a49b", mid: "#8b877e", lo: "#67635c" },
  desert: { hi: "#e8d9a8", mid: "#d8c48d", lo: "#b9a26e" },
};

const RESOURCE_ACCENTS: Record<ResourceId, { hi: string; mid: string; lo: string }> = {
  wood: { hi: "#7fa05a", mid: "#54763c", lo: "#37522a" },
  brick: { hi: "#c98a5e", mid: "#a55c3a", lo: "#7e4128" },
  wool: { hi: "#f2efe4", mid: "#cfc9b4", lo: "#a49d86" },
  wheat: { hi: "#eccf6f", mid: "#d0a94a", lo: "#a37f2c" },
  ore: { hi: "#9aa3ad", mid: "#6f7883", lo: "#4b525c" },
};

/** 小型伪随机源（按 tile id 稳定，避免每次渲染装饰跳动）。 */
function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* 地形插画（在六边形局部坐标系内绘制，中心 (0,0)，内切圆半径 ≈ 0.82）  */
/* ------------------------------------------------------------------ */

export function TerrainArt({ terrain, tileId }: { terrain: Terrain; tileId: number }): ReactElement {
  const rand = seeded(tileId + 7);
  switch (terrain) {
    case "forest": {
      const trees: ReactElement[] = [];
      const spots: Array<[number, number, number]> = [
        [-0.38, 0.16, 1],
        [0.02, -0.26, 0.86],
        [0.4, 0.1, 0.94],
        [0.05, 0.42, 0.78],
        [-0.18, -0.02, 0.7],
      ];
      spots.forEach(([x, y, s], i) => {
        trees.push(
          <g key={i} transform={`translate(${x} ${y}) scale(${s})`} className="ct-tree">
            <path d="M0 -0.34 L0.17 0.02 L-0.17 0.02 Z" fill="#2c4a29" />
            <path d="M0 -0.24 L0.2 0.16 L-0.2 0.16 Z" fill="#355c30" />
            <rect x={-0.045} y={0.16} width={0.09} height={0.16} rx={0.03} fill="#4c3a24" />
            <path d="M0 -0.34 L0.06 -0.2 L-0.04 -0.14 Z" fill="#4e7a42" opacity={0.85} />
          </g>,
        );
      });
      return (
        <g>
          {trees}
          <ellipse cx={-0.3} cy={0.5} rx={0.3} ry={0.1} fill="#2c4a29" opacity={0.5} />
          <ellipse cx={0.35} cy={0.52} rx={0.24} ry={0.08} fill="#2c4a29" opacity={0.4} />
        </g>
      );
    }
    case "pasture": {
      const sheep: ReactElement[] = [];
      const spots: Array<[number, number]> = [
        [-0.34, 0.12],
        [0.12, -0.3],
        [0.34, 0.24],
      ];
      spots.forEach(([x, y], i) => {
        sheep.push(
          <g key={i} transform={`translate(${x} ${y})`}>
            <ellipse cx={0} cy={0} rx={0.16} ry={0.115} fill="#f4f1e4" stroke="#8d886f" strokeWidth={0.02} />
            <circle cx={0.13} cy={-0.05} r={0.055} fill="#3d3a30" />
            <rect x={-0.09} y={0.09} width={0.025} height={0.09} fill="#8d886f" />
            <rect x={0.06} y={0.09} width={0.025} height={0.09} fill="#8d886f" />
          </g>,
        );
      });
      return (
        <g>
          <path
            d="M-0.7 0.28 Q-0.3 0.12 0.05 0.3 T0.75 0.22"
            fill="none"
            stroke="#74894e"
            strokeWidth={0.1}
            opacity={0.55}
            strokeLinecap="round"
          />
          <path
            d="M-0.72 0.48 Q-0.25 0.34 0.2 0.5 T0.78 0.42"
            fill="none"
            stroke="#677a45"
            strokeWidth={0.1}
            opacity={0.45}
            strokeLinecap="round"
          />
          {sheep}
          <ellipse cx={-0.4} cy={-0.42} rx={0.16} ry={0.07} fill="#678246" opacity={0.5} />
        </g>
      );
    }
    case "fields": {
      const sheaves: ReactElement[] = [];
      const spots: Array<[number, number]> = [
        [-0.36, 0.06],
        [0.1, -0.34],
        [0.38, 0.2],
        [-0.06, 0.36],
      ];
      spots.forEach(([x, y], i) => {
        sheaves.push(
          <g key={i} transform={`translate(${x} ${y})`}>
            <path d="M-0.09 0.14 L0 -0.24 L0.09 0.14 Z" fill="#b98f34" />
            <path d="M-0.09 0.14 L0 -0.24 L0 0.14 Z" fill="#a37f2c" />
            <g stroke="#e8cd7a" strokeWidth={0.024} strokeLinecap="round">
              <line x1={0} y1={-0.24} x2={-0.09} y2={-0.4} />
              <line x1={0} y1={-0.24} x2={0} y2={-0.44} />
              <line x1={0} y1={-0.24} x2={0.09} y2={-0.4} />
            </g>
          </g>,
        );
      });
      return (
        <g>
          {sheaves}
          <g stroke="#c39a3c" strokeWidth={0.035} opacity={0.6}>
            <line x1={-0.62} y1={-0.2} x2={0.62} y2={-0.28} />
            <line x1={-0.64} y1={0} x2={0.64} y2={-0.06} />
            <line x1={-0.62} y1={0.2} x2={0.62} y2={0.16} />
          </g>
        </g>
      );
    }
    case "mountains": {
      return (
        <g>
          <path d="M-0.52 0.34 L-0.16 -0.36 L0.2 0.34 Z" fill="#6f6b62" />
          <path d="M-0.16 -0.36 L0.2 0.34 L0.02 0.34 Z" fill="#57544d" />
          <path d="M-0.16 -0.36 L-0.28 -0.14 L-0.19 -0.16 L-0.1 -0.28 Z" fill="#eceadf" />
          <path d="M0.06 0.34 L0.34 -0.14 L0.62 0.34 Z" fill="#8b877e" />
          <path d="M0.34 -0.14 L0.62 0.34 L0.44 0.34 Z" fill="#67635c" />
          <path d="M0.34 -0.14 L0.26 0 L0.34 -0.04 L0.42 0 L0.34 -0.14 Z" fill="#eceadf" />
          <path d="M-0.66 0.36 L-0.46 0 L-0.26 0.36 Z" fill="#7a766d" />
          <ellipse cx={0} cy={0.44} rx={0.62} ry={0.1} fill="#57544d" opacity={0.55} />
        </g>
      );
    }
    case "hills": {
      const bricks: ReactElement[] = [];
      const rows = 3;
      for (let row = 0; row < rows; row++) {
        const n = row === 0 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const x = -0.28 + i * 0.3 + (row === 0 ? 0 : 0.15);
          const y = 0.32 - row * 0.17;
          bricks.push(
            <rect
              key={`${row}-${i}`}
              x={x}
              y={y}
              width={0.26}
              height={0.13}
              rx={0.02}
              fill={row % 2 === 0 ? "#a55c3a" : "#96512f"}
              stroke="#6e3a20"
              strokeWidth={0.018}
            />,
          );
        }
      }
      return (
        <g>
          <path d="M-0.6 -0.1 Q-0.3 -0.34 0 -0.1 T0.6 -0.1" fill="#b06540" opacity={0.5} />
          <path d="M-0.5 0.1 Q-0.2 -0.12 0.1 0.1 T0.66 0.06" fill="#a55c3a" opacity={0.4} />
          <ellipse cx={-0.34} cy={-0.34} rx={0.2} ry={0.1} fill="#8a4c2c" opacity={0.7} />
          <rect x={-0.44} y={-0.44} width={0.2} height={0.12} rx={0.02} fill="#7e4128" />
          {bricks}
        </g>
      );
    }
    case "desert":
    default: {
      const randDune = seeded(tileId + 13);
      const pebbles: ReactElement[] = [];
      for (let i = 0; i < 5; i++) {
        pebbles.push(
          <ellipse
            key={i}
            cx={(randDune() - 0.5) * 1.1}
            cy={(randDune() - 0.5) * 0.9}
            rx={0.035 + randDune() * 0.03}
            ry={0.022}
            fill="#b9a26e"
          />,
        );
      }
      return (
        <g>
          <path
            d="M-0.72 0.05 Q-0.36 -0.16 0 0.02 T0.72 -0.02"
            fill="none"
            stroke="#c4ad78"
            strokeWidth={0.09}
            strokeLinecap="round"
            opacity={0.85}
          />
          <path
            d="M-0.7 0.36 Q-0.3 0.18 0.1 0.34 T0.74 0.26"
            fill="none"
            stroke="#b9a26e"
            strokeWidth={0.09}
            strokeLinecap="round"
            opacity={0.9}
          />
          <path
            d="M-0.66 -0.32 Q-0.3 -0.46 0.06 -0.32 T0.7 -0.36"
            fill="none"
            stroke="#cbb684"
            strokeWidth={0.08}
            strokeLinecap="round"
            opacity={0.8}
          />
          {pebbles}
        </g>
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* 数字 Token                                                          */
/* ------------------------------------------------------------------ */

/** token 上的概率点数（与实体版一致）。 */
export function tokenPips(value: number): number {
  if (value === 6 || value === 8) return 5;
  if (value === 5 || value === 9) return 4;
  if (value === 4 || value === 10) return 3;
  if (value === 3 || value === 11) return 2;
  return 1;
}

export function NumberToken({ value, hot }: { value: number; hot?: boolean }): ReactElement {
  const pips = tokenPips(value);
  const red = value === 6 || value === 8;
  return (
    <g className={`ct-token${hot ? " is-hot" : ""}`}>
      <circle r={0.5} cx={0.02} cy={0.035} fill="rgba(20,14,6,0.35)" />
      <circle r={0.5} fill="url(#ct-token-wood)" stroke="#5e4426" strokeWidth={0.035} />
      <circle r={0.4} fill="#efe4c8" stroke="#c8b48b" strokeWidth={0.02} />
      {Array.from({ length: pips }, (_, i) => {
        const total = pips;
        const angle = (Math.PI * 2 * i) / total - Math.PI / 2;
        const x = Math.cos(angle) * 0.335;
        const y = Math.sin(angle) * 0.335;
        return <circle key={i} cx={x} cy={y} r={0.026} fill={red ? "#a34432" : "#6b5636"} />;
      })}
      <text y={0.115} className={`ct-token-num${red ? " is-red" : ""}`}>
        {value}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* 道路 / 村庄 / 城市 / 强盗                                            */
/* ------------------------------------------------------------------ */

export function RoadPiece({
  x,
  y,
  angle,
  color,
  ghost,
  fresh,
}: {
  x: number;
  y: number;
  angle: number;
  color: string;
  ghost?: boolean;
  fresh?: boolean;
}): ReactElement {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <g className={`ct-road${ghost ? " is-ghost" : ""}${fresh ? " is-fresh" : ""}`}>
        <rect x={-0.4} y={-0.02} width={0.8} height={0.15} rx={0.05} fill="rgba(18,12,5,0.4)" />
        <rect x={-0.4} y={-0.12} width={0.8} height={0.2} rx={0.055} fill={color} stroke="rgba(24,14,6,0.75)" strokeWidth={0.028} />
        <rect x={-0.34} y={-0.085} width={0.29} height={0.13} rx={0.03} fill="rgba(255,244,220,0.28)" />
        <rect x={0.02} y={-0.085} width={0.29} height={0.13} rx={0.03} fill="rgba(255,244,220,0.2)" />
        <rect x={-0.4} y={0.035} width={0.8} height={0.05} rx={0.025} fill="rgba(24,14,6,0.32)" />
      </g>
    </g>
  );
}

export function SettlementPiece({
  x,
  y,
  color,
  ghost,
  fresh,
}: {
  x: number;
  y: number;
  color: string;
  ghost?: boolean;
  fresh?: boolean;
}): ReactElement {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={`ct-piece ct-settlement${ghost ? " is-ghost" : ""}${fresh ? " is-fresh" : ""}`}>
        <ellipse cx={0.02} cy={0.2} rx={0.26} ry={0.09} fill="rgba(18,12,5,0.4)" />
        <rect x={-0.17} y={-0.08} width={0.34} height={0.28} rx={0.03} fill={color} stroke="rgba(24,14,6,0.8)" strokeWidth={0.03} />
        <rect x={-0.17} y={0.08} width={0.34} height={0.12} rx={0.03} fill="rgba(24,14,6,0.28)" />
        <path d="M-0.24 -0.08 L0 -0.34 L0.24 -0.08 Z" fill={color} stroke="rgba(24,14,6,0.8)" strokeWidth={0.03} />
        <path d="M0 -0.34 L0.24 -0.08 L0.06 -0.08 Z" fill="rgba(24,14,6,0.28)" />
        <path d="M-0.24 -0.08 L0 -0.34 L-0.06 -0.16 Z" fill="rgba(255,244,220,0.3)" />
        <rect x={-0.055} y={0.02} width={0.11} height={0.18} rx={0.02} fill="#f0e6cf" opacity={0.92} />
      </g>
    </g>
  );
}

export function CityPiece({
  x,
  y,
  color,
  ghost,
  fresh,
}: {
  x: number;
  y: number;
  color: string;
  ghost?: boolean;
  fresh?: boolean;
}): ReactElement {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={`ct-piece ct-city${ghost ? " is-ghost" : ""}${fresh ? " is-fresh" : ""}`}>
        <ellipse cx={0.03} cy={0.26} rx={0.36} ry={0.11} fill="rgba(18,12,5,0.42)" />
        <rect x={-0.3} y={-0.14} width={0.4} height={0.4} rx={0.035} fill={color} stroke="rgba(24,14,6,0.8)" strokeWidth={0.032} />
        <rect x={-0.3} y={0.1} width={0.4} height={0.16} rx={0.03} fill="rgba(24,14,6,0.3)" />
        <path d="M-0.38 -0.14 L-0.1 -0.42 L0.18 -0.14 Z" fill={color} stroke="rgba(24,14,6,0.8)" strokeWidth={0.032} />
        <path d="M-0.1 -0.42 L0.18 -0.14 L0.02 -0.14 Z" fill="rgba(24,14,6,0.28)" />
        <rect x={0.12} y={-0.3} width={0.22} height={0.56} rx={0.03} fill={color} stroke="rgba(24,14,6,0.8)" strokeWidth={0.032} />
        <rect x={0.12} y={-0.05} width={0.22} height={0.31} rx={0.03} fill="rgba(24,14,6,0.3)" />
        <path d="M0.06 -0.3 L0.23 -0.47 L0.4 -0.3 Z" fill={color} stroke="rgba(24,14,6,0.8)" strokeWidth={0.032} />
        <rect x={-0.06} y={0.12} width={0.12} height={0.14} rx={0.02} fill="#f0e6cf" opacity={0.9} />
        <rect x={0.19} y={-0.22} width={0.08} height={0.1} rx={0.02} fill="#f0e6cf" opacity={0.85} />
      </g>
    </g>
  );
}

export function RobberPiece({ x, y }: { x: number; y: number }): ReactElement {
  return (
    <g transform={`translate(${x} ${y})`} className="ct-robber">
      <ellipse cx={0} cy={0.3} rx={0.22} ry={0.08} fill="rgba(10,8,4,0.5)" />
      <path d="M-0.14 0.26 C-0.16 0.02 -0.1 -0.06 -0.06 -0.14 L0.06 -0.14 C0.1 -0.06 0.16 0.02 0.14 0.26 Z" fill="#2e2a26" stroke="#15120e" strokeWidth={0.024} />
      <circle cx={0} cy={-0.22} r={0.1} fill="#2e2a26" stroke="#15120e" strokeWidth={0.024} />
      <path d="M-0.06 -0.34 C-0.02 -0.4 0.02 -0.4 0.06 -0.34" fill="none" stroke="#8a8378" strokeWidth={0.03} strokeLinecap="round" />
      <path d="M-0.1 -0.1 C0.02 -0.04 0.02 -0.04 0.1 -0.1" fill="none" stroke="#8a8378" strokeWidth={0.026} opacity={0.8} />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* 港口                                                                */
/* ------------------------------------------------------------------ */

export function HarborScene({
  x,
  y,
  angle,
  kind,
  active,
}: {
  x: number;
  y: number;
  angle: number;
  kind: ResourceId | "any";
  active?: boolean;
}): ReactElement {
  const label = kind === "any" ? "3:1" : "2:1";
  const accent = kind === "any" ? "#c9a35c" : RESOURCE_ACCENTS[kind].mid;
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`} className={`ct-harbor${active ? " is-active" : ""}`}>
      {/* 码头栈桥：指向陆地的一侧 */}
      <rect x={-0.5} y={-0.1} width={0.5} height={0.2} rx={0.04} fill="#7c5a34" stroke="#4c3a20" strokeWidth={0.024} />
      <g stroke="#4c3a20" strokeWidth={0.02}>
        <line x1={-0.44} y1={-0.1} x2={-0.44} y2={0.1} />
        <line x1={-0.3} y1={-0.1} x2={-0.3} y2={0.1} />
        <line x1={-0.16} y1={-0.1} x2={-0.16} y2={0.1} />
      </g>
      {/* 帆船 */}
      <g transform="translate(0.1 0.02)">
        <path d="M-0.16 0.1 Q0 0.2 0.16 0.1 L0.1 0.04 L-0.1 0.04 Z" fill="#6e4f2c" stroke="#402e18" strokeWidth={0.02} />
        <line x1={0} y1={0.06} x2={0} y2={-0.3} stroke="#402e18" strokeWidth={0.026} />
        <path d="M0 -0.3 L0.17 -0.04 L0 -0.04 Z" fill="#efe6cc" stroke="#b3a888" strokeWidth={0.018} />
        <path d="M0 -0.26 L-0.12 -0.06 L0 -0.06 Z" fill="#e2d6b8" stroke="#b3a888" strokeWidth={0.016} />
      </g>
      {/* 比率圆牌 */}
      <g transform="translate(-0.22 -0.22)">
        <circle r={0.24} cx={0.02} cy={0.03} fill="rgba(16,10,4,0.35)" />
        <circle r={0.24} fill="#f2e8d0" stroke={accent} strokeWidth={0.05} />
        {kind !== "any" ? (
          <g transform="translate(0 -0.07) scale(0.34)">
            {resourceGlyph(kind)}
          </g>
        ) : (
          <text y={0.02} className="ct-harbor-any" textAnchor="middle">
            任意
          </text>
        )}
        <text y={0.16} className="ct-harbor-ratio" textAnchor="middle">
          {label}
        </text>
      </g>
    </g>
  );
}

/** 资源小图形（SVG 局部坐标系内使用；约 1×1 大小，随外层缩放）。 */
export function resourceGlyph(res: ResourceId): ReactElement {
  switch (res) {
    case "wood":
      return (
        <g>
          <rect x={-0.42} y={-0.1} width={0.84} height={0.24} rx={0.1} fill="#8a6437" stroke="#4c3a20" strokeWidth={0.06} />
          <rect x={-0.42} y={-0.34} width={0.84} height={0.24} rx={0.1} fill="#9a7442" stroke="#4c3a20" strokeWidth={0.06} />
          <circle cx={0.3} cy={-0.22} r={0.09} fill="#d9c39a" />
          <circle cx={0.3} cy={0.02} r={0.09} fill="#d9c39a" />
        </g>
      );
    case "brick":
      return (
        <g fill="#a55c3a" stroke="#5e3018" strokeWidth={0.055}>
          <rect x={-0.44} y={-0.06} width={0.4} height={0.22} rx={0.03} />
          <rect x={0.04} y={-0.06} width={0.4} height={0.22} rx={0.03} />
          <rect x={-0.24} y={-0.32} width={0.4} height={0.22} rx={0.03} />
          <rect x={-0.44} y={0.2} width={0.4} height={0.22} rx={0.03} />
          <rect x={0.04} y={0.2} width={0.4} height={0.22} rx={0.03} />
        </g>
      );
    case "wool":
      return (
        <g>
          <ellipse cx={0} cy={0.05} rx={0.42} ry={0.3} fill="#f2efe4" stroke="#9a937c" strokeWidth={0.055} />
          <circle cx={0.3} cy={-0.14} r={0.14} fill="#423e33" />
          <line x1={-0.18} y1={0.32} x2={-0.18} y2={0.46} stroke="#9a937c" strokeWidth={0.05} />
          <line x1={0.14} y1={0.32} x2={0.14} y2={0.46} stroke="#9a937c" strokeWidth={0.05} />
        </g>
      );
    case "wheat":
      return (
        <g stroke="#b98d2e" strokeWidth={0.06} strokeLinecap="round">
          <line x1={0} y1={0.45} x2={0} y2={-0.2} />
          <g fill="#e3bd55" stroke="#a37f2c" strokeWidth={0.04}>
            <ellipse cx={-0.14} cy={-0.16} rx={0.1} ry={0.2} transform="rotate(-28 -0.14 -0.16)" />
            <ellipse cx={0.14} cy={-0.16} rx={0.1} ry={0.2} transform="rotate(28 0.14 -0.16)" />
            <ellipse cx={0} cy={-0.3} rx={0.1} ry={0.2} />
          </g>
        </g>
      );
    case "ore":
    default:
      return (
        <g>
          <path d="M0 -0.42 L0.4 -0.1 L0.26 0.36 L-0.26 0.36 L-0.4 -0.1 Z" fill="#6f7883" stroke="#3c424a" strokeWidth={0.055} />
          <path d="M0 -0.42 L0.4 -0.1 L0.05 -0.05 Z" fill="#9aa3ad" />
          <path d="M-0.4 -0.1 L-0.26 0.36 L0.05 -0.05 Z" fill="#575f69" />
        </g>
      );
  }
}

/* ------------------------------------------------------------------ */
/* HTML：资源图标 / 卡牌 / 骰子                                         */
/* ------------------------------------------------------------------ */

export function ResourceIcon({ res, size = "md" }: { res: ResourceId; size?: "sm" | "md" | "lg" }): ReactElement {
  return (
    <span className={`ct-ricon ct-ricon--${res} ct-ricon--${size}`} role="img" aria-label={RESOURCE_NAMES[res]}>
      <svg viewBox="-0.55 -0.55 1.1 1.1" aria-hidden="true">
        {resourceGlyph(res)}
      </svg>
    </span>
  );
}

export function ResourceCostList({ cost }: { cost: Partial<Record<ResourceId, number>> }): ReactElement {
  const entries = RESOURCES.filter((r) => (cost[r] ?? 0) > 0);
  return (
    <span className="ct-costlist">
      {entries.map((r) => (
        <span key={r} className="ct-cost">
          <ResourceIcon res={r} size="sm" />×{cost[r]}
        </span>
      ))}
    </span>
  );
}

/** 手牌资源卡：纸面 + 顶部插画 + 资源名。 */
export function ResourceCardFace({ res, count }: { res: ResourceId; count: number }): ReactElement {
  return (
    <div className={`ct-card ct-card--${res}`}>
      <span className="ct-card-art">
        <svg viewBox="-0.6 -0.6 1.2 1.2" aria-hidden="true">
          {resourceGlyph(res)}
        </svg>
      </span>
      <span className="ct-card-name">{RESOURCE_NAMES[res]}</span>
      {count > 1 ? <span className="ct-card-count">×{count}</span> : null}
    </div>
  );
}

const DEV_GLYPHS: Record<DevCardKind, ReactElement> = {
  knight: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 20 L7 12 C7 9 8.4 6.6 11 5.4 L11.6 3 L13.4 4.8 L15.8 4.4 L15.4 6.6 C16.6 7.6 17 9 17 10.4 L14.6 10.8 C14 11 13.6 11.4 13.6 12 L14 20 Z"
        fill="currentColor"
      />
      <circle cx="14.6" cy="7.4" r="0.7" fill="var(--ct-parchment, #efe4c8)" />
    </svg>
  ),
  vp: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 18 L6.6 7 L10 10 L12 5.6 L14 10 L17.4 7 L19 18 Z" fill="currentColor" />
      <rect x="5" y="19" width="14" height="1.8" rx="0.9" fill="currentColor" />
    </svg>
  ),
  roadBuilding: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4 L10.6 20 L13.4 20 L16 4 L13.2 4 L12.6 8 L11.4 8 L10.8 4 Z" fill="currentColor" />
      <g stroke="var(--ct-parchment, #efe4c8)" strokeWidth="1.1">
        <line x1="10" y1="12" x2="14" y2="12" />
        <line x1="10.4" y1="16" x2="13.6" y2="16" />
      </g>
    </svg>
  ),
  yearOfPlenty: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 C14 6 18 7 18 11 C18 15 15.4 18 12 18 C8.6 18 6 15 6 11 C6 7 10 6 12 3 Z" fill="currentColor" />
      <path d="M12 18 L12 21 M9 21 L15 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  monopoly: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.4 15.6 L15.6 8.4 M9.6 9.6 L11.4 11.4 M12.6 12.6 L14.4 14.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
};

export function DevCardFace({ kind, revealed }: { kind: DevCardKind; revealed?: boolean }): ReactElement {
  if (!revealed) {
    return (
      <div className="ct-card ct-card--devback">
        <span className="ct-card-seal" aria-hidden="true">
          ⚓
        </span>
        <span className="ct-card-name">发展卡</span>
      </div>
    );
  }
  return (
    <div className={`ct-card ct-card--dev ct-card--dev-${kind}`}>
      <span className="ct-card-glyph" aria-hidden="true">
        {DEV_GLYPHS[kind]}
      </span>
      <span className="ct-card-name">{DEV_NAMES[kind]}</span>
    </div>
  );
}

const DICE_PIPS: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};

export function Dice({ value, rolling, tint }: { value: number; rolling?: boolean; tint?: "red" | "plain" }): ReactElement {
  const pips = DICE_PIPS[value] ?? DICE_PIPS[1]!;
  return (
    <span className={`ct-dice${rolling ? " is-rolling" : ""}${tint === "red" ? " ct-dice--red" : ""}`} aria-label={`骰子 ${value}`}>
      {pips.map(([px, py], i) => (
        <i key={i} className="ct-dice-pip" data-pip={`${px},${py}`} aria-hidden="true" />
      ))}
    </span>
  );
}
