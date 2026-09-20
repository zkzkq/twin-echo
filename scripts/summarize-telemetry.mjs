/**
 * 试玩遥测汇总：把回收的 CSV（结算页"导出遥测 CSV"产出）汇总成 KPI 报告。
 * 用法：node scripts/summarize-telemetry.mjs <目录或文件...>    （默认 ./telemetry）
 *
 * 期望文件：twin-echo-runs-*.csv（每局一行摘要）与 twin-echo-events-*.csv（关键事件）
 * 输出：局数、胜率、存活中位（min）、终局等级中位、击杀中位、共鸣覆盖率中位、
 *       跳过率、爆发间隔中位、死亡点分布（热区粗粒度统计）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PARSER_TARGETS = process.argv.slice(2);
const inputs = PARSER_TARGETS.length > 0 ? PARSER_TARGETS : ['telemetry'];

function collect(dirOrFile) {
  const out = [];
  const st = statSync(dirOrFile, { throwIfNoEntry: false });
  if (!st) return out;
  if (st.isFile()) return [dirOrFile];
  for (const f of readdirSync(dirOrFile)) {
    if (f.toLowerCase().endsWith('.csv')) out.push(join(dirOrFile, f));
  }
  return out;
}

/** 极简 CSV 解析（支持双引号包裹与转义） */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return { head: [], rows: [] };
  const head = rows[0].map((h) => h.replace(/^\uFEFF/, '').trim());
  return { head, rows: rows.slice(1).filter((r) => r.some((v) => v !== '')) };
}

