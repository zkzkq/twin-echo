/**
 * 蒙特卡洛回归门禁（GDD §11.2："Node 脚本跑 MC 回归验证 §7 验收区间，接入 CI"）：
 * 用确定性步进 + 机器人连续跑 N 局（默认 20，MC_RUNS=200 为完整回归），
 * 输出中位数并对照**回退门禁**（regression floor，用于发现数值被改坏，不是设计 KPI）。
 * 运行：pnpm mc   （MC_RUNS=50 BOT=safe pnpm mc）
 */
import { openApp, BOT_FN, BOT_SAFE_FN } from './cdp.mjs';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
const RUNS = Number(process.env.MC_RUNS ?? 20);
const BOT = process.env.BOT === 'safe' ? 'safe' : 'greedy';
/** 单局上限（秒）：控制总耗时（机器人在 3–5min 阵亡，超过即无信息增益） */
const CAP_S = Number(process.env.MC_CAP_S ?? 420);
const CHUNKS = Math.ceil(CAP_S / 60);

/** 回退门禁：低于/高于即视为数值被改坏（宽松下限，只为抓回退，不作设计验收） */
const GATES = [
  { key: 'survivalMin', label: '存活中位(min)', min: 2.5, max: 11 },
  { key: 'level', label: '终局等级中位', min: 10, max: 40 },
  { key: 'kpm', label: '击杀/分中位', min: 120, max: 700 },
  { key: 'coverage', label: '共鸣覆盖率中位(%)', min: 5, max: 70 },
  { key: 'peak', label: '同屏峰值', min: 10, max: 300 },
];

const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const { cdp, close } = await openApp(APP_URL);
const rows = [];

try {
  await cdp.eval(BOT_FN);
  await cdp.eval(BOT_SAFE_FN);
  const botCall = BOT === 'safe' ? 'window.__botSafe(P.f)' : 'window.__bot(P.f)';
  console.log(`机器人=${BOT} · 局数=${RUNS}\n`);

  for (let r = 0; r < RUNS; r++) {
    await cdp.eval(`(() => { __twinEcho.startRun(); __twinEcho.world.firstRun = true; window.__P = { f: 0, peak: 0 }; return 1; })()`);
    // 单局最多 CAP_S 秒游戏时间（分块跑以免单次 eval 过长）
    let done = false;
    for (let chunk = 0; chunk < CHUNKS && !done; chunk++) {
      const s = await cdp.eval(`(() => {
        const g = __twinEcho, w = g.world, P = window.__P;
        for (let i = 0; i < 3600; i++) {
          if (P.f % 10 === 0) ${botCall};
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
          }
          if (g.state === 'result') break;
          if (w.enemies.count > P.peak) P.peak = w.enemies.count;
        }
        return { state: g.state, t: w.time };
      })()`);
      if (s.state === 'result') done = true;
    }
    const m = await cdp.eval(`(() => {
      const w = __twinEcho.world, P = window.__P;
      const cov = w.stats.hits > 0 ? (w.stats.resHits / w.stats.hits) * 100 : 0;
      return {
        t: w.time, win: __twinEcho.state === 'result' && w.time >= 599.5,
        level: w.player.level, kills: w.stats.kills, cov, peak: P.peak,
        res: w.stats.resHits, bursts: w.stats.bursts, kills2: w.stats.kills,
      };
    })()`);
    rows.push({
      run: r + 1,
      survivalMin: +(m.t / 60).toFixed(2),
      kpm: m.t > 0 ? Math.round((m.kills / m.t) * 60) : 0,
      level: m.level,
      coverage: +m.cov.toFixed(1),
      peak: m.peak,
      bursts: m.bursts,
      win: m.win ? '✓' : '',
      kills: m.kills,
    });
    process.stdout.write(`\r已完成 ${r + 1}/${RUNS} 局…`);
  }
  console.log('\n');
  console.table(rows);

  const agg = {
    survivalMin: median(rows.map((r) => r.survivalMin)),
    level: median(rows.map((r) => r.level)),
    kpm: median(rows.map((r) => r.kpm)),
    coverage: median(rows.map((r) => r.coverage)),
    peak: Math.max(...rows.map((r) => r.peak)),
    winRate: Math.round((rows.filter((r) => r.win).length / rows.length) * 100),
  };
  console.log('中位数汇总：', agg);

  console.log('\n—— 回退门禁（regression floor，非设计 KPI）——');
  let failed = 0;
  for (const g of GATES) {
    const v = agg[g.key];
    const ok = v >= g.min && v <= g.max;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${g.label}: ${typeof v === 'number' ? Math.round(v * 100) / 100 : v}（容许 ${g.min}–${g.max}）`);
  }
  console.log(failed === 0 ? '\n全部回退门禁通过。' : `\n${failed} 项越界——数值可能被改坏，检查最近改动。`);
  process.exitCode = failed === 0 ? 0 : 1;
} catch (err) {
  console.error(`MC 回归失败：${err instanceof Error ? err.message : String(err)}`);
  if (cdp.errors.length) console.error(cdp.errors.slice(0, 3).join('\n'));
  process.exitCode = 1;
} finally {
  close();
}
process.exit(process.exitCode ?? 0);
