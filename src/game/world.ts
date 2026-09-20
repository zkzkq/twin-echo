import { Container, Sprite } from 'pixi.js';
import { BAL, interp } from '../config/balance';
import { recompute } from '../config/items';
import { AudioSys } from '../core/audio';
import { Pool } from '../core/pool';
import { RNG } from '../core/rng';
import { SpatialHash } from '../core/spatial';
import { COLORS, TEX, hiddenSprite } from './textures';
import { updateEnemies, pickKind, spawnBoss, spawnElite, spawnEnemy } from './enemies';
import {
  applyDamage, panelDps, replayEchoAttacks, tryBurst, updateBullets, updateOrbits, updateWeapons, updateTrail,
} from './combat';
import { mergePass, spawnCrystal, spawnGem, spawnHeal, updateGems } from './gems';
import { clearAltars, interruptAltars, spawnAltar, updateAltars } from './altar';
import { eventGaugeMult, eventSpawnMult, rollEvent, updateEvents, type EventKind } from './events';
import { EMPTY_BONUSES, type MetaBonuses } from './meta';
import { defaultRunMods, type RunMods } from './runconfig';
import type {
  Altar, Bullet, Enemy, EchoState, EchoEvent, Gem, OrbitState, Particle, PlayerState, RingFx, RunStats,
  TrailSeg, WorldFlags,
} from './types';

export type WorldEvent =
  | 'levelup'
  | 'death'
  | 'victory'
  | 'boss-warn'
  | 'boss-spawn'
  | 'boss-dead'
  | 'elite-dead'
  | 'first-resonance'
  | 'gauge-full'
  | 'burst'
  | 'rush'
  | 'hint-move'
  | 'revive'
  | 'crystal-picked'
  | 'altar-spawn'
  | 'altar-enter'
  | 'altar-ready'
  | 'altar-unmet'
  | 'evolved'
  | 'event-start'
  | 'event-end';

export interface Layers {
  gems: Container;
  enemies: Container;
  bullets: Container;
  players: Container;
  fx: Container;
}

/** 残影环形缓冲帧数（需 ≥ §16 登记的最大延迟 3.5s = 210 帧） */
export const ECHO_BUF = 240;

/**
 * 游戏世界：60Hz 固定步长逻辑（GDD §11.2 ECS-lite）。
 * 玩家 → 残影（150 帧环形缓冲重演）→ 武器/共鸣 → 敌人/弹幕 → 宝石 → 生成导演。
 */
export class World {
  readonly tex: TEX;
  readonly audio: AudioSys;
  readonly layers: Layers;
  readonly onEvent: (e: WorldEvent) => void;
  /** 输入轴（-1..1），由 Game 每帧写入 */
  readonly input = { x: 0, y: 0 };

  rng = new RNG(1);
  frame = 0;
  time = 0;
  running = false;
  dead = false;
  deathSent = false;
  firstRun = false;
  /** 首局 <5:00 免费复活是否已用（GDD §9 新手引导：首局死亡 <5:00 免费复活 1 次） */
  reviveUsed = false;
  revives = 0;

  player!: PlayerState;
  echo!: EchoState;
  orbits!: { body: OrbitState; echo: OrbitState };
  stats!: RunStats;
  flags!: WorldFlags;

  readonly enemies: Pool<Enemy>;
  readonly bullets: Pool<Bullet>;
  readonly gems: Pool<Gem>;
  readonly parts: Pool<Particle>;
  readonly rings: Pool<RingFx>;
  readonly trails: Pool<TrailSeg>;
  readonly hash = new SpatialHash();

