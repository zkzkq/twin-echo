/**
 * 每日挑战（GDD §6.8.4）——M3 实装。
 * 固定种子（由日期推导）+ 每日轮换变异（8 种池）+ 角色固定（保证同一日的公平性）
 * + 每日首通 +300 时砂（防刷：按日期记录，同日只发一次）+ 本地排行榜（localStorage）。
 */
export interface DailyMod {
  id: string;
  name: string;
  desc: string;
  enemySpeedPct?: number;
  spawnPct?: number;
  eliteFreqMult?: number;
  echoCoeff?: number;
  resWindowBonus?: number;
  gaugeGainPct?: number;
  noPassive?: boolean;
}

export const DAILY_POOL: readonly DailyMod[] = [
  { id: 'wind', name: '逆风', desc: '敌移速 +30%', enemySpeedPct: 0.3 },
  { id: 'dense', name: '密潮', desc: '生成 +25%', spawnPct: 0.25 },
  { id: 'elite', name: '精英律', desc: '精英频率 ×2', eliteFreqMult: 2 },
  { id: 'twinfury', name: '双影狂热', desc: '残影伤害系数 0.6 → 0.8（残影更强，本体不变）', echoCoeff: 0.8 },
  { id: 'resonant', name: '共振激化', desc: '共鸣窗口 1.0s → 1.4s', resWindowBonus: 0.4 },
  { id: 'spring', name: '共鸣涌泉', desc: '共鸣值获取 ×1.5', gaugeGainPct: 0.5 },
  { id: 'nopassive', name: '无被动日', desc: '升级选项不出现被动（只能升级/获取武器）', noPassive: true },
  { id: 'quiet', name: '静滞前夜', desc: '生成 −15%（更少敌人，但 Boss 生命 +20%）', spawnPct: -0.15 },
];

export const DAILY_FIRST_CLEAR_SAND = 300;

/** 本地日期键（YYYY-MM-DD，按本地时区） */
export function dailyKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 由日期键导出确定性种子（FNV-1a 变体，保证同一天每次进入都是同一局） */
export function dailySeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

/** 从键派生一个小整数，用于轮换变异/角色 */
function dailyIndex(key: string, mod: number): number {
  return Math.abs(dailySeed(`${key}#${mod}`)) % mod;
}

export function dailyMod(key: string): DailyMod {
  return DAILY_POOL[dailyIndex(key, DAILY_POOL.length)]!;
}

export function dailyModForPool(key: string, pool: readonly DailyMod[]): DailyMod {
  return pool[dailyIndex(key, pool.length)] ?? pool[0]!;
}

/** 每日固定角色（同一日所有玩家同一角色，保证榜单可比） */
export function dailyCharacterId(key: string, ids: readonly string[]): string {
  return ids[dailyIndex(key, ids.length)] ?? ids[0]!;
}
