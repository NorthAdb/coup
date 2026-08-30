/**
 * 门户首页：双游戏选择。工业时代暗色主题（brass 专属视觉体系，与 coup 样式隔离）。
 */

export function Portal() {
  return (
    <div className="portal">
      <div className="portal-glow" aria-hidden="true" />
      <header className="portal-header">
        <span className="portal-brand">
          <span className="portal-brand-mark">⚙</span>
          MIDLAND WORKS
        </span>
        <span className="portal-sub">线上桌游工坊</span>
      </header>

      <main className="portal-main">
        <h1 className="portal-title">
          选一桌，
          <em>开工。</em>
        </h1>
        <p className="portal-lede">
          两款可联机的经典桌游，浏览器直接开玩。创建房间、分享四位房号、实时同步对局。
        </p>

        <div className="portal-games">
          <a className="game-card game-card--brass" href="/brass">
            <div className="game-card-plate">
              <span className="game-card-kicker">2–4 人 · 策略重镇</span>
              <h2>工业革命</h2>
              <h3>伯明翰</h3>
              <p>
                运河与铁路的两个时代。建厂、铺路、卖货、贷款，在伯明翰的黑乡铸就你的工业帝国。
              </p>
              <span className="game-card-cta">
                进入工坊 <i>→</i>
              </span>
            </div>
            <div className="game-card-art" aria-hidden="true">
              <span className="art-gear art-gear--big" />
              <span className="art-gear art-gear--small" />
              <span className="art-smoke" />
            </div>
          </a>

          <a className="game-card game-card--coup" href="/coup">
            <div className="game-card-plate">
              <span className="game-card-kicker">2–6 人 · 心理博弈</span>
              <h2>政变</h2>
              <h3>COUP</h3>
              <p>五大家族，虚实难辨。虚张声势、挑战与清算，用谎言与直觉除尽对手的影响力。</p>
              <span className="game-card-cta">
                进入牌桌 <i>→</i>
              </span>
            </div>
            <div className="game-card-art game-card-art--coup" aria-hidden="true">
              <span className="art-card art-card--1" />
              <span className="art-card art-card--2" />
              <span className="art-card art-card--3" />
            </div>
          </a>
        </div>

        <footer className="portal-footer">
          <span>房间有效期 30 分钟 · 断线 15 秒内回连自动回席</span>
        </footer>
      </main>
    </div>
  );
}
