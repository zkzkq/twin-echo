import { Application, Container, Sprite, TilingSprite } from 'pixi.js';
import { BAL } from '../config/balance';
import { AudioSys } from '../core/audio';
import { Telemetry } from '../core/telemetry';
import { COLORS, makeTextures, mixColor, TEX } from './textures';
import { UI, fmtTime, type SetupView } from './ui';
import { applyChoice, genChoices, type Choice } from './upgrades';
import { World, ECHO_BUF, type WorldEvent } from './world';
import { craftEvolution, satisfiableRecipes } from './altar';
import { eventLabel } from './events';
import { canBuy, computeBonuses, totalMetaCost } from './meta';
import { computeRunMods, type RunOptions } from './runconfig';
import { CHARACTERS, characterById } from '../config/characters';
import { PARADOX, paradoxSandMult } from '../config/paradox';
import { DAILY_FIRST_CLEAR_SAND, dailyCharacterId, dailyKey, dailySeed, dailyMod } from '../config/daily';
import { MAPS, mapById, mapUnlocked } from '../config/maps';
import { DIFFICULTIES } from '../config/difficulty';
import type { Obstacle } from './terrain';
import { META_BRANCHES, META_NODES, metaCost, metaPrereq } from '../config/meta';
import type { EvolutionDef } from '../config/items';

const STEP = 1000 / 60;

interface SaveData {
  sand: number;
  runs: number;
  bestTime: number;
  bestWin: boolean;
  firstRun: boolean;
  /** 已解锁的密库节点（GDD §6.8.2） */
  nodes: string[];
  /** M3：已用时砂解锁的角色 id */
  chars: string[];
  /** M3：已达成的挑战解锁（提克/诺恩） */
  challenges: string[];
  /** M3：已通关的最高悖论等级 */
  bestParadox: number;
  /** M3：每日挑战记录（日期键 → 最佳成绩）与已领奖日期 */
  dailyBest: Record<string, { time: number; kills: number; level: number }>;
  dailyCleared: string[];
  /** M3：已通关的地图 id（地图解锁链：通关第 i 张 → 解锁第 i+1 张） */
  mapsBeaten: string[];
}

interface DailyRecord {
  time: number;
  kills: number;
  level: number;
}

const SAVE_KEY = 'twinEcho.save';

type GameState = 'title' | 'run' | 'levelup' | 'pause' | 'result' | 'altar' | 'meta' | 'setup';

export class Game {
  readonly app = new Application();
  world!: World;
  ui!: UI;
  readonly audio = new AudioSys();
  readonly telemetry = new Telemetry();
  private tex!: TEX;
  private seed = 0;

  state: GameState = 'title';
  /** init() 完成标志（供 headless 测试等待；避免在 app 未就绪时求值） */
  ready = false;
  private keys = new Set<string>();
  private acc = 0;
  private frameCount = 0;
  private choices: Choice[] = [];
  /** 祭坛面板当前可做的进化（M2） */
  private altarOptions: EvolutionDef[] = [];
  /** 打开密库前的界面（用于返回） */
  private metaReturn: GameState = 'title';
  /** 打开配置面板前的界面（用于返回） */
  private setupReturn: GameState = 'title';
  /** 本局是否为每日挑战（用于结算奖励与榜单） */
  private runIsDaily = false;
  /** 挑战追踪：5 分钟内的最高等级（提克） */
  private lvAt5min = 0;
  private prevHp = 100;
  private rainbowIdx = 0;

  private worldC = new Container();
  private gemC = new Container();
  private enemyC = new Container();
  private bulletC = new Container();
  private playerC = new Container();
  private fxC = new Container();
  private bgTile!: TilingSprite;

  private saved: SaveData = {
    sand: 0, runs: 0, bestTime: 0, bestWin: false, firstRun: true, nodes: [],
    chars: [], challenges: [], bestParadox: 0, dailyBest: {}, dailyCleared: [], mapsBeaten: [],
  };
  /** M3：本局配置（角色 / 悖论 / 地图 / 是否每日挑战） */
  private runOptions: RunOptions = { character: 'otto', paradox: 0, daily: false, map: 'plain' };
  /** 障碍渲染精灵池 */
  private readonly obstacleSprites: Sprite[] = [];
  private obstacleScratch: Obstacle[] = [];

