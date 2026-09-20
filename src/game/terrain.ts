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
  if (cfg.perChunkMax <= 0) return [];
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

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function chunkOf(x: number, y: number): { cx: number; cy: number } {
  return { cx: Math.floor(x / CHUNK), cy: Math.floor(y / CHUNK) };
}
