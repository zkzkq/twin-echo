import { BAL } from '../config/balance';
import { weaponById } from '../config/items';
import { Sprite } from 'pixi.js';
import { COLORS } from './textures';
import type { Enemy, OrbitState, Src } from './types';
import type { World } from './world';

/** 复用查询缓冲（零分配） */
const tmp: Enemy[] = [];

export function nearestEnemy(w: World, x: number, y: number, maxR: number): Enemy | null {
  w.hash.query(x, y, maxR + 44, tmp);
  let best: Enemy | null = null;
  let bd = maxR * maxR;
  for (const e of tmp) {
    if (!e.active) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** 武器单发基伤：基伤 × (1+10%(Lv-1)) × (1+力量+进化叠伤) —— GDD §7.3 */
export function weaponDamage(w: World, id: string): number {
  const st = w.player.weapons.get(id);
  if (!st) return 0;
  const def = weaponById(id);
  return def.base * (1 + 0.1 * (st.lv - 1)) * (1 + w.player.stats.dmg + w.evoDmgBonus);
}

/** 攻击间隔乘区：急速 × 冷却（叠乘，下限 §16 的 0.4×）；诺恩的爆发后攻速为临时乘区 */
export function atkMult(w: World): number {
  const s = w.player.stats;
  const burst = w.burstHasteT > 0 ? 1 - w.run.burstHastePct : 1;
  return Math.max(BAL.weapons.atkFloor, (1 - s.atkSpd) * (1 - s.cd) * burst);
}

/** 武器范围乘区（幅域被动；残影侧另乘 echoRange） */
export function areaMult(w: World): number {
  return 1 + w.player.stats.area;
}

function knock(e: Enemy, amount: number, fromX: number, fromY: number): void {
  if (e.boss) amount *= 0.15;
  const dx = e.x - fromX;
  const dy = e.y - fromY;
  const d = Math.hypot(dx, dy) || 1;
  e.kx += (dx / d) * amount;
  e.ky += (dy / d) * amount;
}

/**
 * 统一伤害管线（本体/残影同路径，GDD §11.2）。
 * 共鸣判定：同一敌人 1s 内先后被两个来源命中 → ×1.3 + 共鸣值；配对命中后消耗，防抖。
 */
export function applyDamage(
  w: World,
  e: Enemy,
  base: number,
  src: Src,
  opts: { kb?: number; noRes?: boolean; forceCrit?: boolean; weaponId?: string } = {},
): void {
  if (!e.active) return;
  const p = w.player;
  let dmg = base;

  if (!opts.noRes) {
    const now = w.time;
    if (e.lastHitSrc !== null && e.lastHitSrc !== src && now - e.lastHitT <= w.resonanceWindow()) {
      dmg *= BAL.resonance.dmgMult * (1 + p.stats.resDmg);
      // 共鸣泉事件 ×2（GDD §6.7）
      const gain = BAL.resonance.gaugeGain * (1 + p.stats.resGain) * w.gaugeMult();
      const was = p.gauge;
      p.gauge = Math.min(BAL.resonance.gaugeMax, p.gauge + gain);
      w.stats.resHits++;
      w.audio.chime();
      // 双色共鸣火花
      const sparkColor = src === 'body' ? COLORS.echo : COLORS.player;
      w.spawnRing(e.x, e.y, 6, 34, 0.28, sparkColor, 0.6);
      for (let i = 0; i < 8; i++) {
        w.spawnParticle(e.x, e.y, i % 2 === 0 ? COLORS.echo : COLORS.player, w.rng.range(60, 220), 0.4, w.rng.range(2, 4));
      }
      if (was < BAL.resonance.gaugeMax && p.gauge >= BAL.resonance.gaugeMax && !w.flags.gaugeToasted) {
        w.flags.gaugeToasted = true;
        w.onEvent('gauge-full');
      }
      if (w.firstRun && !w.flags.resToasted) {
        w.flags.resToasted = true;
        w.onEvent('first-resonance');
      }
      e.lastHitSrc = null; // 配对消耗（防抖）
    } else {
      e.lastHitSrc = src;
      e.lastHitT = now;
    }
  }

  if (src === 'echo') dmg *= w.run.echoCoeff;
  // 角色「断剑士·凯」等：本体伤害流（只作用于 body）
  else if (w.run.bodyDmgPct !== 0) dmg *= 1 + w.run.bodyDmgPct;

  let crit = false;
  if (opts.forceCrit) {
    // 进化体「贯穿命运之矢」：必暴 2.5×（GDD §6.5）
    crit = true;
    dmg *= 2.5;
  } else if (w.rng.next() < p.stats.critCh) {
    crit = true;
    dmg *= p.stats.critDmg;
  }
  dmg *= 1 - BAL.armorReduction(e.armor, w.time / 60);

  e.hp -= dmg;
  e.flashT = 0.09;
  w.stats.hits++;
  w.audio.hit();

  const fx = src === 'body' ? w.player.x : w.echo.x;
  const fy = src === 'body' ? w.player.y : w.echo.y;
  if (crit) {
    w.spawnParticle(e.x, e.y, 0xffffff, 140, 0.25, 4);
    knock(e, opts.kb ?? 40, fx, fy);
  } else if (opts.kb) {
    knock(e, opts.kb, fx, fy);
  }
  if (e.hp <= 0) {
    // 进化体「贯穿命运之矢」击杀叠伤：+2%/次，上限 +20%（GDD §6.5）
    if (opts.weaponId === 'bolt' && p.evolutions.has('arrow')) {
      w.evoDmgBonus = Math.min(0.2, w.evoDmgBonus + 0.02);
    }
    w.killEnemy(e);
  }
}

/** 环绕武器（时钟指针）：本体与残影各一套指针，同一代码路径 */
export function updateOrbits(w: World, dt: number): void {
  const st = w.player.weapons.get('clock');
  if (!st) {
    setNeedleCount(w, w.orbits.body, 0, 'body');
    setNeedleCount(w, w.orbits.echo, 0, 'echo');
    return;
  }
  // 进化体「永恒二重奏」：双环反向旋转、覆盖角 ×2、伤害 +40%（GDD §6.5）
  const evolved = w.player.evolutions.has('duet');
  const perRing = st.lv >= 6 ? 3 : 2;
  const count = perRing * (evolved ? 2 : 1);
  const omega = (Math.PI * 2) / 2.4;
  const dmg = weaponDamage(w, 'clock') * (evolved ? 1.4 : 1);
  const area = areaMult(w);

  for (const side of ['body', 'echo'] as const) {
    const o = w.orbits[side];
    o.phase += omega * dt;
    setNeedleCount(w, o, count, side);
    const baseRadius = (st.lv >= 6 ? 120 : 90) * area * (side === 'echo' ? w.player.stats.echoRange : 1);
    const cx = side === 'body' ? w.player.x : w.echo.x;
    const cy = side === 'body' ? w.player.y : w.echo.y;
    for (let i = 0; i < count; i++) {
      const ring = Math.floor(i / perRing);
      const k = i % perRing;
      const dir = ring === 0 ? 1 : -1;
      const radius = baseRadius * (ring === 0 ? 1 : 0.82);
      const a = dir * o.phase + (k * Math.PI * 2) / perRing;
      const nx = cx + Math.cos(a) * radius;
      const ny = cy + Math.sin(a) * radius;
      const nd = o.needles[i]!;
      nd.x = nx;
      nd.y = ny;
      nd.sprite.rotation = a + Math.PI / 2;
      w.hash.query(nx, ny, 13 + 44, tmp);
      for (const e of tmp) {
        if (!e.active) continue;
        const cd = side === 'body' ? e.orbitCdB : e.orbitCdE;
        if (cd > 0) continue;
        const rr = 13 + e.radius;
        if ((e.x - nx) ** 2 + (e.y - ny) ** 2 <= rr * rr) {
          if (side === 'body') e.orbitCdB = BAL.weapons.orbitContactCd;
          else e.orbitCdE = BAL.weapons.orbitContactCd;
          applyDamage(w, e, dmg, side, { weaponId: 'clock' });
        }
      }
    }
  }
}

function setNeedleCount(w: World, o: OrbitState, count: number, side: Src): void {
  while (o.needles.length < count) {
    const s = new Sprite(w.tex.needle);
    s.anchor.set(0.5);
    s.tint = side === 'body' ? COLORS.needleBody : COLORS.needleEcho;
    s.alpha = side === 'body' ? 0.95 : 0.7;
    w.layers.players.addChild(s);
    o.needles.push({ x: 0, y: 0, sprite: s });
  }
  while (o.needles.length > count) {
    const nd = o.needles.pop()!;
    nd.sprite.destroy();
  }
}

/** 事件型武器（弩/钟鸣/蝶/链）：冷却就绪 → 本体开火 + 记录事件供残影重演 */
export function updateWeapons(w: World, dt: number): void {
  const p = w.player;
  const mult = atkMult(w);
  const area = areaMult(w);
  const arrowEvolved = p.evolutions.has('arrow');

  for (const [id, st] of p.weapons) {
    const def = weaponById(id);
    if (def.kind === 'orbit' || def.kind === 'trail') continue; // 环绕/轨迹为持续型，另在 updateOrbits/updateTrail 处理
    st.cd -= dt;
    if (st.cd > 0) continue;

    if (def.kind === 'bolt') {
      const tgt = nearestEnemy(w, p.x, p.y, 820);
      if (!tgt) {
        st.cd = 0.12;
        continue;
      }
      const ang = Math.atan2(tgt.y - p.y, tgt.x - p.x);
      const count = st.lv >= 6 ? 3 : 1;
      const dmg = weaponDamage(w, id);
      for (let i = 0; i < count; i++) {
        const a = ang + (i - (count - 1) / 2) * 0.15;
        const b = w.spawnBullet(p.x, p.y, Math.cos(a) * BAL.weapons.boltSpeed, Math.sin(a) * BAL.weapons.boltSpeed, dmg, 'bolt', 7, st.lv >= 6 ? 5 : 3, 'body', false, 2.2);
        b.forceCrit = arrowEvolved && id === 'bolt';
        b.weaponId = id;
      }
      w.echo.events.push({ frame: w.frame, id, kind: 'bolt', x: p.x, y: p.y, ang, count });
      st.cd = def.interval * mult;
    } else if (def.kind === 'pulse') {
      const radius = (st.lv >= 6 ? 240 : 150) * area;
      const tgt = nearestEnemy(w, p.x, p.y, radius * 1.3);
      if (!tgt) {
        st.cd = 0.15;
        continue;
      }
      const dmg = weaponDamage(w, id);
      w.hash.query(p.x, p.y, radius + 44, tmp);
      for (const e of tmp) {
        if (!e.active) continue;
        const rr = radius + e.radius;
        if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 <= rr * rr) {
          applyDamage(w, e, dmg, 'body', { kb: st.lv >= 6 ? 70 : 12, weaponId: id });
        }
      }
      w.spawnRing(p.x, p.y, 20, radius, 0.35, COLORS.player, 0.75);
      w.echo.events.push({ frame: w.frame, id, kind: 'pulse', x: p.x, y: p.y, ang: 0, count: 1 });
      st.cd = def.interval * mult;
    } else if (def.kind === 'chain') {
      // 电弧链：命中最近敌人后在 200px 内连锁（GDD §6.2）
      const first = nearestEnemy(w, p.x, p.y, 420 * area);
      if (!first) {
        st.cd = 0.15;
        continue;
      }
      const jumps = st.lv >= 6 ? 5 : 3;
      const dmg = weaponDamage(w, id);
      let cur: Enemy | null = first;
      const hit = new Set<number>();
      let px = p.x;
      let py = p.y;
      for (let j = 0; j < jumps && cur; j++) {
        hit.add(cur.id);
        // 电弧视觉：在上一跳与本次目标之间撒粒子
        const segs = 5;
        for (let k = 0; k <= segs; k++) {
          const tx = px + ((cur.x - px) * k) / segs;
          const ty = py + ((cur.y - py) * k) / segs;
          w.spawnParticle(tx, ty, 0xb98cff, 40, 0.18, 3);
        }
        applyDamage(w, cur, dmg, 'body', { weaponId: id });
        px = cur.x;
        py = cur.y;
        cur = nearestUnhit(w, px, py, 200 * area, hit);
      }
      w.echo.events.push({ frame: w.frame, id, kind: 'chain', x: p.x, y: p.y, ang: 0, count: jumps });
      st.cd = def.interval * mult;
    } else {
      // butterfly
      const count = st.lv >= 6 ? 5 : 2;
      const dmg = weaponDamage(w, id);
      for (let i = 0; i < count; i++) {
        const a = w.rng.angle();
        const b = w.spawnBullet(p.x, p.y, Math.cos(a) * BAL.weapons.butterflySpeed, Math.sin(a) * BAL.weapons.butterflySpeed, dmg, 'butterfly', 6, 1, 'body', true, BAL.weapons.butterflyLife);
        b.weaponId = id;
      }
      w.echo.events.push({ frame: w.frame, id, kind: 'butterfly', x: p.x, y: p.y, ang: 0, count });
      st.cd = def.interval * mult;
    }
  }
}

/** 连锁用：半径内未被本次电弧命中的最近敌人 */
function nearestUnhit(w: World, x: number, y: number, maxR: number, hit: Set<number>): Enemy | null {
  w.hash.query(x, y, maxR + 44, tmp);
  let best: Enemy | null = null;
  let bd = maxR * maxR;
  for (const e of tmp) {
    if (!e.active || hit.has(e.id)) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/**
 * 残光轨迹（GDD §6.2）：本体与残影各自在行进路径上留痕，痕迹对触碰敌人造成伤害。
 * 持续型武器，不走事件重演——残影的痕迹由残影自己的位置生成，天然对应"残影走过的路"。
 */
export function updateTrail(w: World, dt: number): void {
  const st = w.player.weapons.get('trail');
  if (!st) {
    for (const t of w.trails.items) if (t.active) w.trails.release(t);
    return;
  }
  const life = st.lv >= 6 ? 1.6 : 0.8;
  const dmg = weaponDamage(w, 'trail');
  const area = areaMult(w);
  const contactR = 18 * area;

  // 留痕（本体/残影各自计时）
  for (const side of ['body', 'echo'] as const) {
    w.trailTimer[side] -= dt;
    if (w.trailTimer[side] <= 0) {
      w.trailTimer[side] = BAL.weapons.trailEvery;
      const x = side === 'body' ? w.player.x : w.echo.x;
      const y = side === 'body' ? w.player.y : w.echo.y;
      w.spawnTrailSeg(x, y, life, side);
    }
  }

  // 痕迹伤害 + 生命周期
  for (const t of w.trails.items) {
    if (!t.active) continue;
    t.life -= dt;
    if (t.life <= 0) {
      w.trails.release(t);
      continue;
    }
    w.hash.query(t.x, t.y, contactR + 44, tmp);
    for (const e of tmp) {
      if (!e.active || e.trailCd > 0) continue;
      const rr = contactR + e.radius;
      if ((e.x - t.x) ** 2 + (e.y - t.y) ** 2 <= rr * rr) {
        e.trailCd = BAL.weapons.trailContactCd;
        applyDamage(w, e, dmg, t.src, { weaponId: 'trail' });
      }
    }
  }
}

/** 残影重演：消费 150 帧前记录的攻击事件（伤害系数 0.6 在 applyDamage 内） */
export function replayEchoAttacks(w: World): void {
  const ev = w.echo.events;
  const cutoff = w.frame - BAL.echo.delayFrames;
  while (ev.length > 0 && ev[0]!.frame <= cutoff) {
    const e0 = ev.shift()!;
    const st = w.player.weapons.get(e0.id);
    if (!st) continue;
    const dmg = weaponDamage(w, e0.id);
    switch (e0.kind) {
      case 'bolt': {
        for (let i = 0; i < e0.count; i++) {
          const a = e0.ang + (i - (e0.count - 1) / 2) * 0.15;
          w.spawnBullet(e0.x, e0.y, Math.cos(a) * BAL.weapons.boltSpeed, Math.sin(a) * BAL.weapons.boltSpeed, dmg, 'bolt', 7, st.lv >= 6 ? 5 : 3, 'echo', false, 2.2);
        }
        break;
      }
      case 'pulse': {
        const radius = (st.lv >= 6 ? 240 : 150) * w.player.stats.echoRange * areaMult(w);
        w.hash.query(e0.x, e0.y, radius + 44, tmp);
        for (const e of tmp) {
          if (!e.active) continue;
          const rr = radius + e.radius;
          if ((e.x - e0.x) ** 2 + (e.y - e0.y) ** 2 <= rr * rr) {
            applyDamage(w, e, dmg, 'echo', { kb: st.lv >= 6 ? 70 : 12, weaponId: e0.id });
          }
        }
        w.spawnRing(e0.x, e0.y, 20, radius, 0.35, COLORS.echo, 0.75);
        break;
      }
      case 'chain': {
        // 残影重演电弧链：从记录的残影位置起跳，目标按当前位置重新取
        const jumps = e0.count;
        let cur = nearestEnemy(w, e0.x, e0.y, 420 * areaMult(w));
        const hit = new Set<number>();
        let px = e0.x;
        let py = e0.y;
        for (let j = 0; j < jumps && cur; j++) {
          hit.add(cur.id);
          for (let k = 0; k <= 4; k++) {
            w.spawnParticle(px + ((cur.x - px) * k) / 4, py + ((cur.y - py) * k) / 4, 0x8fd8ff, 30, 0.16, 3);
          }
          applyDamage(w, cur, dmg, 'echo', { weaponId: e0.id });
          px = cur.x;
          py = cur.y;
          cur = nearestUnhit(w, px, py, 200 * areaMult(w), hit);
        }
        break;
      }
      case 'butterfly': {
        for (let i = 0; i < e0.count; i++) {
          const a = w.rng.angle();
          const b = w.spawnBullet(e0.x, e0.y, Math.cos(a) * BAL.weapons.butterflySpeed, Math.sin(a) * BAL.weapons.butterflySpeed, dmg, 'butterfly', 6, 1, 'echo', true, BAL.weapons.butterflyLife);
          b.forceCrit = false;
          b.weaponId = e0.id;
        }
        break;
      }
    }
  }
}

export function updateBullets(w: World, dt: number): void {
  const p = w.player;
  for (const b of w.bullets.items) {
    if (!b.active) continue;
    b.life -= dt;
    if (b.life <= 0) {
      w.bullets.release(b);
      continue;
    }
    if (b.homing) {
      b.retarget -= dt;
      if (b.retarget <= 0) {
        b.retarget = 0.2;
        b.target = nearestEnemy(w, b.x, b.y, 420);
      }
      const t = b.target;
      if (t && t.active) {
        const cur = Math.atan2(b.vy, b.vx);
        const want = Math.atan2(t.y - b.y, t.x - b.x);
        let d = want - cur;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const turn = Math.max(-BAL.weapons.butterflyTurn * dt, Math.min(BAL.weapons.butterflyTurn * dt, d));
        const a = cur + turn;
        const sp = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(a) * sp;
        b.vy = Math.sin(a) * sp;
      }
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 > 1500 * 1500) {
      w.bullets.release(b);
      continue;
    }

    if (b.hostile) {
      const rr = b.r + p.radius;
      if (p.invulnT <= 0 && (b.x - p.x) ** 2 + (b.y - p.y) ** 2 <= rr * rr) {
        w.damagePlayer(b.dmg);
        w.bullets.release(b);
      }
    } else {
      w.hash.query(b.x, b.y, b.r + 44, tmp);
      for (const e of tmp) {
        if (!e.active || b.hitIds.has(e.id)) continue;
        const rr = b.r + e.radius;
        if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 <= rr * rr) {
          b.hitIds.add(e.id);
          applyDamage(w, e, b.dmg, b.src, {
            kb: b.kind === 'bolt' ? 12 : 0,
            forceCrit: b.forceCrit,
            weaponId: b.weaponId,
          });
          b.pierce--;
          if (b.pierce <= 0) {
            w.bullets.release(b);
            break;
          }
        }
      }
    }
  }
}

/** 面板 DPS 估算（同步爆发伤害基准，GDD §5.3） */
export function panelDps(w: World): number {
  const p = w.player;
  const area = areaMult(w);
  let dps = 0;
  for (const [id, st] of p.weapons) {
    const def = weaponById(id);
    const base = def.base * (1 + 0.1 * (st.lv - 1));
    if (def.kind === 'orbit') {
      const rings = p.evolutions.has('duet') ? 2 : 1;
      const perRing = st.lv >= 6 ? 3 : 2;
      dps += base * perRing * rings * 2 * (rings === 2 ? 1.4 : 1);
    } else if (def.kind === 'bolt') dps += (base * (st.lv >= 6 ? 3 : 1)) / def.interval;
    else if (def.kind === 'pulse') dps += (base / def.interval) * (1 + (area - 1) * 2);
    else if (def.kind === 'chain') dps += (base * (st.lv >= 6 ? 5 : 3)) / def.interval;
    else if (def.kind === 'trail') dps += (base / BAL.weapons.trailContactCd) * 0.8;
    else dps += (base * (st.lv >= 6 ? 5 : 2) * 0.8) / def.interval;
  }
  dps *= 1 + p.stats.dmg + w.evoDmgBonus;
  dps *= 1 + p.stats.critCh * (p.stats.critDmg - 1);
  return dps;
}

/** 同步爆发：r360 对冲波 · 面板DPS×4 · 清弹幕 · 减速40%/3s · 无敌0.5s（GDD §5.3；含密库中枢支线增益） */
export function tryBurst(w: World): boolean {
  const p = w.player;
  if (!w.running || p.gauge < BAL.resonance.gaugeMax) return false;
  p.gauge = 0;
  w.stats.bursts++;
  p.invulnT = Math.max(p.invulnT, BAL.burst.invuln + w.meta.burstInvulnBonus);

  const radius = BAL.burst.radius * (1 + w.meta.burstRadiusPct + w.run.burstRadiusPct);
  const dmg = panelDps(w) * BAL.burst.dpsMult * (1 + w.meta.burstDmgPct);
  if (w.run.burstHastePct > 0) w.burstHasteT = 3; // 诺恩：爆发后 3s 攻速加成
  const R2 = radius * radius;
  w.hash.query(p.x, p.y, radius + 60, tmp);
  for (const e of tmp) {
    if (!e.active) continue;
    if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 <= R2) {
      e.slowT = BAL.burst.slowDur;
      applyDamage(w, e, dmg, 'body', { noRes: true, kb: BAL.burst.kb });
    }
  }
  for (const b of w.bullets.items) {
    if (b.active && b.hostile && (b.x - p.x) ** 2 + (b.y - p.y) ** 2 <= R2) {
      w.bullets.release(b);
    }
  }

  w.spawnRing(p.x, p.y, 30, radius, 0.45, COLORS.player, 1);
  w.spawnRing(p.x, p.y, 10, radius * 0.8, 0.5, COLORS.echo, 0.6);
  for (let i = 0; i < 26; i++) {
    w.spawnParticle(p.x, p.y, i % 2 === 0 ? COLORS.echo : COLORS.player, w.rng.range(200, 620), w.rng.range(0.3, 0.6), w.rng.range(2, 5));
  }
  w.shake = 0.18;
  w.audio.burst();
  w.onEvent('burst');
  return true;
}
