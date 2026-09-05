import type { LinkDef, LocationDef, MerchantDef, NodeId, PlayerCount } from '../types.js';

/**
 * 版图数据。三源交叉验证：官方规则书 [R]、ikegami/tts_brass [T]、npow [N] 与
 * Quasrain-Coder/BrassBirmingham [Q] 一致（详见 .scratch/brass-birmingham/spec.md）。
 */

export const LOCATIONS: Record<string, LocationDef> = {
  belper: { name: 'Belper', slots: [{ industries: ['cotton', 'manufacturer'] }, { industries: ['coal'] }, { industries: ['pottery'] }] },
  derby: { name: 'Derby', slots: [{ industries: ['cotton', 'brewery'] }, { industries: ['cotton', 'manufacturer'] }, { industries: ['iron'] }] },
  leek: { name: 'Leek', slots: [{ industries: ['cotton', 'manufacturer'] }, { industries: ['cotton', 'coal'] }] },
  'stoke-on-trent': { name: 'Stoke-on-Trent', slots: [{ industries: ['cotton', 'manufacturer'] }, { industries: ['pottery', 'iron'] }, { industries: ['manufacturer'] }] },
  stone: { name: 'Stone', slots: [{ industries: ['cotton', 'brewery'] }, { industries: ['manufacturer', 'coal'] }] },
  uttoxeter: { name: 'Uttoxeter', slots: [{ industries: ['manufacturer', 'brewery'] }, { industries: ['cotton', 'brewery'] }] },
  stafford: { name: 'Stafford', slots: [{ industries: ['manufacturer', 'brewery'] }, { industries: ['pottery'] }] },
  'burton-on-trent': { name: 'Burton-on-Trent', slots: [{ industries: ['manufacturer', 'coal'] }, { industries: ['brewery'] }] },
  cannock: { name: 'Cannock', slots: [{ industries: ['manufacturer', 'coal'] }, { industries: ['coal'] }] },
  tamworth: { name: 'Tamworth', slots: [{ industries: ['cotton', 'coal'] }, { industries: ['cotton', 'coal'] }] },
  walsall: { name: 'Walsall', slots: [{ industries: ['iron', 'manufacturer'] }, { industries: ['manufacturer', 'brewery'] }] },
  wolverhampton: { name: 'Wolverhampton', slots: [{ industries: ['manufacturer'] }, { industries: ['manufacturer', 'coal'] }] },
  coalbrookdale: { name: 'Coalbrookdale', slots: [{ industries: ['iron', 'brewery'] }, { industries: ['iron'] }, { industries: ['coal'] }] },
  dudley: { name: 'Dudley', slots: [{ industries: ['coal'] }, { industries: ['iron'] }] },
  kidderminster: { name: 'Kidderminster', slots: [{ industries: ['cotton', 'coal'] }, { industries: ['cotton'] }] },
  worcester: { name: 'Worcester', slots: [{ industries: ['cotton'] }, { industries: ['cotton'] }] },
  birmingham: { name: 'Birmingham', slots: [{ industries: ['cotton', 'manufacturer'] }, { industries: ['manufacturer'] }, { industries: ['iron'] }, { industries: ['manufacturer'] }] },
  coventry: { name: 'Coventry', slots: [{ industries: ['pottery'] }, { industries: ['manufacturer', 'coal'] }, { industries: ['iron', 'manufacturer'] }] },
  nuneaton: { name: 'Nuneaton', slots: [{ industries: ['manufacturer', 'brewery'] }, { industries: ['cotton', 'coal'] }] },
  redditch: { name: 'Redditch', slots: [{ industries: ['manufacturer', 'coal'] }, { industries: ['iron'] }] },
  'farm-north': { name: '农场酒厂（北）', slots: [{ industries: ['brewery'] }], farm: true },
  'farm-south': { name: '农场酒厂（南）', slots: [{ industries: ['brewery'] }], farm: true },
};

export const MERCHANTS: Record<string, MerchantDef> = {
  shrewsbury: { name: 'Shrewsbury', slots: 1, minPlayers: 2, bonus: { type: 'vp', amount: 4 } },
  gloucester: { name: 'Gloucester', slots: 2, minPlayers: 2, bonus: { type: 'develop' } },
  oxford: { name: 'Oxford', slots: 2, minPlayers: 2, bonus: { type: 'income', amount: 2 } },
  warrington: { name: 'Warrington', slots: 2, minPlayers: 3, bonus: { type: 'money', amount: 5 } },
  nottingham: { name: 'Nottingham', slots: 2, minPlayers: 4, bonus: { type: 'vp', amount: 3 } },
};