  async init(): Promise<void> {
    await this.app.init({
      background: '#0a0d13',
      resizeTo: window,
      antialias: true,
    });
    const appEl = document.getElementById('app');
    if (appEl) appEl.appendChild(this.app.canvas);

    this.tex = makeTextures(this.app.renderer);
    this.bgTile = new TilingSprite({
      texture: this.tex.tile,
      width: this.app.screen.width,
      height: this.app.screen.height,
    });
    this.app.stage.addChild(this.bgTile);
    this.worldC.addChild(this.gemC, this.enemyC, this.bulletC, this.playerC, this.fxC);
    this.app.stage.addChild(this.worldC);
    // 地形障碍精灵池（随相机附近区块动态绑定）
    for (let i = 0; i < 64; i++) {
      const s = new Sprite(this.tex.ring);
      s.anchor.set(0.5);
      s.visible = false;
      s.alpha = 0.9;
      this.gemC.addChild(s);
      this.obstacleSprites.push(s);
    }

    this.ui = new UI({
      start: () => this.startRun(),
      resume: () => this.togglePause(false),
      restart: () => this.startRun(),
      quit: () => this.toTitle(),
      again: () => this.startRun(),
      toTitle: () => this.toTitle(),
      reroll: () => this.doReroll(),
      skip: () => this.doSkip(),
      pick: (i) => this.doPick(i),
      exportCsv: () => this.telemetry.download(),
      evolve: (i) => this.doEvolve(i),
      altarSkip: () => this.closeAltar(),
      openMeta: () => this.openMeta(),
      closeMeta: () => this.closeMeta(),
      buyMeta: (id) => this.buyMeta(id),
      exportSave: () => this.exportSave(),
      importSave: () => this.importSave(),
      openSetup: () => this.openSetup(),
      closeSetup: () => this.closeSetup(),
      selectChar: (id) => this.selectChar(id),
      selectParadox: (lvl) => this.selectParadox(lvl),
      selectMap: (id) => this.selectMap(id),
      selectDifficulty: (id) => this.selectDifficulty(id),
      startDaily: () => this.startDaily(),
    });

    this.loadSave();

    this.world = new World(
      this.tex,
      this.audio,
      (ev) => this.onWorldEvent(ev),
      { gems: this.gemC, enemies: this.enemyC, bullets: this.bulletC, players: this.playerC, fx: this.fxC },
    );

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(normKey(e.key)));
    window.addEventListener('blur', () => {
      this.keys.clear();
      if (this.state === 'run') this.togglePause(true);
    });

