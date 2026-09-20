/**
 * 引擎内节奏探针（In-engine pacing probe）：
 * 用确定性步进让一个"机器人"真打完整一局（风筝走位 + 满共鸣就放爆发 + 自动选卡），
 * 逐分钟采样击杀/同屏/血量/等级/共鸣覆盖率，用**真实游戏逻辑**量测节奏与生存性。
 *
 * 这是 M0 的引擎内版本：比 scripts/sim.ts 的解析模型可信，因为它跑的就是游戏本体。
 * 运行：pnpm probe（需 dev server 已启动）
 */
import { openApp, BOT_FN, BOT_SAFE_FN, BOT_DODGE_FN } from './cdp.mjs';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
const RUNS = Number(process.env.PROBE_RUNS ?? 1);
const FRAMES_PER_CHUNK = 3600; // 60s 局内时间
/** 单局上限（分钟）：M2 标准局 20 分钟 */
const TOTAL_CHUNKS = Number(process.env.PROBE_MINUTES ?? 20);

const { cdp, close } = await openApp(APP_URL);

const kpi = [];
try {
  for (let run = 0; run < RUNS; run++) {
    await cdp.eval(`(() => { const g = __twinEcho;
      g.runOptions.difficulty = '${process.env.PROBE_DIFF ?? 'standard'}';
      g.runOptions.map = '${process.env.PROBE_MAP ?? 'plain'}';
      g.runOptions.character = '${process.env.PROBE_CHAR ?? 'otto'}';
      g.runOptions.paradox = ${Number(process.env.PROBE_PARADOX ?? 0)};
      g.startRun(); g.world.firstRun = true;
      window.__P = { f: 0, peak: 0, samples: [] }; return 1; })()`);
    await cdp.eval(BOT_FN);
    await cdp.eval(BOT_SAFE_FN);
    await cdp.eval(BOT_DODGE_FN);
    // PROBE_BOT=greedy（默认，贪宝石）| safe（生存优先）| dodge（会躲弹幕）
    const botKind = process.env.PROBE_BOT ?? 'greedy';
    const botCall =
      botKind === 'dodge' ? 'window.__botDodge(P.f)'
        : botKind === 'safe' ? 'window.__botSafe(P.f)'
          : 'window.__bot(P.f)';
    // 躲弹幕需要更高决策频率（10 帧 = 167ms 太慢）
    const botEvery = botKind === 'dodge' ? 3 : 10;
    console.log(`\n===== 第 ${run + 1} 局（机器人：${botKind === 'dodge' ? '躲弹幕' : botKind === 'safe' ? '生存优先' : '贪宝石'} / 满共鸣即爆发 / 自动选卡）=====`);
    console.log(' 分钟  击杀/分  累计击杀  同屏  等级   HP   共鸣覆盖  爆发 Boss 结晶 进化 祭坛 事件');

    let died = false;
    let deathAt = 0;
    let prevKills = 0;
    for (let c = 0; c < TOTAL_CHUNKS; c++) {
      const s = await cdp.eval(`(() => {
        const g = __twinEcho, w = g.world, P = window.__P;
        let died = false;
        for (let i = 0; i < ${FRAMES_PER_CHUNK}; i++) {
          if (P.f % ${botEvery} === 0) ${botCall};
          if (w.player.gauge >= 100) w.tryBurst();
          w.update(1 / 60);
          P.f++;
          if (g.state === 'levelup') {
            const cards = document.querySelectorAll('#cards .card');
            let pick = -1;
            if (cards.length) {
              // 低血优先拿生存卡，其余随机（模拟真人取向）
              if (w.player.hp < w.player.maxHp * 0.6) {
                for (let k = 0; k < cards.length; k++) {
                  if (cards[k].textContent.includes('活力')) { pick = k; break; }
                }
              }
              if (pick < 0) pick = Math.floor(Math.random() * cards.length);
              g.doPick(pick);
            } else g.doPick(0);
          }
          if (g.state === 'result') { died = true; break; }
          if (w.enemies.count > P.peak) P.peak = w.enemies.count;
        }
        const cov = w.stats.hits > 0 ? +((w.stats.resHits / w.stats.hits) * 100).toFixed(1) : 0;
        const row = {
          min: +(w.time / 60).toFixed(1), t: +w.time.toFixed(1),
          kills: w.stats.kills, on: w.enemies.count, lv: w.player.level,
          hp: Math.round(w.player.hp), cov, burst: w.stats.bursts,
          res: w.stats.resHits, hits: w.stats.hits, died, state: g.state,
          elites: w.stats.elitesKilled, bossHp: w.boss ? Math.round(w.boss.hp) : null,
          bosses: w.stats.bossKills, crystals: w.player.crystals,
          evos: w.player.evolutions.size, altars: w.stats.altarCrafted, events: w.stats.eventsFired,
          revives: w.revives, firstRun: w.firstRun,
          weapons: [...w.player.weapons].map(([k, v]) => k + ':' + v.lv).join(','),
          passives: [...w.player.passives].map(([k, v]) => k + ':' + v).join(','),
          peak: P.peak,
        };
        P.samples.push(row);
        return row;
      })()`);

      const prev = c === 0 ? 0 : prevKills;
      prevKills = s.kills;
      void prev;
      console.log(
        `  ${String(s.min).padStart(4)}  ${String(s.kills - prev).padStart(7)}  ${String(s.kills).padStart(8)}  ${String(s.on).padStart(4)}  ${String(s.lv).padStart(4)}  ${String(s.hp).padStart(3)}   ${String(s.cov).padStart(5)}%  ${String(s.burst).padStart(4)}  ${String(s.bosses).padStart(3)}  ${String(s.crystals).padStart(3)}  ${String(s.evos).padStart(3)}  ${String(s.altars).padStart(3)}  ${String(s.events).padStart(3)}`,
      );
      if (s.died) {
        died = true;
        deathAt = s.t;
        console.log(`  → 机器人在 ${(s.t / 60).toFixed(1)} 分钟阵亡（HP 归零）`);
        break;
      }
    }

    const last = await cdp.eval('(() => { const w = __twinEcho.world, P = window.__P; return { t: w.time, kills: w.stats.kills, lv: w.player.level, res: w.stats.resHits, hits: w.stats.hits, burst: w.stats.bursts, peak: P.peak, state: __twinEcho.state, elites: w.stats.elitesKilled, bossKills: w.stats.bossKills, crystals: w.player.crystals, evolutions: w.player.evolutions.size, altarCrafted: w.stats.altarCrafted, events: w.stats.eventsFired, revives: w.revives, firstRun: w.firstRun, weapons: [...w.player.weapons].map(([k,v]) => k+":"+v.lv).join(","), passives: [...w.player.passives].map(([k,v]) => k+":"+v).join(",") }; })()');

    const cov = last.hits > 0 ? (last.res / last.hits) * 100 : 0;
    const burstGap = last.burst > 0 ? last.t / last.burst : Infinity;
    const resonancePerMin = last.t > 0 ? (last.res / last.t) * 60 : 0;
    const summary = {
      survived: died ? deathAt : last.t,
      died,
      kills: last.kills,
      kpm: last.t > 0 ? (last.kills / last.t) * 60 : 0,
      level: last.lv,
      coverage: cov,
      resonancePerMin,
      bursts: last.burst,
      burstGap,
      peak: last.peak,
      elites: last.elites,
      bossKills: last.bossKills,
      crystals: last.crystals,
      evolutions: last.evolutions,
      altarCrafted: last.altarCrafted,
      events: last.events,
      build: `${last.weapons} | ${last.passives}`,
    };
    kpi.push(summary);
    console.log(`\n  构筑：${summary.build}`);
    console.log(
      `  峰值同屏 ${summary.peak}（预算 600）· 精英 ${summary.elites} · Boss ${summary.bossKills}/4 · 结晶 ${summary.crystals} · 进化 ${summary.evolutions} ${summary.altarCrafted ? `(${summary.altarCrafted} 次)` : ''} · 事件 ${summary.events} · 复活 ${last.revives}（firstRun=${last.firstRun}）· 状态 ${last.state}`,
    );
  }
} finally {
  close();
}

