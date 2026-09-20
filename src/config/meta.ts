/**
 * 回响密库（GDD §6.8.2）：
 * 局外永久天赋树，用时砂解锁；节点花费按支线内深度 d：cost(d) = 30 × 1.4^d。
 * M2 交付"骨架"18 节点（6 支线 × 3），M3 补全为 **6 支线 × 7 深度 = 42 节点**。
 * 每个节点 1–2 条效果（depth ≥ 5 的深层节点给两条，让深支线值得投资）；
 * 效果全部经 computeBonuses 汇总成 MetaBonuses，再由此驱动开局属性/局内机制。
 */

export interface MetaNode {
  id: string;
  branch: string;
  name: string;
  desc: string;
  /** 支线内深度（决定花费，0–6） */
  depth: number;
  effect: MetaEffectKey;
  value: number;
  /** 深层节点的第二条效果（可选） */
  effect2?: MetaEffectKey;
  value2?: number;
}

export type MetaEffectKey =
  | 'hpBonus'
  | 'levelHealBonus'
  | 'windowBonus'
  | 'gaugeGainPct'
  | 'gaugeStart'
  | 'resDmgPct'
  | 'pincerDmgPct'
  | 'syncBonusPct'
  | 'sandPct'
  | 'winSandPct'
  | 'xpPct'
  | 'rerollBonus'
  | 'choiceBonus'
  | 'critBonus'
  | 'startWeaponLv'
  | 'echoDmgPct'
  | 'burstRadiusPct'
  | 'burstDmgPct'
  | 'burstInvulnBonus'
  | 'pickupPct'
  | 'moveSpdPct'
  | 'cdPct'
  | 'armorPct'
  | 'regenPerSec';

export const META_BRANCHES = ['时相', '共鸣', '贪婪', '命运', '织造', '中枢'] as const;

/** 支线内最大深度（0–6 共 7 层，6 支线 = 42 节点） */
export const META_MAX_DEPTH = 6;

