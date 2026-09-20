/**
 * 会话与稳定性诊断（M3）：为 M3 Exit Criteria 提供**可计算的度量口径**。
 *
 * 为什么需要它：M3 的三条验收指标此前都没有仪器——
 *   ① 中位局时长 ≥18min → 遥测里已有每局存活秒数（本模块只做汇总与导出）；
 *   ② 3 日回访 ≥35%   → 需要"游玩日"历史（本模块记录并算出 D1/D3/D7）；
 *   ③ 崩溃率 <0.5%    → 需要区分"正常退出"与"异常结束"，以及捕获运行时异常（本模块做）。
 *
 * 崩溃率口径（明确写下来，避免各人算法不同）：
 *   **异常会话数 / 总会话数**，其中"异常会话" = 上一次会话没有在 `pagehide` / `visibilitychange(hidden)`
 *   里正常收尾（浏览器崩溃、标签被杀、进程被强杀、GPU 上下文丢失…… 都会留下 `clean=false` 的残留标记）。
 *   另外单独统计 `window.onerror` / `unhandledrejection` 的**捕获异常条数**，用于定位，不混入崩溃率。
 *
 * 隐私：全部数据只写在 localStorage，只有玩家主动点"导出验收报告"才会落成文件。
 */

export type CrashKind = 'error' | 'rejection' | 'unclean-exit';

export interface CrashEntry {
  at: string;
  kind: CrashKind;
  msg: string;
  stack?: string;
  runId?: number;
  gameTime?: number;
  ua: string;
}

export interface DiagState {
  /** 首次启动时间（用于成长期统计） */
  firstAt: string;
  sessions: number;
  cleanExits: number;
  crashes: CrashEntry[];
  /** 游玩日（本地日期 YYYY-MM-DD，去重升序，最多 120 天） */
  playDays: string[];
  /** 每局存活秒数（本机，最多 200 局）——用于中位局时长 */
  runSeconds: number[];
  /** 每次会话的粗信息（用于回访分布） */
  sessionStarts: string[];
}

const DIAG_KEY = 'twinEcho.diag';
const SESSION_KEY = 'twinEcho.session';
const MAX_CRASH = 60;
const MAX_DAYS = 120;
const MAX_RUNS = 200;

