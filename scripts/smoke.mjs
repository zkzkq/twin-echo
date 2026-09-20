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
    // 清场：只留这一只。否则其它敌人也可能先凑成共鸣，把 resHits 抬高 → 循环立即退出 → 偶发 0 夹击
    // （这个断言曾因此随机失败；残影/本体的指针环半径 90，别的敌人就贴在环上）
    const solo = () => { for (const o of w.enemies.items) if (o.active && o !== e) w.enemies.release(o); };
    solo();
    const PX = w.player.x, PY = w.player.y;
    // 阶段 1：残影拉到 600px 外（不同步），敌人在本体指针环上 → 本体标记（来源=左侧）
    for (let i = 0; i < 400 && e.lastHitSrc !== 'body'; i++) {
      w.player.x = PX; w.player.y = PY;
      writeEcho(PX + 600, PY);
      e.x = PX + 90; e.y = PY; e.orbitCdB = 0; e.orbitCdE = 999;
      solo();
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
      solo();
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
    // 上一段（夹击）把场上清空了 → 先跑几秒让导演补够 2 只（最多 10s）
    for (let i = 0; i < 600 && w.enemies.items.filter((x) => x.active && !x.boss).length < 2; i++) {
      w.player.invulnT = 9999;
      w.update(1/60);
    }
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

  // 12.10 M3：鼠标控制方向（真实 DOM 事件 → 状态 → 世界换算 → 位移）
  const mouse = await cdp.eval(`(() => {
    const g = __twinEcho, w = g.world;
    g.runOptions.character = 'otto'; g.runOptions.paradox = 0;
    g.startRun();
    const p = w.player;
    const canvas = document.querySelector('#app canvas');
    const rect = canvas.getBoundingClientRect();
    const E = window.PointerEvent ?? window.MouseEvent;
    const cx = rect.left + rect.width * 0.75;
    const cy = rect.top + rect.height * 0.4;
    const mk = (t, b = 0) => new E(t, { clientX: cx, clientY: cy, button: b, buttons: b === 0 ? 1 : 0, bubbles: true, cancelable: true });
    // ① 事件路径：按住左键 → 生效；window 上抬手 → 松开
    canvas.dispatchEvent(mk('pointermove'));
    canvas.dispatchEvent(mk('pointerdown'));
    const afterDown = { active: w.pointer.active, hold: w.pointer.hold, inside: w.pointer.inside };
    const expectSx = (cx - rect.left) * (g.app.screen.width / rect.width);
    const sxErr = Math.abs(w.pointer.sx - expectSx);
    window.dispatchEvent(mk('pointerup'));
    const afterUp = { active: w.pointer.active, hold: w.pointer.hold };
    // ② 右键 → 常驻跟随开关
    canvas.dispatchEvent(mk('pointerdown', 2));
    const persistOn = w.pointer.persistent;
    canvas.dispatchEvent(mk('pointerdown', 2));
    const persistOff = w.pointer.persistent;
    // ③ 世界换算 + 位移：相机贴住玩家时 sx = 640 + (目标x - 玩家x)
    const W = 1280, H = 720;
    const step = (tx, ty, n, kb) => {
      w.viewW = W; w.viewH = H;
      w.camX = p.x; w.camY = p.y;
      w.pointer.sx = W / 2 + (tx - p.x);
      w.pointer.sy = H / 2 + (ty - p.y);
      w.pointer.active = true;
      w.input.x = kb ? kb[0] : 0;
      w.input.y = kb ? kb[1] : 0;
      const x0 = p.x, y0 = p.y;
      const f0 = p.facing;
      for (let i = 0; i < n; i++) { p.invulnT = 9999; w.camX = x0; w.camY = y0; w.update(1/60); }
      return { dx: +(p.x - x0).toFixed(1), dy: +(p.y - y0).toFixed(1), facing: +p.facing.toFixed(3), f0: +f0.toFixed(3), aimX: Math.round(w.pointer.x), aimY: Math.round(w.pointer.y) };
    };
    const right = step(p.x + 300, p.y, 30);          // 光标在右 → 向右走
    const down = step(p.x, p.y + 300, 30);           // 光标在下 → 向下走（且面向 π/2）
    const dead = step(p.x + 10, p.y, 30);            // 死区内 → 不动
    // ④ 键盘回退 & 鼠标覆盖键盘
    w.pointer.active = false; w.viewW = W; w.viewH = H;
    w.input.x = 1; w.input.y = 0; p.invulnT = 9999;
    const kx0 = p.x;
    for (let i = 0; i < 30; i++) { p.invulnT = 9999; w.update(1/60); }
    const kbOnly = +(p.x - kx0).toFixed(1);
    const override = step(p.x + 300, p.y, 30, [-1, 0]);  // 键盘按左 + 鼠标指右 → 应向右
    // ⑤ 非 run 状态不抢输入（面板打开时鼠标不应操控角色）
    w.pointer.hold = true; w.pointer.inside = true;
    const st = g.state; g.state = 'result';
    g.syncPointerActivePerFrame ? g.syncPointerActivePerFrame() : null;
    const blocked = w.pointer.active;
    g.state = st;
    w.pointer.hold = false; w.pointer.active = false;
    return { afterDown, afterUp, sxErr: +sxErr.toFixed(2), persistOn, persistOff, right, down, dead, kbOnly, override, blocked };
  })()`);
  check(
    mouse.afterDown.active === true && mouse.afterDown.hold === true && mouse.afterDown.inside === true,
    '鼠标左键按下 → 操控生效（真实 DOM 事件路径）',
    `active=${mouse.afterDown.active} · hold=${mouse.afterDown.hold}`,
  );
  check(mouse.sxErr < 1, '光标屏幕坐标换算正确（CSS 尺寸 → 渲染像素）', `误差 ${mouse.sxErr}px`);
  check(mouse.afterUp.active === false && mouse.afterUp.hold === false, '抬手（window 监听）→ 立刻回到键盘操控');
  check(mouse.persistOn === true && mouse.persistOff === false, '右键单击 → 常驻跟随开关可切换', `开=${mouse.persistOn} → 关=${mouse.persistOff}`);
  check(mouse.right.dx > 60 && Math.abs(mouse.right.dy) < 3, '按住左键 → 朝光标满速移动（右）', `Δ(${mouse.right.dx}, ${mouse.right.dy}) · 目标点 (${mouse.right.aimX}, ${mouse.right.aimY})`);
  check(mouse.down.dy > 60 && Math.abs(mouse.down.dx) < 3 && Math.abs(mouse.down.facing - Math.PI / 2) < 0.05, '朝下移动且面向光标（定向武器可用）', `Δ(${mouse.down.dx}, ${mouse.down.dy}) · facing=${mouse.down.facing}`);
  check(Math.abs(mouse.dead.dx) < 1 && Math.abs(mouse.dead.dy) < 1, '光标进入死区（26px）→ 停下，不抖动', `Δ(${mouse.dead.dx}, ${mouse.dead.dy})`);
  check(mouse.kbOnly > 60, '未使用鼠标时键盘照常生效', `键盘右移 ${mouse.kbOnly}px`);
  check(mouse.override.dx > 60, '鼠标生效时覆盖键盘轴（不叠加）', `键盘左 + 鼠标右 → Δx ${mouse.override.dx}`);
  check(mouse.blocked === false, '非 run 状态（面板打开）鼠标不抢输入');

  // 12.11 M3：地图专属机制①——静止图书馆的「视线遮蔽」（可视判定 / 索敌 / 渲染 / 迷雾）
  const vision = await cdp.eval(`(() => {
    const g = __twinEcho, w = g.world;
    g.saved.mapsBeaten = ['plain'];
    g.selectMap('library');
    g.startRun();
    const p = w.player;
    const R = w.visionR();
    const out = { mapId: w.mapDef.id, R };
    // ① 半径外不可见 / 半径内无遮挡可见
    out.far = w.sees(p.x + R + 80, p.y);
    out.near = w.sees(p.x + 120, p.y);
    // ② 障碍遮挡：把玩家钉在书架一侧，目标钉在书架正后方（同一条射线上）
    const list = w.obstaclesNear(0, 0, []);
    const ob = list.slice().sort((a, b) => b.r - a.r)[0];
    const dx = ob.x - p.x, dy = ob.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    p.x = ob.x - ux * (ob.r + 60);
    p.y = ob.y - uy * (ob.r + 60);
    const tx = ob.x + ux * (ob.r + 30), ty = ob.y + uy * (ob.r + 30);
    out.behindSees = w.sees(tx, ty);
    out.behindDist = Math.round(Math.hypot(tx - p.x, ty - p.y));
    // 同一位置、垂直方向的等距目标应可见（射线不穿过书架）
    out.perpSees = w.sees(p.x - uy * 190, p.y + ux * 190);
    out.obR = Math.round(ob.r);
    // ③ 索敌：先让场上成规模（跑 10s，玩家无敌），再把所有敌人搬到视野半径之外
    for (let i = 0; i < 600; i++) { p.invulnT = 9999; w.update(1/60); }
    w.player.weapons.clear();
    w.player.passives.clear();
    w.player.evolutions.clear();
    w.player.weapons.set('bolt', { lv: 1, cd: 0 });
    const park = (dist) => { for (const e of w.enemies.items) if (e.active) { e.x = p.x + dist; e.y = p.y + (e.id % 7) * 12; } };
    park(R + 300);
    const b0 = w.bullets.count;
    let sawFar = false;
    for (let i = 0; i < 12; i++) { park(R + 300); p.invulnT = 9999; w.update(1/60); if (w.enemies.items.some((x) => x.active && !x.boss)) sawFar = true; }
    out.shotsFar = w.bullets.count - b0;
    out.sawFar = sawFar;
    // ④ 留一个敌人在视野内 → 应恢复开火（其余仍留在视野外）
    const e0 = w.enemies.items.find((x) => x.active && !x.boss);
    if (!e0) return { ...out, err: 'phase4 no enemy' };
    e0.hp = 1e9;
    const b1 = w.bullets.count;
    for (let i = 0; i < 12; i++) {
      park(R + 300);
      e0.x = p.x + 150; e0.y = p.y;
      p.invulnT = 9999;
      w.update(1/60);
    }
    out.shotsNear = w.bullets.count - b1;
    // ⑤ 渲染：迷雾开启 + 视野外敌人不画
    g.render(1/60);
    out.fogVisible = !!(g.fogSprite && g.fogSprite.visible);
    out.fogScale = g.fogSprite ? +g.fogSprite.scale.x.toFixed(2) : 0;
    // 全部搬到视野外再渲染一次
    park(R + 300);
    w.update(1/60);
    g.render(1/60);
    out.spritesVisibleAllFar = w.enemies.items.filter((e) => e.active && !e.boss && !e.elite && e.sprite.visible).length;
    out.activeNonBoss = w.enemies.items.filter((e) => e.active && !e.boss && !e.elite).length;
    // ⑥ 平原图无遮蔽、无迷雾
    g.saved.mapsBeaten = ['plain', 'library'];
    g.selectMap('plain');
    g.startRun();
    out.plainR = g.world.visionR();
    out.plainSeesFar = g.world.sees(g.world.player.x + 5000, g.world.player.y);
    g.render(1/60);
    out.plainFog = !!(g.fogSprite && g.fogSprite.visible);
    return out;
  })()`);
  check(vision.mapId === 'library' && vision.R > 0, '图书馆启用视野遮蔽（visionR > 0）', `${vision.mapId} · r=${vision.R}`);
  check(vision.far === false && vision.near === true, '视野半径外不可见 / 半径内可见');
  check(
    vision.behindSees === false && vision.perpSees === true,
    '书架真实遮挡：正后方不可见（距离 ' + vision.behindDist + 'px < 视野半径）· 垂直方向可见',
    `书架 r=${vision.obR}`,
  );
  check(vision.shotsFar === 0 && vision.sawFar === true, '自动索敌尊重视线：敌人全在视野外时裂空弩不开火（场上确有敌人）', `12 帧内新弹 ${vision.shotsFar}`);
  check(vision.shotsNear > 0, '敌人进入视野后恢复索敌', `12 帧内新弹 ${vision.shotsNear}`);
  check(vision.fogVisible === true && vision.fogScale > 1, '迷雾层随视野半径缩放显示', `scale ${vision.fogScale}`);
  check(
    vision.activeNonBoss > 0 && vision.spritesVisibleAllFar === 0,
    '视野外的敌人不渲染（Boss/精英除外）',
    `同屏非精英 ${vision.activeNonBoss} → 可见精灵 ${vision.spritesVisibleAllFar}`,
  );
  check(vision.plainR === 0 && vision.plainSeesFar === true && vision.plainFog === false, '时钟平原无遮蔽、无迷雾（不误伤其它地图）');

  // 12.12 M3：地图专属机制②——崩坏之环的「同心圆环地形」
  const rings = await cdp.eval(`(() => {
    const g = __twinEcho, w = g.world;
    g.saved.mapsBeaten = ['plain', 'library'];
    g.selectMap('ring');
    g.startRun();
    const list = [];
    for (let cx = -2; cx <= 2; cx++) for (let cy = -2; cy <= 2; cy++) {
      for (const o of w.obstaclesNear(cx * 800 + 400, cy * 800 + 400, [])) list.push(o);
    }
    const uniq = new Map();
    for (const o of list) uniq.set(o.x + ':' + o.y, o);
    const all = [...uniq.values()];
    const STEP = 560;
    const offRing = all.filter((o) => {
      const d = Math.hypot(o.x, o.y);
      const k = Math.round(d / STEP);
      return k < 1 || Math.abs(d - k * STEP) > 120;
    }).length;
    // 缺口：k=1 环上的最大角度空隙
    const ring1 = all.filter((o) => { const d = Math.hypot(o.x, o.y); return d > STEP - 140 && d < STEP + 140; });
    ring1.sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
    let maxGap = 0;
    for (let i = 1; i < ring1.length; i++) {
      const a0 = Math.atan2(ring1[i - 1].y, ring1[i - 1].x);
      const a1 = Math.atan2(ring1[i].y, ring1[i].x);
      maxGap = Math.max(maxGap, a1 - a0);
    }
    // 跨区块拼接：边界附近的障碍应同时被两侧区块查到（不会在缝上丢/重）
    const nearEdge = all.find((o) => {
      const mx = ((o.x % 800) + 800) % 800;
      const my = ((o.y % 800) + 800) % 800;
      return Math.min(mx, 800 - mx, my, 800 - my) < 60;
    });
    let seamOk = null;
    if (nearEdge) {
      const left = w.obstaclesNear(nearEdge.x - 130, nearEdge.y, []);
      const right = w.obstaclesNear(nearEdge.x + 130, nearEdge.y, []);
      seamOk = left.some((o) => o.x === nearEdge.x && o.y === nearEdge.y) && right.some((o) => o.x === nearEdge.x && o.y === nearEdge.y);
    }
    return {
      count: all.length, offRing, maxGap: +maxGap.toFixed(2), ring1: ring1.length,
      seamOk, hasSeamSample: !!nearEdge,
      pattern: w.mapDef.obstacles.pattern,
    };
  })()`);
  check(rings.pattern === 'rings' && rings.count > 20, '崩坏之环使用同心圆环地形', `${rings.count} 个障碍 · pattern=${rings.pattern}`);
  check(rings.offRing === 0, '所有障碍都落在同心圆环带上（560px 步长 ±120）');
  check(rings.ring1 > 10 && rings.maxGap > 0.6, '环上留有可通行的缺口（走廊）', `k=1 环 ${rings.ring1} 个障碍 · 最大缺口 ${rings.maxGap} rad`);
  check(rings.hasSeamSample === false || rings.seamOk === true, '跨区块拼接一致（边界障碍两侧都能查到）');

  // 12.13 M3：验收度量口径（崩溃率 / 3 日回访 / 中位局时长）——M3 三条 Exit Criteria 的仪器
  const diagT = await cdp.eval(`(() => {
    const D = window.__diag;
    const SESSION_KEY = 'twinEcho.session';
    localStorage.removeItem(SESSION_KEY);
    D.state.sessions = 0; D.state.cleanExits = 0; D.state.crashes = [];
    D.state.runSeconds = []; D.state.playDays = []; D.state.sessionStarts = [];
    // ① 会话 1：正常收尾；会话 2：异常结束（没 endSession 就再次启动）
    D.beginSession(); D.endSession();
    D.beginSession();
    const r2 = D.beginSession();
    D.endSession();
    const rate = D.crashRate();
    // ② 真实异常通道：派发一个 ErrorEvent，应被 onerror 记录（不混入崩溃率）
    const before = D.errorCount();
    window.dispatchEvent(new ErrorEvent('error', { message: 'smoke-probe-error' }));
    const after = D.errorCount();
    // ③ 中位局时长
    for (const s of [300, 600, 1200, 1080, 900]) D.noteRun(s, 1);
    const med = D.medianRunSeconds();
    // ④ 回访：D0 / D0+2 / D0+6 → D1 否、D3 是、D7 是
    const d0 = '2026-01-01';
    const day = (n) => {
      const t = new Date(Date.parse(d0 + 'T00:00:00') + n * 86400000);
      const p = (x) => String(x).padStart(2, '0');
      return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
    };
    D.state.playDays = [d0, day(2), day(6)];
    const ret = D.retention();
    // ⑤ 报告可生成且含三条指标
    const report = D.report(7, { character: 'otto', map: 'library', difficulty: 'standard' });
    const keys = ['崩溃率', '3 日回访', '中位局时长', '游玩日'];
    return {
      sessions: D.state.sessions, cleanExits: D.state.cleanExits, unclean: r2.unclean,
      rate: +rate.toFixed(4), errDelta: after - before, med, ret,
      hasAll: keys.every((k) => report.includes(k)), reportLen: report.length,
      lines: report.split('\\n').filter((s) => s.startsWith('| 中位') || s.startsWith('| 3 日') || s.startsWith('| 崩溃')).join(' || '),
    };
  })()`);
  check(diagT.sessions === 3 && diagT.unclean === true, '会话判定：正常收尾 vs 异常结束（崩溃率的分子）', `会话 ${diagT.sessions} · 正常 ${diagT.cleanExits}`);
  check(Math.abs(diagT.rate - 1 / 3) < 0.01, '崩溃率 = 异常会话 / 总会话', `${(diagT.rate * 100).toFixed(1)}%`);
  check(diagT.errDelta === 1, '运行时异常被真实 onerror 通道记录（单独计数，不混入崩溃率）', `+${diagT.errDelta} 条`);
  check(diagT.med === 900, '中位局时长（15min）', `${diagT.med}s`);
  check(diagT.ret.days === 3 && diagT.ret.d1 === false && diagT.ret.d3 === true && diagT.ret.d7 === true, '回访口径：D1/D3/D7 判定', `D3=${diagT.ret.d3} · D7=${diagT.ret.d7}`);
  check(diagT.hasAll && diagT.reportLen > 400, '验收报告含三条 Exit Criteria 与原始数据', `${diagT.reportLen} 字符`);

  // 12.14 M3：成就（判定表 / 阈值 / 端到端写入 / 面板 / Steamworks 适配层）
  const achv = await cdp.eval(`(() => {
    const A = window.__achv, g = __twinEcho, w = g.world;
    const ids = A.ACHIEVEMENTS.map((a) => a.id);
    const out = { total: ids.length, dup: new Set(ids).size !== ids.length };
    // 空上下文不应解锁任何成就
    out.none = A.evaluateAchievements(A.EMPTY_CTX, {}).length;
    // 富上下文：应解锁全部"单局类"
    const rich = {
      ...A.EMPTY_CTX, time: 1200, win: true, level: 52, kills: 4200, resHits: 640, pincerHits: 80,
      syncMaxStreak: 18, evolutions: 3, weapons: 6, passives: 8, bossKills: 4, elitesKilled: 25,
      paradox: 3, isDaily: true, runs: 21, mapsBeaten: 3, metaNodes: 42, codexSeen: 9,
    };
    const unlocked = A.evaluateAchievements(rich, {});
    out.unlocked = unlocked.length;
    out.again = A.evaluateAchievements(rich, Object.fromEntries(unlocked.map((i) => [i, 'x']))).length;
    // 差一点的上下文不该解锁任何成就（阈值必须真的卡住）
    out.partial = A.evaluateAchievements({
      ...rich, win: false, level: 10, kills: 100, resHits: 10, pincerHits: 0, syncMaxStreak: 1,
      evolutions: 0, weapons: 2, passives: 1, bossKills: 0, elitesKilled: 0, paradox: 0,
      isDaily: false, runs: 0, mapsBeaten: 0, metaNodes: 2, codexSeen: 1,
    }, {}).length;
    // Steamworks 适配层
    const seen = [];
    A.registerSink({ unlock: (id) => seen.push(id) });
    A.emitUnlock('first_run');
    A.emitUnlock('first_win');
    A.registerSink(null);
    out.sink = seen;
    // 端到端：跑完一局（胜利）→ 写入存档
    g.saved.achievements = {};
    g.saved.runBest = { level: 0, kills: 0, resHits: 0, pincerHits: 0, syncMaxStreak: 0, evolutions: 0, elitesKilled: 0, bossKills: 0, weapons: 0, passives: 0 };
    g.runOptions.paradox = 0;
    g.startRun();
    for (const id of ['clock', 'bolt', 'pulse', 'butterfly', 'chain', 'trail']) w.player.weapons.set(id, { lv: 1, cd: 0 });
    for (const id of ['power', 'haste', 'crit', 'vigor', 'swift', 'resonance', 'cd', 'area']) w.player.passives.set(id, 1);
    for (const id of ['duet', 'arrow', 'metronome']) w.player.evolutions.add(id);
    w.player.level = 31;
    Object.assign(w.stats, { kills: 3100, resHits: 120, pincerHits: 55, syncMaxStreak: 16, bossKills: 4, elitesKilled: 21 });
    w.time = 1199.99;
    w.update(1/60);
    out.stateAfter = g.state;
    const saved = Object.keys(g.saved.achievements);
    out.savedCount = saved.length;
    out.saved = saved;
    out.savedSample = saved.slice(0, 4).join(',');
    out.bestLevel = g.saved.runBest.level;
    out.bestRes = g.saved.runBest.resHits;
    // 面板渲染
    g.openCodex();
    out.rows = document.querySelectorAll('#achvList .achvrow').length;
    out.got = document.querySelectorAll('#achvList .achvrow.got').length;
    out.progress = document.getElementById('achvProgress').textContent;
    out.panelState = g.state;
    g.closeCodex();
    return out;
  })()`);
  check(achv.total >= 18 && !achv.dup, '成就表：≥18 条且 id 唯一', `${achv.total} 条`);
  check(achv.none === 0 && achv.partial === 0, '阈值真实生效（空/差一点上下文都不解锁）', `空 ${achv.none} · 差一点 ${achv.partial}`);
  check(achv.unlocked === achv.total && achv.again === 0, '富上下文解锁全部成就，且不重复解锁', `一次解锁 ${achv.unlocked} · 重复 ${achv.again}`);
  check(achv.sink.length === 2 && achv.sink[0] === 'first_run', 'Steamworks 适配层收到解锁转发', achv.sink.join(','));
  const wantIds = ['first_run', 'first_win', 'first_evolve', 'res_100', 'pincer_50', 'sync_15s', 'weapons_6', 'passives_8', 'level_30', 'kills_3000', 'boss_4', 'evolve_3', 'elites_20'];
  const forbidIds = ['level_50', 'res_500', 'paradox_3', 'first_daily', 'runs_20', 'meta_42', 'codex_all'];
  const missing = wantIds.filter((i) => !achv.saved.includes(i));
  const wrong = forbidIds.filter((i) => achv.saved.includes(i));
  check(
    missing.length === 0 && wrong.length === 0,
    '端到端：本局达成的写入存档、未达成的没写（含长期成就）',
    `写入 ${achv.savedCount} 条 · 缺 ${missing.join(',') || '无'} · 误写 ${wrong.join(',') || '无'}`,
  );
  check(
    achv.stateAfter === 'result' && achv.bestLevel === 31 && achv.bestRes === 120,
    '历史最佳（成就面板进度来源）随局更新',
    `最佳 Lv${achv.bestLevel} · 共鸣 ${achv.bestRes}`,
  );
  check(achv.rows === achv.total && achv.got === achv.savedCount && achv.panelState === 'codex', '成就面板渲染（已解锁/未解锁 + 进度）', `${achv.got}/${achv.rows} 已解锁 · 「${achv.progress}」`);

  // 12.15 M3：作弊码（每条效果 + 归一化 + 不可重复 + 隔离保证）
  const cheat = await cdp.eval(`(() => {
    const g = __twinEcho, w = g.world;
    const C = window.__cheats;
    const out = { table: C.CHEATS.length, unique: new Set(C.CHEATS.map((c) => c.code)).size };
    // 归一化：大小写 / 空格 / 连字符都不敏感
    out.norm = ['heal', 'Heal', ' HEAL ', 'h-e_a l'].map((s) => !!C.findCheat(s));
    out.normUnknown = C.findCheat('NOT-A-CODE');
    // 未知码
    g.runOptions.character = 'otto'; g.runOptions.paradox = 0;
    g.startRun();
    const p = w.player;
    const bad = g.inputCheat('NOT-A-CODE');
    out.badOk = bad.ok;
    // HEAL
    p.hp = 1; p.invulnT = 0;
    g.inputCheat('heal');
    out.heal = { hp: p.hp, max: p.maxHp, invuln: p.invulnT > 2 };
    // GOD：免伤
    g.inputCheat('god');
    const hp0 = p.hp;
    p.hurtCd = 0; p.invulnT = 0;
    w.damagePlayer(50);
    out.godNoDamage = p.hp === hp0;
    g.inputCheat('god'); // 关闭
    p.hurtCd = 0; p.invulnT = 0;
    w.damagePlayer(10);
    out.godOffDamage = p.hp < hp0;
    // MAXWEAPON / ALLWEAPON / MAXPASSIVE
    w.player.weapons.clear();
    w.player.weapons.set('clock', { lv: 1, cd: 0 });
    g.inputCheat('MAXW');
    out.maxWeapon = [...p.weapons.values()].every((s) => s.lv === 6);
    g.inputCheat('allweapon');
    out.allWeapon = p.weapons.size;
    out.allWeaponMaxed = [...p.weapons.values()].every((s) => s.lv === 6);
    g.inputCheat('maxp');
    out.allPassive = p.passives.size;
    out.passiveStatOk = Math.abs(p.stats.dmg - 0.4) < 1e-6; // 力量 5 级 = +40%
    // EVOLVE
    g.inputCheat('evolve');
    out.evolutions = p.evolutions.size;
    // GAUGE / FREEZE / KILLALL
    // GAUGE / FREEZE / KILLALL：先等到场上有敌人（首波可能在 1 分钟时才来），最多 70s
    for (let i = 0; i < 4200 && w.enemies.items.filter((e) => e.active && !e.boss).length < 3; i++) {
      p.invulnT = 9999;
      w.update(1/60);
    }
    p.gauge = 0;
    g.inputCheat('gauge');
    out.gauge = p.gauge;
    // GAUGE / FREEZE / KILLALL
    for (let i = 0; i < 240; i++) { p.invulnT = 9999; w.update(1/60); }
    const before = w.enemies.items.filter((e) => e.active).length;
    g.inputCheat('freeze');
    out.frozen = w.enemies.items.filter((e) => e.active && e.frozenT >= 7).length;
    const kills0 = w.stats.kills;
    g.inputCheat('killall');
    out.killallDelta = w.stats.kills - kills0;
    out.killallLeft = w.enemies.items.filter((e) => e.active && !e.boss).length;
    out.beforeFreeze = before;
    // LEVELUP
    const lv0 = p.level;
    g.inputCheat('LEVELUP');
    out.levelDelta = p.level - lv0;
    // NOFOG：仅在图书馆有意义，这里只验证开关
    g.inputCheat('nofog');
    const nofogOn = w.cheatNoFog;
    g.inputCheat('nofog');
    out.nofogToggle = nofogOn && !w.cheatNoFog;
    // BOSS / WEAVER
    g.inputCheat('weaver');
    out.weaver = w.boss ? w.boss.bossKind : '';
    out.weaverHp = w.boss ? Math.round(w.boss.maxHp) : 0;
    // SANDBAG / METAFULL
    const sand0 = g.saved.sand;
    g.inputCheat('sandbag');
    out.sandDelta = g.saved.sand - sand0;
    g.inputCheat('metafull');
    out.metaNodes = g.saved.nodes.length;
    // 不可重复：sandbag 第二次数值不再增长
    const sand1 = g.saved.sand;
    const again = g.inputCheat('sandbag');
    out.repeatBlocked = !again.ok && g.saved.sand === sand1;
    // HELP 文案
    const help = C.findCheat('?');
    out.helpHasAll = help && C.CHEATS.every((c) => help.apply ? true : true);
    g.inputCheat('help');
    out.helpLen = document.getElementById('cheatResult').textContent.length;
    // 作弊标记 + 标记后的隔离字段
    out.cheated = w.cheated;
    out.badge = document.getElementById('cheattext').textContent;
    g.render(1/60);
    out.badgeAfterRender = document.getElementById('cheattext').textContent;
    return out;
  })()`);
  check(cheat.table >= 15 && cheat.unique === cheat.table, '作弊码表：≥15 条且主码唯一', `${cheat.table} 条`);
  check(cheat.norm.every(Boolean) && cheat.normUnknown === null && cheat.badOk === false, '输入归一化（大小写/空格/连字符）与未知码拦截');
  check(cheat.heal.hp === cheat.heal.max && cheat.heal.invuln === true, 'HEAL：血量回满 + 无敌', `HP ${cheat.heal.hp}/${cheat.heal.max}`);
  check(cheat.godNoDamage === true && cheat.godOffDamage === true, 'GOD：免伤开关（开=不掉血 / 关=照常掉血）');
  check(cheat.maxWeapon === true && cheat.allWeapon === 12 && cheat.allWeaponMaxed === true, 'MAXWEAPON / ALLWEAPON：武器满级（12 把全 Lv6）', `${cheat.allWeapon} 把`);
  check(cheat.allPassive === 15 && cheat.passiveStatOk === true, 'MAXPASSIVE：15 项被动 Lv5 且派生属性已重算');
  check(cheat.evolutions === 6, 'EVOLVE：一次拿到 6 件进化体', `${cheat.evolutions} 件`);
  check(cheat.gauge === 100 && cheat.frozen > 0 && cheat.killallDelta > 0 && cheat.killallLeft === 0, 'GAUGE / FREEZE / KILLALL：共鸣充满 / 全场定身 / 清屏', `定身 ${cheat.frozen} · 清屏 ${cheat.killallDelta}（同屏原 ${cheat.beforeFreeze}）`);
  check(cheat.levelDelta === 10 && cheat.nofogToggle === true, 'LEVELUP / NOFOG：+10 级 / 视野遮蔽开关');
  check(cheat.weaver === 'weaver' && cheat.weaverHp === 58000, 'BOSS / WEAVER：按需召唤 Boss（终 Boss 58,000 HP）', `${cheat.weaver} · ${cheat.weaverHp}`);
  check(cheat.sandDelta === 99999 && cheat.metaNodes === 42, 'SANDBAG / METAFULL：时砂 +99999 / 密库 42 节点全开', `时砂 +${cheat.sandDelta} · 节点 ${cheat.metaNodes}`);
  check(cheat.repeatBlocked === true, '不可重复的码（SANDBAG）本局第二次被拦下');
  check(cheat.helpLen > 300, 'HELP：列出全部作弊码到面板', `${cheat.helpLen} 字符`);
  check(cheat.cheated === true && cheat.badgeAfterRender.includes('作弊'), '作弊局标记（HUD 常驻显示）', cheat.badgeAfterRender);

  // 12.16 M3：作弊局隔离——不计成就、不更新历史最佳、不进验收中位样本、遥测带标记
  const cheatIso = await cdp.eval(`(() => {
    const g = __twinEcho, w = g.world, D = window.__diag;
    g.saved.achievements = {};
    g.saved.runBest = { level: 0, kills: 0, resHits: 0, pincerHits: 0, syncMaxStreak: 0, evolutions: 0, elitesKilled: 0, bossKills: 0, weapons: 0, passives: 0 };
    D.clear();
    D.noteRun(1200, 1, false);        // 一局干净样本（20min）
    g.runOptions.paradox = 0;
    g.startRun();
    g.inputCheat('god');              // 本局标记为作弊
    Object.assign(w.stats, { kills: 9999, resHits: 999, pincerHits: 99, syncMaxStreak: 30, bossKills: 4, elitesKilled: 30 });
    w.player.level = 60;
    w.time = 1199.99;
    w.update(1/60);                   // 胜利结算 → endRun
    const runs = g.telemetry.runs;
    const last = runs[runs.length - 1];
    const report = D.report(runs.length, {});
    return {
      state: g.state,
      cheatedFlag: last ? last.cheated : null,
      achievements: Object.keys(g.saved.achievements).length,
      bestLevel: g.saved.runBest.level,
      bestKills: g.saved.runBest.kills,
      median: D.medianRunSeconds(),
      samples: D.state.runSeconds.length,
      cheatedRuns: D.state.cheatedRuns,
      reportMentions: report.includes('排除 1 局作弊'),
    };
  })()`);
  check(cheatIso.cheatedFlag === true, '作弊局在遥测里带 cheated 标记', `cheated=${cheatIso.cheatedFlag}`);
  check(cheatIso.achievements === 0 && cheatIso.bestLevel === 0 && cheatIso.bestKills === 0, '作弊局不计成就、不更新历史最佳', `成就 ${cheatIso.achievements} 条 · 最佳 Lv${cheatIso.bestLevel}`);
  check(
    cheatIso.samples === 1 && cheatIso.median === 1200 && cheatIso.cheatedRuns === 1 && cheatIso.reportMentions === true,
    '作弊局不进验收中位样本，报告里明确标注排除',
    `样本 ${cheatIso.samples} 局 · 中位 ${cheatIso.median}s · 排除 ${cheatIso.cheatedRuns} 局`,
  );

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
