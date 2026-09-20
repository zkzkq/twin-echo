/**
 * 地图（GDD §6.7，M3 实装 3 张 + 解锁链：图 1 胜利 → 图 2 → 图 2 胜利 → 图 3）。
 *
 * 实现口径：
 * - 「齿轮障碍/书架巷道」以程序化区块障碍实现（可碰撞圆，只阻挡玩家、不阻挡弹道）；敌人不做阻挡（避免寻路）。
 * - **「视线遮蔽」（M3 实装）**：图书馆有 `visionR` 视野半径——半径外与书架背后（真实遮挡判定）的敌人
 *   **不可见、也不被自动索敌**；弹幕与宝石保持可见（遮掩的是"威胁感知与索敌"，不是惩罚玩家）。见 world.sees()。
 * - **「同心圆环」（M3 实装）**：崩坏之环的障碍按同心圆带生成（`pattern: 'rings'`），形成环状通道。
 * - 「时潮涡流」复用通用危险区系统：停留扣血 + 预警期。
 */
export interface MapDef {
  id: string;
  name: string;
  desc: string;
  /** 背景 tile 着色（0xffffff = 原色） */
  bgTint: number;
  /** 敌人混编权重（游戏 2.5 分钟后启用；2.5 分钟前仍以时蛾为主） */
  weights: { moth: number; hopper: number; idol: number; cultist: number };
  /** 程序化障碍：每区块数量与半径范围；pattern=rings 时按同心圆带生成（数量字段仅作兜底） */
  obstacles: { perChunkMin: number; perChunkMax: number; rMin: number; rMax: number; tint: number; pattern?: 'scatter' | 'rings' };
  /** 视野半径（0 = 无遮蔽）；>0 时半径外与障碍后的敌人不可见且不被索敌 */
  visionR: number;
  /** 危险区：每 N 秒在玩家附近生成 1 片（0 = 不生成） */
  hazardEvery: number;
  hazard: { r: number; dps: number; life: number; tele: number; slowFactor: number; color: number };
  /** 事件池偏重（对已实装 3 件事件的权重倍数） */
  eventBias: { tide?: number; spring?: number; stasis?: number };
}

export const MAPS: readonly MapDef[] = [
  {
    id: 'plain', name: '时钟平原', desc: '开阔 + 齿轮障碍（阻挡移动不阻挡弹道）· 视野无遮挡 · 敌性均衡 · 全事件池',
    bgTint: 0xffffff,
    weights: { moth: 0.5, hopper: 0.25, idol: 0.12, cultist: 0.13 },
    obstacles: { perChunkMin: 0, perChunkMax: 2, rMin: 26, rMax: 46, tint: 0x8d7a5a },
    visionR: 0,
    hazardEvery: 0,
    hazard: { r: 100, dps: 15, life: 6, tele: 1, slowFactor: 1, color: 0x8fd8ff },
    eventBias: {},
  },
  {
    id: 'library', name: '静止图书馆', desc: '书架巷道 + **视线遮蔽**（视野外的敌人不可见也不被索敌）· 走位受限 · 膜拜者/织网蛛倾向上升',
    bgTint: 0xb9c4d8,
    weights: { moth: 0.3, hopper: 0.2, idol: 0.25, cultist: 0.25 },
    obstacles: { perChunkMin: 3, perChunkMax: 5, rMin: 34, rMax: 58, tint: 0x6f5a3e },
    visionR: 430,
    hazardEvery: 0,
    hazard: { r: 100, dps: 15, life: 6, tele: 1, slowFactor: 1, color: 0x8fd8ff },
    eventBias: { spring: 2 },
  },
  {
    id: 'ring', name: '崩坏之环', desc: '**同心圆环**通道 + 时潮涡流危险区（停留即受伤）· 湮灭蜂/跳针倾向上升 · 事件偏重：共鸣泉/停滞领域',
    bgTint: 0xffd0b0,
    weights: { moth: 0.35, hopper: 0.4, idol: 0.15, cultist: 0.1 },
    obstacles: { perChunkMin: 0, perChunkMax: 1, rMin: 26, rMax: 42, tint: 0xa8763f, pattern: 'rings' },
    visionR: 0,
    hazardEvery: 12,
    hazard: { r: 115, dps: 15, life: 9, tele: 1.2, slowFactor: 0.8, color: 0x8fd8ff },
    eventBias: { spring: 3, stasis: 1.5 },
  },
];

export function mapById(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0]!;
}

export function mapIndex(id: string): number {
  const i = MAPS.findIndex((m) => m.id === id);
  return i < 0 ? 0 : i;
}

/** 解锁链：第 0 张恒开；第 i 张需先通关第 i−1 张 */
export function mapUnlocked(id: string, beaten: readonly string[]): boolean {
  const i = mapIndex(id);
  if (i === 0) return true;
  return beaten.includes(MAPS[i - 1]!.id);
}