export const LINKS: LinkDef[] = [
  { id: 'belper-derby', a: 'belper', b: 'derby', canal: true, rail: true },
  { id: 'belper-leek', a: 'belper', b: 'leek', canal: false, rail: true },
  { id: 'birmingham-coventry', a: 'birmingham', b: 'coventry', canal: true, rail: true },
  { id: 'birmingham-dudley', a: 'birmingham', b: 'dudley', canal: true, rail: true },
  { id: 'birmingham-nuneaton', a: 'birmingham', b: 'nuneaton', canal: false, rail: true },
  { id: 'birmingham-oxford', a: 'birmingham', b: 'oxford', canal: true, rail: true },
  { id: 'birmingham-redditch', a: 'birmingham', b: 'redditch', canal: false, rail: true },
  { id: 'birmingham-tamworth', a: 'birmingham', b: 'tamworth', canal: true, rail: true },
  { id: 'birmingham-walsall', a: 'birmingham', b: 'walsall', canal: true, rail: true },
  { id: 'birmingham-worcester', a: 'birmingham', b: 'worcester', canal: true, rail: true },
  { id: 'burton-cannock', a: 'burton-on-trent', b: 'cannock', canal: false, rail: true },
  { id: 'burton-derby', a: 'burton-on-trent', b: 'derby', canal: true, rail: true },
  { id: 'burton-stone', a: 'burton-on-trent', b: 'stone', canal: true, rail: true },
  { id: 'burton-tamworth', a: 'burton-on-trent', b: 'tamworth', canal: true, rail: true },
  { id: 'burton-walsall', a: 'burton-on-trent', b: 'walsall', canal: true, rail: false },
  { id: 'cannock-stafford', a: 'cannock', b: 'stafford', canal: true, rail: true },
  { id: 'cannock-farm-north', a: 'cannock', b: 'farm-north', canal: true, rail: true },
  { id: 'cannock-walsall', a: 'cannock', b: 'walsall', canal: true, rail: true },
  { id: 'cannock-wolverhampton', a: 'cannock', b: 'wolverhampton', canal: true, rail: true },
  { id: 'coalbrookdale-kidderminster', a: 'coalbrookdale', b: 'kidderminster', canal: true, rail: true },
  { id: 'coalbrookdale-shrewsbury', a: 'coalbrookdale', b: 'shrewsbury', canal: true, rail: true },
  { id: 'coalbrookdale-wolverhampton', a: 'coalbrookdale', b: 'wolverhampton', canal: true, rail: true },
  { id: 'coventry-nuneaton', a: 'coventry', b: 'nuneaton', canal: false, rail: true },
  { id: 'derby-nottingham', a: 'derby', b: 'nottingham', canal: true, rail: true },
  { id: 'derby-uttoxeter', a: 'derby', b: 'uttoxeter', canal: false, rail: true },
  { id: 'dudley-kidderminster', a: 'dudley', b: 'kidderminster', canal: true, rail: true },
  { id: 'dudley-wolverhampton', a: 'dudley', b: 'wolverhampton', canal: true, rail: true },
  { id: 'gloucester-redditch', a: 'gloucester', b: 'redditch', canal: true, rail: true },
  { id: 'gloucester-worcester', a: 'gloucester', b: 'worcester', canal: true, rail: true },
  { id: 'kidderminster-worcester', a: 'kidderminster', b: 'worcester', via: 'farm-south', canal: true, rail: true },
  { id: 'leek-stoke-on-trent', a: 'leek', b: 'stoke-on-trent', canal: true, rail: true },
  { id: 'nuneaton-tamworth', a: 'nuneaton', b: 'tamworth', canal: true, rail: true },
  { id: 'redditch-oxford', a: 'redditch', b: 'oxford', canal: true, rail: true },
  { id: 'stafford-stone', a: 'stafford', b: 'stone', canal: true, rail: true },
  { id: 'stoke-on-trent-stone', a: 'stoke-on-trent', b: 'stone', canal: true, rail: true },
  { id: 'stoke-on-trent-warrington', a: 'stoke-on-trent', b: 'warrington', canal: true, rail: true },
  { id: 'stone-uttoxeter', a: 'stone', b: 'uttoxeter', canal: false, rail: true },
  { id: 'tamworth-walsall', a: 'tamworth', b: 'walsall', canal: false, rail: true },
  { id: 'walsall-wolverhampton', a: 'walsall', b: 'wolverhampton', canal: true, rail: true },
];

/** 边的全部相邻节点（含 via 三端点）。 */
export function linkEndpoints(link: LinkDef): NodeId[] {
  return link.via ? [link.a, link.via, link.b] : [link.a, link.b];
}

/** 商人板位放置顺序（发牌顺序）；minPlayers 过滤后取前 n 个。 */
export const MERCHANT_SLOT_ORDER: { slotId: string; location: string }[] = (() => {
  const order: { slotId: string; location: string }[] = [];
  for (const loc of ['shrewsbury', 'gloucester', 'oxford', 'warrington', 'nottingham']) {
    for (let i = 1; i <= MERCHANTS[loc].slots; i++) {
      order.push({ slotId: `${loc}#${i}`, location: loc });
    }
  }
  return order;
})();

/** 商人板构成：[万能, 棉×2, 制造×2, 陶×1, 空白×3]；按人数取前 n 张洗混 [T]。 */
export const MERCHANT_TILE_FACES: { goods: string[]; blank: boolean }[] = [
  { goods: ['cotton', 'manufacturer', 'pottery'], blank: false },
  { goods: ['cotton'], blank: false },
  { goods: ['cotton'], blank: false },
  { goods: ['manufacturer'], blank: false },
  { goods: ['manufacturer'], blank: false },
  { goods: ['pottery'], blank: false },
  { goods: [], blank: true },
  { goods: [], blank: true },
  { goods: [], blank: true },
];

export function merchantSlotsFor(playerCount: PlayerCount): { slotId: string; location: string }[] {
  return MERCHANT_SLOT_ORDER.filter((s) => MERCHANTS[s.location].minPlayers <= playerCount);
}