const median = (a) => {
  if (a.length === 0) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mean = (a) => (a.length ? a.reduce((p, c) => p + c, 0) / a.length : 0);

const runRows = [];
const eventRows = [];
const files = inputs.flatMap(collect);
if (files.length === 0) {
  console.log(`未找到 CSV。把测试者导出的文件放进 ./telemetry/ 后重跑，或直接传文件路径。`);
  process.exit(0);
}
for (const f of files) {
  const { head, rows } = parseCsv(readFileSync(f, 'utf8'));
  const isEvents = head.includes('event');
  for (const r of rows) {
    const obj = {};
    head.forEach((h, i) => (obj[h] = r[i]));
    (isEvents ? eventRows : runRows).push(obj);
  }
}
console.log(`读取 ${files.length} 个 CSV：局摘要 ${runRows.length} 行 · 事件 ${eventRows.length} 行\n`);

if (runRows.length === 0) {
  console.log('（没有局摘要行，检查是否导出了 twin-echo-runs-*.csv）');
  process.exit(0);
}

const num = (v) => Number(v ?? 0);
const wins = runRows.filter((r) => r.win === 'true' || r.win === '1');
const survival = runRows.map((r) => num(r.time) / 60);
const coverage = runRows.map((r) => num(r.coverage));
const bursts = runRows.map((r) => num(r.bursts));
const burstGaps = runRows.filter((r) => num(r.bursts) > 0).map((r) => num(r.time) / num(r.bursts));

const shown = eventRows.filter((e) => e.event === 'levelup_shown').length;
const skipped = eventRows.filter((e) => e.event === 'levelup_skip').length;
const rerolls = eventRows.filter((e) => e.event === 'levelup_reroll').length;

console.log('—— 试玩 KPI 汇总 ——');
console.log(`局数 ${runRows.length} · 胜率 ${Math.round((wins.length / runRows.length) * 100)}%`);
console.log(`存活：中位 ${median(survival).toFixed(1)}min（GDD §14 目标 ≥11min；10min MVP 局的可玩下限建议 ≥6min）`);console.log(`终局等级：中位 ${median(runRows.map((r) => num(r.level)))}（§7 目标 42–48@20min / MVP ≈26@10min）`);
console.log(`击杀：中位 ${Math.round(median(runRows.map((r) => num(r.kills))))}`);
console.log(`共鸣覆盖率：中位 ${median(coverage).toFixed(1)}%（§5.2 目标 30–45%）`);
console.log(`同步爆发：中位 ${median(bursts)} 次/局 · 间隔中位 ${burstGaps.length ? median(burstGaps).toFixed(0) + 's' : '—'}（§5.3 目标 60–90s）`);
if (shown > 0) {
  console.log(`升级放弃/跳过率：${((skipped / shown) * 100).toFixed(1)}%（§14 目标 <8%）· 重掷 ${rerolls} 次`);
}
console.log(`被围死/其他：受伤总量中位 ${Math.round(median(runRows.map((r) => num(r.damageTaken))))} · 复活次数中位 ${median(runRows.map((r) => num(r.revives)))}`);

// 死亡点分布（粗粒度 3×3 热区，坐标以出生点为原点）
const killed = runRows.filter((r) => r.win !== 'true' && r.win !== '1');
if (killed.length > 0) {
  const grid = new Map();
  for (const r of killed) {
    const gx = Math.max(-1, Math.min(1, Math.round(num(r.deathX) / 600)));
    const gy = Math.max(-1, Math.min(1, Math.round(num(r.deathY) / 600)));
    const k = `${gx},${gy}`;
    grid.set(k, (grid.get(k) ?? 0) + 1);
  }
  console.log(`\n死亡点热区（3×3，600px 分格，原点=出生点；共 ${killed.length} 次死亡）：`);
  for (let gy = -1; gy <= 1; gy++) {
    const line = [];
    for (let gx = -1; gx <= 1; gx++) line.push(String(grid.get(`${gx},${gy}`) ?? 0).padStart(4));
    console.log(line.join(' '));
  }
  console.log(`平均死亡位移 ${Math.round(mean(killed.map((r) => Math.hypot(num(r.deathX), num(r.deathY)))))}px（越大说明离出生点越远）`);
}

// 构筑偏好
const wCount = new Map();
const pCount = new Map();
for (const r of runRows) {
  for (const w of String(r.weapons ?? '').split('|').filter(Boolean)) {
    const id = w.split(':')[0];
    wCount.set(id, (wCount.get(id) ?? 0) + 1);
  }
  for (const p of String(r.passives ?? '').split('|').filter(Boolean)) {
    const id = p.split(':')[0];
    pCount.set(id, (pCount.get(id) ?? 0) + 1);
  }
}
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}×${v}`).join(' · ');
console.log(`\n武器拿取率：${top(wCount)}`);
console.log(`被动拿取率：${top(pCount)}`);

// ---- M3 Exit Criteria（活文档 §12.2）：三条都必须由真人数据裁决 ----
const medMin = median(survival);
const judge = (ok, label, detail) => console.log(`${ok ? '✓' : '✗'} ${label}：${detail}`);
console.log('\n—— M3 Exit Criteria ——');
judge(medMin >= 18, '中位局时长 ≥18min', `${medMin.toFixed(1)}min（n=${runRows.length}）`);
judge(median(coverage) <= 25, '共鸣覆盖率（诊断量，仅供观察）', `${median(coverage).toFixed(1)}%`);
const perMin = median(runRows.map((r) => num(r.resonancePerMin)));
judge(perMin >= 50 && perMin <= 120, '共鸣击频率（主 KPI 50–120/分）', `${perMin.toFixed(1)}/分`);
judge(median(bursts) >= 2, '同步爆发 ≥2 次/局（§5.3 新手下限）', `中位 ${median(bursts)} 次`);

// 验收报告（每人一份 markdown，含崩溃率与游玩日）
const reports = collect(process.argv[2] ?? 'telemetry').filter((f) => f.toLowerCase().endsWith('.md')).length;
const dirs = inputs.filter((p) => statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false);
let reportFiles = 0;
for (const d of dirs) {
  for (const f of readdirSync(d)) if (f.toLowerCase().endsWith('.md')) reportFiles++;
}
void reports;
console.log(
  reportFiles > 0
    ? `\n发现 ${reportFiles} 份验收报告（twin-echo-acceptance-*.md）：崩溃率与 3 日回访在其中，逐份查表即可。`
    : '\n未发现验收报告（twin-echo-acceptance-*.md）：崩溃率与 3 日回访拿不到，请让试玩者点标题页「导出验收报告」。',
);