  /** 进化祭坛（GDD §6.5，最多 3 座） */
  altars: Altar[] = [];
  /** 局内事件状态（GDD §6.7） */
  eventKind: EventKind | null = null;
  eventT = 0;
  eventCd = 0;
  /** 已生成的 Boss 序号（对应 BAL.bosses） */
  bossIdx = 0;
  /** 进化体「贯穿命运之矢」的击杀叠伤（当局累计，上限 +20%） */
  evoDmgBonus = 0;
  /** 沙流减速带（时漏巨像 §6.6）：玩家踏入减速 30% */
  sandZones: { x: number; y: number; r: number; t: number }[] = [];
  /** 残光轨迹留痕计时（本体/残影各一） */
  trailTimer = { body: 0, echo: 0 };
  /** 回响密库增益（局外成长，GDD §6.8.2） */
  meta: MetaBonuses = { ...EMPTY_BONUSES };
  /** 本局配置修正（角色 / 悖论难度 / 每日挑战，M3） */
  run: RunMods = defaultRunMods();
  /** 同步爆发后的临时攻速加成剩余（诺恩） */
  burstHasteT = 0;
  /** 受击时停的内置冷却（诺亚） */
  stasisCd = 0;

  boss: Enemy | null = null;
  pendingLevelUps = 0;
  rerolls = 1;
  camX = 0;
  camY = 0;
  shake = 0;
  viewW = 1280;
  viewH = 720;
  enemyIdSeq = 1;

  // 生成导演计时器
  private spawnT = 0;
  private spawnDebt = 0;
  private eliteT = 0;
  private swarmT = 0;
  mergeT = 2;
  /** 合并中标志（防 spawnGem ↔ mergeNow 递归；详见 gems.ts） */
  merging = false;
  private bossWarned = false;
  /** 已刷新到第几座祭坛 */
  private altarIdx = 0;

  // 渲染用常驻精灵
  readonly playerSprite: Sprite;
  readonly echoSprite: Sprite;
  readonly trailSprites: readonly Sprite[];

  constructor(tex: TEX, audio: AudioSys, onEvent: (e: WorldEvent) => void, layers: Layers) {
    this.tex = tex;
    this.audio = audio;
    this.onEvent = onEvent;
    this.layers = layers;

    this.playerSprite = hiddenSprite(tex.player, layers.players);
    this.playerSprite.tint = COLORS.player;
    this.echoSprite = hiddenSprite(tex.player, layers.players);
    this.echoSprite.tint = COLORS.echo;
    this.echoSprite.alpha = 0.55;
    this.trailSprites = [
      hiddenSprite(tex.player, layers.players),
      hiddenSprite(tex.player, layers.players),
      hiddenSprite(tex.player, layers.players),
    ];
    this.trailSprites[0].alpha = 0.3;
    this.trailSprites[1].alpha = 0.2;
    this.trailSprites[2].alpha = 0.1;
    for (const s of this.trailSprites) s.tint = COLORS.echo;

    // 预分配到实体预算上限（GDD §11.2"对象池全覆盖：零运行时分配"）：
    // 低于预算的预分配会在对局中触发 obtain() 临时创建 Sprite，实测造成百毫秒级毛刺。
    this.enemies = new Pool<Enemy>((idx) => {
      const sprite = hiddenSprite(tex.moth, layers.enemies);
      const ring = hiddenSprite(tex.eliteRing, layers.enemies);
      ring.tint = COLORS.eliteRing;
      return {
        idx, active: false, id: 0, kind: 'moth', bossKind: '', elite: false, boss: false,
        x: 0, y: 0, hp: 1, maxHp: 1, dmg: 0, speed: 0, xpVal: 0, radius: 9, armor: 0,
        tint: 0xffffff, slowT: 0, frozenT: 0, flashT: 0, hitCd: 0, tele: false, st: 0, stT: 0, pat: 1,
        ax: 0, ay: 0, kx: 0, ky: 0, fireCd: 0, auraCd: 0,
        lastHitSrc: null, lastHitT: -99, orbitCdB: 0, orbitCdE: 0, trailCd: 0, sprite, ring,
      };
    }, 340);

    this.bullets = new Pool<Bullet>((idx) => {
      const sprite = hiddenSprite(tex.bolt, layers.bullets);
      return {
        idx, active: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 0, r: 7, life: 0,
        hostile: false, pierce: 1, hitIds: new Set<number>(), homing: false, retarget: 0,
        target: null, src: 'body', kind: 'bolt', forceCrit: false, weaponId: '', sprite,
      };
    }, 420);

    this.gems = new Pool<Gem>((idx) => {
      const sprite = hiddenSprite(tex.gem, layers.gems);
      return { idx, active: false, x: 0, y: 0, vx: 0, vy: 0, tier: 0, heal: 0, crystal: 0, magnet: false, sprite };
    }, 520);

    this.parts = new Pool<Particle>((idx) => {
      const sprite = hiddenSprite(tex.particle, layers.fx);
      return { idx, active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, color: 0xffffff, sprite };
    }, BAL.vfx.particleCap + 40);

    this.rings = new Pool<RingFx>((idx) => {
      const sprite = hiddenSprite(tex.ring, layers.fx);
      return { idx, active: false, x: 0, y: 0, r0: 10, r1: 40, life: 0, maxLife: 1, color: 0xffffff, sprite };
    }, 48);

    this.trails = new Pool<TrailSeg>((idx) => {
      const sprite = hiddenSprite(tex.trail, layers.fx);
      return { idx, active: false, x: 0, y: 0, life: 0, maxLife: 1, src: 'body' as const, sprite };
    }, 140);

    this.reset(1, true);
  }

