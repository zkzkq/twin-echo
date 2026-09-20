/**
 * headless 端到端功能冒烟测试（确定性步进）：
 * 启动 → 开局 → 残影 2.5s 延迟重演 → 共鸣击 → 同步爆发 → 升级三选一 → 暂停 → 渲染同步 → 胜利结算。
 * 运行：pnpm smoke（需 dev server 已启动；可用 APP_URL 覆盖地址）
 */
import { openApp, BOT_FN } from './cdp.mjs';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/';

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) {
    pass++;
    console.log(`✓ ${label}${detail ? `　${detail}` : ''}`);
  } else {
    fail++;
    console.log(`✗ ${label}${detail ? `　${detail}` : ''}`);
  }
};

console.log(`目标：${APP_URL}\n`);
const { cdp, close } = await openApp(APP_URL);

try {
  // 1. 启动状态
  const errText = await cdp.eval(
    'document.getElementById("errbanner").classList.contains("hidden") ? "" : document.getElementById("errbanner").textContent',
  );
  check(errText === '', '页面无运行时错误横幅', errText ? `→ ${errText}` : '');
  check(await cdp.eval('document.querySelector("#app canvas") !== null'), 'Pixi canvas 已挂载');
  check((await cdp.eval('__twinEcho.state')) === 'title', '初始处于标题界面');

  // 2. 开局 + 主循环推进（确定性步进 300 帧 = 5s 局内时间）
  await cdp.eval('__twinEcho.startRun()');
  check((await cdp.eval('__twinEcho.state')) === 'run', '开局进入 run 状态');
  const t1 = await cdp.eval('(() => { const w = __twinEcho.world; for (let i = 0; i < 300; i++) w.update(1/60); return w.time; })()');
  check(Math.abs(t1 - 5) < 0.05, '60Hz 固定步长步进精确', `300 帧 → t=${t1.toFixed(3)}s`);

  // 3. 残影 2.5s 延迟重演：向右直行 5s，残影应落后约 475px（150 帧 × 190px/s）
  const lag = await cdp.eval(`(() => {
    const w = __twinEcho.world;
    w.input.x = 1; w.input.y = 0;
    for (let i = 0; i < 300; i++) w.update(1/60);
    w.input.x = 0;
    return Math.hypot(w.echo.x - w.player.x, w.echo.y - w.player.y);
  })()`);
  check(lag > 350 && lag < 600, '残影按 ~2.5s 延迟重演移动轨迹', `本体-残影间距 ${Math.round(lag)}px（理论 475px）`);

  // 4. 战斗 / 经验 / 升级（用"吃宝石+规避"机器人：纯逃跑型走位吃不到宝石）
  await cdp.eval(BOT_FN);
  const combat = await cdp.eval(`(() => {
    const w = __twinEcho.world;
    for (let i = 0; i < 1800; i++) {
      if (i % 10 === 0) window.__bot(i);
      w.update(1/60);
      if (__twinEcho.state === 'levelup') __twinEcho.doPick(0);
    }
    return { kills: w.stats.kills, hits: w.stats.hits, enemies: w.enemies.count, spawned: w.enemyIdSeq, gems: w.gems.count, level: w.player.level, hp: w.player.hp, t: w.time };
  })()`);
  check(combat.kills > 0, '武器命中并击杀敌人', `30s 内击杀 ${combat.kills} · 命中 ${combat.hits}`);
  check(combat.spawned > 15, '生成导演持续投放敌人', `累计生成 ${combat.spawned} · 同屏 ${combat.enemies}`);
  check(combat.level >= 3, '经验宝石 → 磁吸拾取 → 升级链路', `Lv ${combat.level}`);

  // 5. 共鸣击：确定性机制验证
  //    先用"向右跑 2s"把残影稳定甩到 ~380px 外（保证阶段 1 只有本体能命中），
  //    阶段 1 把一个静止敌人放到本体指针环上等本体命中（标记 body），
  //    阶段 2 再把它放到残影指针环上——应在 1s 窗口内触发共鸣
  const res = await cdp.eval(`(() => {
    const w = __twinEcho.world;
    const R = (w.player.weapons.get('clock').lv >= 6) ? 120 : 90;
    w.input.x = 1; w.input.y = 0;
    for (let i = 0; i < 180; i++) w.update(1/60);
    w.input.x = 0;
    const e = w.enemies.items.find((x) => x.active && !x.boss);
    if (!e) return { error: 'no enemy' };
    e.hp = 1e9; e.speed = 0;
    for (let i = 0; i < 300 && e.lastHitSrc !== 'body'; i++) {
      e.x = w.player.x + R; e.y = w.player.y; e.orbitCdB = 0;
      w.update(1/60);
    }
    const marked = e.lastHitSrc;
    const gap = Math.round(Math.hypot(w.echo.x - w.player.x, w.echo.y - w.player.y));
    const r0 = w.stats.resHits; const g0 = w.player.gauge;
    for (let i = 0; i < 300 && w.stats.resHits === r0; i++) {
      e.x = w.echo.x + R; e.y = w.echo.y; e.orbitCdE = 0;
      w.update(1/60);
    }
    return { marked, resonance: w.stats.resHits - r0, gaugeGain: +(w.player.gauge - g0).toFixed(1), gap };
  })()`);
  check(res.marked === 'body', '本体命中留下共鸣标记（残影在 380px+ 外）', `lastHitSrc=${res.marked} · 间距 ${res.gap}px`);
  check(res.resonance > 0, '共鸣击（本体 × 残影 1s 内双击同一敌人）触发', `共鸣 +${res.resonance}`);
  check(res.gaugeGain > 0, '共鸣值累积', `+${res.gaugeGain}`);

  // 6. 同步爆发（主动技）
  const burst = await cdp.eval(`(() => {
    const w = __twinEcho.world;
    w.player.gauge = 100;
    const ok = w.tryBurst();
    return { ok, bursts: w.stats.bursts, gauge: w.player.gauge, invuln: w.player.invulnT > 0 };
  })()`);
  check(burst.ok === true && burst.bursts === 1, '共鸣值满后手动释放同步爆发', `释放 ${burst.bursts} 次`);
  check(burst.gauge === 0, '爆发后共鸣值清零');
  check(burst.invuln === true, '爆发瞬间获得 0.5s 无敌');

  // 7. 升级三选一（面板 → 选择生效）
  await cdp.eval('__twinEcho.world.addXp(8000); __twinEcho.world.update(1/60)');
  check((await cdp.eval('__twinEcho.state')) === 'levelup', '升级面板弹出');
  const cardCount = await cdp.eval('document.querySelectorAll("#cards .card").length');
  check(cardCount >= 1 && cardCount <= 3, '三选一面板渲染选项', `${cardCount} 张卡`);
  const before = await cdp.eval('[...__twinEcho.world.player.weapons].map(([k,v]) => `${k}:${v.lv}`).join(",") + " | " + [...__twinEcho.world.player.passives].map(([k,v]) => `${k}:${v}`).join(",")');
  await cdp.eval('__twinEcho.doPick(0)');
  const after = await cdp.eval('[...__twinEcho.world.player.weapons].map(([k,v]) => `${k}:${v.lv}`).join(",") + " | " + [...__twinEcho.world.player.passives].map(([k,v]) => `${k}:${v}`).join(",")');
  check((await cdp.eval('__twinEcho.state')) === 'run', '选卡后回到战斗');
  check(before !== after, '构筑变化生效', `${before} → ${after}`);

  // 8. 暂停 / 继续
  await cdp.eval('__twinEcho.togglePause(true)');
  check((await cdp.eval('__twinEcho.state')) === 'pause', '暂停面板');
  await cdp.eval('__twinEcho.togglePause(false)');
  check((await cdp.eval('__twinEcho.state')) === 'run', '继续战斗');

  // 8.5 GDD §9 首局免费复活（首局死亡 <5:00 保底 1 次）
  const revive = await cdp.eval(`(() => {
    const w = __twinEcho.world;
    w.firstRun = true; w.reviveUsed = false; w.time = 200;
    w.player.hurtCd = 0; w.player.invulnT = 0; w.player.hp = 1;
    const before = w.revives;
    w.damagePlayer(50);
    return { got: w.revives - before, hp: Math.round(w.player.hp), invuln: w.player.invulnT > 0, dead: w.dead };
  })()`);
  check(revive.got === 1 && revive.hp > 0 && !revive.dead, 'GDD §9 首局 <5:00 免费复活', `HP 恢复到 ${revive.hp} · 无敌 ${revive.invuln}`);

  // 9. Boss 生成（跳到 05:00 前一刻）
  const boss = await cdp.eval(`(() => {
    const w = __twinEcho.world;
    w.time = 299.5;
    for (let i = 0; i < 60; i++) w.update(1/60);
    return { time: w.time, hasBoss: !!(w.boss && w.boss.active), bossHp: w.boss ? w.boss.hp : 0, on: w.enemies.count };
  })()`);
  check(boss.hasBoss, '05:00 分针兽 Boss 生成', `HP ${Math.round(boss.bossHp)} · 同屏 ${boss.on}`);
  // HUD 由 render 同步（ticker 已停，故手动渲染一帧再断言）
  await cdp.eval('(() => { for (let i = 0; i < 3; i++) __twinEcho.render(1/60); return true; })()');
  const bossBarVisible = await cdp.eval('!document.getElementById("bossbar").classList.contains("hidden")');
  check(bossBarVisible, 'Boss 血条 HUD 显示');

  // 10. 渲染同步路径（精灵同步/相机/着色不抛异常）
  const rendered = await cdp.eval('(() => { for (let i = 0; i < 10; i++) __twinEcho.render(1/60); return true; })()');
  check(rendered === true, '渲染同步路径无异常（精灵/相机/着色）');
  const hud = await cdp.eval('document.getElementById("clock").textContent');
  check(/^\d\d:\d\d$/.test(hud), 'HUD 时钟渲染', hud);

  // 10.5 M2：结晶拾取 / 局内事件 / 祭坛引导 + 进化
  // 前置：本段是合成场景（玩家在前序步骤可能已阵亡/低血），先保活并复位状态，保证确定性
  await cdp.eval(`(() => {
    const w = __twinEcho.world;
    w.running = true; w.dead = false; w.deathSent = false;
    w.boss = null;
    w.player.hp = w.player.maxHp; w.player.invulnT = 99999;
    __twinEcho.state = 'run';
    return 1;
  })()`);

  const crystal = await cdp.eval(`(() => {
    const w = __twinEcho.world;
    w.player.crystals = 0;
    const g = w.gems.obtain();
    g.crystal = 1; g.heal = 0; g.tier = 0; g.magnet = false;
    g.x = w.player.x + 8; g.y = w.player.y;
    g.sprite.texture = w.tex.altar; g.sprite.visible = true;
    for (let i = 0; i < 60 && w.player.crystals === 0; i++) w.update(1/60);
    return { crystals: w.player.crystals };
  })()`);
  check(crystal.crystals >= 1, '回响结晶拾取（进化材料）', `持有 ${crystal.crystals}`);

  const event = await cdp.eval(`(() => {
    const w = __twinEcho.world;
    w.boss = null; w.eventKind = null; w.eventCd = 0.001;
    for (let i = 0; i < 10 && w.eventKind === null; i++) w.update(1/60);
    const kind = w.eventKind;
    for (let i = 0; i < 2600 && w.eventKind !== null; i++) w.update(1/60);
    return { kind, ended: w.eventKind === null, fired: w.stats.eventsFired };
  })()`);
  check(!!event.kind && event.ended, '局内事件触发并正常结算', `触发 ${event.kind} · 事件总数 ${event.fired}`);

  const altar = await cdp.eval(`(() => {
    const w = __twinEcho.world;
    w.boss = null;
    w.running = true; w.dead = false;
    w.player.hp = w.player.maxHp; w.player.invulnT = 99999;
    __twinEcho.state = 'run';
    w.time = 479.5;
    for (let i = 0; i < 90 && w.altars.length === 0; i++) w.update(1/60);
    const a = w.altars.find((x) => !x.used);
    if (!a) return { error: 'no altar', altars: w.altars.length };
    w.player.weapons.set('clock', { lv: 6, cd: 0 });
    w.player.passives.set('cd', 5);
    w.player.crystals = 2;
    for (let i = 0; i < 300 && __twinEcho.state !== 'altar'; i++) {
      w.player.x = a.x; w.player.y = a.y; w.player.invulnT = 99999; // 防打断，保证确定性
      w.update(1/60);
    }
    return { altars: w.altars.length, state: __twinEcho.state, reached: w.stats.altarReached };
  })()`);
  check(altar.altars >= 1, '08:00 祭坛刷新', `场上祭坛 ${altar.altars}`);
  check(altar.state === 'altar', '站入引导 2s → 进化面板弹出', `altarReached=${altar.reached}`);

  const evolved = await cdp.eval(`(() => {
    __twinEcho.doEvolve(0);
    const w = __twinEcho.world;
    return {
      state: __twinEcho.state,
      evo: [...w.player.evolutions].join(','),
      crystals: w.player.crystals,
      crafted: w.stats.altarCrafted,
      needles: w.orbits.body.needles.length,
    };
  })()`);
  check(evolved.state === 'run' && evolved.evo === 'duet', '进化完成：永恒二重奏生效', `evolutions=${evolved.evo}`);
  check(evolved.crystals === 0 && evolved.crafted === 1, '进化消耗结晶 ×2', `剩余结晶 ${evolved.crystals}`);
  const orbitAfter = await cdp.eval('(() => { const w = __twinEcho.world; for (let i = 0; i < 5; i++) w.update(1/60); return w.orbits.body.needles.length; })()');
  check(orbitAfter >= 4, '进化体效果：双环反向（指针数翻倍）', `${evolved.needles} → ${orbitAfter} 根`);

  // 11. 胜利结算（M2：20 分钟标准局）
  await cdp.eval('__twinEcho.world.time = 1199.99; __twinEcho.world.update(1/60)');
  check((await cdp.eval('__twinEcho.state')) === 'result', '20:00 到达 → 胜利结算');
  const resultVisible = await cdp.eval('!document.getElementById("result").classList.contains("hidden")');
  check(resultVisible, '结算页显示');
  const statsText = await cdp.eval('document.getElementById("resultStats").textContent');
  check(/共鸣击频率/.test(statsText) && /存活/.test(statsText) && /时砂/.test(statsText), '结算页含共鸣击频率（M2 主 KPI）与时砂', statsText.slice(0, 60));

  // 12. 遥测落库（GDD §14 埋点：每局摘要 + 关键事件）
  const tel = await cdp.eval(`(() => {
    const t = __twinEcho.telemetry;
    const lines = t.summaryCsv().trim().split('\\n');
    return {
      rows: lines.length - 1,
      head: lines[0].slice(0, 32),
      runCount: t.runCount(),
      events: t.eventsCsv().trim().split('\\n').length - 1,
      hasEnd: /run_death|run_win/.test(t.eventsCsv()),
      hasChoice: /levelup_choice/.test(t.eventsCsv()),
    };
  })()`);
  check(tel.rows >= 1 && tel.head.includes('runId'), '遥测：每局摘要可导出 CSV', `${tel.rows} 行 · 表头 ${tel.head}…`);
  check(tel.hasEnd && tel.events > 0, '遥测：关键事件行（局结束/升级选择）', `${tel.events} 条事件`);

  // 12.5 M2：回响密库（时砂消费 → 局外增益 → 下一局生效）
  const meta = await cdp.eval(`(() => {
    const g = __twinEcho;
    // 给足时砂，解锁「生命 +15」与「共鸣窗口 +0.1s」
    g.saved.sand = 500;
    g.saved.nodes = [];
    g.runOptions.character = 'otto'; g.runOptions.paradox = 0;
    g.startRun(); // 先在"无密库"状态开一局取基线（避免受前序机器人随机选卡影响）
    const before = { hp: g.world.player.maxHp, window: g.world.resonanceWindow() };
    g.buyMeta('phase1');
    g.buyMeta('res1');
    const afterBuy = { sand: g.saved.sand, nodes: [...g.saved.nodes] };
    g.startRun(); // 密库在下一局生效
    return {
      before,
      afterBuy,
      hp: g.world.player.maxHp,
      window: g.world.resonanceWindow(),
      metaHp: g.world.meta.hpBonus,
    };
  })()`);
  check(meta.afterBuy.nodes.length === 2 && meta.afterBuy.sand === 500 - 30 - 30, '密库：时砂扣除与解锁写入', `剩余时砂 ${meta.afterBuy.sand}`);
  check(meta.hp === meta.before.hp + 15, '密库增益在下一局生效（生命 +15）', `${meta.before.hp} → ${meta.hp}`);
  check(Math.abs(meta.window - (meta.before.window + 0.1)) < 1e-6, '密库「共鸣窗口 +0.1s」生效', `${meta.before.window.toFixed(2)}s → ${meta.window.toFixed(2)}s`);
  const metaBlocked = await cdp.eval(`(() => {
    const g = __twinEcho;
    g.saved.sand = 0;
    g.buyMeta('res3'); // 前置未解锁 + 时砂不足
    return { nodes: g.saved.nodes.length };
  })()`);
  check(metaBlocked.nodes === 2, '密库：前置/时砂校验阻止非法解锁', `仍为 ${metaBlocked.nodes} 节点`);

  // 12.8 M3：角色特性 / 悖论难度 / 每日挑战 / 挑战解锁
  const m3 = await cdp.eval(`(() => {
    const g = __twinEcho;
    g.saved.sand = 5000; g.saved.bestParadox = 1; g.saved.bestWin = true;
    g.saved.nodes = []; // 隔离密库加成，避免影响期望值
    // 角色「谐振者·铃」：共鸣窗口 1.0 → 1.4
    g.runOptions.character = 'rin'; g.runOptions.paradox = 0;
    g.startRun();
    const rin = { window: +g.world.resonanceWindow().toFixed(2), char: g.world.run.character };
    // 角色「见习者·米娅」：经验 +10%（把升级阈值抬高，避免升级吞掉 XP）
    g.runOptions.character = 'mia'; g.startRun();
    g.world.player.xp = 0; g.world.player.xpNeed = 1e9;
    g.world.addXp(100);
    const miaGain = +g.world.player.xp.toFixed(1);
    // 角色「断剑士·凯」：本体伤害 +20%、残影系数 0.5（用时砂解锁后须重开局生效）
    g.selectChar('kai');
    g.startRun();
    const kai = { body: g.world.run.bodyDmgPct, echoCoeff: g.world.run.echoCoeff, sand: g.saved.sand };
    // 悖论 1「阴风」：敌移速 +8% 实际作用到敌人身上（spawnT 初值 1s，需 ≥60 帧）
    g.runOptions.character = 'otto'; g.runOptions.paradox = 1; g.startRun();
    __BAL.spawn.interval = [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05];
    __BAL.spawn.batch = [5, 5, 5, 5, 5, 5, 5, 5, 5];
    for (let i = 0; i < 130; i++) g.world.update(1/60);
    const moth = g.world.enemies.items.find((e) => e.active && e.kind === 'moth' && !e.elite);
    const para = { pct: g.world.run.enemySpeedPct, speed: moth ? +moth.speed.toFixed(1) : -1, expect: 129.6 };
    return { rin, miaGain, kai, para };
  })()`);
  check(m3.rin.window === 1.4 && m3.rin.char === 'rin', '角色特性生效：铃的共鸣窗口 1.4s', `${m3.rin.window}s`);
  check(m3.miaGain === 110, '角色特性生效：米娅经验 +10%', `100 XP → ${m3.miaGain}`);
  check(Math.abs(m3.kai.body - 0.2) < 1e-6 && Math.abs(m3.kai.echoCoeff - 0.5) < 1e-6, '角色特性：凯（本体+20% / 残影 0.5）', `body ${m3.kai.body} · coeff ${m3.kai.echoCoeff} · 剩余时砂 ${m3.kai.sand}`);
  check(Math.abs(m3.para.pct - 0.08) < 1e-6 && Math.abs(m3.para.speed - m3.para.expect) < 0.3, '悖论 1 应用：敌移速 120 → 129.6', `实测 ${m3.para.speed}（pct=${m3.para.pct}）`);

  const daily = await cdp.eval(`(() => {
    const g = __twinEcho;
    const before = g.saved.sand;
    g.saved.dailyCleared = []; g.saved.dailyBest = {};
    g.startDaily();
    const mods = { daily: g.world.run.daily, mod: g.world.run.dailyModName, char: g.world.run.character, seed: g.seed };
    g.world.time = 1199.99; g.world.update(1/60);   // 跨过 20:00 触发胜利结算
    return {
      mods,
      state: g.state,
      cleared: g.saved.dailyCleared.length,
      bestTime: Object.values(g.saved.dailyBest)[0]?.time ?? 0,
      sandGain: g.saved.sand - before,
    };
  })()`);
  check(daily.mods.daily === true && daily.mods.mod !== '' && daily.mods.seed > 0, '每日挑战：固定种子 + 每日变异', `变异「${daily.mods.mod}」· 角色 ${daily.mods.char}`);
  check(daily.cleared === 1 && daily.bestTime > 0, '每日挑战：首通记录与本地榜写入', `记录 ${daily.bestTime}s · 首通标记 ${daily.cleared} · 状态 ${daily.state}`);
  check(daily.sandGain >= 300, '每日挑战：首通 +300 时砂', `本局共得 ${daily.sandGain} 时砂`);

  const challenge = await cdp.eval(`(() => {
    const g = __twinEcho;
    g.saved.challenges = [];
    g.runOptions.character = 'otto'; g.runOptions.paradox = 0;
    g.startRun();
    g.lvAt5min = 12; g.world.stats.bursts = 12;
    g.finishRun(true);
    return { challenges: [...g.saved.challenges] };
  })()`);
  check(challenge.challenges.length === 2, '挑战解锁：5min 达 Lv12 / 单局爆发 ≥10', challenge.challenges.join(' + '));

  // 12.9 M3(B)：15:00 双生回响兽 —— 镜像 4 秒前轨迹 + 延迟领域
  const twin = await cdp.eval(`(() => {
    const g = __twinEcho, w = g.world;
    g.saved.nodes = [];
    g.runOptions.character = 'otto'; g.runOptions.paradox = 0;
    g.startRun();
    w.boss = null; w.bossIdx = 2; w.bossWarned = false;   // 下一次到点刷 15:00 的双生回响兽
    const baseDelay = w.run.echoDelayFrames;
    w.time = 899.5;
    for (let i = 0; i < 90 && !(w.boss && w.boss.active); i++) w.update(1/60);
    const kind = w.boss ? w.boss.bossKind : '';
    const fieldDelay = w.echoDelayNow();
    // 玩家沿固定方向走 4 秒，再把 boss 推到"回响刃"状态，检查是否在老位置生成危险区
    w.input.x = 1; w.input.y = 0;
    for (let i = 0; i < 300; i++) { w.player.invulnT = 9999; w.update(1/60); }
    const past = w.playerPosAgo(240);
    if (w.boss) { w.boss.st = 3; w.boss.stT = 0.01; }
    for (let i = 0; i < 90; i++) { w.player.invulnT = 9999; w.update(1/60); }
    const hazards = w.hazards.count;
    const nearPast = w.hazards.items.some((h) => h.active && Math.hypot(h.x - past.x, h.y - past.y) < 160);
    return { kind, baseDelay, fieldDelay, hazards, nearPast, bossHp: w.boss ? Math.round(w.boss.hp) : 0 };
  })()`);
  check(twin.kind === 'twin', '15:00 双生回响兽按日程生成', `${twin.kind} · HP ${twin.bossHp}`);
  check(twin.fieldDelay === twin.baseDelay + 120, '延迟领域：残影延迟 +2s（§15 交互矩阵）', `${twin.baseDelay} → ${twin.fieldDelay} 帧`);
  check(twin.hazards >= 3 && twin.nearPast, '镜像 4 秒前轨迹：在老位置落下刃域', `危险区 ${twin.hazards} 片 · 命中旧路径 ${twin.nearPast}`);

  // 12.95 M3(A)：3 张地图（解锁链 / 障碍阻挡 / 时潮涡流危险区）
  const maps = await cdp.eval(`(() => {
    const g = __twinEcho;
    // ① 解锁链：未通关时钟平原时，图书馆不可选
    g.saved.mapsBeaten = [];
    g.runOptions.map = 'plain';
    g.selectMap('library');
    const blocked = g.runOptions.map;
    // 通关时钟平原后解锁
    g.saved.mapsBeaten = ['plain'];
    g.selectMap('library');
    const unlocked = g.runOptions.map;
    // ② 障碍阻挡：图书馆（每区块 3–5 个）把玩家推向障碍中心，不应穿模
    g.startRun();
    let w = g.world;
    const near = w.obstaclesNear(0, 0, []);
    const ob = near[0];
    let minGap = 999;
    let pushedGap = -999;
    if (ob) {
      // 直接把玩家放到障碍中心 → 一帧内应被推到表面之外
      w.player.x = ob.x;
      w.player.y = ob.y;
      w.player.invulnT = 9999;
      w.update(1/60);
      pushedGap = Math.hypot(w.player.x - ob.x, w.player.y - ob.y) - ob.r;
      // 再持续朝中心推进 60 帧，不应穿模
      for (let i = 0; i < 60; i++) {
        w.player.invulnT = 9999;
        const dx = ob.x - w.player.x, dy = ob.y - w.player.y;
        const d = Math.hypot(dx, dy) || 1;
        w.input.x = dx / d; w.input.y = dy / d;
        w.update(1/60);
        minGap = Math.min(minGap, Math.hypot(w.player.x - ob.x, w.player.y - ob.y) - ob.r);
      }
    }
    const obsCount = near.length;
    // ③ 时潮涡流：崩坏之环每 12s 在玩家附近生成危险区
    g.saved.mapsBeaten = ['plain', 'library'];
    g.selectMap('ring');
    g.startRun();
    w = g.world;
    for (let i = 0; i < 900; i++) { w.player.invulnT = 9999; w.update(1/60); }
    return {
      blocked, unlocked,
      obsCount, minGap: +minGap.toFixed(1), pushedGap: +pushedGap.toFixed(1), playerR: w.player.radius,
      ringHazards: w.hazards.count, ringId: w.mapDef.id,
    };
  })()`);
  check(maps.blocked === 'plain' && maps.unlocked === 'library', '地图解锁链：通关上一张才开下一张', `拦截后 ${maps.blocked} → 解锁后 ${maps.unlocked}`);
  check(
    maps.obsCount > 0 && maps.pushedGap >= maps.playerR - 0.5 && maps.minGap >= maps.playerR - 1,
    '地形障碍阻挡玩家（推出表面 + 不穿模）',
    `附近障碍 ${maps.obsCount} 个 · 中心推出至 ${maps.pushedGap}px · 推进中最小间隙 ${maps.minGap}px（玩家半径 ${maps.playerR}）`,
  );
  check(maps.ringHazards >= 1 && maps.ringId === 'ring', '崩坏之环：时潮涡流危险区按周期刷新', `15s 内生成 ${maps.ringHazards} 片`);

  // 12.97 M3(C)：难度预设（校准杠杆可切换）
  const diff = await cdp.eval(`(() => {
    const g = __twinEcho, w = g.world;
    g.saved.nodes = [];
    // 恩惠：受击宽限 1.0 → 1.5s、接触伤 −40%、升级回复 +10
    g.runOptions.character = 'otto'; g.runOptions.paradox = 0; g.runOptions.map = 'plain';
    g.runOptions.difficulty = 'casual';
    g.startRun();
    g.world.player.hurtCd = 0; g.world.player.invulnT = 0;
    g.world.damagePlayer(1);
    const casual = { grace: +g.world.player.hurtCd.toFixed(2), id: g.world.run.difficulty };
    const h0 = g.world.player.hp; g.world.addXp(0);
    g.world.player.xp = g.world.player.xpNeed; g.world.addXp(0);
    const healCasual = +(g.world.player.hp - h0).toFixed(1);
    // 标准：宽限应回到 1.0
    g.runOptions.difficulty = 'standard'; g.startRun();
    g.world.player.hurtCd = 0; g.world.player.invulnT = 0;
    g.world.damagePlayer(1);
    const std = +g.world.player.hurtCd.toFixed(2);
    // 严苛：接触伤 +25%（时蛾 3 → 4）
    g.runOptions.difficulty = 'hard'; g.startRun();
    __BAL.spawn.interval = [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05];
    __BAL.spawn.batch = [5, 5, 5, 5, 5, 5, 5, 5, 5];
    for (let i = 0; i < 130; i++) g.world.update(1/60);
    const moth = g.world.enemies.items.find((e) => e.active && e.kind === 'moth' && !e.elite);
    return { casual, std, hardMothDmg: moth ? moth.dmg : -1, healCasual };
  })()`);
  check(diff.casual.grace === 1.5 && diff.std === 1, '难度预设：恩惠宽限 1.5s / 标准 1.0s', `恩惠 ${diff.casual.grace}s · 标准 ${diff.std}s`);
  check(diff.hardMothDmg === 4, '难度预设：严苛接触伤 +25%（时蛾 3 → 4）', `实测 ${diff.hardMothDmg}`);

  // 13. 运行时异常
  check(cdp.errors.length === 0, '无未捕获运行时异常', cdp.errors.slice(0, 2).join(' | '));
  check(cdp.consoleErrors.length === 0, '无 console.error', cdp.consoleErrors.slice(0, 2).join(' | '));
} catch (err) {
  fail++;
  console.error(`✗ 冒烟测试异常：${err instanceof Error ? err.message : String(err)}`);
  if (cdp.errors.length) console.error(`  页面异常：\n  ${cdp.errors.slice(0, 3).join('\n  ')}`);
} finally {
  close();
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
