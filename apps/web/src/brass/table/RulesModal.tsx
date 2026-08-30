import { useState } from "react";

/** Brass: Birmingham 速查规则（简版）。 */
export function RulesModal() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="brass-ghost-btn" onClick={() => setOpen(true)}>
        规则速查
      </button>
      {open ? (
        <div className="brass-overlay" role="dialog" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="brass-overlay-card brass-rules">
            <h3>规则速查（简版）</h3>
            <div className="brass-rules-body">
              <p>
                <b>目标</b>：两个时代（运河/铁路）结束累计 VP 最高者胜。翻面瓦片时代末计分；连线按相邻地点的翻面贸易图标计分（商人位恒 2）。
              </p>
              <p>
                <b>回合</b>：每回合 2 个行动（运河时代第 1 回合 1 个）。每个行动弃 1 张手牌；回合结束补手牌至 8。轮末按本轮花费升序定下轮座次并收取收入（负收入要付钱）。
              </p>
              <p>
                <b>建造</b>：地点卡→该地任意产业；产业卡→网络内对应产业；万能地点/万能产业同理。放面板最低级瓦片；优先专属槽。煤须连通最近未翻面煤矿（免费），否则连通商人位买市场；铁任意未翻面铁厂（免费）否则市场。煤矿/铁厂建成即尽量卖市场，卖空翻面进收入。
              </p>
              <p>
                <b>铺路</b>：运河时代 1 条 £3（运河线）；铁路时代 1 条 £5+1煤，或 2 条 £15+1啤酒（酒厂）。连线须相邻你的网络。
              </p>
              <p>
                <b>研发</b>：移除面板 1–2 块最低级瓦片，每块耗 1 铁；灯泡陶（I/III）不可研发。
              </p>
              <p>
                <b>卖货</b>：未翻面棉/制造/陶 连通收购该货的商人板，耗瓦片右上啤酒数。啤酒来源：自己酒厂（全图）/对手酒厂（须连通）/商人啤酒（用了得该商人奖励）。一次可连卖多块。
              </p>
              <p>
                <b>贷款</b>：+£30，收入等级 −3（不低于 −10）。<b>侦察</b>：弃 3 张换双万能卡（手中有万能时不可）。<b>跳过</b>：弃 1 张不做事。
              </p>
              <p>
                <b>时代末</b>：连线计分后移除；翻面瓦片计分；清除场上全部 1 级板块；商人啤酒补满；弃牌堆洗新牌库重抽 8 张。
              </p>
            </div>
            <button type="button" className="brass-primary-btn" onClick={() => setOpen(false)}>
              关闭
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
