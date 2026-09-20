/**
 * 成就（M3 / Steam EA 前置）。
 *
 * 设计原则：
 * 1. **全部可从"一局结束时的统计 + 存档状态"判定**——不需要在战斗热路径里埋点，
 *    也不会因为中途崩溃而丢掉判定（局末统一评估，配合 diagnostics 的崩溃统计）。
 * 2. **本地优先**：解锁记录写进存档（`saved.achievements`），无 Steam 也能玩；
 *    Steamworks 接入时只需实现 `AchievementSink` 并注册进 `registerSink()`（见文件末尾说明）。
 * 3. 成就分四类：**首次体验 / 机制精通 / 数值里程碑 / 长期收集**，与 §6.8 的留存钩子对齐。
 */

export type AchievementCategory = 'first' | 'mechanic' | 'milestone' | 'collect';

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  category: AchievementCategory;
  /** true = 可在一局内达成（局末评估）；false = 长期/跨局达成（也走局末评估，但看的是存档） */
  inRun: boolean;
  /** 判定：给全 0 的上下文即为"未达成" */
  test: (c: AchievementContext) => boolean;
  /** 达成进度的可读描述（用于面板显示进度，如 "820 / 1000"） */
  progress?: (c: AchievementContext) => string;
}

/** 局末上下文：一局的全部可判定事实（不含任何游戏内部对象，便于测试与云端判定） */
export interface AchievementContext {
  /** 本局存活秒数 */
  time: number;
  win: boolean;
  level: number;
  kills: number;
  /** 本局共鸣击 / 夹击次数 */
  resHits: number;
  pincerHits: number;
  /** 本局最长连续同步（秒） */
  syncMaxStreak: number;
  /** 本局进化体数量 / 武器数 / 被动数 / Boss 击杀 / 精英击杀 */
  evolutions: number;
  weapons: number;
  passives: number;
  bossKills: number;
  elitesKilled: number;
  /** 本局配置 */
  paradox: number;
  isDaily: boolean;
  /** 跨局：历史局数（含本局）、已通关地图集合、密库节点数、图鉴解锁数 */
  runs: number;
  mapsBeaten: number;
  metaNodes: number;
  codexSeen: number;
}

