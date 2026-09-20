import { BAL } from '../config/balance';
import type { RNG } from '../core/rng';
import type { BossKind, Enemy, EnemyKind } from './types';
import type { World } from './world';

/**
 * 基础敌 4 型（GDD §6.6 子集，HP₀ 为分钟 1 数值）。
 *
 * ⚠ M1 实测调参：碰撞伤按 GDD 原值 8/12/10/8 时，密度驱动口径（同屏 40–100，而非 GDD 生成表
 * 推出的 25–40）下机器人 5.0min 即阵亡。碰撞压力 ≈ 碰撞伤 / 受击宽限 × 贴身敌数，与同屏密度成正比，
 * 故密度上调 5–10× 时碰撞伤须反向缩放（取半）。GDD §6.6 原值应在 M2 按最终密度复测后冻结。
 */
const BASE: Record<Exclude<EnemyKind, 'boss'>, { hp0: number; speed: number; dmg: number; xp: number; radius: number; tint: number }> = {
  moth: { hp0: 12, speed: 120, dmg: 3, xp: 1, radius: 9, tint: 0xa9b4c8 },
  idol: { hp0: 55, speed: 55, dmg: 4, xp: 3, radius: 13, tint: 0x8a6f4d },
  hopper: { hp0: 20, speed: 160, dmg: 3, xp: 2, radius: 10, tint: 0xc96a50 },
  cultist: { hp0: 26, speed: 45, dmg: 3, xp: 2, radius: 10, tint: 0xb08968 },
};

const TEXTURE_KEY: Record<EnemyKind, 'moth' | 'idol' | 'hopper' | 'cultist' | 'boss'> = {
  moth: 'moth', idol: 'idol', hopper: 'hopper', cultist: 'cultist', boss: 'boss',
};

/**
 * 敌人混编权重（GDD §6.6 未规定权重）。
 * 2.5 分钟前以时蛾为主（教学期）；之后使用**地图权重**（GDD §6.7 各图敌性倾向）。
 */
export function pickKind(rng: RNG, m: number, weights?: { moth: number; hopper: number; idol: number; cultist: number }): EnemyKind {
  const r = rng.next();
  if (m < 2.5) return 'moth';
  const w = weights ?? { moth: 0.5, hopper: 0.25, idol: 0.12, cultist: 0.13 };
  let acc = w.moth;
  if (r < acc) return 'moth';
  acc += w.hopper;
  if (r < acc) return 'hopper';
  acc += w.idol;
  if (r < acc) return 'idol';
  return 'cultist';
}