  reset(seed: number, firstRun: boolean, meta: MetaBonuses = EMPTY_BONUSES, run: RunMods = defaultRunMods()): void {
    this.rng = new RNG(seed);
    this.frame = 0;
    this.time = 0;
    this.running = true;
    this.dead = false;
    this.deathSent = false;
    this.firstRun = firstRun;
    this.meta = meta;
    this.run = run;
    this.burstHasteT = 0;
    this.stasisCd = 0;

    this.player = {
      x: 0, y: 0, hp: 100, maxHp: 100, radius: BAL.player.radius, speed: BAL.player.speed,
      pickupR: BAL.player.pickupR, facing: 0, invulnT: 0, hurtCd: 0, slowT: 0,
      level: 1, xp: 0, xpNeed: BAL.xpCurve(1), gauge: 0, crystals: 0, evolutions: new Set<string>(),
      weapons: new Map([[run.startWeapon || 'clock', { lv: 1 + meta.startWeaponLv, cd: 0.3 }]]),
      passives: new Map(),
      stats: { dmg: 0, atkSpd: 0, critCh: 0.05, critDmg: 1.5, moveSpd: 0, resDmg: 0, resGain: 0, cd: 0, area: 0, echoRange: 1 },
    };
    recompute(this.player);
    // 密库增益（局外成长）
    this.player.maxHp += meta.hpBonus;
    this.player.pickupR *= 1 + meta.pickupPct;
    this.player.speed *= 1 + meta.moveSpdPct;
    this.player.stats.critCh += meta.critBonus;
    this.player.stats.cd += meta.cdPct;
    this.player.stats.resDmg += meta.resDmgPct;
    // 本局修正（角色 / 悖论 / 每日）
    this.player.maxHp = Math.max(20, Math.round((this.player.maxHp + run.hpDelta) * (1 + run.hpPct)));
    this.player.pickupR *= 1 + run.pickupPct;
    this.player.speed *= 1 + run.moveSpdPct;
    this.player.stats.resDmg += run.resDmgPct;
    this.player.hp = this.player.maxHp;

    this.echo = {
      x: 0, y: 0, facing: 0,
      bx: new Float32Array(ECHO_BUF), by: new Float32Array(ECHO_BUF), br: new Float32Array(ECHO_BUF),
      head: 0, count: 0, events: [],
    };
    this.orbits = { body: { phase: 0, needles: [] }, echo: { phase: Math.PI, needles: [] } };
    this.stats = {
      kills: 0, hits: 0, resHits: 0, bursts: 0, elitesKilled: 0, elitesSpawned: 0, bossKills: 0,
      levelsGained: 0, skipped: 0, sandBonus: 0, damageTaken: 0,
      altarReached: 0, altarCrafted: 0, eventsFired: 0,
    };
    this.flags = {
      resToasted: false, gaugeToasted: false, moveToasted: false, rushToasted: false, firstEliteToasted: false,
    };

    this.enemies.releaseAll();
    this.bullets.releaseAll();
    this.gems.releaseAll();
    this.parts.releaseAll();
    this.rings.releaseAll();
    this.trails.releaseAll();
    clearAltars(this);
    for (const nd of [...this.orbits.body.needles, ...this.orbits.echo.needles]) nd.sprite.destroy();
    this.orbits.body.needles.length = 0;
    this.orbits.echo.needles.length = 0;

    this.hash.clear();
    this.boss = null;
    this.pendingLevelUps = 0;
    this.rerolls = 1;
    this.camX = 0;
    this.camY = 0;
    this.shake = 0;
    this.enemyIdSeq = 1;
    this.spawnT = 1.0;
    this.spawnDebt = 0;
    this.eliteT = BAL.elite.first;
    this.swarmT = BAL.swarm.first;
    this.mergeT = 2;
    this.merging = false;
    this.bossWarned = false;
    this.altarIdx = 0;
    this.reviveUsed = false;
    this.revives = 0;
    this.eventKind = null;
    this.eventT = 0;
    this.eventCd = BAL.events.first;
    this.bossIdx = 0;
    this.evoDmgBonus = 0;
    this.sandZones.length = 0;
    this.trailTimer = { body: 0, echo: Math.PI / 4 };
    this.profFrames.length = 0;
  }

