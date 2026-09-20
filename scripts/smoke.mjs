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
