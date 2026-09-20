import type { MapDef } from '../config/maps';

/** 可碰撞障碍（只挡玩家、不挡弹道；敌人不寻路） */
export interface Obstacle {
  x: number;
  y: number;
  r: number;
  tint: number;
}

const CHUNK = 800;

/** 由区块坐标与地图 id 派生确定性种子 */
function chunkSeed(mapId: string, cx: number, cy: number): number {
  let h = 2166136261;
  const s = `${mapId}:${cx}:${cy}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 生成某区块的障碍（同一地图+区块永远一致） */
export function chunkObstacles(map: MapDef, cx: number, cy: number): Obstacle[] {
  const cfg = map.obstacles;
  if (cfg.perChunkMax <= 0 && cfg.pattern !== 'rings') return [];
  if (cfg.pattern === 'rings') return ringObstacles(map, cx, cy);
  const rnd = mulberry(chunkSeed(map.id, cx, cy));
  const n = cfg.perChunkMin + Math.floor(rnd() * (cfg.perChunkMax - cfg.perChunkMin + 1));
  const out: Obstacle[] = [];
  for (let i = 0; i < n; i++) {
    const x = cx * CHUNK + rnd() * CHUNK;
    const y = cy * CHUNK + rnd() * CHUNK;
    const r = cfg.rMin + rnd() * (cfg.rMax - cfg.rMin);
    // 出生点周围留出安全区（避免开局被卡）
    if (Math.hypot(x, y) < 220) continue;
    out.push({ x, y, r, tint: cfg.tint });
  }
  return out;
}

/**
 * 同心圆环地形（崩坏之环，M3）：
 * 障碍沿若干条半径递增的圆环带分布，每条环上按角度撒障碍并**随机留出缺口**（玩家从缺口穿过，
 * 形成"环状走廊 + 逐环推进"的走位结构）；相邻环的缺口角度错开，避免一条直线直接穿出去。
 *
 * 确定性：环上第 i 个障碍的位置只由 (地图 id, 环序号 k, 角度序号 i) 决定——所以同一个障碍
 * 会被它所在的每个区块以完全相同的方式重新算出来，跨区块拼接不会错位。
 */
const RING_STEP = 560;
const RING_MAX = 8;

function ringObstacles(map: MapDef, cx: number, cy: number): Obstacle[] {
  const cfg = map.obstacles;
  const out: Obstacle[] = [];
  // 本区块到原点的距离区间（用于只处理真正路过的环）
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const near = Math.max(0, Math.hypot(Math.min(Math.abs(x0), Math.abs(x0 + CHUNK)), Math.min(Math.abs(y0), Math.abs(y0 + CHUNK))));
  const far = Math.hypot(Math.max(Math.abs(x0), Math.abs(x0 + CHUNK)), Math.max(Math.abs(y0), Math.abs(y0 + CHUNK)));
  for (let k = 1; k <= RING_MAX; k++) {
    const R = k * RING_STEP;
    if (R + 80 < near || R - 80 > far) continue;
    const rnd = mulberry(chunkSeed(`${map.id}#ring${k}`, 0, 0));
    const count = Math.round((Math.PI * 2 * R) / 96); // 环上每 ~96px 一个候选点
    const gapA = rnd() * Math.PI * 2;                 // 缺口中心
    const gapHalf = 0.5 + rnd() * 0.45;               // 缺口半角（弧度）
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rnd() * 0.06;
      // 缺口：留出可通行的走廊
      let da = a - gapA;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) < gapHalf) continue;
      if (rnd() < 0.22) continue; // 环本身的稀疏度
      const rr = R + (rnd() - 0.5) * 70;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (x < x0 - 90 || x > x0 + CHUNK + 90 || y < y0 - 90 || y > y0 + CHUNK + 90) continue;
      if (Math.hypot(x, y) < 240) continue; // 出生点安全区
      out.push({ x, y, r: cfg.rMin + rnd() * (cfg.rMax - cfg.rMin), tint: cfg.tint });
    }
  }
  return out;
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function chunkOf(x: number, y: number): { cx: number; cy: number } {
  return { cx: Math.floor(x / CHUNK), cy: Math.floor(y / CHUNK) };
}