  // ---------- 分相剖析器（dev-only，默认关闭零开销；供 pnpm bench 定位慢帧） ----------
  profEnabled = false;
  profFrames: { ms: number; phases: Record<string, number> }[] = [];
  private profAcc: Record<string, number> = {};
  private profT0 = 0;

  private phase<T>(name: string, fn: () => T): T {
    if (!this.profEnabled) return fn();
    const t0 = performance.now();
    const r = fn();
    this.profAcc[name] = (this.profAcc[name] ?? 0) + (performance.now() - t0);
    return r;
  }

  private profCommit(): void {
    const ms = performance.now() - this.profT0;
    this.profFrames.push({ ms: +ms.toFixed(3), phases: { ...this.profAcc } });
    if (this.profFrames.length > 4000) this.profFrames.shift();
  }

  spawnRadius(): number {
    return Math.hypot(this.viewW, this.viewH) / 2 + 100;
  }

  /**
   * 可视矩形外贴边生成点（side 0=左 1=右 2=上 3=下，t∈[0,1] 沿边位置）。
   * 用贴边而非对角线远端：敌人抵达时间从 5–10s 降到 3–5s，避免开局空场。
   */
  private sideSpawn(side: number, t: number): { x: number; y: number } {
    const hw = this.viewW / 2 + 70;
    const hh = this.viewH / 2 + 70;
    const u = t * 2 - 1;
    const p = this.player;
    switch (side) {
      case 0: return { x: p.x - hw, y: p.y + u * hh };
      case 1: return { x: p.x + hw, y: p.y + u * hh };
      case 2: return { x: p.x + u * hw, y: p.y - hh };
      default: return { x: p.x + u * hw, y: p.y + hh };
    }
  }

  spawnPoint(): { x: number; y: number } {
    return this.sideSpawn(this.rng.int(0, 3), this.rng.next());
  }

  /** 60Hz 逻辑步进 */
  update(dt: number): void {
    if (!this.running) return;
    this.frame++;
    this.time += dt;
    if (this.profEnabled) {
      this.profAcc = {};
      this.profT0 = performance.now();
    }

    this.phase('player', () => this.updatePlayer(dt));
    this.phase('enemies', () => updateEnemies(this, dt));

    this.phase('hash', () => {
      this.hash.clear();
      for (const e of this.enemies.items) if (e.active) this.hash.insert(e);
    });

    this.phase('orbits', () => updateOrbits(this, dt));
    this.phase('weapons', () => updateWeapons(this, dt));
    this.phase('trail', () => updateTrail(this, dt));
    this.phase('echoReplay', () => replayEchoAttacks(this));
    this.phase('bullets', () => updateBullets(this, dt));
    this.phase('separation', () => this.separation());
    this.phase('contact', () => this.playerContact());

    if (this.dead) {
      if (this.profEnabled) this.profCommit();
      if (!this.deathSent) {
        this.deathSent = true;
        this.running = false;
        this.onEvent('death');
      }
      return;
    }

    this.phase('gems', () => updateGems(this, dt));
    this.phase('merge', () => mergePass(this, dt));
    this.phase('altars', () => updateAltars(this, dt));
    this.phase('events', () => updateEvents(this, dt));
    this.phase('director', () => this.director(dt));

    if (this.time >= BAL.meta.runSeconds) {
      if (this.profEnabled) this.profCommit();
      this.running = false;
      this.onEvent('victory');
      return;
    }
    if (this.pendingLevelUps > 0) {
      this.pendingLevelUps--;
      this.onEvent('levelup');
    }
    if (this.profEnabled) this.profCommit();
  }