export function spawnEnemy(w: World, kind: EnemyKind, x: number, y: number, elite = false, bossKind: BossKind | '' = ''): Enemy {
  const e = w.enemies.obtain();
  e.id = w.enemyIdSeq++;
  e.kind = kind;
  e.bossKind = bossKind;
  e.x = x;
  e.y = y;
  e.kx = 0;
  e.ky = 0;
  e.slowT = 0;
  e.frozenT = 0;
  e.flashT = 0;
  e.hitCd = 0;
  e.tele = false;
  e.st = 0;
  e.stT = 0;
  e.pat = w.rng.chance(0.5) ? 1 : -1;
  e.ax = 0;
  e.ay = 0;
  e.lastHitSrc = null;
  e.lastHitT = -99;
  e.phase = 0;
  e.orbitCdB = 0;
  e.orbitCdE = 0;
  e.trailCd = 0;

  if (kind === 'boss') {
    const def = BAL.bosses.find((b) => b.kind === bossKind) ?? BAL.bosses[0]!;
    e.elite = false;
    e.boss = true;
    e.maxHp = e.hp = Math.round(def.hp * (1 + w.run.bossHpPct));
    e.speed = def.speed * (1 + w.run.enemySpeedPct);
    e.dmg = Math.round(def.dmg * (1 + w.run.enemyDmgPct));
    e.xpVal = 0;
    e.radius = def.radius;
    e.armor = def.armor;
    e.tint = bossKind === 'hourglass' ? 0xc9a227 : bossKind === 'weaver' ? 0x9a6bff : 0xd95f4a;
    e.st = 0;
    e.stT = 2.0;
    e.pat = 0;
    e.fireCd = 0;
    e.auraCd = 99;
  } else {
    const b = BASE[kind];
    const m = Math.max(w.time / 60, 0.5);
    e.elite = elite;
    e.boss = false;
    const hpMult = BAL.enemyHpScale(m) * (elite ? BAL.elite.hpMult : 1);
    e.maxHp = e.hp = Math.round(b.hp0 * hpMult);
    e.speed = b.speed * (1 + w.run.enemySpeedPct);
    e.dmg = Math.max(1, Math.round((b.dmg + (elite ? 2 : 0)) * (1 + w.run.enemyDmgPct + w.run.contactDmgPct)));
    e.xpVal = b.xp;
    e.radius = b.radius * (elite ? BAL.elite.sizeMult : 1);
    e.armor = elite ? 4 : 0;
    e.tint = elite ? 0xd9a94a : b.tint;
    e.fireCd = w.rng.range(1, 2.5);
    e.auraCd = elite ? BAL.elite.auraEvery : 0;
  }

  e.sprite.texture = w.tex[TEXTURE_KEY[kind]];
  e.sprite.visible = true;
  e.sprite.alpha = 1;
  e.sprite.rotation = 0;
  e.sprite.scale.set(elite ? BAL.elite.sizeMult : 1);
  if (e.ring) {
    e.ring.visible = elite;
    e.ring.scale.set(e.radius / 22);
  }
  return e;
}

export function spawnElite(w: World): void {
  const kinds: EnemyKind[] = ['idol', 'hopper', 'cultist', 'moth'];
  const kind = kinds[w.stats.elitesSpawned % kinds.length]!;
  const sp = w.spawnPoint();
  spawnEnemy(w, kind, sp.x, sp.y, true);
}

export function spawnBoss(w: World, bossKind: BossKind): void {
  const a = w.rng.angle();
  const d = w.spawnRadius();
  const e = spawnEnemy(w, 'boss', w.player.x + Math.cos(a) * d, w.player.y + Math.sin(a) * d, false, bossKind);
  w.boss = e;
}

/** 敌方环形弹幕（精英光环 / Boss 环形弹幕） */
function ringBullets(w: World, e: Enemy, n: number, speed: number, dmg: number, offset = 0): void {
  for (let i = 0; i < n; i++) {
    const a = offset + (i * Math.PI * 2) / n;
    w.spawnBullet(e.x, e.y, Math.cos(a) * speed, Math.sin(a) * speed, dmg, 'enemy', 6, 1, 'body', false, 8);
  }
}