const [kLo, kHi] = [50, 120]; // BAL.resonance.perMinTarget（与 config 同步）
console.log('\n===== KPI 汇总（GDD §7.6 / §14，M2 二十局口径）=====');
const rows = kpi.map((r, i) => ({
  局: i + 1,
  存活: `${(r.survived / 60).toFixed(1)}min${r.died ? '（阵亡）' : ''}`,
  击杀: r.kills,
  '击杀/分': Math.round(r.kpm),
  等级: r.level,
  '共鸣击/分': Math.round(r.resonancePerMin),
  '覆盖率(诊断)': `${r.coverage.toFixed(1)}%`,
  '爆发间隔': Number.isFinite(r.burstGap) ? `${r.burstGap.toFixed(0)}s` : '—',
  峰值同屏: r.peak,
  进化: r.altarCrafted,
  事件: r.events,
}));
console.table(rows);

const r0 = kpi[0];
const judge = (ok, label, detail) => console.log(`${ok ? '✓' : '✗'} ${label}：${detail}`);
console.log('');
judge(r0.survived >= 480, '生存 ≥8min（20min 局的可玩下限；§14 目标 ≥11min）', `${(r0.survived / 60).toFixed(1)}min`);
judge(r0.resonancePerMin >= kLo && r0.resonancePerMin <= kHi, `共鸣击频率（M2 主 KPI ${kLo}–${kHi}/分）`, `${Math.round(r0.resonancePerMin)}/分`);
judge(r0.burstGap >= 45 && r0.burstGap <= 150, '爆发间隔（§5.3 目标 60–90s）', Number.isFinite(r0.burstGap) ? `${r0.burstGap.toFixed(0)}s` : '—');
judge(r0.level >= 35 && r0.level <= 55, '终局等级（§7 目标 42–48@20min）', `Lv ${r0.level}`);
judge(r0.peak <= 600, '峰值同屏不超 §11.2 预算 600', `${r0.peak}`);
judge(r0.events >= 3, '局内事件触发（§6.7 每 120s）', `${r0.events} 次`);

process.exit(0);
