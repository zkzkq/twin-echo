/**
 * 共鸣几何 A/B 实验（决策 1 的数据支撑）：
 * 实测发现共鸣覆盖率只有 8–20%，根因是"延迟 × 移速 ⇒ 本体-残影间距 475px > 武器半径 90–150"。
 * 本脚本对比 4 个干预方案对覆盖率与其他指标的影响：
 *   A 基线          D=2.5s（150 帧），残影射程 ×1.0
 *   B 短延迟        D=1.8s（108 帧，§16 登记下限），射程 ×1.0
 *   C 残影射程被动  D=2.5s，残影攻击范围 ×1.5
 *   D 组合          D=1.8s + 射程 ×1.5
 * 每臂 × 2 种机器人（生存优先 / 贪宝石）× N 局，取中位数。
 * 运行：pnpm ab   （AB_RUNS=5 pnpm ab）
 */
import { openApp, BOT_FN, BOT_SAFE_FN } from './cdp.mjs';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
const RUNS = Number(process.env.AB_RUNS ?? 3);
/** 单局上限（秒）：机器人多在 3–5min 阵亡，限时以控制总耗时 */
const CAP_S = Number(process.env.AB_CAP_S ?? 300);
const CHUNKS = Math.ceil(CAP_S / 60);

const ARMS = [
  { name: 'A 基线 D=2.5s ×1.0', delay: 150, range: 1.0 },
  { name: 'B 短延迟 D=1.8s', delay: 108, range: 1.0 },
  { name: 'C 残影射程 ×1.5', delay: 150, range: 1.5 },
  { name: 'D 组合 1.8s+×1.5', delay: 108, range: 1.5 },
];
const BOTS = [
  { name: '生存优先', call: 'window.__botSafe(P.f)' },
  { name: '贪宝石', call: 'window.__bot(P.f)' },
].filter((b) => !process.env.AB_BOTS || process.env.AB_BOTS.split(',').some((k) => b.name.includes(k)));

const median = (a) => {
  if (a.length === 0) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const { cdp, close } = await openApp(APP_URL);
const results = [];

try {
  await cdp.eval(BOT_FN);
  await cdp.eval(BOT_SAFE_FN);

  for (const arm of ARMS) {
    for (const bot of BOTS) {
      const per = [];
      for (let r = 0; r < RUNS; r++) {
        await cdp.eval(`(() => {
          window.__BAL.echo.delayFrames = ${arm.delay};
          __twinEcho.startRun();
          __twinEcho.world.firstRun = true;
          __twinEcho.world.player.stats.echoRange = ${arm.range};
          window.__P = { f: 0, peak: 0 };
          return 1;
        })()`);
        let done = false;
        for (let chunk = 0; chunk < CHUNKS && !done; chunk++) {
          const s = await cdp.eval(`(() => {
            const g = __twinEcho, w = g.world, P = window.__P;
            for (let i = 0; i < 3600; i++) {
              if (P.f % 10 === 0) ${bot.call};
              if (w.player.gauge >= 100) w.tryBurst();
              w.update(1/60);
              P.f++;
              if (g.state === 'levelup') {
                const cards = document.querySelectorAll('#cards .card');
                let pick = -1;
                if (cards.length) {
                  if (w.player.hp < w.player.maxHp * 0.6) {
                    for (let k = 0; k < cards.length; k++) if (cards[k].textContent.includes('活力')) { pick = k; break; }
                  }
                  if (pick < 0) pick = Math.floor(Math.random() * cards.length);
                  g.doPick(pick);
                } else g.doPick(0);
                w.player.stats.echoRange = ${arm.range}; // recompute 会重置，故选卡后重新注入
              }
              if (g.state === 'result') break;
              if (w.enemies.count > P.peak) P.peak = w.enemies.count;
            }
            return { state: g.state };
          })()`);
          if (s.state === 'result') done = true;
        }
        const m = await cdp.eval(`(() => {
          const w = __twinEcho.world, P = window.__P;
          return {
            t: w.time, kills: w.stats.kills, level: w.player.level,
            res: w.stats.resHits, hits: w.stats.hits, peak: P.peak,
          };
        })()`);
        per.push({
          survival: +(m.t / 60).toFixed(2),
          kpm: m.t > 0 ? Math.round((m.kills / m.t) * 60) : 0,
          level: m.level,
          coverage: m.hits > 0 ? +((m.res / m.hits) * 100).toFixed(1) : 0,
          resPerMin: m.t > 0 ? +((m.res / m.t) * 60).toFixed(1) : 0,
          peak: m.peak,
        });
      }
      results.push({
        臂: arm.name,
        机器人: bot.name,
        '存活(min)': median(per.map((p) => p.survival)),
        '击杀/分': median(per.map((p) => p.kpm)),
        等级: median(per.map((p) => p.level)),
        '共鸣覆盖%': median(per.map((p) => p.coverage)),
        '共鸣击/分': median(per.map((p) => p.resPerMin)),
        峰值同屏: Math.max(...per.map((p) => p.peak)),
      });
      process.stdout.write(`\r已跑完 ${results.length}/${ARMS.length * BOTS.length} 组…`);
    }
  }

  console.log('\n');
  console.table(results);

  console.log('\n—— 按臂汇总（两机器人取中位）——');
  for (const arm of ARMS) {
    const rs = results.filter((r) => r.臂 === arm.name);
    console.log(
      `${arm.name}: 覆盖率 ${median(rs.map((r) => r['共鸣覆盖%'])).toFixed(1)}% · ` +
      `共鸣击/分 ${median(rs.map((r) => r['共鸣击/分'])).toFixed(1)} · ` +
      `击杀/分 ${median(rs.map((r) => r['击杀/分']))} · ` +
      `存活 ${median(rs.map((r) => r['存活(min)'])).toFixed(2)}min · ` +
      `等级 ${median(rs.map((r) => r.等级))}`,
    );
  }
  console.log('\n判读口径：覆盖率目标是 §5.2 的 30–45%；若某一臂把覆盖率抬进区间且存活/击杀未恶化，即为推荐方案。');
} catch (err) {
  console.error(`A/B 实验失败：${err instanceof Error ? err.message : String(err)}`);
  if (cdp.errors.length) console.error(cdp.errors.slice(0, 3).join('\n'));
  process.exitCode = 1;
} finally {
  close();
}
process.exit(process.exitCode ?? 0);
