/**
 * 地图节点坐标：对照实体版图的地理排布手工精调（非精确测绘）。
 * 画布 1180×930；注意保持连线与地点框无遮挡，调整时先在浏览器里核对。
 */
export const NODE_POS: Record<string, { x: number; y: number }> = {
  warrington: { x: 150, y: 80 },
  "stoke-on-trent": { x: 330, y: 185 },
  leek: { x: 505, y: 125 },
  belper: { x: 690, y: 115 },
  nottingham: { x: 1030, y: 95 },
  derby: { x: 855, y: 215 },
  uttoxeter: { x: 610, y: 250 },
  stone: { x: 270, y: 320 },
  "burton-on-trent": { x: 820, y: 345 },
  stafford: { x: 195, y: 425 },
  shrewsbury: { x: 85, y: 565 },
  "farm-north": { x: 490, y: 395 },
  cannock: { x: 415, y: 500 },
  tamworth: { x: 715, y: 480 },
  walsall: { x: 570, y: 530 },
  wolverhampton: { x: 345, y: 590 },
  coalbrookdale: { x: 150, y: 690 },
  dudley: { x: 435, y: 665 },
  birmingham: { x: 665, y: 620 },
  nuneaton: { x: 880, y: 540 },
  coventry: { x: 1005, y: 630 },
  "farm-south": { x: 390, y: 790 },
  kidderminster: { x: 280, y: 815 },
  worcester: { x: 455, y: 845 },
  redditch: { x: 735, y: 740 },
  oxford: { x: 1000, y: 845 },
  gloucester: { x: 620, y: 862 },
};

export const MERCHANT_NODES = new Set(["warrington", "shrewsbury", "nottingham", "gloucester", "oxford"]);
export const FARM_NODES = new Set(["farm-north", "farm-south"]);

export const BOARD_WIDTH = 1180;
export const BOARD_HEIGHT = 930;