    this.app.ticker.add((tk) => this.tick(tk));
    this.ui.showTitle();
    this.refreshTitleConfig();
    this.ready = true;
  }

  // ---------- 存档 ----------

  private loadSave(): void {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) this.saved = { ...this.saved, ...(JSON.parse(raw) as Partial<SaveData>) };
    } catch {
      /* 忽略损坏存档 */
    }
  }

  private save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.saved));
    } catch {
      /* 无 localStorage 时忽略 */
    }
  }

  // ---------- 输入 ----------

  private onKeyDown(e: KeyboardEvent): void {
    const k = normKey(e.key);
    if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) {
      this.keys.add(k);
      return;
    }
    this.keys.add(k);
    this.audio.ensure();

    switch (this.state) {
      case 'title':
        if (k === 'Enter') this.startRun();
        break;
      case 'run':
        if (k === 'p' || k === 'Escape') this.togglePause(true);
        else if (k === ' ' || k === 'e') this.world.tryBurst();
        break;
      case 'levelup':
        if (k === '1' || k === '2' || k === '3') this.doPick(Number(k) - 1);
        else if (k === 'r') this.doReroll();
        break;
      case 'altar':
        if (k === '1' || k === '2' || k === '3') this.doEvolve(Number(k) - 1);
        else if (k === 'escape') this.closeAltar();
        break;
      case 'setup':
        if (k === 'escape' || k === 'enter') this.closeSetup();
        break;
      case 'meta':
        if (k === 'escape' || k === 'enter') this.closeMeta();
        break;
      case 'pause':
        if (k === 'p' || k === 'Escape' || k === 'Enter') this.togglePause(false);
        else if (k === 'r') this.startRun();
        else if (k === 't') this.toTitle();
        break;
      case 'result':
        if (k === 'r' || k === 'Enter') this.startRun();
        else if (k === 't') this.toTitle();
        break;
    }
  }

  // ---------- 主循环 ----------

  private tick(tk: { deltaMS: number }): void {
    const dtMs = Math.min(tk.deltaMS, 100);
    this.frameCount++;

    // 输入轴
    const k = this.keys;
    const ax = (k.has('d') || k.has('ArrowRight') ? 1 : 0) - (k.has('a') || k.has('ArrowLeft') ? 1 : 0);
    const ay = (k.has('s') || k.has('ArrowDown') ? 1 : 0) - (k.has('w') || k.has('ArrowUp') ? 1 : 0);
    this.world.input.x = ax;
    this.world.input.y = ay;

    if (this.state === 'run') {
      this.acc += dtMs;
      let guard = 0;
      while (this.acc >= STEP && guard++ < 6) {
        this.world.update(1 / 60);
        this.acc -= STEP;
        if (this.state !== 'run') {
          this.acc = 0;
          break;
        }
      }
      // 挑战追踪：5 分钟时刻的等级（提克）
      if (this.world.time >= 300 && this.lvAt5min === 0) this.lvAt5min = this.world.player.level;
    }

    this.render(dtMs / 1000);
  }

  // ---------- 渲染同步 ----------

  private render(dtSec: number): void {
    const w = this.world;
    const scr = this.app.screen;
    w.viewW = scr.width;
    w.viewH = scr.height;

    // 相机跟随 + 屏震
    w.camX += (w.player.x - w.camX) * Math.min(1, dtSec * 6);
    w.camY += (w.player.y - w.camY) * Math.min(1, dtSec * 6);
    let ox = 0;
    let oy = 0;
    if (w.shake > 0) {
      w.shake = Math.max(0, w.shake - dtSec);
      const amp = w.shake * 24;
      ox = (Math.random() * 2 - 1) * amp;
      oy = (Math.random() * 2 - 1) * amp;
    }
    this.worldC.position.set(scr.width / 2 - w.camX + ox, scr.height / 2 - w.camY + oy);
    this.bgTile.width = scr.width;
    this.bgTile.height = scr.height;
    this.bgTile.tilePosition.set(scr.width / 2 - w.camX + ox, scr.height / 2 - w.camY + oy);
    this.bgTile.tint = w.mapDef.bgTint;

    // 地形障碍（地图 1/2/3 的齿轮与书架）：只同步相机附近区块
    const near = w.obstaclesNear(w.camX, w.camY, this.obstacleScratch);
    for (let i = 0; i < this.obstacleSprites.length; i++) {
      const s = this.obstacleSprites[i]!;
      const o: Obstacle | undefined = near[i];
      if (!o) {
        if (s.visible) s.visible = false;
        continue;
      }
      s.visible = true;
      s.position.set(o.x, o.y);
      s.scale.set(o.r / 40);
      s.tint = o.tint;
    }

    // 玩家 / 残影 / 拖尾
    const p = w.player;
    const ps = w.playerSprite;
    ps.visible = true;
    ps.position.set(p.x, p.y);
    ps.rotation = p.facing;
    ps.alpha = p.invulnT > 0 ? 0.45 + 0.35 * Math.sin(w.time * 40) : 1;

    const es = w.echoSprite;
    es.visible = true;
    es.position.set(w.echo.x, w.echo.y);
    es.rotation = w.echo.facing;
    es.alpha = 0.55;

    for (let i = 0; i < w.trailSprites.length; i++) {
      const ts = w.trailSprites[i]!;
      const back = 6 * (i + 1);
      const fa = w.echo.count - back; // 比残影更"新"的位置（残影行进方向的前段轨迹）
      if (fa >= 1) {
        const idx = (w.echo.head - fa + ECHO_BUF) % ECHO_BUF;
        ts.visible = true;
        ts.position.set(w.echo.bx[idx]!, w.echo.by[idx]!);
        ts.rotation = w.echo.br[idx]!;
      } else {
        ts.visible = false;
      }
    }

    // 敌人
    for (const e of w.enemies.items) {
      const s = e.sprite;
      if (!e.active) {
        if (s.visible) s.visible = false;
        if (e.ring && e.ring.visible) e.ring.visible = false;
        continue;
      }
      s.visible = true;
      s.position.set(e.x, e.y);
      const baseScale = (e.elite ? BAL.elite.sizeMult : 1) * (e.boss ? 1.5 : 1);
      if (e.flashT > 0) {
        s.tint = 0xffffff;
        s.scale.set(baseScale * 1.15);
      } else if (e.tele) {
        const ph = 0.5 + 0.5 * Math.sin(performance.now() * 0.02);
        s.tint = mixColor(e.tint, 0xff5040, ph);
        s.scale.set(baseScale);
      } else {
        s.tint = e.tint;
        s.scale.set(baseScale);
      }
      if (e.ring) {
        e.ring.visible = e.elite;
        if (e.elite) e.ring.position.set(e.x, e.y);
      }
    }

    // 弹幕
    for (const b of w.bullets.items) {
      const s = b.sprite;
      if (!b.active) {
        if (s.visible) s.visible = false;
        continue;
      }
      s.visible = true;
      s.position.set(b.x, b.y);
      if (b.kind === 'butterfly') {
        s.rotation += dtSec * 12;
        const sc = 0.8 + 0.25 * Math.sin(this.frameCount * 0.6);
        s.scale.set(sc, 1);
      } else {
        s.rotation = Math.atan2(b.vy, b.vx);
        s.scale.set(1);
      }
    }

    // 宝石（虹宝石色相循环）
    this.rainbowIdx = Math.floor(w.time * 8) % COLORS.rainbow.length;
    for (const g of w.gems.items) {
      const s = g.sprite;
      if (!g.active) {
        if (s.visible) s.visible = false;
        continue;
      }
      s.visible = true;
      s.position.set(g.x, g.y);
      if (g.tier === 3 && g.heal === 0) s.tint = COLORS.rainbow[this.rainbowIdx]!;
    }

    // 粒子
    for (const pa of w.parts.items) {
      const s = pa.sprite;
      if (!pa.active) {
        if (s.visible) s.visible = false;
        continue;
      }
      pa.life -= dtSec;
      if (pa.life <= 0) {
        w.parts.release(pa);
        s.visible = false;
        continue;
      }
      pa.x += pa.vx * dtSec;
      pa.y += pa.vy * dtSec;
      pa.vx *= 0.92;
      pa.vy *= 0.92;
      s.visible = true;
      s.position.set(pa.x, pa.y);
      s.alpha = Math.max(0, pa.life / pa.maxLife);
      s.scale.set(pa.size / 2);
    }

    // 扩散圆环
    for (const r of w.rings.items) {
      const s = r.sprite;
      if (!r.active) {
        if (s.visible) s.visible = false;
        continue;
      }
      r.life -= dtSec;
      if (r.life <= 0) {
        w.rings.release(r);
        s.visible = false;
        continue;
      }
      const k = 1 - r.life / r.maxLife;
      const rr = r.r0 + (r.r1 - r.r0) * k;
      s.visible = true;
      s.position.set(r.x, r.y);
      s.scale.set(rr / 40);
      s.alpha = (1 - k) * 0.9;
    }

    // 危险区（双生回响兽镜像刃 / 地图危险区）：预警期闪烁，生效期呼吸
    for (const h of w.hazards.items) {
      const s = h.sprite;
      if (!h.active) {
        if (s.visible) s.visible = false;
        continue;
      }
      s.visible = true;
      s.position.set(h.x, h.y);
      s.scale.set(h.r / 40);
      s.alpha = h.tele > 0
        ? 0.25 + 0.22 * Math.sin(this.frameCount * 0.55)
        : 0.5 + 0.18 * Math.sin(this.frameCount * 0.2);
    }

    // 受击闪屏
    if (this.state === 'run' && p.hp < this.prevHp - 0.01) this.ui.flashHurt();
    this.prevHp = p.hp;

    // HUD
    if (this.state !== 'title') {
      this.telemetry.observe(w.enemies.count);
      this.ui.updateHud(w);
      this.ui.bossBar(w.boss !== null && w.boss.active, w.boss ? w.boss.hp / w.boss.maxHp : 0, this.bossName());
    }
  }

  // ---------- 事件 ----------

  /** 当前 Boss 名（HUD 用） */
  private bossName(): string {
    const b = this.world.boss;
    if (!b) return '';
    return BAL.bosses.find((x) => x.kind === b.bossKind)?.name ?? 'Boss';
  }

  private onWorldEvent(ev: WorldEvent): void {
    switch (ev) {
      case 'levelup': {
        this.state = 'levelup';
        this.choices = genChoices(this.world);
        // §9 教学：首局首次升级自动暂停 + 高亮推荐项（命运加权已保证 ≥1 项可用）
        const rec = this.world.firstRun && this.world.stats.levelsGained <= 1 ? 0 : -1;
        this.telemetry.log(this.world.time, 'levelup_shown', {
          level: this.world.player.level,
          choices: this.choices.map((c) => `${c.id}:${c.lv}->${c.lv + 1}`).join('|'),
        });
        this.ui.showLevelUp(this.choices, this.world.rerolls, rec);
        break;
      }
      case 'death':
        this.finishRun(false);
        break;
      case 'victory':
        this.finishRun(true);
        break;
      case 'boss-warn':
        this.ui.toast('⚠ 时空裂隙震动——强敌即将袭来', 'red');
        this.audio.warn();
        break;
      case 'boss-spawn': {
        this.ui.toast(`${this.bossName()} 现身！`, 'red');
        // 双生回响兽：主动提示它的机制，否则玩家不会理解"为什么要错位"
        if (this.world.boss?.bossKind === 'twin') {
          this.ui.toast('延迟领域：你的残影延迟 +2s —— 它会沿你 4 秒前的走法攻击，别站在自己走过的路上', 'red');
        }
        this.telemetry.log(this.world.time, 'boss_spawn', { boss: this.bossName() });
        break;
      }
      case 'boss-dead':
        this.ui.toast(`${this.bossName() || 'Boss'} 已被抹除——掉落回响结晶 ×2`, 'cyan');
        break;
      case 'elite-dead':
        this.ui.toast('精英崩解——掉落回响结晶 ×1（进化材料）');
        if (!this.world.flags.firstEliteToasted) {
          this.world.flags.firstEliteToasted = true;
          // §9 教学 3:30：精英 → 结晶 → 祭坛（不做前置教学，仅此一次提示）
          this.ui.toast('集齐结晶后，走到 8/13/18 分钟刷新的祭坛即可进化武器', 'cyan');
        }
        this.telemetry.log(this.world.time, 'elite_dead', { count: this.world.stats.elitesKilled });
        break;
      case 'first-resonance':
        this.ui.toast(
          `共鸣击！你和残影在 1 秒内命中了同一个敌人（伤害 ×${BAL.resonance.dmgMult} · 共鸣值 +${BAL.resonance.gaugeGain}）`,
          'cyan',
        );
        break;
      case 'gauge-full':
        this.ui.toast('共鸣值已满——按 空格 释放同步爆发！', 'cyan');
        break;
      case 'burst':
        this.ui.flashBurst();
        this.telemetry.log(this.world.time, 'burst_cast', {
          gaugeBefore: 100,
          enemies: this.world.enemies.count,
          kills: this.world.stats.kills,
        });
        break;
      case 'rush':
        this.ui.toast('静滞潮汐达到峰值——坚持到最后！', 'red');
        break;
      case 'hint-move':
        this.ui.toast('移动：WASD / 方向键 —— 青色残影会重演你 2.5 秒前的行动', 'cyan');
        break;
      case 'revive':
        this.ui.toast('回响护住了你 —— 首局免费复活（GDD §9 新手保底，限 1 次）', 'cyan');
        this.audio.levelup();
        this.telemetry.log(this.world.time, 'revive', { hp: Math.round(this.world.player.maxHp * 0.5) });
        break;

      // ---- M2：结晶 / 祭坛 / 进化 / 事件 ----
      case 'crystal-picked':
        this.ui.toast(`回响结晶 ×${this.world.player.crystals}（进化需 ×2）`, 'cyan');
        this.telemetry.log(this.world.time, 'crystal_picked', { total: this.world.player.crystals });
        break;
      case 'altar-spawn':
        this.ui.toast('祭坛已刷新（8/13/18 分钟）——集齐「武器满级 + 配方被动满级 + 结晶 ×2」即可进化', 'cyan');
        this.telemetry.log(this.world.time, 'altar_spawn', {});
        break;
      case 'altar-enter':
        this.telemetry.log(this.world.time, 'altar_enter', {});
        break;
      case 'altar-ready':
        this.openAltar();
        break;
      case 'altar-unmet': {
        const p = this.world.player;
        const need: string[] = [];
        if (p.crystals < 2) need.push(`结晶 ×2（持有 ${p.crystals}）`);
        need.push('对应武器 Lv6 + 配方被动 Lv5');
        this.ui.toast(`祭坛条件未满足：需要 ${need.join(' · ')}`);
        this.telemetry.log(this.world.time, 'altar_unmet', { crystals: p.crystals });
        break;
      }
      case 'evolved':
        this.ui.toast(`进化完成！已解锁 ${this.evolvedLabel()}`, 'cyan');
        this.telemetry.log(this.world.time, 'evolution', { list: [...this.world.player.evolutions].join('|') });
        break;
      case 'event-start':
        this.ui.toast(`事件：${eventLabel(this.world.eventKind ?? 'tide')}`, 'cyan');
        this.telemetry.log(this.world.time, 'event_start', { kind: this.world.eventKind });
        break;
      case 'event-end':
        this.telemetry.log(this.world.time, 'event_end', {});
        break;
    }
  }

  private evolvedLabel(): string {
    const ids = [...this.world.player.evolutions];
    const names = ids.map((id) => this.altarOptions.find((e) => e.id === id)?.name ?? id);
    return names.join('、') || '——';
  }

  /** 打开进化面板（祭坛引导完成且条件满足） */
  private openAltar(): void {
    const options = satisfiableRecipes(this.world);
    if (options.length === 0) return;
    this.altarOptions = options;
    this.state = 'altar';
    this.ui.showAltar(
      options.map((o) => ({ name: o.name, desc: o.desc, crystals: this.world.player.crystals })),
    );
    this.telemetry.log(this.world.time, 'altar_ready', { options: options.map((o) => o.id).join('|') });
  }

  doEvolve(i: number): void {
    if (this.state !== 'altar') return;
    const evo = this.altarOptions[i];
    if (!evo) return;
    craftEvolution(this.world, evo.id);
    this.ui.hideAltar();
    this.ui.renderSlots(this.world);
    this.state = 'run';
    this.acc = 0;
  }

  private closeAltar(): void {
    if (this.state !== 'altar') return;
    this.ui.hideAltar();
    this.state = 'run';
    this.acc = 0;
  }

  // ---------- 角色 / 悖论 / 每日挑战（M3） ----------

  /** 角色是否已解锁：初始(cost=0 且无挑战) / 时砂购买 / 挑战达成 */
  private charUnlocked(id: string): boolean {
    const c = characterById(id);
    if (c.challenge) return this.saved.challenges.includes(c.challenge.key);
    if (c.cost === 0) return true;
    return this.saved.chars.includes(id);
  }

  /** 悖论等级 n 是否解锁：需已在 n−1 级获胜（n=0 恒开） */
  private paradoxUnlocked(lvl: number): boolean {
    return lvl <= this.saved.bestParadox + (this.saved.bestWin ? 1 : 0) || lvl === 0;
  }

  private setupView(): SetupView {
    const key = dailyKey();
    const dm = dailyMod(key);
    const dailyChar = dailyCharacterId(key, CHARACTERS.map((c) => c.id));
    const rec = this.saved.dailyBest[key];
    return {
      sand: this.saved.sand,
      characters: CHARACTERS.map((c) => {
        const unlocked = this.charUnlocked(c.id);
        const selected = this.runOptions.character === c.id;
        let costLabel: string;
        if (selected) costLabel = '出战中';
        else if (c.challenge) costLabel = unlocked ? '已解锁（点击选择）' : c.challenge.desc;
        else if (c.cost === 0) costLabel = '初始角色';
        else if (unlocked) costLabel = '已解锁';
        else costLabel = `解锁需 ${c.cost} 时砂`;
        return {
          id: c.id, name: c.name, glyph: c.glyph, role: c.role, trait: c.traitNote,
          state: selected ? 'selected' : unlocked ? 'owned' : 'buyable',
          costLabel,
        };
      }),
      paradox: PARADOX.map((p) => ({
        lvl: p.lvl, name: p.name, desc: p.desc,
        state: this.runOptions.paradox === p.lvl ? 'selected' : this.paradoxUnlocked(p.lvl) ? 'owned' : 'locked',
      })),
      daily: {
        key,
        modName: dm.name,
        modDesc: dm.desc,
        charName: characterById(dailyChar).name,
        best: rec ? `${fmtTime(rec.time)} · 击杀 ${rec.kills} · Lv${rec.level}` : '暂无记录',
        cleared: this.saved.dailyCleared.includes(key),
      },
      maps: MAPS.map((m) => {
        const unlocked = mapUnlocked(m.id, this.saved.mapsBeaten);
        return {
          id: m.id, name: m.name, desc: m.desc,
          state: this.runOptions.map === m.id ? 'selected' : unlocked ? 'owned' : 'locked',
          beaten: this.saved.mapsBeaten.includes(m.id),
        };
      }),
      difficulty: DIFFICULTIES.map((d) => ({
        id: d.id, name: d.name, desc: d.desc, selected: (this.runOptions.difficulty ?? 'standard') === d.id,
      })),
    };
  }

  openSetup(): void {
    this.setupReturn = this.state;
    this.state = 'setup';
    this.ui.showSetup(this.setupView());
  }

  private closeSetup(): void {
    if (this.state !== 'setup') return;
    this.ui.hideSetup();
    this.state = this.setupReturn;
    this.refreshTitleConfig();
  }

  private refreshTitleConfig(): void {
    const c = characterById(this.runOptions.character);
    const p = PARADOX[this.runOptions.paradox]!;
    this.ui.setTitleConfig(
      `出战角色 <b>${c.name}</b>（${c.role}） · 悖论 <b>${p.lvl} ${p.name}</b> · 密库 <i>${this.saved.nodes.length}</i> 节点 · 时砂 <i>${this.saved.sand}</i>`,
    );
  }

  /** 选择角色：已解锁直接切换；未解锁则尝试用时砂购买（挑战角色需达成条件） */
  selectChar(id: string): void {
    const c = characterById(id);
    if (this.charUnlocked(id)) {
      this.runOptions.character = id;
      this.ui.showSetup(this.setupView());
      return;
    }
    if (c.challenge) {
      this.ui.toast(`「${c.name}」需完成挑战：${c.challenge.desc}`);
      return;
    }
    if (this.saved.sand < c.cost) {
      this.ui.toast(`时砂不足：解锁「${c.name}」需 ${c.cost}（持有 ${this.saved.sand}）`);
      return;
    }
    this.saved.sand -= c.cost;
    this.saved.chars.push(id);
    this.runOptions.character = id;
    this.save();
    this.telemetry.log(0, 'char_unlock', { id, cost: c.cost, sand: this.saved.sand });
    this.ui.toast(`已解锁并选择「${c.name}」`, 'cyan');
    this.ui.showSetup(this.setupView());
  }

  selectParadox(lvl: number): void {
    if (!this.paradoxUnlocked(lvl)) {
      this.ui.toast(`悖论 ${lvl} 未解锁：需先在悖论 ${lvl - 1} 获胜`);
      return;
    }
    this.runOptions.paradox = lvl;
    this.ui.showSetup(this.setupView());
  }

  /** 选择地图（解锁链：通关上一张才开下一张） */
  selectMap(id: string): void {
    if (!mapUnlocked(id, this.saved.mapsBeaten)) {
      const idx = MAPS.findIndex((m) => m.id === id);
      this.ui.toast(`「${mapById(id).name}」未解锁：需先通关「${MAPS[idx - 1]?.name ?? '上一张地图'}」`);
      return;
    }
    this.runOptions.map = id;
    this.ui.showSetup(this.setupView());
  }

  /** 选择难度预设（M3 校准工具） */
  selectDifficulty(id: string): void {
    this.runOptions.difficulty = id;
    this.ui.showSetup(this.setupView());
  }

  startDaily(): void {
    this.ui.hideSetup();
    this.startRun(true);
  }

  // ---------- 回响密库（GDD §6.8.2，M2 骨架） ----------

  /** 打开密库面板（标题页 / 结算页） */
  openMeta(): void {
    this.metaReturn = this.state;
    this.state = 'meta';
    this.ui.showMeta(this.metaView());
  }

  private closeMeta(): void {
    if (this.state !== 'meta') return;
    this.ui.hideMeta();
    this.state = this.metaReturn;
  }

  private metaView(): Parameters<UI['showMeta']>[0] {
    const unlocked = this.saved.nodes;
    return {
      sand: this.saved.sand,
      totalCost: totalMetaCost(),
      nodes: META_NODES.map((n) => {
        const pre = metaPrereq(n);
        const status = unlocked.includes(n.id)
          ? 'owned'
          : this.saved.sand >= metaCost(n.depth) && (!pre || unlocked.includes(pre.id))
            ? 'buyable'
            : 'locked';
        return {
          id: n.id,
          branch: n.branch,
          name: n.name,
          desc: n.desc,
          cost: metaCost(n.depth),
          status: status as 'owned' | 'buyable' | 'locked',
          reqName: pre && !unlocked.includes(pre.id) ? pre.name : '',
        };
      }),
      branches: [...META_BRANCHES],
    };
  }

  /** 购买节点：扣时砂 → 写存档（局外即时生效，下一局开始应用） */
  buyMeta(id: string): void {
    const check = canBuy(this.saved.nodes, id, this.saved.sand);
    if (!check.ok) {
      this.ui.toast(`无法解锁：${check.reason}`);
      return;
    }
    const node = META_NODES.find((n) => n.id === id)!;
    this.saved.sand -= metaCost(node.depth);
    this.saved.nodes.push(id);
    this.save();
    this.telemetry.log(0, 'meta_spend', { node: id, cost: metaCost(node.depth), sand: this.saved.sand });
    this.ui.toast(`已解锁「${node.name}」——下一局生效`, 'cyan');
    this.ui.showMeta(this.metaView());
  }

  /** 导出/导入存档码（GDD §11.2：localStorage + 导出码 → M3 接 Steam Cloud） */
  exportSave(): void {
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(this.saved))));
    void navigator.clipboard?.writeText(code).then(
      () => this.ui.toast('存档码已复制到剪贴板（含时砂与密库进度）', 'cyan'),
      () => this.ui.toast(`存档码：${code.slice(0, 60)}…（复制失败，请手动选取）`),
    );
  }

  importSave(): void {
    const code = window.prompt('粘贴存档码（会覆盖当前进度）');
    if (!code) return;
    try {
      const data = JSON.parse(decodeURIComponent(escape(atob(code.trim())))) as Partial<SaveData>;
      if (typeof data.sand !== 'number' || !Array.isArray(data.nodes)) throw new Error('格式不符');
      this.saved = { ...this.saved, ...data, nodes: data.nodes.filter((n) => typeof n === 'string') };
      this.save();
      this.ui.toast(`存档已导入：时砂 ${this.saved.sand}、密库 ${this.saved.nodes.length} 节点`, 'cyan');
      if (this.state === 'meta') this.ui.showMeta(this.metaView());
    } catch (e) {
      this.ui.toast(`存档码无效：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---------- 流程 ----------

  startRun(asDaily = false): void {
    const daily = asDaily;
    this.runIsDaily = daily;
    this.runOptions.daily = daily;
    const key = dailyKey();
    // 每日挑战：固定种子 + 固定角色（保证同日榜单可比）
    this.seed = daily
      ? dailySeed(key)
      : (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    if (daily) {
      this.runOptions.character = dailyCharacterId(key, CHARACTERS.map((c) => c.id));
      this.runOptions.paradox = 0;
      this.runOptions.map = 'plain'; // 每日固定地图，保证榜单可比
    }
    const mods = computeRunMods(this.runOptions);
    this.world.reset(this.seed, this.saved.firstRun, computeBonuses(this.saved.nodes), mods);
    this.telemetry.runStart(this.seed, this.saved.firstRun);
    this.telemetry.log(0, 'run_config', {
      character: mods.character, paradox: mods.paradox, daily, map: mods.map,
      difficulty: mods.difficulty, dailyMod: mods.dailyModName,
      echoDelay: mods.echoDelayFrames, choiceCount: mods.choiceCount,
    });
    if (this.saved.firstRun) {
      // §9 教学 0:00–0:10：移动是第一课（强提示 + 敌人从四周来）
      this.ui.toast('移动：W A S D / 方向键 —— 敌人会从四周涌来，别停下', 'cyan');
    }
    if (daily) this.ui.toast(`每日挑战：${mods.dailyModName} —— ${mods.dailyModDesc}`, 'cyan');
    this.ui.hideAll();
    this.ui.showHud();
    this.ui.renderSlots(this.world);
    this.state = 'run';
    this.acc = 0;
    this.prevHp = this.world.player.hp;
    this.audio.ensure();
  }

  toTitle(): void {
    this.state = 'title';
    this.ui.hideAll();
    this.ui.showTitle();
    this.refreshTitleConfig();
  }

  togglePause(on: boolean): void {
    if (on && this.state === 'run') {
      this.state = 'pause';
      this.ui.showPause(this.world);
    } else if (!on && this.state === 'pause') {
      this.state = 'run';
      this.ui.hidePause();
      this.acc = 0;
    }
  }

  doPick(i: number): void {
    if (this.state !== 'levelup' || i < 0 || i >= this.choices.length) return;
    const c = this.choices[i]!;
    this.telemetry.log(this.world.time, 'levelup_choice', {
      cardIndex: i, id: c.id, kind: c.kind, lv: c.lv + 1, tag: c.tagLabel, isNew: c.isNew,
    });
    applyChoice(this.world, c);
    this.ui.hideLevelUp();
    this.ui.renderSlots(this.world);
    this.state = 'run';
    this.acc = 0;
  }

  doReroll(): void {
    if (this.state !== 'levelup' || this.world.rerolls <= 0) return;
    this.world.rerolls--;
    this.telemetry.countReroll();
    this.telemetry.log(this.world.time, 'levelup_reroll', { left: this.world.rerolls });
    this.choices = genChoices(this.world);
    this.ui.showLevelUp(this.choices, this.world.rerolls);
  }

  doSkip(): void {
    if (this.state !== 'levelup') return;
    this.world.stats.skipped++;
    this.telemetry.log(this.world.time, 'levelup_skip', { level: this.world.player.level });
    this.ui.hideLevelUp();
    this.state = 'run';
    this.acc = 0;
  }

  /** 挑战解锁检查（提克：5 分钟内达 Lv12；诺恩：单局同步爆发 ≥10 次） */
  private checkChallenges(win: boolean): string {
    const w = this.world;
    const done: string[] = [];
    if (this.lvAt5min >= 12 && !this.saved.challenges.includes('lv12in5')) {
      this.saved.challenges.push('lv12in5');
      done.push('神童·提克');
    }
    if (w.stats.bursts >= 10 && !this.saved.challenges.includes('burst10')) {
      this.saved.challenges.push('burst10');
      done.push('完美回响·诺恩');
    }
    void win;
    return done.length > 0 ? `挑战达成，解锁角色：${done.join('、')}` : '';
  }

  private finishRun(win: boolean): void {
    this.state = 'result';
    const w = this.world;
    const st = w.stats;
    const minutes = w.time / 60;
    const sandBase = BAL.sand(minutes, st.kills, st.elitesKilled, st.bossKills, win) + st.sandBonus;
    // 密库「贪婪」支线 × 角色（皮普）× 悖论等级（每级 +10%）
    const sand = Math.round(
      sandBase
        * (1 + w.meta.sandPct + w.run.sandPct)
        * (win ? 1 + w.meta.winSandPct : 1)
        * paradoxSandMult(w.run.paradox),
    );
    this.saved.sand += sand;
    this.saved.runs++;
    if (w.time > this.saved.bestTime) this.saved.bestTime = w.time;
    if (win) this.saved.bestWin = true;

    // M3：悖论解锁（在 N 级获胜 → 解锁 N+1）与地图解锁链
    let paradoxUnlocked = false;
    if (win && w.run.paradox >= this.saved.bestParadox) {
      this.saved.bestParadox = Math.min(5, w.run.paradox + 1);
      paradoxUnlocked = true;
    }
    let mapMsg = '';
    if (win && !this.saved.mapsBeaten.includes(w.run.map)) {
      this.saved.mapsBeaten.push(w.run.map);
      const idx = MAPS.findIndex((m) => m.id === w.run.map);
      const next = MAPS[idx + 1];
      mapMsg = next ? `地图「${next.name}」已解锁` : '全部地图已通关';
    }
    const challengeMsg = this.checkChallenges(win);

    // M3：每日挑战结算（本地榜 + 首通奖励，同日只发一次，防刷）
    let dailyMsg = '';
    if (this.runIsDaily) {
      const key = dailyKey();
      const prev = this.saved.dailyBest[key];
      const better = !prev || w.time > prev.time || (w.time === prev.time && st.kills > prev.kills);
      if (better) this.saved.dailyBest[key] = { time: Math.round(w.time), kills: st.kills, level: w.player.level };
      if (win && !this.saved.dailyCleared.includes(key)) {
        this.saved.dailyCleared.push(key);
        this.saved.sand += DAILY_FIRST_CLEAR_SAND;
        dailyMsg = `每日首通 +${DAILY_FIRST_CLEAR_SAND} 时砂`;
      } else {
        dailyMsg = better ? '已刷新今日记录' : '今日记录未超过';
      }
    }

    this.saved.firstRun = false;
    this.save();

    const cov = st.hits > 0 ? Math.round((st.resHits / st.hits) * 1000) / 10 : 0;
    const resonancePerMin = w.time > 0 ? Math.round((st.resHits / w.time) * 60 * 10) / 10 : 0;
    const evolutions = [...w.player.evolutions].join('|');
    this.telemetry.log(w.time, 'run_meta', {
      character: w.run.character, paradox: w.run.paradox, daily: this.runIsDaily,
      paradoxUnlocked, challengeMsg: challengeMsg || '', dailyMsg,
    });
    this.telemetry.runEnd({
      seed: this.seed,
      firstRun: w.firstRun,
      win,
      time: Math.round(w.time * 10) / 10,
      level: w.player.level,
      kills: st.kills,
      hits: st.hits,
      resonanceHits: st.resHits,
      coverage: cov,
      resonancePerMin,
      bursts: st.bursts,
      elitesSpawned: st.elitesSpawned,
      elitesKilled: st.elitesKilled,
      bossKills: st.bossKills,
      damageTaken: Math.round(st.damageTaken),
      revives: w.revives,
      skipped: st.skipped,
      sand,
      weapons: [...w.player.weapons].map(([k, v]) => `${k}:${v.lv}`).join('|'),
      passives: [...w.player.passives].map(([k, v]) => `${k}:${v}`).join('|'),
      crystals: w.player.crystals,
      evolutions,
      altarReached: st.altarReached,
      altarCrafted: st.altarCrafted,
      eventsFired: st.eventsFired,
      deathX: Math.round(w.player.x),
      deathY: Math.round(w.player.y),
    });

    this.ui.showResult({
      win,
      time: w.time,
      level: w.player.level,
      kills: st.kills,
      resHits: st.resHits,
      hits: st.hits,
      resonancePerMin,
      bursts: st.bursts,
      elites: st.elitesKilled,
      bossKills: st.bossKills,
      crystals: w.player.crystals,
      evolutions: [...w.player.evolutions]
        .map((id) => this.altarOptions.find((e) => e.id === id)?.name ?? id)
        .join('、'),
      character: characterById(w.run.character).name,
      paradox: w.run.paradox,
      mapName: mapById(w.run.map).name,
      dailyMod: this.runIsDaily ? w.run.dailyModName : '',
      unlockMsg: [challengeMsg, paradoxUnlocked ? `悖论 ${this.saved.bestParadox} 已解锁` : '', mapMsg, dailyMsg]
        .filter(Boolean)
        .join(' · '),
      sand,
      totalSand: this.saved.sand,
      bestTime: this.saved.bestTime,
      runs: this.saved.runs,
    });
    if (win) this.audio.victory();
    else this.audio.defeat();
  }
}

function normKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}
