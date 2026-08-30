/** 地图节点坐标（手工排布的示意地图，非精确地理）。 */
export const NODE_POS: Record<string, { x: number; y: number }> = {
  warrington: { x: 320, y: 46 },
  "stoke-on-trent": { x: 300, y: 140 },
  leek: { x: 470, y: 92 },
  belper: { x: 640, y: 76 },
  nottingham: { x: 830, y: 56 },
  derby: { x: 740, y: 170 },
  uttoxeter: { x: 500, y: 190 },
  stone: { x: 190, y: 210 },
  "burton-on-trent": { x: 640, y: 280 },
  stafford: { x: 170, y: 310 },
  shrewsbury: { x: 60, y: 420 },
  "farm-north": { x: 345, y: 330 },
  cannock: { x: 300, y: 400 },
  tamworth: { x: 580, y: 370 },
  walsall: { x: 430, y: 440 },
  wolverhampton: { x: 230, y: 470 },
  coalbrookdale: { x: 105, y: 550 },
  birmingham: { x: 520, y: 530 },
  nuneaton: { x: 700, y: 460 },
  coventry: { x: 790, y: 560 },
  "farm-south": { x: 250, y: 640 },
  kidderminster: { x: 195, y: 710 },
  worcester: { x: 305, y: 770 },
  redditch: { x: 560, y: 650 },
  oxford: { x: 800, y: 740 },
  gloucester: { x: 420, y: 760 },
};

export const MERCHANT_NODES = new Set(["warrington", "shrewsbury", "nottingham", "gloucester", "oxford"]);
export const FARM_NODES = new Set(["farm-north", "farm-south"]);

export const BOARD_WIDTH = 960;
export const BOARD_HEIGHT = 830;