export function updateEnemies(w: World, dt: number): void {
  const p = w.player;
  const t = w.time;
  for (const e of w.enemies.items) {
    if (!e.active) continue;
    if (e.flashT > 0) e.flashT -= dt;
    if (e.slowT > 0) e.slowT -= dt;
    if (e.hitCd > 0) e.hitCd -= dt;
    if (e.orbitCdB > 0) e.orbitCdB -= dt;
    if (e.orbitCdE > 0) e.orbitCdE -= dt;
    if (e.trailCd > 0) e.trailCd -= dt;
    if (e.fireCd > 0) e.fireCd -= dt;
    // 停滞领域事件：定身（不移动、不攻击）
    if (e.frozenT > 0) {
      e.frozenT -= dt;
      continue;
    }
    // 击退衰减
    if (e.kx !== 0 || e.ky !== 0) {
      e.x += e.kx * dt;
      e.y += e.ky * dt;
      const dec = Math.max(0, 1 - 10 * dt);
      e.kx *= dec;
      e.ky *= dec;
      if (Math.abs(e.kx) < 1) e.kx = 0;
      if (Math.abs(e.ky) < 1) e.ky = 0;
    }

    // 回响阻尼（M3「编队走位」的生存收益）：同步 ramp 越高，残影周围的敌人越慢（最高 -25%）。
    // 目的：让"贴住残影"在**防守上**也成立——否则编队流永远打不过"远离怪群贪宝石"（见调参记录 §23）。
    let damping = 1;
    const ramp = w.syncRamp();
    if (ramp > 0) {
      const ex2 = w.echo.x - e.x;
      const ey2 = w.echo.y - e.y;
      const ed2 = ex2 * ex2 + ey2 * ey2;
      const R = BAL.resonance.dampRange;
      if (ed2 <= R * R) {
        const near = 1 - Math.sqrt(ed2) / R; // 越靠近残影，阻尼越强
        damping = 1 - BAL.resonance.dampMax * ramp * (0.4 + 0.6 * near);
      }
    }
    const slow = (e.slowT > 0 ? BAL.burst.slowFactor : 1) * damping * (1 - p.stats.damp); // 被动「滞时」（M3）
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    if (e.boss) {
      updateBoss(w, e, dt, nx, ny, slow);
      continue;
    }

    if (e.elite) {
      e.auraCd -= dt;
      if (e.auraCd <= 0) {
        e.auraCd = BAL.elite.auraEvery;
        ringBullets(w, e, BAL.elite.auraBullets, 90, 10, w.rng.angle());
      }
    }

    switch (e.kind) {
      case 'moth': {
        // 直线蜂群 + 轻微正弦摆动
        const wob = Math.sin(t * 3.1 + e.id * 1.7) * 0.45;
        let mx = nx - ny * wob;
        let my = ny + nx * wob;
        const ml = Math.hypot(mx, my) || 1;
        e.x += (mx / ml) * e.speed * slow * dt;
        e.y += (my / ml) * e.speed * slow * dt;
        e.sprite.rotation = Math.atan2(my, mx);
        break;
      }
      case 'idol': {
        e.x += nx * e.speed * slow * dt;
        e.y += ny * e.speed * slow * dt;
        break;
      }
      case 'hopper': {
        e.stT -= dt;
        e.tele = false;
        if (e.st === 0) {
          e.x += nx * e.speed * slow * dt;
          e.y += ny * e.speed * slow * dt;
          e.sprite.rotation = Math.atan2(ny, nx);
          if (dist < 260) {
            e.st = 1;
            e.stT = 0.8;
          }
        } else if (e.st === 1) {
          e.tele = true; // 蓄力预警
          if (e.stT <= 0) {
            e.ax = nx;
            e.ay = ny;
            e.st = 2;
            e.stT = 0.55;
            e.sprite.rotation = Math.atan2(ny, nx);
          }
        } else if (e.st === 2) {
          e.x += e.ax * 320 * slow * dt;
          e.y += e.ay * 320 * slow * dt;
          if (e.stT <= 0) {
            e.st = 3;
            e.stT = 0.5;
          }
        } else {
          if (e.stT <= 0) e.st = 0;
        }
        break;
      }
      case 'cultist': {
        if (dist > 240) {
          e.x += nx * e.speed * slow * dt;
          e.y += ny * e.speed * slow * dt;
        } else if (dist < 140) {
          e.x -= nx * e.speed * 0.7 * slow * dt;
          e.y -= ny * e.speed * 0.7 * slow * dt;
        } else {
          e.x += -ny * e.pat * e.speed * 0.5 * slow * dt;
          e.y += nx * e.pat * e.speed * 0.5 * slow * dt;
        }
        if (e.fireCd <= 0 && dist < 300) {
          e.fireCd = 2.5;
          w.spawnBullet(e.x, e.y, nx * 110, ny * 110, 12, 'enemy', 6, 1, 'body', false, 8);
        }
        break;
      }
      case 'boss':
        break;
    }
  }
}