  /** 玩家移动 + 残影缓冲记录/重演（GDD §5.1：延迟 2.5s，开局不足 2.5s 时贴身跟随） */
  private updatePlayer(dt: number): void {
    const p = this.player;
    const e = this.echo;
    p.invulnT = Math.max(0, p.invulnT - dt);
    p.hurtCd = Math.max(0, p.hurtCd - dt);
    if (this.stasisCd > 0) this.stasisCd -= dt;
    if (this.burstHasteT > 0) this.burstHasteT -= dt;

    let mx = this.input.x;
    let my = this.input.y;
    const l = Math.hypot(mx, my);
    if (l > 0.01) {
      mx /= l;
      my /= l;
      p.facing = Math.atan2(my, mx);
      const spd = p.speed * (p.slowT > 0 ? 0.7 : 1); // 沙流减速带
      p.x += mx * spd * dt;
      p.y += my * spd * dt;
    }

    // 沙流带判定与清理
    if (this.sandZones.length > 0) {
      for (let i = this.sandZones.length - 1; i >= 0; i--) {
        const z = this.sandZones[i]!;
        z.t -= dt;
        if (z.t <= 0) {
          this.sandZones.splice(i, 1);
          continue;
        }
        if ((p.x - z.x) ** 2 + (p.y - z.y) ** 2 <= z.r * z.r) p.slowT = 0.2;
      }
    }
    if (p.slowT > 0) p.slowT -= dt;

    // 记录轨迹（环形缓冲）
    e.bx[e.head] = p.x;
    e.by[e.head] = p.y;
    e.br[e.head] = p.facing;
    e.head = (e.head + 1) % ECHO_BUF;
    if (e.count < ECHO_BUF) e.count++;

    // 重演位置：延迟 = min(已记录帧数, 本局延迟)；开局不足时贴身跟随
    const delay = Math.min(e.count, this.run.echoDelayFrames);
    const idx = (e.head - delay + ECHO_BUF) % ECHO_BUF;
    e.x = e.bx[idx]!;
    e.y = e.by[idx]!;
    e.facing = e.br[idx]!;

    if (this.firstRun && !this.flags.moveToasted && this.time >= 6) {
      this.flags.moveToasted = true;
      this.onEvent('hint-move');
    }
  }

