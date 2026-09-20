/**
 * 难度预设（M3 新增，用于试玩时量测"人类存活曲线"）。
 *
 * 背景：机器人不会规避弹幕，无法裁决 M3 的"中位局时长 ≥18min"（见实测记录 §18）。
 * 因此把 §18 列出的调参杠杆做成**可切换预设**，让 15 人试玩时能在同一构建里跑不同难度，
 * 一次拿到"难度 → 存活中位"的对应曲线，再定标准局参数。
 *
 * ⚠ 这**不在 GDD 原文中**：GDD 的难度轴只有"悖论 0–5（更难）"。本预设提供的是**更易一档**，
 * 属可访问性/校准工具，结算与遥测都会记录所用预设，便于事后按预设切分数据。
 */
export interface DifficultyDef {
  id: 'casual' | 'standard' | 'hard';
  name: string;
  desc: string;
  /** 受击宽限相对变化（标准 1.0s）：+0.5 ⇒ 1.5s，单位时间最多只吃 1 次 */
  hurtGracePct: number;
  /** 接触伤相对变化 */
  contactDmgPct: number;
  /** 升级回复的额外点数 */
  levelHealBonus: number;
  /** Boss 弹幕数量/弹速/伤害倍率 */
  bossBulletCountMult: number;
  bossBulletSpeedMult: number;
  bossBulletDmgMult: number;
  /** 生成速率相对变化 */
  spawnPct: number;
}

export const DIFFICULTIES: readonly DifficultyDef[] = [
  {
    id: 'casual', name: '恩惠（试玩向）',
    desc: '受击宽限 1.5s · 接触伤 −40% · 升级回复 +10 · Boss 弹幕数量 −30%/弹速 −15%/伤害 −40% · 生成 −15%',
    hurtGracePct: 0.5, contactDmgPct: -0.4, levelHealBonus: 10,
    bossBulletCountMult: 0.7, bossBulletSpeedMult: 0.85, bossBulletDmgMult: 0.6, spawnPct: -0.15,
  },
  {
    id: 'standard', name: '标准',
    desc: 'GDD 当前基线（受击宽限 1.0s、Boss 弹幕原值、生成原值）',
    hurtGracePct: 0, contactDmgPct: 0, levelHealBonus: 0,
    bossBulletCountMult: 1, bossBulletSpeedMult: 1, bossBulletDmgMult: 1, spawnPct: 0,
  },
  {
    id: 'hard', name: '严苛',
    desc: '受击宽限 0.7s · 接触伤 +25% · 升级回复 −5 · Boss 弹幕 +25%/+15%/+25% · 生成 +10%',
    hurtGracePct: -0.3, contactDmgPct: 0.25, levelHealBonus: -5,
    bossBulletCountMult: 1.25, bossBulletSpeedMult: 1.15, bossBulletDmgMult: 1.25, spawnPct: 0.1,
  },
];

export function difficultyById(id: string): DifficultyDef {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1]!;
}