/** Boss 技能分发（GDD §6.6）。minute=分针兽；hourglass=时漏巨像；twin=双生回响兽；weaver=时间织造者·诺诺 */
function updateBoss(w: World, e: Enemy, dt: number, nx: number, ny: number, slow: number): void {
  if (e.bossKind === 'hourglass') {
    updateHourglass(w, e, dt, nx, ny, slow);
    return;
  }
  if (e.bossKind === 'twin') {
    updateTwin(w, e, dt, nx, ny, slow);
    return;
  }
  if (e.bossKind === 'weaver') {
    updateWeaver(w, e, dt, nx, ny, slow);
    return;
  }
  updateMinute(w, e, dt, nx, ny, slow);
}

/**
 * 终 Boss 时间织造者·诺诺（20:00）：三阶段 + 领域（GDD §6.6）。
 * 阶段按 HP 阈值切换（66% / 33%），每次切换有一次"织梭停顿"与冲击环（onEvent 'boss-phase'）。
 *   P1 织梭（>66%）  ：错位环形弹幕 + 织梭突进——先让玩家学会她的节奏；
 *   P2 静止织机（33–66%）：展开半径 300 的领域（world.echoDelayNow 在圈内 +2s）+ 召唤织蛛；
 *   P3 终末织梭（<33%）：全屏扩散弹幕波（3 层）+ 高速突进 + 密集召唤。
 * 领域是**可读可躲**的减益：退到圈外输出即可规避，代价是与 Boss 拉开距离、命中率下降。
 */
