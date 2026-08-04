type RulesPanelProps = {
  open: boolean;
  onClose: () => void;
};

export function RulesPanel({ open, onClose }: RulesPanelProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="rules-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="rules-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
      >
        <header className="rules-header">
          <div>
            <p className="eyebrow">基础版</p>
            <h2 id="rules-title">游戏规则</h2>
          </div>
          <button type="button" className="quiet-button" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="rules-body">
          <section>
            <h3>目标</h3>
            <p>
              成为最后一个仍有影响力的玩家。影响力是你面前仍面朝下的角色牌；两张都翻开后淘汰。
            </p>
          </section>
          <section>
            <h3>设置</h3>
            <p>
              2–6 人。洗混 15 张角色牌，每人发 2 张，余下为宫廷牌库。每人通常拿 2
              枚钱币；2 人局先手拿 1 枚。
            </p>
          </section>
          <section>
            <h3>一般行动</h3>
            <ul>
              <li>
                <strong>收入</strong>：+1 钱币。不可质疑，不可阻挡。
              </li>
              <li>
                <strong>外援</strong>：尝试 +2 钱币。不可质疑；可用公爵阻挡。
              </li>
              <li>
                <strong>政变</strong>
                ：支付 7，目标失去 1 点影响力。必定成功。10 枚及以上时本回合必须政变。
              </li>
            </ul>
          </section>
          <section>
            <h3>角色行动</h3>
            <ul>
              <li>
                <strong>公爵 · 征税</strong>：+3。可质疑，不可阻挡。
              </li>
              <li>
                <strong>刺客 · 刺杀</strong>
                ：支付 3，目标失去影响力。可质疑；目标可用伯爵夫人阻挡。
              </li>
              <li>
                <strong>队长 · 偷窃</strong>
                ：从目标拿最多 2。可质疑；目标可用大使或队长阻挡。
              </li>
              <li>
                <strong>大使 · 交换</strong>
                ：抽 2 张，与自己的面朝下牌合并后选择要保留的影响力（其余洗回宫廷）。可质疑，不可阻挡。
              </li>
            </ul>
          </section>
          <section>
            <h3>响应顺序</h3>
            <p>
              声明行动（含目标）→ 质疑行动 → 声明阻挡 → 质疑阻挡 →
              结算。按顺时针逐席响应，第一个有效响应生效。
            </p>
          </section>
          <section>
            <h3>质疑</h3>
            <p>
              被质疑者可证明角色（展示后洗回并抽替代牌，质疑者失去影响力），也可认输并失去自己的影响力。阻挡被揭穿后不重开阻挡窗口。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
