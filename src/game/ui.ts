import { PASSIVES, WEAPONS, passiveById, weaponById } from '../config/items';
import { BAL } from '../config/balance';
import { eventLabel } from './events';
import type { World } from './world';
import type { Choice } from './upgrades';

export interface UIHandlers {
  start(): void;
  resume(): void;
  restart(): void;
  quit(): void;
  again(): void;
  toTitle(): void;
  reroll(): void;
  skip(): void;
  pick(i: number): void;
  exportCsv(): void;
  evolve(i: number): void;
  altarSkip(): void;
  openMeta(): void;
  closeMeta(): void;
  openCodex(): void;
  closeCodex(): void;
  buyMeta(id: string): void;
  exportSave(): void;
  exportReport(): void;
  /** M3 作弊码：执行一条并返回结果（UI 只负责把文本送进去） */
  inputCheat(text: string): void;
  importSave(): void;
  openSetup(): void;
  closeSetup(): void;
  selectChar(id: string): void;
  selectParadox(lvl: number): void;
  selectMap(id: string): void;
  selectDifficulty(id: string): void;
  startDaily(): void;
}

/** 角色/悖论/每日配置面板视图 */
export interface SetupCharView {
  id: string; name: string; glyph: string; role: string; trait: string;
  state: 'selected' | 'owned' | 'buyable' | 'locked';
  costLabel: string;
}
export interface SetupView {
  sand: number;
  characters: SetupCharView[];
  paradox: { lvl: number; name: string; desc: string; state: 'selected' | 'owned' | 'locked' }[];
  maps: { id: string; name: string; desc: string; state: 'selected' | 'owned' | 'locked'; beaten: boolean }[];
  difficulty: { id: string; name: string; desc: string; selected: boolean }[];
  daily: { key: string; modName: string; modDesc: string; charName: string; best: string; cleared: boolean };
}

/** 密库面板视图数据 */
export interface MetaNodeView {
  id: string;
  branch: string;
  name: string;
  desc: string;
  cost: number;
  status: 'owned' | 'buyable' | 'locked';
  reqName: string;
}

export interface MetaView {
  sand: number;
  totalCost: number;
  nodes: MetaNodeView[];
  branches: string[];
}

export interface ResultData {
  win: boolean;
  time: number;
  level: number;
  kills: number;
  resHits: number;
  hits: number;
  /** 主 KPI（M2 口径）：共鸣击频率 = 共鸣击 / 分钟 */
  resonancePerMin: number;
  /** M3「编队走位」两个诊断量：双影夹击次数 / 回响同步时间占比(%) */
  pincerHits: number;
  syncPct: number;
  /** M3：最长连续同步时长（秒）与结算时对应的 ramp 增益(%) */
  syncMaxStreak: number;
  syncBonusPct: number;
  /** M3：本局是否用过作弊码（结算页给出明确标记） */
  cheated: boolean;
  bursts: number;
  elites: number;
  bossKills: number;
  crystals: number;
  evolutions: string;
  /** M3：本局配置与解锁提示 */
  character: string;
  paradox: number;
  mapName: string;
  dailyMod: string;
  unlockMsg: string;
  sand: number;
  totalSand: number;
  bestTime: number;
  runs: number;
}