function updateWeaver(w: World, e: Enemy, dt: number, nx: number, ny: number, slow: number): void {
  const W = BAL.weaver;
  e.stT -= dt;
  e.tele = false;
  e.sprite.rotation += dt * (e.phase >= 3 ? 1.3 : 0.6);

  // ---- 阶段切换（可跳过中间阶段：一次高伤害爆发直接打进 P3） ----
  const pct = e.maxHp > 0 ? e.hp / e.maxHp : 1;
  const want = pct <= W.phase3At ? 3 : pct <= W.phase2At ? 2 : 1;
  if (want > e.phase) {
    e.phase = want;
    e.st = 9;
    e.stT = 1.1;
    e.auraCd = 0;
    w.spawnRing(e.x, e.y, 20, want >= 3 ? 900 : 620, 0.7, want >= 3 ? 0xff5c5c : 0xffd77a, 1);
    for (let i = 0; i < 30; i++) {
      w.spawnParticle(e.x, e.y, i % 2 === 0 ? 0xffd77a : 0x9a6bff, w.rng.range(120, 420), 0.55, w.rng.range(3, 6));
    }
    w.onEvent('boss-phase');
    return;
  }

  // ---- 领域边界（P2 起常驻）：每 0.4s 描一圈，让"圈内残影被织慢"始终可见 ----
  if (e.phase >= 2) {
    e.auraCd -= dt;
    if (e.auraCd <= 0) {
      e.auraCd = 0.4;
      w.spawnRing(e.x, e.y, W.domainR, W.domainR, 0.42, 0x9a6bff, 0.38);
      for (let i = 0; i < 3; i++) {
        const a = w.rng.angle();
        w.spawnParticle(e.x + Math.cos(a) * W.domainR, e.y + Math.sin(a) * W.domainR, 0x9a6bff, 12, 0.45, 2.4);
      }
    }
  }

  const dashSpeed = e.phase >= 3 ? 720 : 620;
  switch (e.st) {
    case 0: // 追击，按 pat 选下一个招式
      e.x += nx * e.speed * slow * dt;
      e.y += ny * e.speed * slow * dt;
      if (e.stT <= 0) {
        const rot = (e.pat + 3) % 3;
        if (e.phase >= 3) {
          e.st = rot === 0 ? 5 : rot === 1 ? 3 : 7;
          e.stT = 0.55;
        } else if (e.phase === 2) {
          e.st = rot === 0 ? 1 : rot === 1 ? 3 : 7;
          e.stT = 0.6;
        } else {
          e.st = rot === 0 ? 1 : 3;
          e.stT = 0.7;
        }
      }
      break;
    case 1: // 弹幕前摇
      e.tele = true;
      if (e.stT <= 0) {
        e.st = 2;
        e.ax = 3;          // 波数
        e.ay = 0;          // 已发波数
        e.fireCd = 0;
      }
      break;
    case 2: // 错位环形弹幕（每波相位错开，逼玩家持续位移）
      if (e.fireCd <= 0) {
        e.fireCd = 0.34;
        ringBullets(
          w, e,
          Math.max(8, Math.round(BAL.boss.barrageCount * w.run.bossBulletCountMult)),
          BAL.boss.bulletSpeed * w.run.bossBulletSpeedMult,
          Math.max(3, Math.round(BAL.boss.bulletDmg * w.run.bossBulletDmgMult)),
          (e.ay * Math.PI) / 7,
        );
        e.ay++;
        if (e.ay >= e.ax) {
          e.st = 0;
          e.stT = e.phase >= 3 ? 1.2 : 1.8;
          e.pat = (e.pat + 1) % 3;
        }
      }
      break;
    case 3: // 突进前摇（结束瞬间锁定方向）
      e.tele = true;
      if (e.stT <= 0) {
        e.ax = nx;
        e.ay = ny;
        e.st = 4;
        e.stT = 0.7;
      }
      break;
    case 4: // 织梭突进
      e.x += e.ax * dashSpeed * slow * dt;
      e.y += e.ay * dashSpeed * slow * dt;
      if (e.stT <= 0) {
        e.st = 0;
        e.stT = e.phase >= 3 ? 1.0 : 2.0;
        e.pat = (e.pat + 1) % 3;
      }
      break;
    case 5: // P3 全屏波前摇
      e.tele = true;
      if (e.stT <= 0) {
        e.st = 6;
        e.ax = W.waveCount;
        e.ay = 0;
        e.fireCd = 0;
      }
      break;
    case 6: // P3 全屏扩散弹幕波
      if (e.fireCd <= 0) {
        e.fireCd = W.waveGap;
        ringBullets(
          w, e,
          Math.max(10, Math.round(BAL.boss.barrageCount * 1.2 * w.run.bossBulletCountMult)),
          (BAL.boss.bulletSpeed + 26 * e.ay) * w.run.bossBulletSpeedMult,
          Math.max(3, Math.round(BAL.boss.bulletDmg * w.run.bossBulletDmgMult)),
          e.ay * 0.21,
        );
        w.spawnRing(e.x, e.y, 30, 520 + e.ay * 90, 0.4, 0xff5c5c, 0.7);
        e.ay++;
        if (e.ay >= e.ax) {
          e.st = 0;
          e.stT = 1.5;
          e.pat = 1;
        }
      }
      break;
    case 7: // 召唤织蛛（P3 数量更多）
      if (e.stT <= 0) {
        const n = e.phase >= 3 ? 12 : 8;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          spawnEnemy(w, 'moth', e.x + Math.cos(a) * 90, e.y + Math.sin(a) * 90);
        }
        w.spawnRing(e.x, e.y, 20, 170, 0.4, 0x9a6bff, 0.85);
        e.st = 0;
        e.stT = 1.8;
        e.pat = (e.pat + 1) % 3;
      }
      break;
    case 9: // 阶段转换停顿（不移动、不出招）
      if (e.stT <= 0) {
        e.st = 0;
        e.stT = 0.7;
        e.pat = 0;
      }
      break;
  }
}

/**
 * Boss 双生回响兽（15:00）：**镜像玩家 4 秒前的轨迹**发起攻击（GDD §6.6）。
 * 三个机制都直接读取玩家的回响缓冲（240 帧 = 4s），主题与机制同构：
 *   ① 延迟领域（被动）：本局残影延迟 +2s（§15 交互矩阵）——在你身边，连"过去的你"都变得更远；
 *   ② 镜像突进：预警后朝"4 秒前的你"冲锋——站在原地不动就会被打中；
 *   ③ 回响刃：在 4s / 3s / 2s 前的位置依次落下三片刃域，封锁你走过的路。
 * 破解方式即"主动错位自己 4 秒前的走法"——玩家的应对就是设计意图。
 */
