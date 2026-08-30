import type { ReactElement } from "react";
import type { CharacterId } from "@coup/protocol";

/**
 * 内联 SVG 角色卡面：五角色各有专属纹章、配色与能力铭文。
 * 全部为矢量绘制，无位图资源，单卡体积 ~2KB。
 */

export type RoleVisual = {
  /** 纹章主色（深）。 */
  deep: string;
  /** 纹章辅色（亮）。 */
  lite: string;
  /** 卡面底色渐变（两点）。 */
  field: [string, string];
};

export const ROLE_VISUAL: Record<CharacterId, RoleVisual> = {
  duke: {
    deep: "#28486e",
    lite: "#7fa8d8",
    field: ["#1d3350", "#0e1a2b"],
  },
  assassin: {
    deep: "#6e2430",
    lite: "#d98a92",
    field: ["#4a1a22", "#200c10"],
  },
  captain: {
    deep: "#1e5a4c",
    lite: "#7cc8b0",
    field: ["#163e35", "#0a1d18"],
  },
  ambassador: {
    deep: "#6e5620",
    lite: "#d8b96a",
    field: ["#4a3a16", "#211a0a"],
  },
  contessa: {
    deep: "#54306e",
    lite: "#b795d8",
    field: ["#38204a", "#180e22"],
  },
};

const GOLD = "#d7ad62";
const GOLD_LITE = "#f4d69a";
const PARCHMENT = "#f0e2c8";

/** 角纹角饰（四角复用）。 */
function CornerOrnament({ transform }: { transform: string }) {
  return (
    <g transform={transform} stroke={GOLD} strokeWidth="1.1" fill="none" opacity="0.75">
      <path d="M2 12 Q2 2 12 2" />
      <circle cx="4.6" cy="4.6" r="1.5" fill={GOLD} stroke="none" />
    </g>
  );
}

/** 公爵：三尖冠冕 + 三枚金币（征税 / 收买）。 */
function DukeEmblem() {
  return (
    <g>
      {/* 冠冕 */}
      <path
        d="M50 22 L60 40 L72 30 L68 52 L32 52 L28 30 L40 40 Z"
        fill="none"
        stroke={GOLD_LITE}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <circle cx="50" cy="18" r="3" fill={GOLD_LITE} />
      <circle cx="27" cy="27" r="2.2" fill={GOLD_LITE} />
      <circle cx="73" cy="27" r="2.2" fill={GOLD_LITE} />
      <line x1="32" y1="52" x2="68" y2="52" stroke={GOLD_LITE} strokeWidth="2.4" />
      {/* 金币堆 */}
      <g stroke={GOLD} strokeWidth="1.8">
        <ellipse cx="50" cy="66" rx="17" ry="6" fill="rgba(215,173,98,0.28)" />
        <ellipse cx="50" cy="76" rx="17" ry="6" fill="rgba(215,173,98,0.2)" />
        <ellipse cx="50" cy="86" rx="17" ry="6" fill="rgba(215,173,98,0.14)" />
        <line x1="33" y1="66" x2="33" y2="86" />
        <line x1="67" y1="66" x2="67" y2="86" />
      </g>
    </g>
  );
}

/** 刺客：垂直匕首 + 血珠。 */
function AssassinEmblem() {
  return (
    <g>
      {/* 柄 */}
      <circle cx="50" cy="22" r="4.5" fill="none" stroke={GOLD_LITE} strokeWidth="2" />
      <path d="M50 27 L50 38" stroke={GOLD_LITE} strokeWidth="2.6" />
      {/* 护手 */}
      <path d="M36 40 Q50 46 64 40" fill="none" stroke={GOLD_LITE} strokeWidth="2.6" />
      {/* 刃 */}
      <path
        d="M45 42 L50 88 L55 42 Q50 38 45 42 Z"
        fill="rgba(217,138,146,0.24)"
        stroke={GOLD_LITE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <line x1="50" y1="46" x2="50" y2="80" stroke={GOLD} strokeWidth="1" opacity="0.8" />
      {/* 血珠 */}
      <path
        d="M64 56 q4 6 0 9 q-4 -3 0 -9"
        fill={ROLE_VISUAL.assassin.lite}
        opacity="0.9"
      />
    </g>
  );
}

/** 队长：舵轮 + 金币（掠夺与护航）。 */
function CaptainEmblem() {
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const angle = (i * Math.PI) / 4;
    const x1 = 50 + Math.cos(angle) * 12;
    const y1 = 54 + Math.sin(angle) * 12;
    const x2 = 50 + Math.cos(angle) * 32;
    const y2 = 54 + Math.sin(angle) * 32;
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
  });
  return (
    <g stroke={GOLD_LITE} strokeWidth="2.4" fill="none">
      <circle cx="50" cy="54" r="30" strokeWidth="3" />
      <circle cx="50" cy="54" r="12" />
      {spokes}
      <circle cx="50" cy="20" r="3" fill={GOLD_LITE} stroke="none" />
      <circle cx="84" cy="54" r="3" fill={GOLD_LITE} stroke="none" />
      <circle cx="50" cy="88" r="3" fill={GOLD_LITE} stroke="none" />
      <circle cx="16" cy="54" r="3" fill={GOLD_LITE} stroke="none" />
      {/* 中心金币 */}
      <circle cx="50" cy="54" r="5.5" fill="rgba(215,173,98,0.4)" stroke={GOLD} strokeWidth="1.6" />
    </g>
  );
}