function $<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export class UI {
  private hud = $('hud');
  private hpbar = $('hpbar');
  private hptext = $('hptext');
  private clock = $('clock');
  private xpbar = $('xpbar');
  private lvtext = $('lvtext');
  private resonance = $('resonance');
  private resRing = $('resRing');
  private resKey = $('resKey');
  private wslots = $('wslots');
  private pslots = $('pslots');
  private bossbar = $('bossbar');
  private bossfill = $('bossfill');
  private bossname = $('bossname');
  private crystaltext = $('crystaltext');
  private synctext = $('synctext');
  private domaintext = $('domaintext');
  /** 同步态缓存：只在状态翻转时改 className（避免每帧写 DOM 样式） */
  private syncShown = false;
  /** 领域态缓存（诺诺的静止织机） */
  private domainShown = false;
  private altarhint = $('altarhint');
  private eventtext = $('eventtext');
  private altar = $('altar');
  private altarCards = $('altarCards');
  private meta = $('meta');
  private metaSand = $('metaSand');
  private metaProgress = $('metaProgress');
  private metaBranches = $('metaBranches');
  private setupEl = $('setup');
  private setupChars = $('setupChars');
  private setupParadox = $('setupParadox');
  private setupDaily = $('setupDaily');
  private setupMaps = $('setupMaps');
  private setupDiff = $('setupDiff');
  private setupSand = $('setupSand');
  private titleConfig = $('titleConfig');
  private toasts = $('toasts');
  private title = $('title');
  /** M3 图鉴 */
  private codex = $('codex');
  private codexList = $('codexList');
  private codexProgress = $('codexProgress');
  private achvList = $('achvList');
  private achvProgress = $('achvProgress');
  /** M3 作弊码 */
  private cheatInput = $('cheatInput') as HTMLInputElement;
  private cheatResult = $('cheatResult');
  private cheattext = $('cheattext');
  private levelup = $('levelup');
  private cards = $('cards');
  private pause = $('pause');
  private pauseStats = $('pauseStats');
  private result = $('result');
  private resTitle = $('resTitle');
  private resEyebrow = $('resEyebrow');
  private resultStats = $('resultStats');
  private resHint = $('resHint');
  private hurtfx = $('hurtfx');
  private burstfx = $('burstfx');
  private btnReroll = $('btnReroll') as HTMLButtonElement;

  constructor(private h: UIHandlers) {
    $('btnStart').onclick = () => h.start();
    $('btnResume').onclick = () => h.resume();
    $('btnRestart').onclick = () => h.restart();
    $('btnQuit').onclick = () => h.quit();
    $('btnAgain').onclick = () => h.again();
    $('btnTitle').onclick = () => h.toTitle();
    $('btnReroll').onclick = () => h.reroll();
    $('btnSkip').onclick = () => h.skip();
    $('btnExport').onclick = () => h.exportCsv();
    $('btnAltarSkip').onclick = () => h.altarSkip();
    $('btnMetaTitle').onclick = () => h.openMeta();
    $('btnMetaResult').onclick = () => h.openMeta();
    $('btnMetaClose').onclick = () => h.closeMeta();
    $('btnCodexTitle').onclick = () => h.openCodex();
    $('btnCodexClose').onclick = () => h.closeCodex();
    // 作弊码输入（M3）：回车或点按钮执行；输入框内的按键不再冒泡给游戏（否则打字会触发重开/选卡）
    const submitCheat = (): void => {
      const v = this.cheatInput.value;
      this.cheatInput.value = '';
      if (v.trim()) h.inputCheat(v);
    };
    this.cheatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        submitCheat();
      }
    });
    $('btnCheat').onclick = () => submitCheat();
    $('btnMetaExport').onclick = () => h.exportSave();
    $('btnReport').onclick = () => h.exportReport();
    $('btnMetaImport').onclick = () => h.importSave();
    $('btnSetup').onclick = () => h.openSetup();
    $('btnSetupClose').onclick = () => h.closeSetup();
    $('btnDailyStart').onclick = () => h.startDaily();
  }

  /** 角色 / 悖论 / 每日挑战配置面板（M3） */
  showSetup(v: SetupView): void {
    this.setupSand.textContent = `${v.sand}`;
    this.setupChars.innerHTML = v.characters
      .map(
        (c) => `<button class="charcard ${c.state === 'selected' ? 'selected' : ''} ${c.state === 'locked' ? 'locked' : ''}" data-id="${c.id}">
          <span class="cc-top"><span class="cc-name">${c.name}</span><span class="cc-glyph">${c.glyph}</span></span>
          <span class="cc-role">${c.role}</span>
          <span class="cc-trait">${c.trait}</span>
          <span class="cc-cost">${c.costLabel}</span>
        </button>`,
      )
      .join('');
    this.setupChars.querySelectorAll('.charcard').forEach((el) => {
      (el as HTMLElement).onclick = () => this.h.selectChar((el as HTMLElement).dataset.id ?? '');
    });
    this.setupParadox.innerHTML = v.paradox
      .map(
        (p) => `<button class="parabtn ${p.state === 'selected' ? 'selected' : ''} ${p.state === 'locked' ? 'locked' : ''}" data-lvl="${p.lvl}">
          ${p.lvl} ${p.name}<small>${p.desc}</small>
        </button>`,
      )
      .join('');
    this.setupParadox.querySelectorAll('.parabtn:not(.locked)').forEach((el) => {
      (el as HTMLElement).onclick = () => this.h.selectParadox(Number((el as HTMLElement).dataset.lvl ?? '0'));
    });
    this.setupMaps.innerHTML = v.maps
      .map(
        (m) => `<button class="mapcard ${m.state === 'selected' ? 'selected' : ''} ${m.state === 'locked' ? 'locked' : ''}" data-id="${m.id}">
          <span class="mc-name">${m.name}${m.beaten ? ' ✓' : ''}</span>
          <span class="mc-desc">${m.desc}</span>
          <span class="mc-state">${m.state === 'selected' ? '出战中' : m.state === 'locked' ? '未解锁（需通关上一张）' : '已解锁'}</span>
        </button>`,
      )
      .join('');
    this.setupMaps.querySelectorAll('.mapcard:not(.locked)').forEach((el) => {
      (el as HTMLElement).onclick = () => this.h.selectMap((el as HTMLElement).dataset.id ?? '');
    });
    this.setupDiff.innerHTML = v.difficulty
      .map(
        (d) => `<button class="parabtn ${d.selected ? 'selected' : ''}" data-id="${d.id}">
          ${d.name}<small>${d.desc}</small>
        </button>`,
      )
      .join('');
    this.setupDiff.querySelectorAll('.parabtn').forEach((el) => {
      (el as HTMLElement).onclick = () => this.h.selectDifficulty((el as HTMLElement).dataset.id ?? 'standard');
    });
    this.setupDaily.innerHTML =
      `<div><b>${v.daily.modName}</b> —— ${v.daily.modDesc}</div>` +
      `<div class="dimb">日期 ${v.daily.key} · 固定角色 ${v.daily.charName} · 固定种子</div>` +
      `<div class="dimb">今日记录：${v.daily.best}${v.daily.cleared ? ' · 首通奖励已领' : ' · 首通 +300 时砂'}</div>`;
    this.setupEl.classList.remove('hidden');
  }

  hideSetup(): void {
    this.setupEl.classList.add('hidden');
  }

  /** 标题页当前配置摘要 */
  setTitleConfig(text: string): void {
    this.titleConfig.innerHTML = text;
  }

  showTitle(): void {
    this.hideAll();
    this.title.classList.remove('hidden');
  }

  hideAll(): void {
    for (const el of [this.title, this.levelup, this.pause, this.result, this.hud, this.altar, this.meta, this.setupEl]) {
      el.classList.add('hidden');
    }
  }

  /** 进化面板（GDD §6.5：条件全透明，由玩家主动完成） */

  /** 密库面板（GDD §6.8.2）：按支线分列，节点显示花费与状态 */
  showMeta(view: MetaView): void {
    const spent = view.nodes.filter((n) => n.status === 'owned').reduce((p, n) => p + n.cost, 0);
    this.metaSand.textContent = `${view.sand}`;
    this.metaProgress.textContent = `${spent} / ${view.totalCost}`;
    this.metaBranches.innerHTML = view.branches
      .map((branch) => {
        const nodes = view.nodes.filter((n) => n.branch === branch);
        const items = nodes
          .map((n) => {
            const cls = n.status === 'owned' ? 'owned' : n.status === 'buyable' ? 'buyable' : 'locked';
            const label = n.status === 'owned' ? '已解锁' : n.status === 'buyable' ? `解锁 ${n.cost} 时砂` : (n.reqName ? `需「${n.reqName}」` : `${n.cost} 时砂`);
            return `<button class="metanode ${cls}" data-id="${n.id}" ${n.status === 'buyable' ? '' : 'disabled'}>
              <span class="mn-name">${n.name}</span>
              <span class="mn-desc">${n.desc}</span>
              <span class="mn-cost">${label}</span>
            </button>`;
          })
          .join('');
        return `<div class="metabranch"><div class="mb-title">${branch}</div>${items}</div>`;
      })
      .join('');
    this.metaBranches.querySelectorAll('.metanode.buyable').forEach((el) => {
      (el as HTMLElement).onclick = () => this.h.buyMeta((el as HTMLElement).dataset.id ?? '');
    });
    this.meta.classList.remove('hidden');
  }

  hideMeta(): void {
    this.meta.classList.add('hidden');
  }

  /** 图鉴 + 成就（M3）：未遭遇时只显示剪影；成就显示历史最佳进度 */  showCodex(
    entries: readonly { kind: string; name: string; glyph: string; color: number; stats: string; behavior: string; tip: string }[],
    kills: Record<string, number>,
    ids: readonly string[],
    achievements: readonly { name: string; desc: string; category: string; unlocked: boolean; progress: string }[] = [],
  ): void {
    let unlocked = 0;
    this.codexList.innerHTML = entries
      .map((e, i) => {
        const n = kills[ids[i]!] ?? 0;
        const has = n > 0;
        if (has) unlocked++;
        const kindLabel = e.kind === 'boss' ? 'BOSS' : e.kind === 'elite' ? '精英' : '杂兵';
        const hex = `#${e.color.toString(16).padStart(6, '0')}`;
        return `<div class="codexcard ${has ? '' : 'locked'}">
          <div class="cx-head">
            <div class="cx-glyph" style="color:${hex};border-color:${hex}66">${has ? e.glyph : '？'}</div>
            <span class="cx-name">${has ? e.name : '未遭遇'}</span>
            <span class="cx-kind">${kindLabel}</span>
          </div>
          ${has ? `<div class="cx-stats">${e.stats}</div><div class="cx-behavior">${e.behavior}</div><div class="cx-tip">▸ ${e.tip}</div>` : '<div class="cx-behavior">在局内遇到并击杀后解锁</div>'}
          <div class="cx-kills">累计击杀 ${n}</div>
        </div>`;
      })
      .join('');
    this.codexProgress.textContent = `${unlocked} / ${entries.length}`;
    // 成就区（M3）：按"已解锁 → 未解锁"排序，未解锁显示历史最佳进度
    if (this.achvList) {
      const CAT: Record<string, string> = { first: '初体验', mechanic: '机制', milestone: '里程碑', collect: '收集' };
      const sorted = [...achievements].sort((a, b) => Number(b.unlocked) - Number(a.unlocked));
      const got = achievements.filter((a) => a.unlocked).length;
      this.achvProgress.textContent = `${got} / ${achievements.length}`;
      this.achvList.innerHTML = sorted
        .map(
          (a) => `<div class="achvrow ${a.unlocked ? 'got' : ''}">
            <span class="av-icon">${a.unlocked ? '🏆' : '·'}</span>
            <span class="av-name">${a.name}</span>
            <span class="av-tag">${CAT[a.category] ?? ''}</span>
            <span class="av-desc">${a.desc}</span>
            <span class="av-prog">${a.unlocked ? '已解锁' : a.progress}</span>
          </div>`,
        )
        .join('');
    }
    this.codex.classList.remove('hidden');
  }

  hideCodex(): void {
    this.codex.classList.add('hidden');
  }
  showAltar(recipes: { name: string; desc: string; crystals: number }[]): void {
    this.altarCards.innerHTML = recipes
      .map(
        (r, i) => `
      <div class="card" data-i="${i}">
        <span class="key">${i + 1}</span><span class="tag">进化</span>
        <div class="glyph">✦</div>
        <div class="cname">${r.name}</div>
        <div class="clv">消耗结晶 ×2（持有 ${r.crystals}）</div>
        <div class="cdesc">${r.desc}</div>
      </div>`,
      )
      .join('');
    this.altarCards.querySelectorAll('.card').forEach((el) => {
      (el as HTMLElement).onclick = () => this.h.evolve(Number((el as HTMLElement).dataset.i ?? '0'));
    });
    this.altar.classList.remove('hidden');
  }

  hideAltar(): void {
    this.altar.classList.add('hidden');
  }

  showHud(): void {
    this.hud.classList.remove('hidden');
  }

  hideHud(): void {
    this.hud.classList.add('hidden');
  }

  toast(msg: string, cls = ''): void {
    const div = document.createElement('div');
    div.className = `toast ${cls}`;
    div.textContent = msg;
    this.toasts.appendChild(div);
    while (this.toasts.children.length > 4) {
      this.toasts.firstChild?.remove();
    }
    setTimeout(() => div.classList.add('fade'), 2600);
    setTimeout(() => div.remove(), 3200);
  }

  updateHud(w: World): void {
    const p = w.player;
    if (!p) return;
    this.hpbar.style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
    this.hptext.textContent = `${Math.ceil(Math.max(0, p.hp))} / ${p.maxHp}`;
    this.xpbar.style.width = `${(p.xp / p.xpNeed) * 100}%`;
    this.lvtext.textContent = `Lv ${p.level}`;
    this.clock.textContent = fmtTime(w.time);
    const gauge = p.gauge;
    this.resRing.style.setProperty('--p', `${gauge}`);
    const ready = gauge >= 100;
    this.resonance.classList.toggle('ready', ready);
    this.resKey.textContent = ready ? '空格' : `${Math.floor(gauge)}`;

    // 信息条：结晶 / 祭坛指引 / 事件（M2）
    this.crystaltext.textContent = `◇ 结晶 ${p.crystals}`;
    let hint = '';
    let bd = Infinity;
    for (const a of w.altars) {
      if (a.used) continue;
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d < bd) {
        bd = d;
        hint = d <= BAL.altar.radius ? `祭坛引导中 ${Math.min(100, Math.round((a.channel / BAL.altar.channel) * 100))}%` : `祭坛 ${Math.round(d)}px ↑`;
      }
    }
    this.altarhint.textContent = hint;
    this.eventtext.textContent = w.eventKind ? `${eventLabel(w.eventKind)} ${Math.ceil(w.eventT)}s` : '';

    // 作弊标记（M3）：用过作弊码就常驻显示，避免"看不出这局不干净"
    if (this.cheattext.textContent === '' && w.cheated) this.cheattext.textContent = '⚑ 作弊已启用';

    // 回响同步（M3）：本体贴近残影 → 全局增益；指示器亮起让"编队状态"随时可见
    const synced = w.isSynced();
    if (synced !== this.syncShown) {
      this.syncShown = synced;
      this.synctext.className = synced ? 'syncOn' : 'syncOff';
    }
    if (synced) {
      const b = Math.round(w.syncBonus() * 100);
      const def = Math.round(BAL.resonance.syncDefMax * w.syncRamp() * 100);
      const damp = Math.round(BAL.resonance.dampMax * w.syncRamp() * 100);
      this.synctext.textContent = `⬤ 回响同步 伤害/共鸣 +${b}% · 吸取 +${b}% · 受伤 -${def}% · 阻尼 -${damp}%`;
    } else {
      const d = Math.round(Math.hypot(p.x - w.echo.x, p.y - w.echo.y));
      this.synctext.textContent = `回响分离 ${d}px`;
    }

    // 时间织造者·诺诺的「静止织机」领域（M3）：圈内残影延迟 +2s，必须让玩家看得见
    const wb = w.boss;
    if (wb !== null && wb.active && wb.bossKind === 'weaver' && wb.phase >= 2) {
      const inD = w.inWeaverDomain();
      this.domaintext.textContent = inD ? '⚠ 静止织机：残影延迟 +2s（退出紫圈可解除）' : '静止织机（圈外安全）';
      if (inD !== this.domainShown) {
        this.domainShown = inD;
        this.domaintext.className = inD ? 'inDomain' : '';
      }
    } else if (this.domaintext.textContent !== '') {
      this.domaintext.textContent = '';
      this.domaintext.className = '';
      this.domainShown = false;
    }
  }

  renderSlots(w: World): void {
    const p = w.player;
    if (!p) return;
    let html = '';
    for (let i = 0; i < 6; i++) {
      const def = WEAPONS[i];
      if (!def) break;
      const st = p.weapons.get(def.id);
      if (!st) {
        html += '<div class="slot w"></div>';
        continue;
      }
      let pips = '';
      for (let j = 0; j < 6; j++) pips += `<span class="pip ${j < st.lv ? 'on' : ''}"></span>`;
      html += `<div class="slot w" title="${def.name}">${def.glyph}<div class="pips">${pips}</div></div>`;
    }
    this.wslots.innerHTML = html;

    html = '';
    for (let i = 0; i < 8; i++) {
      const def = PASSIVES[i];
      if (!def) break;
      const lv = p.passives.get(def.id) ?? 0;
      if (lv <= 0) {
        html += '<div class="slot p"></div>';
        continue;
      }
      let pips = '';
      for (let j = 0; j < 5; j++) pips += `<span class="pip ${j < lv ? 'on' : ''}"></span>`;
      html += `<div class="slot p" title="${def.name}">${def.glyph}<div class="pips">${pips}</div></div>`;
    }
    this.pslots.innerHTML = html;
  }

  bossBar(visible: boolean, frac = 1, name = ''): void {
    this.bossbar.classList.toggle('hidden', !visible);
    if (visible) {
      this.bossfill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      if (name) this.bossname.textContent = name;
    }
  }

  showLevelUp(choices: Choice[], rerolls: number, recommendIdx = -1): void {
    const html = choices
      .map((c, i) => {
        const lvLine = c.isNew
          ? (c.kind === 'weapon' ? '新武器' : '新被动')
          : `Lv ${c.lv} <span class="up">→ ${c.lv + 1}</span>`;
        const maxfx = c.kind === 'weapon' && c.lv + 1 >= 6 && c.maxDesc ? `<div class="maxfx">升到满级：${c.maxDesc}</div>` : '';
        const rec = i === recommendIdx;
        return `
        <div class="card ${c.kind === 'passive' || c.kind === 'sand' ? 'p' : ''} ${rec ? 'rec' : ''}" data-i="${i}">
          <span class="key">${i + 1}</span><span class="tag">${rec ? '推荐' : c.tagLabel}</span>
          <div class="glyph">${c.glyph}</div>
          <div class="cname">${c.name}</div>
          <div class="clv">${lvLine}</div>
          <div class="cdesc">${c.desc}</div>
          ${maxfx}
        </div>`;
      })
      .join('');
    this.cards.innerHTML = html;
    this.cards.querySelectorAll('.card').forEach((el) => {
      (el as HTMLElement).onclick = () => this.h.pick(Number((el as HTMLElement).dataset.i ?? '0'));
    });
    this.btnReroll.textContent = `重掷 ×${rerolls}（R）`;
    this.btnReroll.disabled = rerolls <= 0;
    this.levelup.classList.remove('hidden');
  }

  hideLevelUp(): void {
    this.levelup.classList.add('hidden');
  }

  showPause(w: World): void {
    let html = '';
    for (const [id, st] of w.player.weapons) {
      html += `<div><b class="a">${weaponById(id).name}</b>　Lv${st.lv}${st.lv >= 6 ? ' · 满级' : ''}</div>`;
    }
    for (const [id, lv] of w.player.passives) {
      html += `<div><b class="c">${passiveById(id).name}</b>　Lv${lv}</div>`;
    }
    const cov = w.stats.hits > 0 ? Math.round((w.stats.resHits / w.stats.hits) * 100) : 0;
    const perMin = w.time > 0 ? Math.round((w.stats.resHits / w.time) * 60) : 0;
    const syncPct = w.time > 0 ? Math.round((w.stats.syncTime / w.time) * 100) : 0;
    html += `<div style="margin-top:10px;color:var(--dim)">共鸣击频率 <b class="c">${perMin}/分</b>（KPI ${BAL.resonance.perMinTarget[0]}–${BAL.resonance.perMinTarget[1]}） · 覆盖率 ${cov}% · 击杀 ${w.stats.kills} · 存活 ${fmtTime(w.time)}</div>`;
    html += `<div style="color:var(--dim)">编队：双影夹击 <b class="a">${w.stats.pincerHits}</b> 次 · 回响同步 <b class="a">${syncPct}%</b> 时间（贴住残影 +${Math.round(BAL.resonance.syncDmgPct * 100)}% 伤害）</div>`;
    this.pauseStats.innerHTML = html;
    this.pause.classList.remove('hidden');
  }

  hidePause(): void {
    this.pause.classList.add('hidden');
  }

  /** M3 作弊码：把执行结果显示在暂停面板里（HELP 会列出全表，用 pre 保留换行） */
  showCheatResult(text: string, ok: boolean): void {
    this.cheatResult.textContent = ok ? `✓ ${text}` : `✗ ${text}`;
    this.cheatResult.className = ok ? 'cheatresult' : 'cheatresult bad';
  }

  showResult(d: ResultData): void {
    this.resEyebrow.textContent = d.win ? 'VICTORY · 时间为你停留' : 'RUN OVER';
    this.resEyebrow.className = d.win ? 'eyebrow c' : 'eyebrow';
    this.resTitle.textContent = d.win ? '胜利' : '被淹没';
    const cov = d.hits > 0 ? Math.round((d.resHits / d.hits) * 100) : 0;
    const [lo, hi] = BAL.resonance.perMinTarget;
    const rateOk = d.resonancePerMin >= lo && d.resonancePerMin <= hi;
    const stat = (v: string, k: string, c = false): string =>
      `<div class="stat"><div class="v ${c ? 'c' : ''}">${v}</div><div class="k">${k}</div></div>`;
    this.resultStats.innerHTML = [
      stat(fmtTime(d.time), '存活时间'),
      stat(`Lv ${d.level}`, '终局等级'),
      stat(`${d.kills}`, '击杀数'),
      // M2 主 KPI：共鸣击频率（覆盖率降级为诊断量，见 GDD §5.2 变更记录）
      stat(`${d.resonancePerMin}/分`, `共鸣击频率（目标 ${lo}–${hi}）`, true),
      stat(`${cov}%`, '共鸣覆盖率（诊断）'),
      // M3 新增：编队走位诊断量
      stat(`${d.pincerHits}`, `双影夹击（×${BAL.resonance.pincerDmgMult} 伤害）`, d.pincerHits > 0),
      stat(`${d.syncPct}%`, `回响同步时间（连续 ${d.syncMaxStreak}s → +${Math.round(d.syncBonusPct)}%）`),
      stat(`${d.bursts}`, '同步爆发'),
      stat(d.evolutions || '—', '武器进化'),
      stat(`${d.crystals}`, '回响结晶'),
      stat(`${d.elites}`, '精英击杀'),
      stat(`${d.bossKills}/4`, 'Boss 击杀'),
      stat(d.paradox > 0 ? `悖论 ${d.paradox}` : '标准', `角色 ${d.character}`, true),
      stat(d.mapName, '地图'),
      stat(d.dailyMod || '—', '每日变异'),
      stat(`+${d.sand}`, '时砂（M3 密库）'),
      stat(`${d.totalSand}`, '累计时砂'),
      stat(`${d.runs}`, '历史局数'),
      stat(fmtTime(d.bestTime), '最佳存活'),
      stat(rateOk ? '✓' : '—', '共鸣 KPI 达标', true),
      ...(d.cheated ? [stat('⚑ 是', '作弊局（不计成就与历史最佳）', true)] : []),
    ].join('');
    const leftMin = Math.max(0, Math.ceil((BAL.meta.runSeconds - d.time) / 60));
    this.resHint.textContent =
      (d.unlockMsg ? `🎉 ${d.unlockMsg} · ` : '') +
      (d.win
        ? '标准局达成——下一局试试更高悖论难度，或换角色构筑。'
        : `差 ${leftMin} 分钟——让残影与你形成交叉火力，共鸣击频率会显著提升。`);
    this.result.classList.remove('hidden');
  }

  hideResult(): void {
    this.result.classList.add('hidden');
  }

  flashHurt(): void {
    this.hurtfx.style.opacity = '1';
    setTimeout(() => {
      this.hurtfx.style.opacity = '0';
    }, 90);
  }

  flashBurst(): void {
    this.burstfx.style.transition = 'opacity 0.05s';
    this.burstfx.style.opacity = '1';
    setTimeout(() => {
      this.burstfx.style.transition = 'opacity 0.35s';
      this.burstfx.style.opacity = '0';
    }, 60);
  }
}
