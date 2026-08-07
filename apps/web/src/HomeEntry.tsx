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
  return (
    <div className="home-b" aria-label="入口">
      <div className="b-hero">
        <p className="eyebrow">互联网房间</p>
        <h1>创建房间</h1>
        {recoveryRooms.length > 0 ? (
          <>
            <p>服务器已恢复以下房间，可逐房放弃不需要的房间。</p>
            {recoveryRooms.map((room) => (
              <div key={room.code}>
                <p>房间 {room.code}：{room.status === "failed" ? `恢复失败（${recoveryReasonMessage(room.reason)}）` : "已恢复"}</p>
                <button type="button" disabled={busy} onClick={() => onAbandonRecovery?.(room.code)}>
                  放弃房间 {room.code}
                </button>
              </div>
            ))}
          </>
        ) : (
          <>
            <p>
              你创建房间后获得 4 位房间号，把它发给朋友；座位配置与开局在后续步骤完成。
            </p>
            <button
              type="button"
              className="primary xl"
              disabled={busy}
              onClick={() => onCreateRoom()}
            >
              创建房间
            </button>
          </>
        )}
      </div>
      <aside className="b-side">
        <button
          type="button"
          className="side-card"
          disabled={busy}
          onClick={() => onJoinRoom()}
        >
          <strong>加入房间</strong>
          <span>输入房主分享的 4 位房间号</span>
        </button>
      </aside>
    </div>
  );
}