/** 大使：往复信使环（交换与斡旋）。 */
function AmbassadorEmblem() {
  return (
    <g fill="none" strokeLinecap="round">
      <path
        d="M30 62 A 22 22 0 0 1 66 40"
        stroke={GOLD_LITE}
        strokeWidth="3"
      />
      <path d="M66 30 L67 41 L56 39" fill="none" stroke={GOLD_LITE} strokeWidth="3" strokeLinejoin="round" />
      <path
        d="M70 46 A 22 22 0 0 1 34 68"
        stroke={GOLD}
        strokeWidth="3"
      />
      <path d="M34 78 L33 67 L44 69" fill="none" stroke={GOLD} strokeWidth="3" strokeLinejoin="round" />
      {/* 印章 */}
      <circle cx="50" cy="54" r="5" fill="rgba(216,185,106,0.35)" stroke={GOLD_LITE} strokeWidth="1.6" />
      <circle cx="50" cy="54" r="1.8" fill={PARCHMENT} stroke="none" />
    </g>
  );
}

/** 伯爵夫人：盛放蔷薇（美色为盾）。 */
function ContessaEmblem() {
  return (
    <g>
      {/* 外层花瓣 */}
      <g fill="rgba(183,149,216,0.22)" stroke={GOLD_LITE} strokeWidth="1.8">
        <path d="M50 24 C60 30 64 40 60 50 C56 42 52 38 50 36 C48 38 44 42 40 50 C36 40 40 30 50 24 Z" />
        <path d="M76 54 C74 66 66 74 56 74 C62 68 64 62 64 58 C60 60 56 62 54 64 C56 54 66 50 76 54 Z" />
        <path d="M24 54 C34 50 44 54 46 64 C44 62 40 60 36 58 C36 62 38 68 44 74 C34 74 26 66 24 54 Z" />
      </g>
      {/* 花心螺旋 */}
      <g fill="none" stroke={GOLD_LITE} strokeWidth="1.8" strokeLinecap="round">
        <circle cx="50" cy="54" r="10" opacity="0.9" />
        <path d="M50 46 a8 8 0 0 1 8 8 a6 6 0 0 1 -6 6 a4.5 4.5 0 0 1 -4.5 -4.5 a3 3 0 0 1 3 -3" />
      </g>
      {/* 茎叶 */}
      <path d="M50 64 L50 86" stroke={GOLD} strokeWidth="1.8" />
      <path d="M50 76 q-10 -2 -12 -10 q10 0 12 10 Z" fill="rgba(124,200,176,0.3)" stroke={GOLD} strokeWidth="1.4" />
    </g>
  );
}

const EMBLEMS: Record<CharacterId, () => ReactElement> = {
  duke: DukeEmblem,
  assassin: AssassinEmblem,
  captain: CaptainEmblem,
  ambassador: AmbassadorEmblem,
  contessa: ContessaEmblem,
};

/**
 * 角色纹章（不含卡框）。`flip` 时水平镜像（供对局座位朝向使用）。
 */
export function CharacterCrest({
  character,
  className,
}: {
  character: CharacterId;
  className?: string;
}) {
  const Emblem = EMBLEMS[character];
  return (
    <svg
      viewBox="0 0 100 108"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <Emblem />
    </svg>
  );
}

/**
 * 完整角色牌面：纹章 + 铭牌 + 能力铭文 + 角饰框线。
 */
