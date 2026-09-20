/**
 * 本地遥测（GDD §14 埋点清单的 MVP 版）：
 * 单机原型无服务端，故按"每局一行摘要 + 关键事件行"记录，存 localStorage，结算页可导出 CSV。
 * 试玩时让每位测试者导出/回收 CSV，即可得到死亡时间分布、共鸣覆盖率、跳过率、爆发间隔等 KPI。
 * M3 接匿名遥测后，本模块的字段名可直接复用作上报 schema。
 */

export interface RunSummary {
  runId: number;
  seed: number;
  firstRun: boolean;
  startedAt: string;
  win: boolean;
  /** 存活秒数 */
  time: number;
  level: number;
  kills: number;
  hits: number;
  resonanceHits: number;
  /** 共鸣覆盖率（诊断量） */
  coverage: number;
  /** M2 主 KPI：共鸣击频率 = 共鸣击 / 分钟 */
  resonancePerMin: number;
  bursts: number;
  elitesSpawned: number;
  elitesKilled: number;
  bossKills: number;
  damageTaken: number;
  peakEnemies: number;
  revives: number;
  skipped: number;
  rerolls: number;
  sand: number;
  weapons: string;
  passives: string;
  /** M2：结晶持有 / 已完成进化 / 祭坛到达 / 完成进化 / 事件触发 */
  crystals: number;
  evolutions: string;
  altarReached: number;
  altarCrafted: number;
  eventsFired: number;
  /** M3「编队走位」：双影夹击次数 / 夹击频率 / 回响同步累计秒数 / 同步时间占比(%) */
  pincerHits: number;
  pincerPerMin: number;
  syncTime: number;
  syncPct: number;
  syncMaxStreak: number;
  /** M3：本局是否用过作弊码（作弊局不计成就、不进验收统计的中位样本） */
  cheated: boolean;
  deathX: number;
  deathY: number;
}

export interface TelemetryEvent {
  runId: number;
  t: number;
  event: string;
  data: string;
}

const KEY = 'twinEcho.telemetry';
const MAX_RUNS = 200;

const SUMMARY_COLS: (keyof RunSummary)[] = [
  'runId', 'seed', 'firstRun', 'startedAt', 'win', 'time', 'level', 'kills', 'hits',
  'resonanceHits', 'coverage', 'resonancePerMin', 'bursts', 'elitesSpawned', 'elitesKilled', 'bossKills',
  'damageTaken', 'peakEnemies', 'revives', 'skipped', 'rerolls', 'sand', 'weapons', 'passives',
  'crystals', 'evolutions', 'altarReached', 'altarCrafted', 'eventsFired', 'deathX', 'deathY',
  'pincerHits', 'pincerPerMin', 'syncTime', 'syncPct', 'syncMaxStreak', 'cheated',
];

function esc(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export class Telemetry {
  private runs: RunSummary[] = [];
  private events: TelemetryEvent[] = [];
  private runId = 0;
  private peak = 0;
  private rerolls = 0;
  private startedAt = '';

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { runs?: RunSummary[]; events?: TelemetryEvent[] };
      this.runs = parsed.runs ?? [];
      this.events = parsed.events ?? [];
      this.runId = this.runs.length > 0 ? Math.max(...this.runs.map((r) => r.runId)) : 0;
    } catch {
      /* 损坏则忽略 */
    }
  }

  private persist(): void {
    try {
      if (this.runs.length > MAX_RUNS) this.runs = this.runs.slice(-MAX_RUNS);
      if (this.events.length > MAX_RUNS * 120) this.events = this.events.slice(-MAX_RUNS * 120);
      localStorage.setItem(KEY, JSON.stringify({ runs: this.runs, events: this.events }));
    } catch {
      /* 无 localStorage 时忽略 */
    }
  }

  runStart(seed: number, firstRun: boolean): void {
    this.runId++;
    this.peak = 0;
    this.rerolls = 0;
    this.startedAt = new Date().toISOString();
    this.log(0, 'run_start', { seed, firstRun });
  }

  /** 每帧观察峰值同屏（render 时调用，成本仅一次比较） */
  observe(enemies: number): void {
    if (enemies > this.peak) this.peak = enemies;
  }

  log(t: number, event: string, data: Record<string, unknown> = {}): void {
    this.events.push({ runId: this.runId, t: +t.toFixed(1), event, data: JSON.stringify(data) });
  }

  countReroll(): void {
    this.rerolls++;
  }

  runEnd(s: Omit<RunSummary, 'runId' | 'startedAt' | 'peakEnemies' | 'rerolls'>): void {
    const row: RunSummary = {
      ...s,
      runId: this.runId,
      startedAt: this.startedAt,
      peakEnemies: this.peak,
      rerolls: this.rerolls,
    };
    this.runs.push(row);
    this.log(s.time, s.win ? 'run_win' : 'run_death', {
      x: Math.round(s.deathX), y: Math.round(s.deathY), level: s.level, kills: s.kills,
      coverage: s.coverage, revived: s.revives,
    });
    this.persist();
  }

  summaryCsv(): string {
    const head = SUMMARY_COLS.join(',');
    const body = this.runs.map((r) => SUMMARY_COLS.map((c) => esc(r[c])).join(',')).join('\n');
    return `${head}\n${body}\n`;
  }

  eventsCsv(): string {
    const head = 'runId,t,event,data';
    const body = this.events.map((e) => [e.runId, e.t, e.event, esc(e.data)].join(',')).join('\n');
    return `${head}\n${body}\n`;
  }

  runCount(): number {
    return this.runs.length;
  }

  /** 当前局号（诊断上报用） */
  runIdNow(): number {
    return this.runId;
  }

  clear(): void {
    this.runs = [];
    this.events = [];
    this.persist();
  }

  /** 触发浏览器下载（结算页"导出遥测 CSV"按钮 / 控制台 __twinEcho.telemetry.download()） */
  download(): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const files: [string, string][] = [
      [`twin-echo-runs-${stamp}.csv`, this.summaryCsv()],
      [`twin-echo-events-${stamp}.csv`, this.eventsCsv()],
    ];
    for (const [name, content] of files) {
      const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  }
}
