type HomeEntryProps = {
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  busy: boolean;
  recoveryFailed?: boolean;
  onAbandonRecovery?: () => void;
};

export function HomeEntry({
  onCreateRoom,
  onJoinRoom,
  busy,
  recoveryFailed = false,
  onAbandonRecovery,
}: HomeEntryProps) {
  return (
    <div className="home-b" aria-label="入口">
      <div className="b-hero">
        <p className="eyebrow">互联网房间</p>
        <h1>创建房间</h1>
        {recoveryFailed ? (
          <>
            <p>无法恢复上一房间。须先放弃并作废旧房间号与座位凭证，才能创建新房。</p>
            <button
              type="button"
              className="primary xl"
              disabled={busy}
              onClick={() => onAbandonRecovery?.()}
            >
              放弃并开新房间
            </button>
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