function today(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00`);
  const tb = Date.parse(`${b}T00:00:00`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.round((tb - ta) / 86400000);
}

export class Diagnostics {
  state: DiagState = {
    firstAt: new Date().toISOString(),
    sessions: 0,
    cleanExits: 0,
    crashes: [],
    playDays: [],
    runSeconds: [],
    sessionStarts: [],
  };

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(DIAG_KEY);
      if (raw) this.state = { ...this.state, ...(JSON.parse(raw) as Partial<DiagState>) };
    } catch {
      /* 损坏则用默认值 */
    }
  }

  private persist(): void {
    try {
      if (this.state.crashes.length > MAX_CRASH) this.state.crashes = this.state.crashes.slice(-MAX_CRASH);
      if (this.state.playDays.length > MAX_DAYS) this.state.playDays = this.state.playDays.slice(-MAX_DAYS);
      if (this.state.runSeconds.length > MAX_RUNS) this.state.runSeconds = this.state.runSeconds.slice(-MAX_RUNS);
      if (this.state.sessionStarts.length > MAX_RUNS) this.state.sessionStarts = this.state.sessionStarts.slice(-MAX_RUNS);
      localStorage.setItem(DIAG_KEY, JSON.stringify(this.state));
    } catch {
      /* 无 localStorage 时忽略 */
    }
  }

  /** 启动时调用：先判定上一次会话是否为异常结束，再登记本次会话与游玩日 */
  beginSession(): { unclean: boolean } {
    let unclean = false;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const prev = JSON.parse(raw) as { at?: string; clean?: boolean; runId?: number };
        if (prev.clean !== true) {
          unclean = true;
          this.state.crashes.push({
            at: prev.at ?? '',
            kind: 'unclean-exit',
            msg: '上一次会话没有正常收尾（浏览器崩溃 / 标签被杀 / 进程强杀 / GPU 上下文丢失）',
            runId: prev.runId,
            ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          });
        } else {
          this.state.cleanExits++;
        }
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify({ at: new Date().toISOString(), clean: false }));
    } catch {
      /* 存储不可用：仍继续，只是统计缺失 */
    }
    this.state.sessions++;
    const d = today();
    if (!this.state.playDays.includes(d)) {
      this.state.playDays.push(d);
      this.state.playDays.sort();
    }
    this.state.sessionStarts.push(new Date().toISOString());
    this.persist();
    return { unclean };
  }

  /** 正常收尾（pagehide / visibilitychange→hidden） */
  endSession(): void {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const cur = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      cur.clean = true;
      localStorage.setItem(SESSION_KEY, JSON.stringify(cur));
    } catch {
      /* 忽略 */
    }
  }

  /** 记录一条运行时异常（onerror / unhandledrejection） */
  record(kind: CrashKind, msg: string, stack?: string, ctx?: { runId?: number; gameTime?: number }): void {
    this.state.crashes.push({
      at: new Date().toISOString(),
      kind,
      msg: String(msg).slice(0, 400),
      stack: stack ? String(stack).slice(0, 1200) : undefined,
      runId: ctx?.runId,
      gameTime: ctx?.gameTime,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    });
    this.persist();
  }

  /** 每局结束登记存活时长（中位局时长的原始数据） */
  noteRun(seconds: number, runId: number): void {
    this.state.runSeconds.push(Math.round(seconds * 10) / 10);
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const cur = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      cur.runId = runId;
      localStorage.setItem(SESSION_KEY, JSON.stringify(cur));
    } catch {
      /* 忽略 */
    }
    this.persist();
  }

  /** 崩溃率 = 异常会话 / 总会话（含本次会话的前置判定） */
  crashRate(): number {
    if (this.state.sessions <= 0) return 0;
    return this.state.crashes.filter((c) => c.kind === 'unclean-exit').length / this.state.sessions;
  }

  /** 捕获异常条数（不含 unclean-exit） */
  errorCount(): number {
    return this.state.crashes.filter((c) => c.kind !== 'unclean-exit').length;
  }

  /**
   * 回访（单机口径）：以**首个游玩日**为 D0，看 D1 / D3 / D7 内是否还有游玩日。
   * 汇总到多人时需要每台机器的导出文件（报告里带原始 playDays，可离线聚合）。
   */
  retention(): { days: number; d1: boolean; d3: boolean; d7: boolean; maxGap: number } {
    const days = this.state.playDays;
    if (days.length === 0) return { days: 0, d1: false, d3: false, d7: false, maxGap: 0 };
    const first = days[0]!;
    let d1 = false;
    let d3 = false;
    let d7 = false;
    let maxGap = 0;
    for (let i = 1; i < days.length; i++) {
      const gap = daysBetween(days[i - 1]!, days[i]!);
      if (gap > maxGap) maxGap = gap;
      const fromFirst = daysBetween(first, days[i]!);
      if (fromFirst >= 1 && fromFirst <= 1) d1 = true;
      if (fromFirst >= 1 && fromFirst <= 3) d3 = true;
      if (fromFirst >= 1 && fromFirst <= 7) d7 = true;
    }
    // 任意相邻两天之间在 1–3 天内也算回访（长线玩家）
    for (let i = 1; i < days.length; i++) {
      const g = daysBetween(days[i - 1]!, days[i]!);
      if (g >= 1 && g <= 1) d1 = true;
      if (g >= 1 && g <= 3) d3 = true;
      if (g >= 1 && g <= 7) d7 = true;
    }
    return { days: days.length, d1, d3, d7, maxGap };
  }

  medianRunSeconds(): number {
    const a = [...this.state.runSeconds].sort((x, y) => x - y);
    if (a.length === 0) return 0;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 === 1 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
  }

  /** 验收报告（Markdown）：三条 Exit Criteria + 原始数据，供试玩后直接回传 */
  report(telemetryRuns: number, meta: { character?: string; map?: string; difficulty?: string } = {}): string {
    const r = this.retention();
    const crash = this.crashRate();
    const med = this.medianRunSeconds();
    const l = (ok: boolean | null, label: string, val: string): string =>
      `| ${label} | ${val} | ${ok === null ? '待人工试玩' : ok ? '达标' : '未达标'} |`;
    const lines = [
      '# 双影回响 Twin Echo · M3 验收数据',
      '',
      `- 生成时间：${new Date().toISOString()}`,
      `- 首次启动：${this.state.firstAt}`,
      `- 本次配置：角色 ${meta.character ?? '-'} · 地图 ${meta.map ?? '-'} · 难度 ${meta.difficulty ?? '-'}`,
      `- 会话数：${this.state.sessions}（正常收尾 ${this.state.cleanExits}）`,
      `- 遥测局数：${telemetryRuns}`,
      '',
      '## Exit Criteria',
      '',
      '| 指标 | 实测 | 判定 |',
      '|---|---|---|',
      l(med > 0 ? med >= 18 * 60 : null, '中位局时长 ≥18min', med > 0 ? `${(med / 60).toFixed(1)}min（n=${this.state.runSeconds.length}）` : '—'),
      l(r.days > 0 ? r.d3 : null, '3 日回访 ≥35%', `${r.days} 个游玩日 · D1 ${r.d1 ? '✓' : '✗'} · D3 ${r.d3 ? '✓' : '✗'} · D7 ${r.d7 ? '✓' : '✗'} · 最大间隔 ${r.maxGap} 天`),
      l(this.state.sessions > 0 ? crash < 0.005 : null, '崩溃率 <0.5%', `${(crash * 100).toFixed(2)}%（${this.errorCount()} 条捕获异常）`),
      '',
      '## 原始数据（可离线聚合）',
      '',
      `- 游玩日：${this.state.playDays.join(' ') || '—'}`,
      `- 每局存活（秒）：${this.state.runSeconds.map((s) => s.toFixed(0)).join(' ') || '—'}`,
      '',
      '## 最近异常',
      '',
      ...(this.state.crashes.length === 0
        ? ['（无）']
        : this.state.crashes.slice(-8).map((c) => `- [${c.at}] ${c.kind} · 局内 ${c.gameTime ?? '-'}s · ${c.msg}`)),
      '',
      '> 崩溃率口径：异常会话 / 总会话；“异常会话”= 上一次会话没有正常收尾（浏览器崩溃/标签被杀/进程强杀/GPU 丢失）。',
    ];
    return `${lines.join('\n')}\n`;
  }

  clear(): void {
    this.state.crashes = [];
    this.state.runSeconds = [];
    this.persist();
  }
}

export const diag = new Diagnostics();