  /** boids-lite 分离（每敌 ≤6 邻居，Boss 不被推动） */
  private separation(): void {
    const tmp: Enemy[] = [];
    for (const e of this.enemies.items) {
      if (!e.active || e.boss) continue;
      this.hash.query(e.x, e.y, e.radius + 44, tmp);
      let cnt = 0;
      let px = 0;
      let py = 0;
      for (const o of tmp) {
        if (o === e || !o.active) continue;
        const dx = e.x - o.x;
        const dy = e.y - o.y;
        const rr = e.radius + o.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.0001 && d2 < rr * rr) {
          const d = Math.sqrt(d2);
          const f = (rr - d) / rr;
          px += (dx / d) * f;
          py += (dy / d) * f;
          if (++cnt >= 6) break;
        }
      }
      if (cnt > 0) {
        const push = e.elite ? 0.5 : 0.9;
        e.x += px * push;
        e.y += py * push;
      }
    }
  }

  /** 敌我碰撞（每敌 0.8s 一次，被围=死亡，GDD §7.4） */
  private playerContact(): void {
    const p = this.player;
    const tmp: Enemy[] = [];
    this.hash.query(p.x, p.y, p.radius + 44, tmp);
    for (const e of tmp) {
      if (!e.active || e.hitCd > 0) continue;
      const rr = p.radius + e.radius;
      if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 <= rr * rr) {
        e.hitCd = 0.8;
        this.damagePlayer(e.dmg);
        if (this.dead) return;
      }
    }
  }

  /** 生成导演：难度曲线 / 蜂群 / 精英 / Boss / 终局冲刺（GDD §7.4 §8.1） */
  private director(dt: number): void {
    const t = this.time;
    const m = t / 60;

    if (!this.flags.rushToasted && t >= BAL.rush.start) {
      this.flags.rushToasted = true;
      this.onEvent('rush');
    }
    // Boss 连战（GDD §6.6：05:00 / 10:00 / 15:00 / 20:00）
    const nextBoss = BAL.bosses[this.bossIdx];
    if (nextBoss && !this.bossWarned && t >= nextBoss.at - BAL.boss.warnBefore) {
      this.bossWarned = true;
      this.onEvent('boss-warn');
    }
    if (nextBoss && t >= nextBoss.at) {
      this.bossIdx++;
      this.bossWarned = false;
      spawnBoss(this, nextBoss.kind);
      this.onEvent('boss-spawn');
    }
    // 进化祭坛刷新（8:00 / 13:00 / 18:00）
    while (this.altarIdx < BAL.altar.at.length && t >= BAL.altar.at[this.altarIdx]!) {
      this.altarIdx++;
      spawnAltar(this);
    }
    // 局内事件：每 120s roll 1 次，Boss 战期间禁用
    if (this.eventKind === null) {
      this.eventCd -= dt;
      const bossFighting = this.boss !== null && this.boss.active;
      if (this.eventCd <= 0) {
        if (bossFighting) this.eventCd = 15; // Boss 战期间挂起，稍后重试
        else {
          rollEvent(this);
          this.eventCd = BAL.events.every;
        }
      }
    }
    if (t >= this.eliteT) {
      this.stats.elitesSpawned++;
      spawnElite(this);
      this.eliteT = t + (BAL.elite.every + this.rng.range(-BAL.elite.jitter, BAL.elite.jitter)) / this.run.eliteFreqMult;
    }
    if (t >= this.swarmT) {
      // 蜂群：整面"虫墙"从单侧压入
      const n = BAL.swarm.base + Math.floor(m * 2.5);
      const side = this.rng.int(0, 3);
      for (let i = 0; i < n; i++) {
        const sp = this.sideSpawn(side, n > 1 ? i / (n - 1) : 0.5);
        spawnEnemy(this, 'moth', sp.x, sp.y);
      }
      this.swarmT += BAL.swarm.every;
    }

    const firstSlow = this.firstRun && t < 90 ? 2 : 1;
    const rush = t >= BAL.rush.start;
    const interval = interp(BAL.spawn.minute, BAL.spawn.interval, m) * firstSlow * (rush ? BAL.rush.intervalMult : 1);
    const batch = (interp(BAL.spawn.minute, BAL.spawn.batch, m) + (rush ? BAL.rush.batchAdd : 0))
      * eventSpawnMult(this) * (1 + this.run.spawnPct);
    const cap = interp(BAL.spawn.minute, BAL.spawn.cap, m);

    this.spawnT -= dt;
    // M3：Boss 战期间暂停常规生成 —— 避免"Boss 弹幕 + 虫潮"叠加把玩家夹死，
    // 同时让 Boss 战读图清晰（开关式设计，便于试玩对比）。
    const bossFighting = this.boss !== null && this.boss.active;
    if (this.spawnT <= 0 && !bossFighting) {
      this.spawnT = Math.max(0.12, interval);
      // 小数批量 → 累积债务取整，保证长窗口生成速率精确
      this.spawnDebt += batch;
      const n = Math.floor(this.spawnDebt);
      this.spawnDebt -= n;
      const can = Math.min(n, Math.max(0, cap - this.enemies.count));
      for (let i = 0; i < can; i++) {
        const sp = this.spawnPoint();
        spawnEnemy(this, pickKind(this.rng, m), sp.x, sp.y);
      }
    }
  }

  // ---------- 供子系统调用的工具方法 ----------

  addXp(v: number): void {
    const p = this.player;
    p.xp += v * (1 + this.run.xpPct);
    while (p.xp >= p.xpNeed) {
      p.xp -= p.xpNeed;
      p.level++;
      this.stats.levelsGained++;
      p.xpNeed = BAL.xpCurve(p.level);
      p.hp = Math.min(p.maxHp, p.hp + BAL.player.levelHeal + this.meta.levelHealBonus);
      this.pendingLevelUps++;
      this.audio.levelup();
    }
  }

  damagePlayer(dmg: number): void {
    const p = this.player;
    if (!this.running || p.invulnT > 0 || p.hurtCd > 0) return;
    p.hp -= dmg;
    p.hurtCd = BAL.player.hurtGrace;
    // 角色「时停者·诺亚」：受击 30% 概率时停 0.5s（内置 CD 5s）
    if (this.run.stasisOnHitChance > 0 && this.stasisCd <= 0 && this.rng.chance(this.run.stasisOnHitChance)) {
      this.stasisCd = 5;
      for (const e of this.enemies.items) if (e.active) e.frozenT = Math.max(e.frozenT, 0.5);
      this.spawnRing(p.x, p.y, 10, 420, 0.4, COLORS.echo, 0.8);
    }
    interruptAltars(this); // GDD §6.5：祭坛引导受击打断（走位风险决策点）
    this.stats.damageTaken += dmg;
    this.audio.hurt();
    this.shake = Math.max(this.shake, 0.08);
    if (p.hp <= 0) {
      // GDD §9：首局死亡 <5:00 免费复活 1 次（保底让新手见到 Boss 与结算）
      if (this.firstRun && !this.reviveUsed && this.time < 300) {
        this.reviveUsed = true;
        this.revives++;
        p.hp = p.maxHp * 0.5;
        p.invulnT = Math.max(p.invulnT, 3);
        p.hurtCd = 3;
        // 清出一圈呼吸空间：把周围敌人推开（不击杀，避免误杀 Boss/污染击杀统计）
        const tmp: Enemy[] = [];
        this.hash.query(p.x, p.y, 340 + 44, tmp);
        for (const e of tmp) {
          if (!e.active) continue;
          const dx = e.x - p.x;
          const dy = e.y - p.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d <= 340) {
            const push = 400 / d;
            e.x = p.x + dx * push;
            e.y = p.y + dy * push;
            e.slowT = 3;
            e.hitCd = Math.max(e.hitCd, 1.5);
          }
        }
        this.spawnRing(p.x, p.y, 20, 340, 0.6, COLORS.echo, 1);
        this.shake = 0.2;
        this.onEvent('revive');
        return;
      }
      p.hp = 0;
      this.dead = true;
    }
  }

  killEnemy(e: Enemy): void {
    if (!e.active) return;
    this.stats.kills++;
    const n = e.boss ? 40 : e.elite ? 16 : 6;
    for (let i = 0; i < n; i++) {
      this.spawnParticle(e.x, e.y, e.tint, this.rng.range(40, 200), this.rng.range(0.25, 0.5), this.rng.range(2, 4));
    }
    if (e.boss) {
      this.stats.bossKills++;
      this.boss = null;
      this.shake = 0.2;
      this.audio.bossDie();
      spawnGem(this, 3, e.x, e.y);
      for (let i = 0; i < 5; i++) {
        spawnGem(this, 2, e.x + this.rng.range(-40, 40), e.y + this.rng.range(-40, 40));
      }
      // GDD §6.5：Boss 必掉结晶 ×2
      for (let i = 0; i < 2; i++) {
        spawnCrystal(this, e.x + this.rng.range(-60, 60), e.y + this.rng.range(-60, 60));
      }
      spawnHeal(this, e.x, e.y - 30, 50);
      this.onEvent('boss-dead');
    } else if (e.elite) {
      this.stats.elitesKilled++;
      for (let i = 0; i < BAL.elite.gems; i++) {
        spawnGem(this, 2, e.x + this.rng.range(-50, 50), e.y + this.rng.range(-50, 50));
      }
      // GDD §6.5：精英必掉结晶 1
      spawnCrystal(this, e.x, e.y);
      spawnHeal(this, e.x + 30, e.y, BAL.elite.heal);
      this.onEvent('elite-dead');
      this.audio.kill();
    } else {
      for (let i = 0; i < e.xpVal; i++) {
        spawnGem(this, 0, e.x + this.rng.range(-14, 14), e.y + this.rng.range(-14, 14));
      }
      this.audio.kill();
    }
    if (e.ring) e.ring.visible = false;
    this.enemies.release(e);
  }

  spawnBullet(
    x: number, y: number, vx: number, vy: number, dmg: number,
    kind: 'bolt' | 'butterfly' | 'enemy', r: number, pierce: number, src: 'body' | 'echo',
    homing: boolean, life: number,
  ): Bullet {
    const b = this.bullets.obtain();
    b.x = x;
    b.y = y;
    b.vx = vx;
    b.vy = vy;
    b.dmg = dmg;
    b.r = r;
    b.life = life;
    b.hostile = kind === 'enemy';
    b.pierce = pierce;
    b.hitIds.clear();
    b.homing = homing;
    b.retarget = 0;
    b.target = null;
    b.src = src;
    b.kind = kind;
    b.forceCrit = false;
    b.weaponId = '';
    b.sprite.texture = kind === 'enemy' ? this.tex.bulletE : kind === 'butterfly' ? this.tex.butterfly : this.tex.bolt;
    b.sprite.tint = kind === 'enemy' ? COLORS.bulletE : kind === 'butterfly'
      ? (src === 'body' ? COLORS.butterflyBody : COLORS.butterflyEcho)
      : COLORS.bolt;
    b.sprite.alpha = kind === 'enemy' ? 1 : 0.9;
    b.sprite.visible = true;
    b.sprite.rotation = Math.atan2(vy, vx);
    return b;
  }

  spawnParticle(x: number, y: number, color: number, speed: number, life: number, size: number): void {
    if (this.parts.count >= BAL.vfx.particleCap) return; // §10.2 VFX 预算硬上限
    const p = this.parts.obtain();
    const a = this.rng.angle();
    p.x = x;
    p.y = y;
    p.vx = Math.cos(a) * speed;
    p.vy = Math.sin(a) * speed;
    p.life = life;
    p.maxLife = life;
    p.size = size;
    p.color = color;
    p.sprite.tint = color;
    p.sprite.visible = true;
  }

  spawnRing(x: number, y: number, r0: number, r1: number, life: number, color: number, alpha: number): void {
    const r = this.rings.obtain();
    r.x = x;
    r.y = y;
    r.r0 = r0;
    r.r1 = r1;
    r.life = life;
    r.maxLife = life;
    r.color = color;
    r.sprite.tint = color;
    r.sprite.alpha = alpha;
    r.sprite.visible = true;
  }

  tryBurst(): boolean {
    return tryBurst(this);
  }

  getPanelDps(): number {
    return panelDps(this);
  }

  /** 共鸣值获取倍率（共鸣泉事件 ×2 + 密库 + 每日挑战） */
  gaugeMult(): number {
    return eventGaugeMult(this) * (1 + this.meta.gaugeGainPct) * (1 + this.run.gaugeGainPct);
  }

  /** 共鸣判定窗口（全局 + 密库 + 角色/每日） */
  resonanceWindow(): number {
    return BAL.resonance.window + this.meta.windowBonus + this.run.resWindowBonus;
  }

  /** 事件/系统用的对外伤害入口 */
  applyDamagePublic(e: Enemy, base: number, src: 'body' | 'echo', opts: { kb?: number; noRes?: boolean } = {}): void {
    applyDamage(this, e, base, src, opts);
  }

  /** 事件用的 XP 宝石掉落别名 */
  spawnXpGem(x: number, y: number): void {
    spawnGem(this, 0, x, y);
  }

  /** 生成一段残光轨迹（残光轨迹武器；本体/残影各自留痕） */
  spawnTrailSeg(x: number, y: number, life: number, src: 'body' | 'echo'): void {
    const t = this.trails.obtain();
    t.x = x;
    t.y = y;
    t.life = life;
    t.maxLife = life;
    t.src = src;
    t.sprite.tint = src === 'body' ? COLORS.needleBody : COLORS.needleEcho;
    t.sprite.rotation = this.rng.angle();
    t.sprite.visible = true;
  }
}
