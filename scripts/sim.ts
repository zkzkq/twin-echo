/**
 * M0-lite 单局节奏模拟（GDD §12.2 M0 的轻量版）：
 * 用 DPS/HP/生成曲线推演 10 分钟 MVP 局的击杀/分、终局等级、同屏峰值。
 *
 * 口径说明：
 * - 玩家 DPS = §7.5 面板 DPS 曲线 × (4/6 武器) × 1.6 残影系数；击杀效率取 0.65
 *   （与 §7.5 "AoE 理论清杀/秒 ÷ 击杀节拍" 的隐含效率一致）。
 * - §7.6 的击杀节拍区间（150@5min / 210@10min）是按 20 分钟完整局（6 武器+进化）标定的；
 *   10 分钟 MVP 只有 4 武器且无进化，故本脚本按 MVP 口径评估，同时打印 GDD 参考值。
 * 运行：pnpm sim
 */
import { BAL, interp } from '../src/config/balance';

/** §7.5 面板 DPS（本体，6 武器口径） */
function gddBodyDps(m: number): number {
  return interp([0, 5, 10], [28, 75, 190], m);
}

/** MVP 口径：4 武器（×4/6）+ 残影（×1.6） */
function mvpDps(m: number): number {
  return gddBodyDps(m) * (4 / 6) * 1.6;
}

/** 敌人混编平均 HP₀（与 enemies.ts pickKind 权重同步） */
function avgHp0(m: number): number {
  // <2.5 时蛾12 | 2.5-4 蛾.65+跳.35 → 14.8 | 4-6 蛾.55+跳.30+像.15 → 20.85 | ≥6 → 20.98
  return interp([2.5, 4, 6, 10], [12, 14.8, 20.85, 20.98], m);
}

/** 分段平均 XP/击杀（GDD §7.1：前 5min ≈1.1 → 中期 ≈3.5） */
function gemAt(m: number): number {
  return interp([0, 5, 10], [1.25, 2.2, 3.0], m);
}

const EFF = 0.65;

function simulate(firstRun: boolean) {
  let onscreen = 0;
  let kills = 0;
  let xp = 0;
  let level = 1;
  let xpNeed = BAL.xpCurve(1);
  let peak = 0;
  let k5 = 0;
  let debt = 0;

  for (let s = 1; s <= 600; s++) {
    const m = s / 60;
    let iv = interp(BAL.spawn.minute, BAL.spawn.interval, m);
    if (firstRun && s <= 90) iv *= 2; // 首局前 90s 生成 ×0.5
    const rush = s >= BAL.rush.start;
    if (rush) iv *= BAL.rush.intervalMult;
    const batch = interp(BAL.spawn.minute, BAL.spawn.batch, m) + (rush ? BAL.rush.batchAdd : 0);
    const cap = interp(BAL.spawn.minute, BAL.spawn.cap, m);

    // 每秒生成（含小数批量累积 + 蜂群事件近似）
    debt += batch / iv;
    if (s % 60 === 0) debt += 8;
    const spawnNow = Math.floor(debt);
    debt -= spawnNow;
    onscreen += Math.max(0, Math.min(spawnNow, cap - onscreen));

    const avgHp = avgHp0(m) * BAL.enemyHpScale(m);
    const killCap = (mvpDps(m) / avgHp) * EFF;
    const k = Math.min(onscreen, killCap);
    onscreen -= k;
    kills += k;
    xp += k * gemAt(m);
    while (xp >= xpNeed) {
      xp -= xpNeed;
      level++;
      xpNeed = BAL.xpCurve(level);
    }
    peak = Math.max(peak, onscreen);
    if (s === 300) k5 = kills;
  }

  // 精英（≈6 只）与 Boss 的宝石 XP 加成
  xp += 6 * 5 * 36 + 216 + 5 * 36;
  while (xp >= xpNeed) {
    xp -= xpNeed;
    level++;
    xpNeed = BAL.xpCurve(level);
  }

  return {
    firstRun,
    kills: Math.round(kills),
    kpm5: Math.round(k5 / 5),
    kpm10: Math.round((kills - k5) / 5),
    level,
    peak: Math.round(peak),
  };
}

const rows = [simulate(false), simulate(true)];
console.table(rows);

const r = rows[0]!;
let fails = 0;
const ok = (v: number, lo: number, hi: number, name: string, gddRef?: string): void => {
  const pass = v >= lo && v <= hi;
  if (!pass) fails++;
  const ref = gddRef ? `　[GDD 20min 口径参考：${gddRef}]` : '';
  console.log(`${pass ? '✓' : '✗'} ${name}: ${Math.round(v)}（MVP 目标 ${lo}–${hi}）${ref}`);
};
console.log('\n—— 10min / 4 武器 MVP 局节奏自检 ——');
ok(r.kpm5, 70, 150, '5min 击杀/分', '150');
ok(r.kpm10, 90, 180, '10min 击杀/分', '210');
ok(r.level, 22, 28, '终局等级', '26@10min');
ok(r.peak, 0, 300, '同屏敌人峰值', '240@5min / 300@8min+');
console.log(
  fails === 0
    ? '\n结论：密度平稳爬升、等级节拍落在 §7 目标附近（MVP 口径）；击杀节拍低于 §7.6 是"4 武器无进化"的预期偏差，须由 M1 试玩定性确认。'
    : `\n${fails} 项越界——按 §7.6 越界处理规则调参（优先调宝石价值/生成批量，不动 XP 曲线指数）。`,
);