const pct = (c: AchievementContext, k: keyof AchievementContext, target: number): string =>
  `${Math.min(target, Number(c[k]) || 0)} / ${target}`;

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // ---------- 首次体验 ----------
  { id: 'first_run', name: '初次回响', desc: '完成第一局', category: 'first', inRun: true, test: (c) => c.runs >= 1 },
  { id: 'first_win', name: '时间为你停留', desc: '击杀时间织造者·诺诺，通关一局', category: 'first', inRun: true, test: (c) => c.win },
  { id: 'first_evolve', name: '第一次进化', desc: '在祭坛完成一次武器进化', category: 'first', inRun: true, test: (c) => c.evolutions >= 1 },
  { id: 'first_daily', name: '今日份的回响', desc: '完成一次每日挑战', category: 'first', inRun: true, test: (c) => c.isDaily },

  // ---------- 机制精通（服务 §5.4 编队走位与共鸣） ----------
  {
    id: 'res_100', name: '共鸣入门', desc: '单局共鸣击 ≥100 次', category: 'mechanic', inRun: true,
    test: (c) => c.resHits >= 100, progress: (c) => pct(c, 'resHits', 100),
  },
  {
    id: 'res_500', name: '共鸣狂潮', desc: '单局共鸣击 ≥500 次', category: 'mechanic', inRun: true,
    test: (c) => c.resHits >= 500, progress: (c) => pct(c, 'resHits', 500),
  },
  {
    id: 'pincer_50', name: '双影夹击', desc: '单局双影夹击 ≥50 次（把敌人夹在本体与残影之间）', category: 'mechanic', inRun: true,
    test: (c) => c.pincerHits >= 50, progress: (c) => pct(c, 'pincerHits', 50),
  },
  {
    id: 'sync_15s', name: '编队大师', desc: '连续保持回响同步 ≥15 秒', category: 'mechanic', inRun: true,
    test: (c) => c.syncMaxStreak >= 15, progress: (c) => `${c.syncMaxStreak.toFixed(1)} / 15.0 s`,
  },
  {
    id: 'weapons_6', name: '全副武装', desc: '单局同时持有 6 件武器', category: 'mechanic', inRun: true,
    test: (c) => c.weapons >= 6, progress: (c) => pct(c, 'weapons', 6),
  },
  {
    id: 'passives_8', name: '满编被动', desc: '单局同时持有 8 项被动', category: 'mechanic', inRun: true,
    test: (c) => c.passives >= 8, progress: (c) => pct(c, 'passives', 8),
  },

  // ---------- 数值里程碑 ----------
  {
    id: 'level_30', name: '渐入佳境', desc: '单局达到 Lv30', category: 'milestone', inRun: true,
    test: (c) => c.level >= 30, progress: (c) => `Lv ${Math.min(30, c.level)} / 30`,
  },
  {
    id: 'level_50', name: '时间的极限', desc: '单局达到 Lv50', category: 'milestone', inRun: true,
    test: (c) => c.level >= 50, progress: (c) => `Lv ${Math.min(50, c.level)} / 50`,
  },
  {
    id: 'kills_3000', name: '收割者', desc: '单局击杀 ≥3000', category: 'milestone', inRun: true,
    test: (c) => c.kills >= 3000, progress: (c) => pct(c, 'kills', 3000),
  },
  {
    id: 'boss_4', name: '四连斩', desc: '单局击杀全部 4 只 Boss', category: 'milestone', inRun: true,
    test: (c) => c.bossKills >= 4, progress: (c) => `${Math.min(4, c.bossKills)} / 4`,
  },
  {
    id: 'evolve_3', name: '三重进化', desc: '单局拥有 3 件进化体', category: 'milestone', inRun: true,
    test: (c) => c.evolutions >= 3, progress: (c) => pct(c, 'evolutions', 3),
  },
  {
    id: 'paradox_3', name: '悖论行者', desc: '以悖论难度 ≥3 通关', category: 'milestone', inRun: true,
    test: (c) => c.win && c.paradox >= 3, progress: (c) => `悖论 ${Math.min(3, c.paradox)} / 3`,
  },
  {
    id: 'elites_20', name: '精英猎人', desc: '单局击杀 ≥20 只精英', category: 'milestone', inRun: true,
    test: (c) => c.elitesKilled >= 20, progress: (c) => pct(c, 'elitesKilled', 20),
  },

  // ---------- 长期收集 ----------
  { id: 'maps_3', name: '走遍三时', desc: '三张地图各通关一次', category: 'collect', inRun: false, test: (c) => c.mapsBeaten >= 3, progress: (c) => `${Math.min(3, c.mapsBeaten)} / 3` },
  { id: 'meta_42', name: '密库全开', desc: '解锁全部 42 个密库节点', category: 'collect', inRun: false, test: (c) => c.metaNodes >= 42, progress: (c) => pct(c, 'metaNodes', 42) },
  { id: 'codex_all', name: '图鉴全开', desc: '图鉴 9 条全部解锁', category: 'collect', inRun: false, test: (c) => c.codexSeen >= 9, progress: (c) => pct(c, 'codexSeen', 9) },
  { id: 'runs_20', name: '回响成瘾', desc: '累计完成 20 局', category: 'collect', inRun: false, test: (c) => c.runs >= 20, progress: (c) => pct(c, 'runs', 20) },
];

export const ACHIEVEMENT_TOTAL = ACHIEVEMENTS.length;

/** 全 0 上下文（面板显示进度用） */
export const EMPTY_CTX: AchievementContext = {
  time: 0, win: false, level: 0, kills: 0, resHits: 0, pincerHits: 0, syncMaxStreak: 0,
  evolutions: 0, weapons: 0, passives: 0, bossKills: 0, elitesKilled: 0,
  paradox: 0, isDaily: false, runs: 0, mapsBeaten: 0, metaNodes: 0, codexSeen: 0,
};

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/**
 * 评估：返回本次**新解锁**的成就 id 列表（已解锁的不会重复返回）。
 * `unlocked` 是存档里的记录（id → 解锁时间），本函数不修改它，由调用方写入。
 */
export function evaluateAchievements(c: AchievementContext, unlocked: Record<string, string>): string[] {
  const out: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked[a.id]) continue;
    if (a.test(c)) out.push(a.id);
  }
  return out;
}

/**
 * Steamworks 接入点（M3 只做接口，不引依赖）：
 * 打包成 Tauri/Electron 后，在 `registerSink()` 里传一个把 `unlock` 转发到 `SteamUserStats`
 * （`SetAchievement` + `StoreStats`）的实现即可；本地 sink 仍然保留，保证离线可玩。
 * 注意：Steam 成就的 API 名必须在 Steamworks 后台先建好，id 与这里的 `a.id` 保持一致。
 */
export interface AchievementSink {
  unlock(id: string): void;
}

let sink: AchievementSink | null = null;

export function registerSink(s: AchievementSink | null): void {
  sink = s;
}

export function emitUnlock(id: string): void {
  sink?.unlock(id);
}
