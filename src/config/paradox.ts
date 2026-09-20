/**
 * 悖论难度 0–5（GDD §6.8.3）——M3 实装。
 * 解锁规则：胜利后逐级解锁（打过第 n 级才能进第 n+1 级），并存档最高已通关等级。
 * 奖励：每级 +10% 结算时砂（GDD §6.8.3）。
 */
export interface ParadoxMods {
  enemySpeedPct?: number;
  spawnPct?: number;
  eliteFreqMult?: number;
  hpPct?: number;
  enemyDmgPct?: number;
  bossHpPct?: number;
}

export interface ParadoxDef {
  lvl: number;
  name: string;
  desc: string;
  mods: ParadoxMods;
}

export const PARADOX: readonly ParadoxDef[] = [
  { lvl: 0, name: '标准', desc: '无修正', mods: {} },
  { lvl: 1, name: '阴风', desc: '敌移速 +8%', mods: { enemySpeedPct: 0.08 } },
  { lvl: 2, name: '密潮', desc: '生成 +15%', mods: { spawnPct: 0.15 } },
  { lvl: 3, name: '精英律', desc: '精英频率 ×1.5', mods: { eliteFreqMult: 1.5 } },
  { lvl: 4, name: '玻璃共振', desc: '玩家生命 −25%、敌伤 +15%', mods: { hpPct: -0.25, enemyDmgPct: 0.15 } },
  {
    lvl: 5, name: '终末回响', desc: '以上全部叠加 + Boss 生命 +20%',
    mods: { enemySpeedPct: 0.08, spawnPct: 0.15, eliteFreqMult: 1.5, hpPct: -0.25, enemyDmgPct: 0.15, bossHpPct: 0.2 },
  },
];

export function paradoxByLvl(lvl: number): ParadoxDef {
  return PARADOX[Math.min(Math.max(lvl, 0), PARADOX.length - 1)]!;
}

/** 每级 +10% 时砂 */
export function paradoxSandMult(lvl: number): number {
  return 1 + 0.1 * Math.max(0, lvl);
}
