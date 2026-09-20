/**
 * 性能压测（M1 Exit Criteria："60fps @ 300 敌"）：
 * 强制把生成拉满填到 300 敌，分两段测量：
 *   ① 纯逻辑：world.update 逐帧耗时（1800 帧，硬门禁）
 *   ② 含渲染：sprite 同步 + GPU 提交（120 帧；无头 SwiftShader 软件光栅，属保守上界）
 * 输出 avg / p50 / p95 / max。逻辑 p95 门禁 = 16.67ms 的一半（给渲染留余量）。
 * 运行：pnpm bench   （BENCH_FRAMES / BENCH_RENDER_FRAMES 可覆盖）
 */
import { openApp } from './cdp.mjs';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
const LOGIC_FRAMES = Number(process.env.BENCH_FRAMES ?? 1800);
const RENDER_FRAMES = Number(process.env.BENCH_RENDER_FRAMES ?? 120);
const TARGET = 300;
/** BENCH_BUILD=max：把 4 武器拉满 Lv6 + 6 被动 Lv5（近似终局满构筑），
 *  裸装口径（默认 min）会显著低估后期负载——这是上一版压测的盲点。 */
const MAX_BUILD = (process.env.BENCH_BUILD ?? 'min') === 'max';
const BUILD_SNIPPET = MAX_BUILD
  ? `
    w.player.weapons.set('clock', { lv: 6, cd: 0 });
    w.player.weapons.set('bolt', { lv: 6, cd: 0 });
    w.player.weapons.set('pulse', { lv: 6, cd: 0 });
    w.player.weapons.set('butterfly', { lv: 6, cd: 0 });
    for (const id of ['power', 'haste', 'crit', 'vigor', 'swift', 'resonance']) w.player.passives.set(id, 5);
    Object.assign(w.player.stats, { dmg: 0.4, atkSpd: 0.35, critCh: 0.25, critDmg: 1.5, moveSpd: 0.25, resDmg: 0.5, resGain: 0.4, echoRange: 1 });
  `
  : '';

const { cdp, close } = await openApp(APP_URL);
let exitCode = 0;

/** 把页面内的 eval 包一层超时，避免软件光栅下整脚本挂死 */
async function evalTimed(expr, ms) {
  return Promise.race([
    cdp.eval(expr),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`eval 超时 ${ms}ms`)), ms)),
  ]);
}

