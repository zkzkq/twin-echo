/**
 * 作弊码（M3）：开发/QA 工具 + 玩家玩具。
 *
 * 设计约定（重要，别绕过）：
 * 1. **一律走 `applyCheat()`**：它负责"归一化输入 → 查表 → 不可重复检查 → 标记 `world.cheated` → 遥测"。
 *    直接改字段不会标记作弊局，会污染验收数据（成就/最佳/中位局时长都会算上作弊局）。
 * 2. **`world.cheated` 是隔离开关**：作弊局不计成就、不更新历史最佳、不进验收报告的中位样本
 *    （沙与时砂照给——单人玩具里拦不住，也不值得拦）。
 * 3. 作弊码表是**数据**：加一条 = 加一行 + 在 `CheatCtx` 里接一个能力（需要新能力就加到 Ctx 上，
 *    不要在 cheats.ts 里 import Game 去摸私有字段——那会把测试和循环依赖一起带进来）。
 * 4. 输入归一化：大小写不敏感、忽略空格/连字符/下划线；`HELP` 打印全表。
 */

import { EVOLUTIONS, PASSIVES, WEAPONS, recompute } from '../config/items';
import type { BossKind } from './types';
import type { World } from './world';

/** 作弊码可用的特权能力（由 Game 实现——只有它能碰存档、UI 与召唤逻辑） */
export interface CheatCtx {
  world: World;
  /** 给存档加时砂（局外货币），立即保存 */
  addSand(n: number): void;
  /** 解锁全部密库节点，返回节点总数 */
  unlockAllMeta(): number;
  /** 直接结算胜利（把时钟推到终局并移除终 Boss） */
  forceWin(): void;
  /** 立刻召唤 Boss；kind 为空则按当前进度取下一只 */
  summonBoss(kind: BossKind | ''): string;
  /** 作弊码清单文本（HELP 用） */
  helpText(): string;
}

export interface CheatDef {
  /** 主码（比对前会归一化为大写去符号） */
  code: string;
  alias?: readonly string[];
  name: string;
  desc: string;
  /** false = 一局内只能用一次（改存档/跳关/直接胜利这类，避免刷） */
  repeatable: boolean;
  /** 返回给玩家的结果文案 */
  apply: (c: CheatCtx) => string;
}

/** 归一化：大写、去掉空格/连字符/下划线/中点 */
export function normalizeCheat(input: string): string {
  return input.trim().toUpperCase().replace(/[\s\-_·]/g, '');
}