export function CharacterCardFace({
  character,
  name,
  ability,
}: {
  character: CharacterId;
  name: string;
  ability: string;
}) {
  const visual = ROLE_VISUAL[character];
  const Emblem = EMBLEMS[character];
  const gid = `field-${character}`;
  return (
    <svg
      viewBox="0 0 104 146"
      className="card-face-svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={gid} cx="50%" cy="30%" r="85%">
          <stop offset="0%" stopColor={visual.field[0]} />
          <stop offset="100%" stopColor={visual.field[1]} />
        </radialGradient>
        <linearGradient id={`${gid}-plate`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(244,214,154,0.24)" />
          <stop offset="100%" stopColor="rgba(244,214,154,0.06)" />
        </linearGradient>
      </defs>
      {/* 底色 */}
      <rect x="1.5" y="1.5" width="101" height="143" rx="10" fill={`url(#${gid})`} />
      {/* 内框 */}
      <rect
        x="5"
        y="5"
        width="94"
        height="136"
        rx="7"
        fill="none"
        stroke={GOLD}
        strokeOpacity="0.65"
        strokeWidth="1.4"
      />
      <rect
        x="8.5"
        y="8.5"
        width="87"
        height="129"
        rx="5"
        fill="none"
        stroke={GOLD}
        strokeOpacity="0.3"
        strokeWidth="0.8"
      />
      <CornerOrnament transform="translate(0,0)" />
      <CornerOrnament transform="translate(104,0) scale(-1,1)" />
      <CornerOrnament transform="translate(0,146) scale(1,-1)" />
      <CornerOrnament transform="translate(104,146) scale(-1,-1)" />
      {/* 纹章 */}
      <g transform="translate(2,2)">
        <Emblem />
      </g>
      {/* 铭牌 */}
      <rect
        x="16"
        y="102"
        width="72"
        height="30"
        rx="6"
        fill={`url(#${gid}-plate)`}
        stroke={GOLD}
        strokeOpacity="0.55"
        strokeWidth="1"
      />
      <text
        x="52"
        y="116"
        textAnchor="middle"
        fontSize="14"
        letterSpacing="3"
        fill={PARCHMENT}
        style={{ fontFamily: "Georgia, 'Songti SC', serif" }}
      >
        {name}
      </text>
      <text
        x="52"
        y="127.5"
        textAnchor="middle"
        fontSize="6.6"
        letterSpacing="1"
        fill="rgba(240,226,200,0.62)"
        style={{ fontFamily: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif" }}
      >
        {ability}
      </text>
    </svg>
  );
}

/** 统一牌背：午夜底 + 菱格暗纹 + 冠冕印记。 */
export function CardBack({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 104 146"
      className={`card-face-svg ${className ?? ""}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern id="card-back-lattice" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="14" height="14" fill="#101826" />
          <path d="M0 0 H14 V14" fill="none" stroke="rgba(215,173,98,0.14)" strokeWidth="1" />
        </pattern>
        <radialGradient id="card-back-glow" cx="50%" cy="42%" r="70%">
          <stop offset="0%" stopColor="rgba(215,173,98,0.16)" />
          <stop offset="100%" stopColor="rgba(215,173,98,0)" />
        </radialGradient>
      </defs>
      <rect x="1.5" y="1.5" width="101" height="143" rx="10" fill="#0d1520" />
      <rect x="1.5" y="1.5" width="101" height="143" rx="10" fill="url(#card-back-lattice)" />
      <rect x="5" y="5" width="94" height="136" rx="7" fill="none" stroke={GOLD} strokeOpacity="0.5" strokeWidth="1.4" />
      <rect x="9" y="9" width="86" height="128" rx="5" fill="none" stroke={GOLD} strokeOpacity="0.25" strokeWidth="0.8" />
      <circle cx="52" cy="73" r="30" fill="url(#card-back-glow)" />
      {/* 中央印记：冠冕 + 环 */}
      <circle cx="52" cy="73" r="21" fill="rgba(13,21,32,0.88)" stroke={GOLD} strokeOpacity="0.7" strokeWidth="1.6" />
      <circle cx="52" cy="73" r="17.5" fill="none" stroke={GOLD} strokeOpacity="0.35" strokeWidth="0.8" />
      <g transform="translate(2,15)" stroke={GOLD_LITE} fill="none" strokeWidth="2" strokeLinejoin="round">
        <path d="M50 46 L58 60 L68 52 L65 70 L39 70 L36 52 L46 60 Z" />
        <circle cx="50" cy="43" r="2.4" fill={GOLD_LITE} stroke="none" />
        <line x1="39" y1="70" x2="65" y2="70" />
      </g>
    </svg>
  );
}

/** 揭示后的明置影响力小牌：纹章剪影。 */
export function CharacterMiniFace({ character }: { character: CharacterId }) {
  const visual = ROLE_VISUAL[character];
  const Emblem = EMBLEMS[character];
  return (
    <svg viewBox="0 0 34 46" className="mini-face-svg" aria-hidden="true" focusable="false">
      <rect x="0.8" y="0.8" width="32.4" height="44.4" rx="4" fill={visual.field[1]} stroke="rgba(215,173,98,0.4)" strokeWidth="1" />
      <g transform="translate(8.3,1.6) scale(0.174)">
        <Emblem />
      </g>
    </svg>
  );
}
