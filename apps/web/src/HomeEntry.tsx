import { useState } from "react";
import { RulesPanel } from "@coup/web-desk";
import { sfx } from "@coup/web-desk";

type HomeEntryProps = {
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  busy: boolean;
  recoveryRooms?: Array<{ code: string; status: "restored" | "failed"; reason: string | null }>;
  onAbandonRecovery?: (roomCode: string) => void;
};

export function recoveryReasonMessage(reason: string | null): string {
  const messages: Record<string, string> = {
    corrupt: "房间数据损坏",
    invalid: "房间数据无效",
    migration_error: "房间数据迁移失败",
    match_missing: "缺少进行中的对局",
    match_not_active: "进行中的对局不存在",
    match_room_mismatch: "对局与房间不匹配",
    rematch_match_not_found: "续局记录不存在",
    rematch_match_active: "续局记录仍在进行中",
  };
  return (reason && messages[reason]) || "无法恢复该房间";
}

export function HomeEntry({
  onCreateRoom,
  onJoinRoom,
  busy,
  recoveryRooms = [],
  onAbandonRecovery,
}: HomeEntryProps) {
  const [rulesOpen, setRulesOpen] = useState(false);

  return (
    <div className="home-b" aria-label="入口">
      <div className="home-hero">
        <span className="home-crest" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path
              d="M4 18 L6 9 L10 13 L12 5 L14 13 L18 9 L20 18 Z"
              fill="currentColor"
            />
            <rect x="4" y="19" width="16" height="2" rx="1" fill="currentColor" />
          </svg>
        </span>
        <p className="home-eyebrow">Coup · 宫廷博弈</p>
        <h1>政 变</h1>
        <p className="home-tagline">五种身份，两枚暗牌，一次虚张声势定乾坤。</p>

        {recoveryRooms.length > 0 ? (
          <div className="recovery-card">
            <p>检测到服务器恢复了以下房间：</p>
            {recoveryRooms.map((room) => (
              <p key={room.code}>
                房间 {room.code}：
                {room.status === "failed"
                  ? `恢复失败（${recoveryReasonMessage(room.reason)}）`
                  : "已恢复（可用原房间号加入）"}
              </p>
            ))}
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={() => onAbandonRecovery?.(recoveryRooms[0]?.code ?? "")}
            >
              放弃房间 {recoveryRooms[0]?.code}
            </button>
          </div>
        ) : (
          <>
            <div className="home-actions">
              <button
                type="button"
                className="home-btn"
                disabled={busy}
                onClick={() => {
                  sfx.play("confirm");
                  onCreateRoom();
                }}
              >
                创建房间
              </button>
              <button
                type="button"
                className="home-btn ghost"
                disabled={busy}
                onClick={() => {
                  sfx.play("click");
                  onJoinRoom();
                }}
              >
                加入房间
              </button>
            </div>
            <div className="home-facts">
              <span>2–6 人同桌</span>
              <span>4 位房间号邀请</span>
              <span>掉线回席保护</span>
            </div>
            <button
              type="button"
              className="ghost-btn"
              style={{ marginTop: "1.1rem" }}
              onClick={() => {
                sfx.play("click");
                setRulesOpen(true);
              }}
            >
              怎么玩？
            </button>
          </>
        )}
      </div>
      <RulesPanel open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