export const CHEATS: readonly CheatDef[] = [
  {
    code: 'HEAL', alias: ['HP', 'FULLHEAL'], name: '回响续命', desc: '生命回满 + 3 秒无敌', repeatable: true,
    apply: (c) => {
      const p = c.world.player;
      p.hp = p.maxHp;
      p.invulnT = Math.max(p.invulnT, 3);
      return `生命回满（${p.maxHp}），并获得 3 秒无敌`;
    },
  },
  {
    code: 'MAXWEAPON', alias: ['MAXW'], name: '针针满级', desc: '当前持有的武器全部升到 Lv6', repeatable: true,
    apply: (c) => {
      const p = c.world.player;
      if (p.weapons.size === 0) p.weapons.set('clock', { lv: 6, cd: 0 });
      for (const [, st] of p.weapons) st.lv = 6;
      return `持有的 ${p.weapons.size} 件武器全部升到 Lv6`;
    },
  },
  {
    code: 'ALLWEAPON', alias: ['ALLW'], name: '十二时相', desc: '一次入手全部 12 把武器（Lv6）', repeatable: true,
    apply: (c) => {
      const p = c.world.player;
      for (const d of WEAPONS) {
        const st = p.weapons.get(d.id);
        if (st) st.lv = 6;
        else p.weapons.set(d.id, { lv: 6, cd: 0 });
      }
      return `${WEAPONS.length} 把武器全部 Lv6`;
    },
  },
  {
    code: 'MAXPASSIVE', alias: ['MAXP'], name: '满编回响', desc: '15 项被动全部 Lv5（属性重算）', repeatable: true,
    apply: (c) => {
      const p = c.world.player;
      for (const d of PASSIVES) p.passives.set(d.id, 5);
      recompute(p);
      return `${PASSIVES.length} 项被动全部 Lv5`;
    },
  },
  {
    code: 'EVOLVE', alias: ['EVO'], name: '六重织造', desc: '直接获得全部 6 件进化体（自动补齐武器/被动/结晶）', repeatable: false,
    apply: (c) => {
      const p = c.world.player;
      for (const e of EVOLUTIONS) {
        const st = p.weapons.get(e.weapon);
        if (st) st.lv = 6;
        else p.weapons.set(e.weapon, { lv: 6, cd: 0 });
        if ((p.passives.get(e.passive) ?? 0) < 5) {
          p.passives.set(e.passive, 5);
          recompute(p);
        }
        p.evolutions.add(e.id);
      }
      return `${EVOLUTIONS.length} 件进化体全部入手`;
    },
  },
  {
    code: 'LEVELUP', alias: ['LV'], name: '时间加速', desc: '直接 +10 级（含每级回复）', repeatable: true,
    apply: (c) => {
      const w = c.world;
      const p = w.player;
      let healed = 0;
      for (let i = 0; i < 10; i++) {
        p.level++;
        w.stats.levelsGained++;
        const before = p.hp;
        p.hp = Math.min(p.maxHp, p.hp + 15);
        healed += p.hp - before;
      }
      p.xpNeed = Math.max(1, Math.round(6 + 4.5 * Math.pow(p.level - 1, 1.4)));
      p.xp = 0;
      return `等级 +10 → Lv${p.level}（回复 ${Math.round(healed)} 生命）`;
    },
  },
  {
    code: 'KILLALL', alias: ['CLEARSCREEN'], name: '静止潮汐', desc: '清空场上所有非 Boss 敌人（掉落照常）', repeatable: true,
    apply: (c) => {
      const w = c.world;
      let n = 0;
      for (const e of w.enemies.items) {
        if (!e.active || e.boss) continue;
        n++;
        w.killEnemy(e);
      }
      return `清空 ${n} 个敌人（Boss 除外）`;
    },
  },
  {
    code: 'FREEZE', alias: ['STASIS', 'TIMESTOP'], name: '时停', desc: '全场敌人定身 8 秒', repeatable: true,
    apply: (c) => {
      const w = c.world;
      let n = 0;
      for (const e of w.enemies.items) {
        if (!e.active) continue;
        e.frozenT = Math.max(e.frozenT, 8);
        n++;
      }
      return `${n} 个敌人被定身 8 秒`;
    },
  },
  {
    code: 'GOD', alias: ['INVINCIBLE'], name: '回响不灭', desc: '切换免伤（开/关）', repeatable: true,
    apply: (c) => {
      c.world.godMode = !c.world.godMode;
      return c.world.godMode ? '免伤已开启（不会再掉血，也不进无敌帧特效）' : '免伤已关闭';
    },
  },
  {
    code: 'GAUGE', alias: ['BURSTREADY'], name: '共鸣满溢', desc: '共鸣值立刻充满（可直接放同步爆发）', repeatable: true,
    apply: (c) => {
      c.world.player.gauge = 100;
      return '共鸣值已充满——按 空格 释放同步爆发';
    },
  },
  {
    code: 'NOFOG', alias: ['VISION'], name: '开卷', desc: '切换无视视野遮蔽（图书馆调试用）', repeatable: true,
    apply: (c) => {
      c.world.cheatNoFog = !c.world.cheatNoFog;
      return c.world.cheatNoFog ? '视野遮蔽已关闭（全图可见）' : '视野遮蔽已恢复';
    },
  },
  {
    code: 'BOSS', alias: ['SUMMON'], name: '织造者降临', desc: '立刻召唤下一只 Boss（跳过日程）', repeatable: true,
    apply: (c) => `已召唤 ${c.summonBoss('')}`,
  },
  {
    code: 'WEAVER', alias: ['NONO'], name: '终末提前', desc: '立刻召唤 20:00 时间织造者·诺诺', repeatable: false,
    apply: (c) => `已召唤 ${c.summonBoss('weaver')}`,
  },
  {
    code: 'SANDBAG', alias: ['SAND'], name: '时砂满仓', desc: '时砂 +99999（局外货币，立即存档）', repeatable: false,
    apply: (c) => {
      c.addSand(99999);
      return '时砂 +99999（已写入存档）';
    },
  },
  {
    code: 'METAFULL', alias: ['META'], name: '密库全开', desc: '解锁全部 42 个密库节点', repeatable: false,
    apply: (c) => `密库已解锁 ${c.unlockAllMeta()} 个节点`,
  },
  {
    code: 'WIN', alias: ['FORCEWIN'], name: '时间为你停留', desc: '立刻结算胜利（演示/验收用）', repeatable: false,
    apply: (c) => {
      c.forceWin();
      return '时钟已推到终局——下一帧结算胜利';
    },
  },
  {
    code: 'KONAMI', alias: ['↑↑↓↓←→←→BA'], name: '残影之友', desc: '彩蛋：回满血 + 全武器满级 + 被动满级 + 共鸣满 + 3000 时砂', repeatable: false,
    apply: (c) => {
      const p = c.world.player;
      p.hp = p.maxHp;
      p.invulnT = Math.max(p.invulnT, 3);
      p.gauge = 100;
      for (const d of WEAPONS) {
        const st = p.weapons.get(d.id);
        if (st) st.lv = 6;
        else p.weapons.set(d.id, { lv: 6, cd: 0 });
      }
      for (const d of PASSIVES) p.passives.set(d.id, 5);
      recompute(p);
      c.addSand(3000);
      return '残影之友：满血 + 12 武器 Lv6 + 15 被动 Lv5 + 共鸣满 + 时砂 +3000';
    },
  },
  {
    code: 'HELP', alias: ['?', 'CHEATS'], name: '作弊码清单', desc: '列出全部作弊码', repeatable: true,
    apply: (c) => c.helpText(),
  },
];

export function findCheat(input: string): CheatDef | null {
  const n = normalizeCheat(input);
  if (!n) return null;
  for (const c of CHEATS) {
    if (normalizeCheat(c.code) === n) return c;
    if (c.alias?.some((a) => normalizeCheat(a) === n)) return c;
  }
  return null;
}

export interface CheatResult {
  ok: boolean;
  /** 给玩家的文案（未知码/重复码也有） */
  msg: string;
  def?: CheatDef;
}

/**
 * 统一入口：查表 → 不可重复检查 → 执行 → 标记作弊局（`world.cheated = true`）。
 * `used` 是**每局**用过的码集合（startRun 时清空）。
 */
export function applyCheat(input: string, ctx: CheatCtx, used: Set<string>): CheatResult {
  const def = findCheat(input);
  if (!def) return { ok: false, msg: `无法识别的作弊码「${input.trim()}」（输入 HELP 查看全部）` };
  if (!def.repeatable && used.has(def.code)) {
    return { ok: false, msg: `作弊码「${def.code}」本局已经用过（不可重复）`, def };
  }
  used.add(def.code);
  let msg: string;
  try {
    msg = def.apply(ctx);
  } catch (err) {
    return { ok: false, msg: `作弊码「${def.code}」执行失败：${err instanceof Error ? err.message : String(err)}`, def };
  }
  ctx.world.cheated = true;
  return { ok: true, msg, def };
}
