import type { IndustryType, TileSpec } from '../types.js';

/**
 * 产业瓦片数值表（每名玩家）。三方核对一致：官方规则书玩家面板、ikegami/tts_brass、npow。
 * canalOnly = 铁路时代禁建；railOnly = 运河时代禁建。
 */

function t(
  industry: IndustryType,
  level: number,
  count: number,
  eras: TileSpec['eras'],
  costMoney: number,
  costCoal: number,
  costIron: number,
  beersToSell: number,
  vp: number,
  income: number,
  linkPoints: number,
  produces: number,
  lightbulb = false,
): TileSpec {
  return { industry, level, count, eras, costMoney, costCoal, costIron, beersToSell, vp, income, linkPoints, produces, lightbulb };
}

export const TILE_SPECS: TileSpec[] = [
  // Cotton Mill ×11
  t('cotton', 1, 3, 'canalOnly', 12, 0, 0, 1, 5, 5, 1, 0),
  t('cotton', 2, 2, 'both', 14, 1, 0, 1, 5, 4, 2, 0),
  t('cotton', 3, 3, 'both', 16, 1, 1, 1, 9, 3, 1, 0),
  t('cotton', 4, 3, 'both', 18, 1, 1, 1, 12, 2, 1, 0),
  // Manufacturer ×11
  t('manufacturer', 1, 1, 'canalOnly', 8, 1, 0, 1, 3, 5, 2, 0),
  t('manufacturer', 2, 2, 'both', 10, 0, 1, 1, 5, 1, 1, 0),
  t('manufacturer', 3, 1, 'both', 12, 2, 0, 0, 4, 4, 0, 0),
  t('manufacturer', 4, 1, 'both', 8, 0, 1, 1, 3, 6, 1, 0),
  t('manufacturer', 5, 2, 'both', 16, 1, 0, 2, 8, 2, 2, 0),
  t('manufacturer', 6, 1, 'both', 20, 0, 0, 1, 7, 6, 1, 0),
  t('manufacturer', 7, 1, 'both', 16, 1, 1, 0, 9, 4, 0, 0),
  t('manufacturer', 8, 2, 'both', 20, 0, 2, 1, 11, 1, 1, 0),
  // Pottery ×5
  t('pottery', 1, 1, 'both', 17, 0, 1, 1, 10, 5, 1, 0, true),
  t('pottery', 2, 1, 'both', 0, 1, 0, 1, 1, 1, 1, 0),
  t('pottery', 3, 1, 'both', 22, 2, 0, 2, 11, 5, 1, 0, true),
  t('pottery', 4, 1, 'both', 0, 1, 0, 1, 1, 1, 1, 0),
  t('pottery', 5, 1, 'railOnly', 24, 2, 0, 2, 20, 5, 1, 0),
  // Coal Mine ×7
  t('coal', 1, 1, 'canalOnly', 5, 0, 0, 0, 1, 4, 2, 2),
  t('coal', 2, 2, 'both', 7, 0, 0, 0, 2, 7, 1, 3),
  t('coal', 3, 2, 'both', 8, 0, 1, 0, 3, 6, 1, 4),
  t('coal', 4, 2, 'both', 10, 0, 1, 0, 4, 5, 1, 5),
  // Iron Works ×4
  t('iron', 1, 1, 'canalOnly', 5, 1, 0, 0, 3, 3, 1, 4),
  t('iron', 2, 1, 'both', 7, 1, 0, 0, 5, 3, 1, 4),
  t('iron', 3, 1, 'both', 9, 1, 0, 0, 7, 2, 1, 5),
  t('iron', 4, 1, 'both', 12, 1, 0, 0, 9, 1, 1, 6),
  // Brewery ×7
  t('brewery', 1, 2, 'canalOnly', 5, 0, 1, 0, 4, 4, 2, 1),
  t('brewery', 2, 2, 'both', 7, 0, 1, 0, 5, 5, 2, 1),
  t('brewery', 3, 2, 'both', 9, 0, 1, 0, 7, 5, 2, 1),
  t('brewery', 4, 1, 'railOnly', 9, 0, 1, 0, 10, 5, 2, 1),
];

export function tileSpec(industry: IndustryType, level: number): TileSpec {
  const spec = TILE_SPECS.find((s) => s.industry === industry && s.level === level);
  if (!spec) throw new Error(`no tile spec for ${industry} L${level}`);
  return spec;
}

export const INDUSTRY_NAMES: Record<IndustryType, string> = {
  cotton: '棉纺厂',
  manufacturer: '制造厂',
  pottery: '陶瓷厂',
  coal: '煤矿',
  iron: '铁厂',
  brewery: '酿酒厂',
};

export function tilesPerEraBreweryBarrels(era: 'canal' | 'rail'): number {
  return era === 'canal' ? 1 : 2;
}