function updateTwin(w: World, e: Enemy, dt: number, nx: number, ny: number, slow: number): void {
  e.stT -= dt;
  e.tele = false;
  e.sprite.rotation += dt * 0.6;
  switch (e.st) {
    case 0: // 追击
      e.x += nx * e.speed * slow * dt;
      e.y += ny * e.speed * slow * dt;
      if (e.stT <= 0) {
        if (e.pat === 0) {
          e.st = 1;
          e.stT = 0.6;
        } else {
          e.st = 3;
          e.stT = 0.5;
        }
      }
      break;
    case 1: // 镜像突进：前摇（锁定"4 秒前的你"，用残影拖尾提示读者）
      e.tele = true;
      if (e.stT <= 0) {
        const past = w.playerPosAgo(240);
        const dx = past.x - e.x;
        const dy = past.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        e.ax = dx / d;
        e.ay = dy / d;
        e.st = 2;
        e.stT = Math.max(0.45, Math.min(1.1, d / 620));
        w.spawnRing(past.x, past.y, 20, 90, 0.5, 0xff8a70, 0.9); // 标出"你 4 秒前站的位置"
      }
      break;
    case 2: // 镜像突进：冲锋（超速）
      e.x += e.ax * 620 * slow * dt;
      e.y += e.ay * 620 * slow * dt;
      if (e.stT <= 0) {
        e.st = 0;
        e.stT = 1.8;
        e.pat = 1;
      }
      break;
    case 3: // 回响刃：前摇
      e.tele = true;
      if (e.stT <= 0) {
        e.st = 4;
        e.stT = 0;
      }
      break;
    case 4: {
      // 在 4s / 3s / 2s 前的位置依次落下刃域（预警 0.7s，伤害 26/s，持续 2.2s）
      const marks: [number, number][] = [[240, 0], [180, 0.35], [120, 0.7]];
      for (const [frames, delayExtra] of marks) {
        const past = w.playerPosAgo(frames);
        w.spawnHazard(past.x, past.y, 70, 2.2 + delayExtra, {
          tele: 0.7 + delayExtra, dps: 26, kind: 'blade', color: 0xff8a70,
        });
      }
      e.st = 0;
      e.stT = 2.0;
      e.pat = 0;
      break;
    }
  }
}

/** Boss 分针兽：环形弹幕 + 扇形冲锋（GDD §6.6） */
function updateMinute(w: World, e: Enemy, dt: number, nx: number, ny: number, slow: number): void {
  e.stT -= dt;
  e.tele = false;
  e.sprite.rotation += dt * 0.8;
  switch (e.st) {
    case 0: // 追击
      e.x += nx * e.speed * slow * dt;
      e.y += ny * e.speed * slow * dt;
      if (e.stT <= 0) {
        if (e.pat === 0) {
          e.st = 1;
          e.stT = 0.5;
        } else {
          e.st = 3;
          e.stT = 0.8;
        }
      }
      break;
    case 1: // 弹幕前摇
      e.tele = true;
      if (e.stT <= 0) {
        e.st = 2;
        e.ax = e.hp < e.maxHp * 0.5 ? 3 : 2; // 总波数（狂暴 +1）
        e.ay = 0; // 已发波数
        e.fireCd = 0;
      }
      break;
    case 2: // 环形弹幕（多波）
      if (e.fireCd <= 0) {
        e.fireCd = 0.35;
        ringBullets(
          w, e,
          Math.max(6, Math.round(BAL.boss.barrageCount * w.run.bossBulletCountMult)),
          BAL.boss.bulletSpeed * w.run.bossBulletSpeedMult,
          Math.max(3, Math.round(BAL.boss.bulletDmg * w.run.bossBulletDmgMult)),
          (e.ay * Math.PI) / BAL.boss.barrageCount,
        );
        e.ay++;
        if (e.ay >= e.ax) {
          e.st = 0;
          e.stT = 2.0;
          e.pat = 1;
        }
      }
      break;
    case 3: // 冲锋前摇（结束瞬间锁定方向）
      e.tele = true;
      if (e.stT <= 0) {
        e.ax = nx;
        e.ay = ny;
        e.st = 4;
        e.stT = 0.7;
      }
      break;
    case 4: // 扇形冲锋
      e.x += e.ax * 420 * slow * dt;
      e.y += e.ay * 420 * slow * dt;
      if (e.stT <= 0) {
        e.st = 0;
        e.stT = 2.2;
        e.pat = 0;
      }
      break;
  }
}

