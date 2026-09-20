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
    e.tint = bossKind === 'hourglass' ? 0xc9a227 : 0xd95f4a;
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
    e.dmg = Math.max(1, Math.round((b.dmg + (elite ? 2 : 0)) * (1 + w.run.enemyDmgPct)));
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

    const slow = e.slowT > 0 ? BAL.burst.slowFactor : 1;
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

/** Boss 技能分发（GDD §6.6）。minute=分针兽；hourglass=时漏巨像；twin/weaver 为 M3 占位（复用巨像行为） */
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
    updateHourglass(w, e, dt, nx, ny, slow); // 20:00 诺诺：M3 后半实装三阶段，暂用巨像行为
    return;
  }
  updateMinute(w, e, dt, nx, ny, slow);
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
        ringBullets(w, e, BAL.boss.barrageCount, BAL.boss.bulletSpeed, BAL.boss.bulletDmg, (e.ay * Math.PI) / BAL.boss.barrageCount);
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
