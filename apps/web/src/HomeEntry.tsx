type HomeEntryProps = {
  onLocal: () => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  busy: boolean;
};

export function HomeEntry({
  onLocal,
  onCreateRoom,
  onJoinRoom,
  busy,
}: HomeEntryProps) {
  return (
    <div className="home-b" aria-label="入口">
      <div className="b-hero">
        <p className="eyebrow">局域网主机</p>
        <h1>创建房间</h1>
        <p>
          你做权威主机。分享 4 位房间号或加入链接；座位配置与开局在后续步骤完成。
        </p>
        <button
          type="button"
          className="primary xl"
          disabled={busy}
          onClick={() => onCreateRoom()}
        >
          创建房间
        </button>
      </div>
      <aside className="b-side">
        <button
          type="button"
          className="side-card"
          disabled={busy}
          onClick={() => onJoinRoom()}
        >
          <strong>加入房间</strong>
          <span>粘贴链接，或地址 + 房间号</span>
        </button>
        <button
          type="button"
          className="side-card ghost"
          disabled={busy}
          onClick={() => onLocal()}
        >
          <strong>本机对战</strong>
          <span>仅 loopback · 现有开局页</span>
        </button>
      </aside>
    </div>
  );
}