export const META_NODES: readonly MetaNode[] = [
  // ---------- 时相（生存） ----------
  { id: 'phase1', branch: '时相', name: '生命 +15', desc: '生命上限 +15', depth: 0, effect: 'hpBonus', value: 15 },
  { id: 'phase2', branch: '时相', name: '拾取 +15%', desc: '拾取半径 +15%', depth: 1, effect: 'pickupPct', value: 0.15 },
  { id: 'phase3', branch: '时相', name: '时相核心', desc: '生命上限 +25 · 升级回复 +3', depth: 2, effect: 'hpBonus', value: 25, effect2: 'levelHealBonus', value2: 3 },
  { id: 'phase4', branch: '时相', name: '甲壳', desc: '受到伤害 −4%', depth: 3, effect: 'armorPct', value: 0.04 },
  { id: 'phase5', branch: '时相', name: '再生', desc: '每秒回复 0.4 生命', depth: 4, effect: 'regenPerSec', value: 0.4 },
  { id: 'phase6', branch: '时相', name: '生命 +30', desc: '生命上限 +30', depth: 5, effect: 'hpBonus', value: 30 },
  { id: 'phase7', branch: '时相', name: '时相终章', desc: '受到伤害 −6% · 每秒回复 0.6 生命', depth: 6, effect: 'armorPct', value: 0.06, effect2: 'regenPerSec', value2: 0.6 },
  // ---------- 共鸣（核心机制） ----------
  { id: 'res1', branch: '共鸣', name: '共鸣窗口 +0.1s', desc: '共鸣判定窗口 +0.1s', depth: 0, effect: 'windowBonus', value: 0.1 },
  { id: 'res2', branch: '共鸣', name: '共鸣值 +10%', desc: '共鸣值获取 +10%', depth: 1, effect: 'gaugeGainPct', value: 0.1 },
  { id: 'res3', branch: '共鸣', name: '共鸣伤 +15%', desc: '共鸣击伤害 +15%', depth: 2, effect: 'resDmgPct', value: 0.15 },
  { id: 'res4', branch: '共鸣', name: '开局共鸣值 +20', desc: '开局自带 20 点共鸣值', depth: 3, effect: 'gaugeStart', value: 20 },
  { id: 'res5', branch: '共鸣', name: '夹击 +20%', desc: '双影夹击伤害 +20%', depth: 4, effect: 'pincerDmgPct', value: 0.2 },
  { id: 'res6', branch: '共鸣', name: '同步上限 +15%', desc: '回响同步 ramp 上限 +15%', depth: 5, effect: 'syncBonusPct', value: 0.15 },
  { id: 'res7', branch: '共鸣', name: '共鸣之核', desc: '共鸣击伤害 +20% · 判定窗口 +0.1s', depth: 6, effect: 'resDmgPct', value: 0.2, effect2: 'windowBonus', value2: 0.1 },
  // ---------- 贪婪（经济） ----------
  { id: 'greed1', branch: '贪婪', name: '时砂 +10%', desc: '结算时砂 +10%', depth: 0, effect: 'sandPct', value: 0.1 },
  { id: 'greed2', branch: '贪婪', name: '移速 +5%', desc: '移动速度 +5%', depth: 1, effect: 'moveSpdPct', value: 0.05 },
  { id: 'greed3', branch: '贪婪', name: '琥珀之心', desc: '胜利时砂 ×1.25', depth: 2, effect: 'winSandPct', value: 0.25 },
  { id: 'greed4', branch: '贪婪', name: '经验 +10%', desc: '经验获取 +10%', depth: 3, effect: 'xpPct', value: 0.1 },
  { id: 'greed5', branch: '贪婪', name: '拾取 +20%', desc: '拾取半径 +20%', depth: 4, effect: 'pickupPct', value: 0.2 },
  { id: 'greed6', branch: '贪婪', name: '时砂 +15%', desc: '结算时砂 +15%', depth: 5, effect: 'sandPct', value: 0.15 },
  { id: 'greed7', branch: '贪婪', name: '丰收之环', desc: '经验 +15% · 拾取半径 +20%', depth: 6, effect: 'xpPct', value: 0.15, effect2: 'pickupPct', value2: 0.2 },
  // ---------- 命运（随机性控制） ----------
  { id: 'fate1', branch: '命运', name: '重掷 +1', desc: '每局额外 1 次重掷', depth: 0, effect: 'rerollBonus', value: 1 },
  { id: 'fate2', branch: '命运', name: '会心 +3%', desc: '暴击率 +3%', depth: 1, effect: 'critBonus', value: 0.03 },
  { id: 'fate3', branch: '命运', name: '命运之轮', desc: '重掷 +1 · 暴击率 +3%', depth: 2, effect: 'rerollBonus', value: 1, effect2: 'critBonus', value2: 0.03 },
  { id: 'fate4', branch: '命运', name: '会心 +4%', desc: '暴击率 +4%', depth: 3, effect: 'critBonus', value: 0.04 },
  { id: 'fate5', branch: '命运', name: '四选一', desc: '升级面板多 1 个选项（3 → 4）', depth: 4, effect: 'choiceBonus', value: 1 },
  { id: 'fate6', branch: '命运', name: '会心 +5%', desc: '暴击率 +5%', depth: 5, effect: 'critBonus', value: 0.05 },
  { id: 'fate7', branch: '命运', name: '命运主宰', desc: '暴击率 +6% · 升级面板再多 1 个选项', depth: 6, effect: 'critBonus', value: 0.06, effect2: 'choiceBonus', value2: 1 },
  // ---------- 织造（开局构筑） ----------
  { id: 'weave1', branch: '织造', name: '初始武器 Lv2', desc: '开局起始武器直接 Lv2', depth: 0, effect: 'startWeaponLv', value: 1 },
  { id: 'weave2', branch: '织造', name: '冷却 −5%', desc: '武器冷却 −5%', depth: 1, effect: 'cdPct', value: 0.05 },
  { id: 'weave3', branch: '织造', name: '织者印记', desc: '开局武器 Lv2 · 冷却再 −5%', depth: 2, effect: 'startWeaponLv', value: 1, effect2: 'cdPct', value2: 0.05 },
  { id: 'weave4', branch: '织造', name: '残影伤害 +8%', desc: '残影造成的伤害 +8%', depth: 3, effect: 'echoDmgPct', value: 0.08 },
  { id: 'weave5', branch: '织造', name: '残影伤害 +12%', desc: '残影造成的伤害 +12%', depth: 4, effect: 'echoDmgPct', value: 0.12 },
  { id: 'weave6', branch: '织造', name: '冷却 −6%', desc: '武器冷却 −6%', depth: 5, effect: 'cdPct', value: 0.06 },
  { id: 'weave7', branch: '织造', name: '织造终章', desc: '残影伤害 +15% · 开局武器再 +1 级', depth: 6, effect: 'echoDmgPct', value: 0.15, effect2: 'startWeaponLv', value2: 1 },
  // ---------- 中枢（同步爆发） ----------
  { id: 'core1', branch: '中枢', name: '爆发半径 +10%', desc: '同步爆发半径 +10%', depth: 0, effect: 'burstRadiusPct', value: 0.1 },
  { id: 'core2', branch: '中枢', name: '爆发伤害 +10%', desc: '同步爆发伤害 +10%', depth: 1, effect: 'burstDmgPct', value: 0.1 },
  { id: 'core3', branch: '中枢', name: '回响永续', desc: '爆发后无敌 +0.25s', depth: 2, effect: 'burstInvulnBonus', value: 0.25 },
  { id: 'core4', branch: '中枢', name: '爆发伤害 +15%', desc: '同步爆发伤害 +15%', depth: 3, effect: 'burstDmgPct', value: 0.15 },
  { id: 'core5', branch: '中枢', name: '爆发半径 +15%', desc: '同步爆发半径 +15%', depth: 4, effect: 'burstRadiusPct', value: 0.15 },
  { id: 'core6', branch: '中枢', name: '无敌 +0.25s', desc: '爆发后无敌再 +0.25s', depth: 5, effect: 'burstInvulnBonus', value: 0.25 },
  { id: 'core7', branch: '中枢', name: '中枢奇点', desc: '爆发伤害 +25% · 半径 +15%', depth: 6, effect: 'burstDmgPct', value: 0.25, effect2: 'burstRadiusPct', value2: 0.15 },
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
