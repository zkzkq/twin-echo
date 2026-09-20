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
  // 注意：非每日局的开局种子是随机的，30s 时的等级本身有 1–2 级抖动，故留到 40s 再断言（原先 30s 会偶发 Lv2）
  await cdp.eval(BOT_FN);
  const combat = await cdp.eval(`(() => {
    const w = __twinEcho.world;
    for (let i = 0; i < 2400; i++) {
      if (i % 10 === 0) window.__bot(i);
      w.update(1/60);
      if (__twinEcho.state === 'levelup') __twinEcho.doPick(0);
    }
    return { kills: w.stats.kills, hits: w.stats.hits, enemies: w.enemies.count, spawned: w.enemyIdSeq, gems: w.gems.count, level: w.player.level, hp: w.player.hp, t: w.time };
  })()`);
  check(combat.kills > 0, '武器命中并击杀敌人', `40s 内击杀 ${combat.kills} · 命中 ${combat.hits}`);
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

  // 5b. M3「编队走位」收益：双影夹击（本体在左、残影在右夹住同一敌人）
  //     残影位置由重演缓冲决定，这里直接改写"下一帧将被读到"的缓冲槽来精确摆放残影
  const pincer = await cdp.eval(`(() => {
    const w = __twinEcho.world;
    const E = w.echo;
    const writeEcho = (x, y) => {
      const delay = Math.min(E.count, w.echoDelayNow());
      const at = (E.head + 1 - delay + E.bx.length) % E.bx.length;
      E.bx[at] = x; E.by[at] = y;
    };
    w.input.x = 0; w.input.y = 0;
    const e = w.enemies.items.find((x) => x.active && !x.boss);
    if (!e) return { error: 'no enemy' };
    e.hp = 1e9; e.speed = 0; e.dmg = 0;
    const PX = w.player.x, PY = w.player.y;
    // 阶段 1：残影拉到 600px 外（不同步），敌人在本体指针环上 → 本体标记（来源=左侧）
    for (let i = 0; i < 400 && e.lastHitSrc !== 'body'; i++) {
      w.player.x = PX; w.player.y = PY;
      writeEcho(PX + 600, PY);
      e.x = PX + 90; e.y = PY; e.orbitCdB = 0; e.orbitCdE = 999;
      w.update(1/60);
    }
    const marked = e.lastHitSrc;
    const gap = Math.round(Math.hypot(w.echo.x - w.player.x, w.echo.y - w.player.y));
    const p0 = w.stats.pincerHits, r0 = w.stats.resHits;
    // 阶段 2：残影放到敌人右侧 90px（本体↔残影 180px，两侧夹角 180°）→ 夹击
    for (let i = 0; i < 400 && w.stats.resHits === r0; i++) {
      w.player.x = PX; w.player.y = PY;
      writeEcho(PX + 180, PY);
      e.x = PX + 90; e.y = PY; e.orbitCdB = 0; e.orbitCdE = 0;
      w.update(1/60);
    }
    return {
      marked, gap, resonance: w.stats.resHits - r0, pincer: w.stats.pincerHits - p0,
      angle: Math.round(Math.atan2(0, -1) * 180 / Math.PI),
      echoX: Math.round(w.echo.x), playerX: Math.round(w.player.x), enemyX: Math.round(e.x),
    };
  })()`);
  check(pincer.marked === 'body' && pincer.gap > 500, '阶段 1：残影分离 600px，本体单独标记', `间距 ${pincer.gap}px`);
  check(pincer.resonance > 0, '阶段 2：残影从另一侧补刀 → 共鸣成立', `共鸣 +${pincer.resonance}`);
  check(pincer.pincer > 0, '双影夹击判定（两侧夹角 180° > 120°）→ 额外伤害乘区', `夹击 ${pincer.pincer} 次 · 本体 x=${pincer.playerX} 敌 x=${pincer.enemyX} 残影 x=${pincer.echoX}`);

  // 5c. M3「回响同步」：残影贴身 → isSynced + 同步时间累加 + 增伤乘区生效
  const sync = await cdp.eval(`(() => {
    const w = __twinEcho.world;
    const BAL = window.__BAL;
    const E = w.echo;
    const writeEcho = (x, y) => {
      const delay = Math.min(E.count, w.echoDelayNow());
      const at = (E.head + 1 - delay + E.bx.length) % E.bx.length;
      E.bx[at] = x; E.by[at] = y;
    };
    const far = () => { const dx = w.player.x - w.echo.x, dy = w.player.y - w.echo.y; return dx*dx+dy*dy > 400*400; };
    const enemies = w.enemies.items.filter((x) => x.active && !x.boss);
    if (enemies.length < 2) return { error: 'need 2 enemies', n: enemies.length };
    const [eA, eB] = enemies;
    for (const e of [eA, eB]) { e.hp = 1e9; e.speed = 0; e.dmg = 0; e.lastHitSrc = null; e.orbitCdE = 999; }
    w.input.x = 0; w.input.y = 0;
    const PX = w.player.x, PY = w.player.y;
    const old = BAL.resonance.syncPerSec, oldMax = BAL.resonance.syncMaxBonus;
    let maxDropA = 0, maxDropB = 0, syncTimeGain = 0, syncedSeen = false, farSeen = false;
    try {
      BAL.resonance.syncPerSec = 100; BAL.resonance.syncMaxBonus = 100; // 放大到 ×101 上限，使同步乘区在实测伤害中不可混淆
      // A：残影 600px 外（分离）
      eA.x = PX + 90; eA.y = PY;
      for (let i = 0; i < 240; i++) {
        w.player.x = PX; w.player.y = PY;
        writeEcho(PX + 600, PY);
        eA.x = PX + 90; eA.y = PY; eA.orbitCdB = 0;
        const h0 = eA.hp;
        w.update(1/60);
        maxDropA = Math.max(maxDropA, h0 - eA.hp);
        if (w.isSynced()) syncedSeen = true;
        if (far()) farSeen = true;
      }
      const t0 = w.stats.syncTime;
      // B：残影 30px（同步）
      eB.x = PX + 90; eB.y = PY;
      for (let i = 0; i < 240; i++) {
        w.player.x = PX; w.player.y = PY;
        writeEcho(PX + 30, PY);
        eB.x = PX + 90; eB.y = PY; eB.orbitCdB = 0;
        const h0 = eB.hp;
        w.update(1/60);
        maxDropB = Math.max(maxDropB, h0 - eB.hp);
        syncTimeGain = w.stats.syncTime - t0;
      }
    } finally {
      BAL.resonance.syncPerSec = old; BAL.resonance.syncMaxBonus = oldMax;
    }
    return {
      farSeen, syncedSeen, maxDropA: Math.round(maxDropA), maxDropB: Math.round(maxDropB),
      ratio: maxDropA > 0 ? Math.round(maxDropB / maxDropA) : 0,
      syncTimeGain: +syncTimeGain.toFixed(2), synced: w.isSynced(),
      streak: +w.syncStreak.toFixed(2), bonusAtCap: +w.syncBonus().toFixed(2), maxStreak: +w.stats.syncMaxStreak.toFixed(2),
      range: BAL.resonance.syncRange,
    };
  })()`);
  check(sync.farSeen === true && sync.syncedSeen === false, '残影 600px 外 → 未同步（分离态）');
  check(sync.synced === true, '残影 30px 内 → isSynced() 判定同步', `阈值 ${sync.range}px`);
  check(sync.syncTimeGain > 3, '同步时间累计（用于"编队时间占比"KPI）', `+${sync.syncTimeGain}s`);
  check(sync.maxStreak > 3, '连续同步时长被记录（ramp 输入量）', `最长连续 ${sync.maxStreak}s`);
  check(sync.ratio > 20, '同步态增伤乘区生效（实测 ×101 放大下伤害比）', `分离 ${sync.maxDropA} vs 同步 ${sync.maxDropB} → ×${sync.ratio}`);

  // 5d. ramp 的真实数值曲线（默认平衡值）：连续 5s 应 ≈ 5 × 7.5% = 37.5%，上限 60%
  const ramp = await cdp.eval(`(() => {
    const w = __twinEcho.world;
    const BAL = window.__BAL;
    const E = w.echo;
    const PX = w.player.x, PY = w.player.y;
    w.input.x = 0; w.input.y = 0;
    w.syncStreak = 0;
    const samples = [];
    for (let i = 0; i < 480; i++) {
      w.player.x = PX; w.player.y = PY;
      const delay = Math.min(E.count, w.echoDelayNow());
      const at = (E.head + 1 - delay + E.bx.length) % E.bx.length;
      E.bx[at] = PX + 20; E.by[at] = PY;
      w.update(1/60);
      if (i === 59 || i === 179 || i === 299 || i === 479) samples.push(+(w.syncBonus() * 100).toFixed(1));
    }
    // 断开同步后 streak 归零
    w.player.x = PX + 900;
    w.update(1/60);
    const broke = { streak: w.syncStreak, bonus: w.syncBonus() };
    return { samples, broke, perSec: BAL.resonance.syncPerSec, cap: BAL.resonance.syncMaxBonus };
  })()`);
  check(ramp.samples[0] > 5 && ramp.samples[0] < 12, '同步 1s → 增益 ≈7.5%', `${ramp.samples[0]}%`);
  check(ramp.samples[2] > 33 && ramp.samples[2] < 42, '同步 5s → 增益 ≈37.5%（叠加生效）', `${ramp.samples[2]}%`);
  check(Math.abs(ramp.samples[3] - ramp.cap * 100) < 0.5, '同步 8s → 增益触顶 +60%', `${ramp.samples[3]}%`);
  check(ramp.broke.streak === 0 && ramp.broke.bonus === 0, '断开同步 → 连续时长与增益归零');

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

  // 12.6 M3：密库补全 18 → 42 节点（6 支线 × 7 深度），含双效果节点与新增效果链路
  const metaFull = await cdp.eval(`(() => {
    const g = __twinEcho, w = g.world;
    const M = window.__meta;
    const byBranch = {};
    for (const n of M.META_NODES) byBranch[n.branch] = (byBranch[n.branch] ?? 0) + 1;
    // 前置链完整性：depth d 的节点必须能沿同支线一路回溯到 depth 0
    const chainOk = M.META_NODES.every((n) => {
      let cur = n;
      for (let guard = 0; guard < 10 && cur.depth > 0; guard++) {
        const pre = M.metaPrereq(cur);
        if (!pre) return false;
        cur = pre;
      }
      return cur.depth === 0;
    });
    // 双效果节点：phase3 = 生命 +25 且 升级回复 +3
    const b = M.computeBonuses(['phase3']);
    const dualOk = b.hpBonus === 25 && b.levelHealBonus === 3;
    const total = M.totalMetaCost();
    // 新增效果链路：开局共鸣值 + 甲壳减伤 + 四选一
    g.saved.nodes = ['res4', 'phase4', 'fate5'];
    g.startRun();
    const gaugeAtStart = w.player.gauge;
    w.player.hp = w.player.maxHp;
    w.damagePlayer(100);
    const armorTaken = +(w.player.maxHp - w.player.hp).toFixed(1);
    const choices = g.world ? M.genChoices(w).length : 0;
    void choices;
    const sandStart = g.saved.sand;
    void sandStart;
    return {
      nodes: M.META_NODES.length, branches: Object.keys(byBranch).length, perBranch: byBranch,
      chainOk, dualOk, total, gaugeAtStart, armorTaken, metaArmor: w.meta.armorPct, choiceBonus: w.meta.choiceBonus,
    };
  })()`);
  check(metaFull.nodes === 42 && metaFull.branches === 6, '密库节点 18 → 42（6 支线 × 7 深度）', `${metaFull.nodes} 节点 · 每支线 ${Object.values(metaFull.perBranch).join('/')}`);
  check(metaFull.chainOk, '密库前置链完整（每个深度都能回溯到 depth 0）');
  check(metaFull.dualOk, '密库深层双效果节点生效（时相核心：生命 +25 且 升级回复 +3）');
  check(metaFull.gaugeAtStart === 20, '密库「开局共鸣值 +20」生效', `开局共鸣值 ${metaFull.gaugeAtStart}`);
  check(metaFull.armorTaken < 100 && Math.abs(metaFull.armorTaken - 96) < 0.6, '密库「甲壳 −4%」生效（100 伤害 → 实际扣除）', `实扣 ${metaFull.armorTaken}`);
  check(metaFull.choiceBonus === 1, '密库「四选一」写入 choiceBonus（升级面板 3 → 4 张）', `+${metaFull.choiceBonus}`);
  check(metaFull.total > 3000, '密库全解锁总花费（反通胀基线）', `${metaFull.total} 时砂`);

  // 12.7 M3：图鉴（遭遇即解锁 / 击杀跨局累计 / 面板渲染）
  const codex = await cdp.eval(`(() => {
    const g = __twinEcho, w = g.world;
    g.saved.codex = {};
    g.runOptions.character = 'otto'; g.runOptions.paradox = 0;
    g.startRun();
    // 直接杀掉几只不同种类的敌人，验证图鉴计数与存档合并
    const kinds = ['moth', 'hopper', 'idol'];
    let killed = 0;
    for (const k of kinds) {
      const e = w.enemies.obtain();
      e.id = w.enemyIdSeq++; e.kind = k; e.boss = false; e.elite = false; e.bossKind = '';
      e.x = w.player.x + 4000; e.y = w.player.y; e.hp = 1; e.maxHp = 1; e.xpVal = 0; e.damageFree = true;
      w.killEnemy(e);
      killed++;
    }
    const liveCodex = Object.fromEntries(w.codex);
    // 局末合并进存档：直接走 runEnd 的那一步（这里手动模拟同样的合并逻辑前先落一次存档）
    for (const [k, v] of w.codex) g.saved.codex[k] = (g.saved.codex[k] ?? 0) + v;
    g.openCodex();
    const cards = document.querySelectorAll('#codexList .codexcard').length;
    const locked = document.querySelectorAll('#codexList .codexcard.locked').length;
    const unlockedText = document.getElementById('codexProgress').textContent;
    const state = g.state;
    g.closeCodex();
    return { killed, liveCodex, cards, locked, unlockedText, state, backTo: g.state, savedKeys: Object.keys(g.saved.codex).length };
  })()`);
  check(codex.cards === 9 && codex.state === 'codex' && codex.backTo === 'run', '图鉴面板可打开/关闭（4 杂兵 + 1 精英 + 4 Boss）', `${codex.cards} 张卡 · 状态 ${codex.state} → 返回 ${codex.backTo}`);
  check(codex.locked === codex.cards - 3, '图鉴未遭遇条目显示剪影（按存档解锁）', `已解锁 3 / ${codex.cards} · 进度「${codex.unlockedText}」`);
  check(codex.savedKeys === 3 && codex.liveCodex.moth === 1, '图鉴击杀跨局累计写入存档', `存档种类 ${codex.savedKeys} · 本局时蛾 ${codex.liveCodex.moth}`);

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

  // 12.93 M3：20:00 时间织造者·诺诺 —— 三阶段 + 「静止织机」领域（圈内残影延迟 +2s）
  const weaver = await cdp.eval(`(() => {
    const g = __twinEcho, w = g.world;
    g.runOptions.character = 'otto'; g.runOptions.paradox = 0;
    g.startRun();
    w.boss = null; w.bossIdx = 3; w.bossWarned = false;   // 下一次到点刷 20:00 的诺诺
    w.time = 1199.4;
    for (let i = 0; i < 90 && !(w.boss && w.boss.active); i++) { w.player.invulnT = 9999; w.update(1/60); }
    const b = w.boss;
    if (!b) return { error: 'no boss' };
    const baseDelay = w.run.echoDelayFrames;
    const D = w.player.maxHp;
    void D;
    const out = { kind: b.bossKind, phases: [], name: g.bossName ? '' : '' };
    // 站到 Boss 身边（圈内）与远处（圈外），分别检查相位与延迟
    const near = () => { w.player.x = b.x + 60; w.player.y = b.y; w.player.invulnT = 9999; w.update(1/60); };
    const far = () => { w.player.x = b.x + 900; w.player.y = b.y; w.player.invulnT = 9999; w.update(1/60); };
    // P1：满血
    b.hp = b.maxHp; near(); far();
    out.phases.push({ hp: 100, phase: b.phase, delayFar: w.echoDelayNow() });
    // P2：血量降到 60% → 领域展开
    b.hp = b.maxHp * 0.6;
    for (let i = 0; i < 120; i++) { w.player.x = b.x + 900; w.player.y = b.y; w.player.invulnT = 9999; w.update(1/60); }
    out.phases.push({ hp: 60, phase: b.phase });
    far();
    out.delayFar = w.echoDelayNow();
    near();
    out.delayNear = w.echoDelayNow();
    out.inDomain = w.inWeaverDomain();
    out.domainR = window.__BAL.weaver.domainR;
    // P3：血量降到 25% → 狂暴（全屏波状态 5/6 可达）
    b.hp = b.maxHp * 0.25;
    let sawWave = false;
    for (let i = 0; i < 900; i++) {
      w.player.x = b.x + 700; w.player.y = b.y; w.player.invulnT = 9999;
      w.update(1/60);
      if (b.st === 5 || b.st === 6) sawWave = true;
      b.hp = b.maxHp * 0.25; // 锁血观察招式，避免被打死
    }
    out.phases.push({ hp: 25, phase: b.phase });
    out.sawWave = sawWave;
    out.bullets = w.bullets.count;
    out.telemetryEvents = g.telemetry.events.length;
    return out;
  })()`);
  check(weaver.kind === 'weaver', '20:00 时间织造者·诺诺按日程生成');
  check(weaver.phases[0].phase === 1 && weaver.phases[1].phase === 2 && weaver.phases[2].phase === 3, '三阶段按血量阈值切换（100% → 60% → 25%）', `P${weaver.phases.map((p) => p.phase).join(' → P')}`);
  check(weaver.delayFar === weaver.phases[0].delayFar, 'P2 领域外：残影延迟不变（可读可躲）', `${weaver.delayFar} 帧`);
  check(weaver.inDomain === true && weaver.delayNear === weaver.delayFar + 120, '「静止织机」领域内：残影延迟 +2s', `圈内 ${weaver.delayNear} 帧 vs 圈外 ${weaver.delayFar} 帧 · 半径 ${weaver.domainR}`);
  check(weaver.sawWave === true, 'P3 狂暴：全屏扩散弹幕波进入出招循环', `场上子弹 ${weaver.bullets}`);

  // 12.94 M3「编队走位」：回响阻尼（同步时残影周围敌人减速）
  const damp = await cdp.eval(`(() => {
    const g = __twinEcho, w = g.world;
    g.runOptions.character = 'otto'; g.runOptions.paradox = 0;
    g.startRun();
    const E = w.echo;
    const writeEcho = (x, y) => {
      const delay = Math.min(E.count, w.echoDelayNow());
      const at = (E.head + 1 - delay + E.bx.length) % E.bx.length;
      E.bx[at] = x; E.by[at] = y;
    };
    w.input.x = 0; w.input.y = 0;
    for (let i = 0; i < 200; i++) { w.player.invulnT = 9999; w.update(1/60); }
    const e = w.enemies.items.find((x) => x.active && !x.boss);
    if (!e) return { error: 'no enemy' };
    e.hp = 1e9;
    w.player.stats.critCh = 0; // 关暴击：暴击附带击退，会污染位移测量
    const PX = w.player.x, PY = w.player.y;
    // 先把 ramp 拉满：连续同步 10s（残影贴在本体旁）
    for (let i = 0; i < 600; i++) {
      w.player.x = PX; w.player.y = PY; w.player.invulnT = 9999;
      writeEcho(PX + 20, PY);
      w.update(1/60);
    }
    const ramp = w.syncRamp();
    // 每帧把敌人钉回固定点，只累计"单帧位移" → 排除距离/追击时长差异，只留速度差
    const measure = (atEcho) => {
      let moved = 0;
      for (let i = 0; i < 60; i++) {
        w.player.x = PX; w.player.y = PY; w.player.invulnT = 9999;
        writeEcho(PX + 20, PY);
        e.hp = 1e9; e.slowT = 0; e.kx = 0; e.ky = 0;
        e.x = atEcho ? w.echo.x + 30 : PX + 400;  // 400px 远在阻尼半径（140）之外
        e.y = atEcho ? w.echo.y : PY;
        const x0 = e.x, y0 = e.y;
        w.update(1/60);
        moved += Math.hypot(e.x - x0, e.y - y0);
      }
      return moved;
    };
    const near = measure(true);
    const away = measure(false);
    return { ramp: +ramp.toFixed(2), near: +near.toFixed(1), away: +away.toFixed(1), ratio: away > 0 ? +(near / away).toFixed(3) : 0 };
  })()`);
  check(damp.ramp >= 0.99, 'ramp 拉满（连续同步 10s）', `ramp ${damp.ramp}`);
  check(damp.ratio > 0.6 && damp.ratio < 0.95, '回响阻尼：残影旁边的敌人明显变慢', `贴残影位移 ${damp.near} vs 远处 ${damp.away} → ×${damp.ratio}`);

  // 12.96 M3：内容全表 —— 武器 6→12 / 被动 8→15 / 进化 2→6
  const table = await cdp.eval(`(() => {
    const I = window.__items;
    return {
      weapons: I.WEAPONS.length,
      passives: I.PASSIVES.length,
      evolutions: I.EVOLUTIONS.length,
      evoRefsOk: I.EVOLUTIONS.every((e) => !!I.weaponById(e.weapon) && !!I.passiveById(e.passive)),
      dupes: new Set(I.WEAPONS.map((w) => w.id)).size !== I.WEAPONS.length || new Set(I.PASSIVES.map((p) => p.id)).size !== I.PASSIVES.length,
    };
  })()`);
  check(table.weapons === 12 && !table.dupes, '武器全表 12 把（M3 6→12，id 无重复）', `${table.weapons} 把`);
  check(table.passives === 15, '被动全表 15 项（M3 8→15，id 无重复）', `${table.passives} 项`);
  check(table.evolutions === 6 && table.evoRefsOk, '进化配方 6 条（M3 2→6）且武器/被动引用有效', `${table.evolutions} 条`);

  // 12.97 M3：新增 6 把武器都能实际造成伤害（每把单独装备，先跑 15s 让场上成规模）
  const wres = await cdp.eval(`(() => {
    const g = __twinEcho;
    const out = [];
    for (const id of ['pendulum', 'boomerang', 'rain', 'web', 'prism', 'chime']) {
      g.runOptions.character = 'otto'; g.runOptions.paradox = 0;
      g.startRun();
      const w = g.world;
      for (let i = 0; i < 900; i++) {
        if (i % 10 === 0) window.__bot(i);
        w.player.invulnT = 9999;
        w.update(1/60);
        if (g.state === 'levelup') g.doPick(0);
      }
      w.player.xpNeed = 1e9;               // 关掉后续升级，保证只测这一把武器
      w.player.weapons.clear();
      w.player.weapons.set(id, { lv: 1, cd: 0 });
      const h0 = w.stats.hits;
      for (let i = 0; i < 600; i++) {
        if (i % 10 === 0) window.__bot(i);
        w.player.invulnT = 9999;
        w.update(1/60);
      }
      out.push({ id, hits: w.stats.hits - h0 });
    }
    return out;
  })()`);
  const noHit = wres.filter((r) => r.hits <= 0);
  check(
    noHit.length === 0,
    'M3 新增 6 武器全部能造成伤害（扇形/往返/落点/减速/双影/残影）',
    wres.map((r) => `${r.id}:${r.hits}`).join(' · '),
  );

  // 12.98 M3：新增 7 被动写入派生属性 + 进化可获得性与效果
  const pnew = await cdp.eval(`(() => {
    const I = window.__items, w = __twinEcho.world;
    const out = {};
    for (const id of ['echo', 'magnet', 'armor', 'regen', 'greed', 'damp', 'burstcore']) {
      w.player.passives.clear();
      w.player.passives.set(id, 5);
      I.recompute(w.player);
      const s = w.player.stats;
      out[id] = { echoDmg: s.echoDmg, pickup: s.pickup, armor: s.armor, regen: s.regen, greed: s.greed, damp: s.damp, burstDmg: s.burstDmg };
    }
    // 6 条进化的可获得性判定（满足武器满级 6 + 被动 5 + 结晶 ≥2）
    const reach = [];
    for (const e of I.EVOLUTIONS) {
      w.player.evolutions.clear();
      w.player.weapons.clear();
      w.player.passives.clear();
      w.player.crystals = 10;
      w.player.weapons.set(e.weapon, { lv: 6, cd: 0 });
      w.player.passives.set(e.passive, 5);
      reach.push({ id: e.id, ok: I.satisfiableRecipes(w).some((x) => x.id === e.id) });
    }
    // 端到端：造出「命运节拍器」（回旋镖 + 急速）
    w.player.evolutions.clear();
    w.player.weapons.clear();
    w.player.passives.clear();
    w.player.crystals = 10;
    w.player.weapons.set('boomerang', { lv: 6, cd: 0 });
    w.player.passives.set('haste', 5);
    const c0 = w.player.crystals;
    const crafted = I.craftEvolution(w, 'metronome');
    return {
      stats: out, reach,
      crafted, crystalsSpent: c0 - w.player.crystals, hasEvo: w.player.evolutions.has('metronome'),
      evoCrafted: w.stats.altarCrafted,
    };
  })()`);
  check(
    pnew.stats.echo.echoDmg > 0 && pnew.stats.magnet.pickup > 0 && pnew.stats.armor.armor > 0 &&
      pnew.stats.regen.regen > 0 && pnew.stats.greed.greed > 0 && pnew.stats.damp.damp > 0 && pnew.stats.burstcore.burstDmg > 0,
    'M3 新增 7 被动全部写入派生属性',
    `回响 +${pnew.stats.echo.echoDmg} · 磁引 +${pnew.stats.magnet.pickup} · 甲壳 ${pnew.stats.armor.armor} · 再生 ${pnew.stats.regen.regen}/s · 丰收 +${pnew.stats.greed.greed} · 滞时 ${pnew.stats.damp.damp} · 共鸣核 +${pnew.stats.burstcore.burstDmg}`,
  );
  check(pnew.reach.every((r) => r.ok), '6 条进化在条件满足时都可被祭坛提出', pnew.reach.map((r) => `${r.id}${r.ok ? '✓' : '✗'}`).join(' '));
  check(pnew.crafted && pnew.hasEvo && pnew.crystalsSpent === 2, '端到端：祭坛进化新配方（回旋镖+急速 → 命运节拍器）', `消耗结晶 ${pnew.crystalsSpent} · altarCrafted ${pnew.evoCrafted}`);

  // 12.99 M3：「双生镜界」进化真的把棱镜变成双影散射（3 向 × 本体/残影 = 6 发）
  const prismEvo = await cdp.eval(`(() => {
    const g = __twinEcho, w = g.world;
    g.startRun();
    w.player.invulnT = 9999;
    for (let i = 0; i < 240; i++) w.update(1/60);
    const shoot = (mirror) => {
      w.player.weapons.clear();
      w.player.passives.clear();
      w.player.evolutions.clear();
      if (mirror) w.player.evolutions.add('mirror');
      w.player.weapons.set('prism', { lv: 1, cd: 0 });
      const e = w.enemies.items.find((x) => x.active && !x.boss);
      if (!e) return null;
      e.hp = 1e9; e.speed = 0; e.x = w.player.x + 120; e.y = w.player.y;
      // 直接统计 spawnBullet 的调用（按 src 分类）：比数池里剩几发更可靠——
      // 残影那一发可能一出生就落在敌人身上被立即回收
      let body = 0, echo = 0;
      const orig = w.spawnBullet.bind(w);
      w.spawnBullet = (...a) => { if (a[8] === 'echo') echo++; else body++; return orig(...a); };
      try {
        w.player.invulnT = 9999;
        w.update(1/60);
      } finally {
        delete w.spawnBullet;
      }
      return { body, echo };
    };
    const base = shoot(false);
    const mirror = shoot(true);
    return { base, mirror };
  })()`);
  check(
    prismEvo.base && prismEvo.mirror &&
      prismEvo.base.body === 1 && prismEvo.base.echo === 1 &&
      prismEvo.mirror.body === 3 && prismEvo.mirror.echo === 3,
    '「双生镜界」：棱镜 1 向 → 3 向，本体+残影各一发',
    `基础 本体${prismEvo.base?.body}/残影${prismEvo.base?.echo} 发 → 进化 本体${prismEvo.mirror?.body}/残影${prismEvo.mirror?.echo} 发`,
  );

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
    // 取"最孤立"的障碍：相邻障碍会把玩家推回去，导致断言偶发失败（布局随种子随机）
    const iso = (o) => {
      let m = Infinity;
      for (const q of near) {
        if (q === o) continue;
        m = Math.min(m, Math.hypot(q.x - o.x, q.y - o.y) - q.r - o.r);
      }
      return m;
    };
    const ob = near.slice().sort((a, b) => iso(b) - iso(a))[0];
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