/**
 * Boss 时漏巨像（10:00）：激光扫场 + 召唤时蛾潮 + 沙流减速带（GDD §6.6）。
 * 状态机：0 追击 → 1 激光前摇 → 2 激光旋转扫场 → 0 → 3 召唤蛾潮 → 0 → 4 沙流带 → 0
 */
function updateHourglass(w: World, e: Enemy, dt: number, nx: number, ny: number, slow: number): void {
  e.stT -= dt;
  e.tele = false;
  e.sprite.rotation += dt * 0.5;
  switch (e.st) {
    case 0: // 追击
      e.x += nx * e.speed * slow * dt;
      e.y += ny * e.speed * slow * dt;
      if (e.stT <= 0) {
        e.st = e.pat === 0 ? 1 : e.pat === 1 ? 3 : 4;
        e.stT = e.st === 1 ? 0.9 : 0.6;
      }
      break;
    case 1: // 激光前摇（锁定初始角度）
      e.tele = true;
      if (e.stT <= 0) {
        e.ax = Math.atan2(w.player.y - e.y, w.player.x - e.x);
        e.ay = 0;
        e.st = 2;
        e.stT = 2.4;
        e.fireCd = 0;
      }
      break;
    case 2: {
      // 激光旋转扫场：沿射线判定伤害（玩家在射线附近即受伤）
      e.ax += dt * 0.9; // 扫描角速度
      const dirX = Math.cos(e.ax);
      const dirY = Math.sin(e.ax);
      const rx = w.player.x - e.x;
      const ry = w.player.y - e.y;
      const along = rx * dirX + ry * dirY;
      if (along > 0) {
        const perp = Math.abs(rx * dirY - ry * dirX);
        if (perp < 26 && e.fireCd <= 0) {
          e.fireCd = 0.35;
          w.damagePlayer(Math.round(e.dmg * 0.6));
        }
      }
      // 视觉：沿射线撒粒子
      if (e.fireCd <= 0) e.fireCd = 0.05;
      for (let i = 1; i <= 8; i++) {
        w.spawnParticle(e.x + dirX * i * 70, e.y + dirY * i * 70, 0xffd77a, 30, 0.14, 3);
      }
      if (e.stT <= 0) {
        e.st = 0;
        e.stT = 1.8;
        e.pat = 1;
      }
      break;
    }
    case 3: // 召唤时蛾潮
      if (e.stT <= 0) {
        const n = 10;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          spawnEnemy(w, 'moth', e.x + Math.cos(a) * 90, e.y + Math.sin(a) * 90);
        }
        w.spawnRing(e.x, e.y, 20, 160, 0.4, 0xa9b4c8, 0.8);
        e.st = 0;
        e.stT = 1.8;
        e.pat = 2;
      }
      break;
    case 4: // 沙流减速带：在玩家附近撒 3 片减速区（玩家踏入减速 30%）
      if (e.stT <= 0) {
        for (let i = 0; i < 3; i++) {
          const a = w.rng.angle();
          const d = w.rng.range(80, 260);
          const sx = w.player.x + Math.cos(a) * d;
          const sy = w.player.y + Math.sin(a) * d;
          w.spawnRing(sx, sy, 10, 120, 3, 0xc9a227, 0.5);
          w.sandZones.push({ x: sx, y: sy, r: 120, t: 6 });
        }
        e.st = 0;
        e.stT = 1.6;
        e.pat = 0;
      }
      break;
  }
}