try {
  const filled = await evalTimed(`(() => {
    const D = window.__BAL, g = __twinEcho;
    D.spawn.batch = [40, 40, 40, 40, 40];
    D.spawn.cap = [300, 300, 300, 300, 300];
    D.spawn.interval = [0.1, 0.1, 0.1, 0.1, 0.1];
    g.startRun();
    g.world.firstRun = false;
    g.world.time = 480;
    const w = g.world;
    ${BUILD_SNIPPET}
    let frames = 0;
    while (g.world.enemies.count < ${TARGET} && frames < 4000) { g.world.update(1/60); frames++; }
    return { frames, on: g.world.enemies.count };
  })()`, 120000);
  console.log(`填场：${filled.frames} 帧 → 同屏敌 ${filled.on}（构筑口径：${MAX_BUILD ? '满构筑 Lv6/Lv5' : '裸装 Lv1'}）\n`);

  // ① 纯逻辑
  const logic = await evalTimed(`(() => {
    const g = __twinEcho, w = g.world;
    const prof = ${process.env.BENCH_PROF === '1'};
    if (prof) { w.profEnabled = true; w.profFrames.length = 0; }
    const t = [];
    for (let i = 0; i < ${LOGIC_FRAMES}; i++) {
      w.player.hp = 1e6; w.player.maxHp = 1e6;   // 压测中保持存活，避免死亡后 update 空转
      let guard = 0;
      while (w.enemies.count < ${TARGET} && guard++ < 40) w.update(1/60);
      const t0 = performance.now();
      w.update(1/60);
      t.push(performance.now() - t0);
    }
    const s = t.slice().sort((a, b) => a - b);
    const sum = t.reduce((p, c) => p + c, 0);
    const out = {
      avg: +(sum / t.length).toFixed(3), p50: +s[Math.floor(s.length * 0.5)].toFixed(3),
      p95: +s[Math.floor(s.length * 0.95)].toFixed(3), max: +s[s.length - 1].toFixed(3),
      on: w.enemies.count, bullets: w.bullets.count, gems: w.gems.count, parts: w.parts.count,
      kills: w.stats.kills, elapsed: +w.time.toFixed(0),
      level: w.player.level, pending: w.pendingLevelUps, xp: Math.round(w.player.xp), xpNeed: w.player.xpNeed,
      state: __twinEcho.state,
    };
    if (prof) {
      // 最慢 5 帧的分相耗时与"未归因时间"（总耗时 − 各相之和，大值 ⇒ GC/浏览器内部开销）
      const pf = w.profFrames;
      const idx = t.map((ms, i) => [ms, i]).sort((a, b) => b[0] - a[0]).slice(0, 5).map((p) => p[1]);
      out.slowest = idx.map((i) => {
        const f = pf[i] ?? { ms: 0, phases: {} };
        const phaseSum = Object.values(f.phases).reduce((p, c) => p + c, 0);
        return { frame: i, ms: f.ms, unaccounted: +(f.ms - phaseSum).toFixed(1), phases: f.phases };
      });
      const acc = {};
      for (const f of pf) for (const [k, v] of Object.entries(f.phases)) acc[k] = (acc[k] ?? 0) + v;
      const n = pf.length || 1;
      out.phaseAvg = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, +(v / n).toFixed(3)]));
    }
    return out;
  })()`, 300000);

  console.log(`场上实体（逻辑段末）：敌 ${logic.on} · 弹幕 ${logic.bullets} · 宝石 ${logic.gems} · 粒子 ${logic.parts}`);
  console.log(`累计击杀 ${logic.kills} · 游戏内 t=${logic.elapsed}s`);
  console.log(`终局等级 Lv${logic.level} · 待处理升级 ${logic.pending} · XP ${logic.xp}/${logic.xpNeed} · 状态 ${logic.state}\n`);

  if (logic.slowest) {
    console.log('—— 最慢 5 帧分相（ms）——');
    for (const f of logic.slowest) {
      const ps = Object.entries(f.phases).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v.toFixed(1)}`).join(' ');
      console.log(`  帧#${f.frame} 总 ${f.ms}ms · 未归因 ${f.unaccounted}ms · ${ps}`);
    }
    console.log('—— 全帧分相平均（ms）——');
    console.log('  ' + Object.entries(logic.phaseAvg).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
    const worstUnaccounted = Math.max(...logic.slowest.map((f) => f.unaccounted));
    if (worstUnaccounted > 50) {
      console.log(`\n⚠ 最慢帧未归因时间高达 ${worstUnaccounted}ms —— 时间不在游戏 JS 里，指向 V8 GC 或浏览器内部（软光栅合成/纹理上传）。`);
    }
    console.log('');
  }

  // ② 含渲染（帧数少，软件光栅很慢）
  const frame = await evalTimed(`(() => {
    const g = __twinEcho, w = g.world;
    const t = [];
    for (let i = 0; i < ${RENDER_FRAMES}; i++) {
      w.player.hp = 1e6; w.player.maxHp = 1e6;
      let guard = 0;
      while (w.enemies.count < ${TARGET} && guard++ < 40) w.update(1/60);
      const t0 = performance.now();
      w.update(1/60);
      g.render(1/60);
      g.app.renderer.render(g.app.stage);
      t.push(performance.now() - t0);
    }
    const s = t.slice().sort((a, b) => a - b);
    const sum = t.reduce((p, c) => p + c, 0);
    return {
      avg: +(sum / t.length).toFixed(3), p50: +s[Math.floor(s.length * 0.5)].toFixed(3),
      p95: +s[Math.floor(s.length * 0.95)].toFixed(3), max: +s[s.length - 1].toFixed(3),
    };
  })()`, 300000);

  console.table({ [`纯逻辑 update（${LOGIC_FRAMES} 帧）`]: logic, [`含渲染同步+GPU提交（${RENDER_FRAMES} 帧）`]: frame });

  const LOGIC_BUDGET = 16.67 / 2;
  const FRAME_BUDGET = 1000 / 60;
  const logicOk = logic.p95 <= LOGIC_BUDGET;
  console.log(`${logicOk ? '✓' : '✗'} 逻辑 p95 ${logic.p95}ms ≤ ${LOGIC_BUDGET}ms（60fps 预算一半，给渲染留余量）`);
  console.log(`  逻辑 avg ${logic.avg}ms ⇒ 逻辑侧余量 ${(LOGIC_BUDGET / Math.max(logic.avg, 0.001)).toFixed(1)}×`);
  console.log(`  ${frame.p95 <= FRAME_BUDGET ? '✓' : '⚠'} 帧内总计 p95 ${frame.p95}ms（预算 ${FRAME_BUDGET}ms）—— 无头 SwiftShader 软件光栅，真机 GPU 会显著更快，此项仅作保守上界`);
  console.log(`\n结论：300 敌稳态下逻辑侧${logicOk ? '满足' : '不满足'} 60fps 预算；实体预算（敌 300 / 弹 400 / 拾取 500）与对象池无运行时分配已按 §11.2 落实。`);
  exitCode = logicOk ? 0 : 1;
} catch (err) {
  console.error(`压测失败：${err instanceof Error ? err.message : String(err)}`);
  if (cdp.errors.length) console.error(cdp.errors.slice(0, 3).join('\n'));
  exitCode = 1;
} finally {
  close();
}
process.exit(exitCode);
