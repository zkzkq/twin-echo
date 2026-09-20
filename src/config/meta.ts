/**
 * 回响密库（GDD §6.8.2，M2 骨架版）：
 * 局外永久天赋树，用时砂解锁；节点花费按支线内深度 d：cost(d) = 30 × 1.4^d。
 * M2 交付"骨架"：6 支线 × 3 节点 = 18 节点（GDD 完整版为 5 支线 + 中枢共 42 节点，M3 补全），
 * 但效果链路（局外 → 开局属性/局内机制）已完整打通，新增节点只需在此表加一行 + 在 meta.ts 里接一个 effect key。
 */

export interface MetaNode {
  id: string;
  branch: string;
  name: string;
  desc: string;
  /** 支线内深度（决定花费） */
  depth: number;
  effect: MetaEffectKey;
  value: number;
}

export type MetaEffectKey =
  | 'hpBonus'
  | 'levelHealBonus'
  | 'windowBonus'
  | 'gaugeGainPct'
  | 'resDmgPct'
  | 'sandPct'
  | 'winSandPct'
  | 'rerollBonus'
  | 'critBonus'
  | 'startWeaponLv'
  | 'burstRadiusPct'
  | 'burstDmgPct'
  | 'burstInvulnBonus'
  | 'pickupPct'
  | 'moveSpdPct'
  | 'cdPct';

export const META_BRANCHES = ['时相', '共鸣', '贪婪', '命运', '织造', '中枢'] as const;

export const META_NODES: readonly MetaNode[] = [
  // 时相（生存）
  { id: 'phase1', branch: '时相', name: '生命 +15', desc: '生命上限 +15', depth: 0, effect: 'hpBonus', value: 15 },
  { id: 'phase2', branch: '时相', name: '拾取 +15%', desc: '拾取半径 +15%', depth: 1, effect: 'pickupPct', value: 0.15 },
  { id: 'phase3', branch: '时相', name: '时相核心', desc: '生命上限 +25、升级回复 +3', depth: 2, effect: 'hpBonus', value: 25 },
  // 共鸣（核心机制）
  { id: 'res1', branch: '共鸣', name: '共鸣窗口 +0.1s', desc: '共鸣判定窗口 +0.1s', depth: 0, effect: 'windowBonus', value: 0.1 },
  { id: 'res2', branch: '共鸣', name: '共鸣值 +10%', desc: '共鸣值获取 +10%', depth: 1, effect: 'gaugeGainPct', value: 0.1 },
  { id: 'res3', branch: '共鸣', name: '共鸣伤 +15%', desc: '共鸣击伤害 +15%', depth: 2, effect: 'resDmgPct', value: 0.15 },
  // 贪婪（经济）
  { id: 'greed1', branch: '贪婪', name: '时砂 +10%', desc: '结算时砂 +10%', depth: 0, effect: 'sandPct', value: 0.1 },
  { id: 'greed2', branch: '贪婪', name: '移速 +5%', desc: '移动速度 +5%', depth: 1, effect: 'moveSpdPct', value: 0.05 },
  { id: 'greed3', branch: '贪婪', name: '琥珀之心', desc: '胜利时砂 ×1.25', depth: 2, effect: 'winSandPct', value: 0.25 },
  // 命运（随机性控制）
  { id: 'fate1', branch: '命运', name: '重掷 +1', desc: '每局额外 1 次重掷', depth: 0, effect: 'rerollBonus', value: 1 },
  { id: 'fate2', branch: '命运', name: '会心 +3%', desc: '暴击率 +3%', depth: 1, effect: 'critBonus', value: 0.03 },
  { id: 'fate3', branch: '命运', name: '命运之轮', desc: '重掷 +1、暴击率 +3%', depth: 2, effect: 'rerollBonus', value: 1 },
  // 织造（开局构筑）
  { id: 'weave1', branch: '织造', name: '初始武器 Lv2', desc: '开局起始武器直接 Lv2', depth: 0, effect: 'startWeaponLv', value: 1 },
  { id: 'weave2', branch: '织造', name: '冷却 −5%', desc: '武器冷却 −5%', depth: 1, effect: 'cdPct', value: 0.05 },
  { id: 'weave3', branch: '织造', name: '织者印记', desc: '开局武器 Lv2、冷却再 −5%', depth: 2, effect: 'startWeaponLv', value: 1 },
  // 中枢（同步爆发）
  { id: 'core1', branch: '中枢', name: '爆发半径 +10%', desc: '同步爆发半径 +10%', depth: 0, effect: 'burstRadiusPct', value: 0.1 },
  { id: 'core2', branch: '中枢', name: '爆发伤害 +10%', desc: '同步爆发伤害 +10%', depth: 1, effect: 'burstDmgPct', value: 0.1 },
  { id: 'core3', branch: '中枢', name: '回响永续', desc: '爆发后无敌 +0.25s', depth: 2, effect: 'burstInvulnBonus', value: 0.25 },
];

/** 支线内深度 d 的花费：30 × 1.4^d */
export function metaCost(depth: number): number {
  return Math.round(30 * Math.pow(1.4, depth));
}

/** 前置：同支线前一个深度必须已解锁 */
export function metaPrereq(node: MetaNode): MetaNode | null {
  if (node.depth === 0) return null;
  return (
    META_NODES.find((n) => n.branch === node.branch && n.depth === node.depth - 1) ?? null
  );
}

export function metaNodeById(id: string): MetaNode | undefined {
  return META_NODES.find((n) => n.id === id);
}
