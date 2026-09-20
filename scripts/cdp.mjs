/**
 * CDP（Chrome DevTools Protocol）测试助手：
 * 启动无头 Edge/Chrome → 打开 dev server → 返回可求值的 CDP 连接。
 * 供 smoke.mjs / probe.mjs / bench.mjs / mc.mjs / ab-resonance.mjs 复用。
 *
 * 两个已踩过的坑（改动时勿回退）：
 *  1. 调试端口随机化 —— 上一次异常退出留下的僵尸实例会占住固定端口，让新的 WebSocket 连接悬死；
 *  2. 关闭必须杀进程树（taskkill /T）—— proc.kill() 只杀启动器，Edge 子进程会残留（曾累积 121 个）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 无头浏览器候选路径（跨平台）：本地 Windows 开发 + Linux/macOS CI 都能找到。
 * CI 上若都没有，先在 runner 里装一个（GitHub 的 ubuntu-latest 自带 google-chrome）。
 */
const BROWSERS = [
  // Windows
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  // Linux（CI runner / 容器）
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

/** 跨平台杀进程：Windows 用 taskkill /T（杀进程树），类 Unix 用进程组信号 */
export function killProcessTree(pid) {
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch {
      /* 落到下面 */
    }
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* 已退出 */
    }
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 页面内机器人决策（近似真人风筝流·贪宝石）：安装到 window.__bot(f)，每 10 帧调用一次。
 * 融合转向：始终朝最近宝石前进（宝石标记了"刚死过怪"的位置），威胁只做排斥修正。
 * 注意：早先"低血就不吃宝石"的策略会形成死亡螺旋（无宝石→无等级→无回复→死），
 * 会让测量噪声压倒信号，故不用。
 */
export const BOT_FN = `window.__bot = (f) => {
  const w = __twinEcho.world;
  const p = w.player;
  let gx = 0, gy = 0, gd = Infinity;
  for (const gm of w.gems.items) {
    if (!gm.active) continue;
    const d = (gm.x - p.x) ** 2 + (gm.y - p.y) ** 2;
    if (d < gd) { gd = d; gx = gm.x; gy = gm.y; }
  }
  let dx = 0, dy = 0;
  if (gd < Infinity) { dx = gx - p.x; dy = gy - p.y; }
  else { const a = f * 0.004; dx = Math.cos(a); dy = Math.sin(a); }
  const gl = Math.hypot(dx, dy) || 1;
  dx /= gl; dy /= gl;
  let ex = 0, ey = 0, ed = Infinity;
  for (const en of w.enemies.items) {
    if (!en.active) continue;
    const d = (en.x - p.x) ** 2 + (en.y - p.y) ** 2;
    if (d < ed) { ed = d; ex = en.x; ey = en.y; }
  }
  if (Number.isFinite(ed)) {
    const dist = Math.sqrt(ed);
    const danger = p.hp < p.maxHp * 0.5 ? 200 : 130;
    if (dist < danger) {
      const wgr = Math.min(1.8, ((danger - dist) / danger) * (p.hp < p.maxHp * 0.5 ? 2.4 : 1.4));
      dx += ((p.x - ex) / (dist || 1)) * wgr;
      dy += ((p.y - ey) / (dist || 1)) * wgr;
    }
  }
  const L = Math.hypot(dx, dy) || 1;
  w.input.x = dx / L; w.input.y = dy / L;
};`;

/** 生存优先机器人（量测"会风筝的玩家"上限）：远离最近敌人，只顺路吃安全宝石 */export const BOT_SAFE_FN = `window.__botSafe = (f) => {
  const w = __twinEcho.world;
  const p = w.player;
  let ex = 0, ey = 0, ed = Infinity;
  for (const en of w.enemies.items) {
    if (!en.active) continue;
    const d = (en.x - p.x) ** 2 + (en.y - p.y) ** 2;
    if (d < ed) { ed = d; ex = en.x; ey = en.y; }
  }
  let dx = 0, dy = 0;
  const dist = Number.isFinite(ed) ? Math.sqrt(ed) : Infinity;
  if (dist < 300) { dx = p.x - ex; dy = p.y - ey; }
  else {
    let gx = 0, gy = 0, gd = 150 * 150;
    for (const gm of w.gems.items) {
      if (!gm.active) continue;
      const d = (gm.x - p.x) ** 2 + (gm.y - p.y) ** 2;
      if (d >= gd) continue;
      let safe = true;
      for (const en of w.enemies.items) {
        if (!en.active) continue;
        if ((en.x - gm.x) ** 2 + (en.y - gm.y) ** 2 < 110 * 110) { safe = false; break; }
      }
      if (safe) { gd = d; gx = gm.x; gy = gm.y; }
    }
    if (gd < 150 * 150) { dx = gx - p.x; dy = gy - p.y; }
    else { const a = f * 0.003; dx = Math.cos(a); dy = Math.sin(a); }
  }
  const L = Math.hypot(dx, dy) || 1;
  w.input.x = dx / L; w.input.y = dy / L;
};`;

/**
 * 会躲弹幕的机器人（用于难度自动化校准）——**混合策略版**。
 *
 * 三次迭代的实测教训（别回退到"纯规避"）：
 *   v1 纯规避（弹幕/危险区/敌人三者合成，威胁高就放弃吃宝石）→ 存活 3.5–3.6min，共鸣 61/分
 *   v2 收紧敌人排斥半径到 90px → 更差（3.1min）：前 3 分钟场上没有弹幕，掉血全看敌人回避半径
 *   v3 加方向承诺（指数平滑）→ 仍 3.1–3.3min
 *   结论：**纯规避会脱离交战**——宝石在怪堆里，躲开怪堆就没经验、没等级、没火力（等级 8–15 vs 贪宝石 18–19，
 *   共鸣 24–61/分 vs 89–127/分），死得更早。
 *   故本版改为混合：**基座沿用贪宝石策略（保证练级与交战），只在其上叠加弹道/危险区侧移**。
 */
export const BOT_DODGE_FN = `window.__botDir = null;
window.__botDodge = (f) => {
  const w = __twinEcho.world;
  const p = w.player;

  // ① 基座：沿用贪宝石机器人的策略（交战与练级优先）
  let ex = 0, ey = 0, ed = Infinity;
  for (const en of w.enemies.items) {
    if (!en.active) continue;
    const d = (en.x - p.x) ** 2 + (en.y - p.y) ** 2;
    if (d < ed) { ed = d; ex = en.x; ey = en.y; }
  }
  const eDist = Number.isFinite(ed) ? Math.sqrt(ed) : Infinity;
  let dx = 0, dy = 0;
  if (eDist < 130) {
    dx = p.x - ex; dy = p.y - ey;                    // 贴身 → 退开
  } else {
    let gx = 0, gy = 0, gd = Infinity;
    for (const gm of w.gems.items) {
      if (!gm.active) continue;
      const d = (gm.x - p.x) ** 2 + (gm.y - p.y) ** 2;
      if (d < gd) { gd = d; gx = gm.x; gy = gm.y; }
    }
    if (gd < Infinity) { dx = gx - p.x; dy = gy - p.y; }
    else { const a = f * 0.004; dx = Math.cos(a); dy = Math.sin(a); }
  }
  const bl = Math.hypot(dx, dy) || 1;
  dx /= bl; dy /= bl;                                // 基座单位向量

  // ② 叠加：弹幕垂直侧移（不替代基座，只偏移）
  let dodgeX = 0, dodgeY = 0;
  for (const b of w.bullets.items) {
    if (!b.active || !b.hostile) continue;
    const bx = p.x - b.x, by = p.y - b.y;
    const d2 = bx * bx + by * by;
    if (d2 > 320 * 320) continue;
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const ux = b.vx / sp, uy = b.vy / sp;
    const along = bx * ux + by * uy;
    if (along <= 0) continue;                        // 已飞过的不算
    const perp = bx * uy - by * ux;
    const miss = Math.abs(perp);
    const danger = Math.max(0, 1 - miss / 80) * Math.max(0, 1 - Math.sqrt(d2) / 320);
    if (danger <= 0.02) continue;
    const sign = perp >= 0 ? 1 : -1;
    dodgeX += -uy * sign * danger * 1.8;
    dodgeY += ux * sign * danger * 1.8;
  }
  // ③ 叠加：危险区规避（预警期撤离，这是免费的撤离窗口）
  for (const h of w.hazards.items) {
    if (!h.active) continue;
    const hx = p.x - h.x, hy = p.y - h.y;
    const d = Math.hypot(hx, hy) || 1;
    const safeR = h.r + 60;
    if (d >= safeR) continue;
    const danger = Math.max(0, 1 - d / safeR) * (h.tele > 0 ? 1.5 : 1.1);
    dodgeX += (hx / d) * danger * 1.6;
    dodgeY += (hy / d) * danger * 1.6;
  }

  dx += dodgeX;
  dy += dodgeY;

  // ④ 方向承诺：指数平滑，避免在弹道两侧每 3 帧翻转（抖动 = 原地不动 = 被围死）
  const prev = window.__botDir;
  if (prev) { dx = prev.x * 0.72 + dx * 0.28; dy = prev.y * 0.72 + dy * 0.28; }
  if (Math.hypot(dx, dy) < 0.05) { const a = f * 0.01; dx = Math.cos(a); dy = Math.sin(a); }
  const L = Math.hypot(dx, dy) || 1;
  const nx = dx / L, ny = dy / L;
  window.__botDir = { x: nx, y: ny };
  w.input.x = nx; w.input.y = ny;
};`;

/**
 * 编队走位机器人（M3「回响同步 / 双影夹击」收益实验用）。
 *
 * 目的：验证"给走位一个正收益"之后，**贴着残影作战**是否终于能打平/超过贪宝石流。
 * 曾经的负面结论（见 BOT_DODGE_FN 注释）：纯规避 = 脱离交战 = 没等级 = 死得更早。
 * 本版不是纯规避，而是**贪宝石为基座 + 回响同步为叠加**：
 *   - 残影永远重演你 2.5s 前的位置，所以"贴着残影"等价于"走回自己刚走过的路"（回环/绕圈）；
 *   - 回环走位恰好也待在已被清空的口袋里，天然比直线逃跑更安全；
 *   - 叠加弹幕与危险区侧移（否则照样被弹幕打死，会淹没同步带来的信号）。
 */
export const BOT_SYNC_FN = `window.__botSyncDir = null;
window.__botSync = (f) => {
  const w = __twinEcho.world;
  const p = w.player;

  // ① 基座：贪最近宝石（保证练级与交战，这是生存的第一因）
  let ex = 0, ey = 0, ed = Infinity;
  for (const en of w.enemies.items) {
    if (!en.active) continue;
    const d = (en.x - p.x) ** 2 + (en.y - p.y) ** 2;
    if (d < ed) { ed = d; ex = en.x; ey = en.y; }
  }
  const eDist = Number.isFinite(ed) ? Math.sqrt(ed) : Infinity;
  let dx = 0, dy = 0;
  if (eDist < 120) {
    dx = p.x - ex; dy = p.y - ey;                 // 贴身 → 退开
  } else {
    let gx = 0, gy = 0, gd = Infinity;
    for (const gm of w.gems.items) {
      if (!gm.active) continue;
      const d = (gm.x - p.x) ** 2 + (gm.y - p.y) ** 2;
      if (d < gd) { gd = d; gx = gm.x; gy = gm.y; }
    }
    if (gd < Infinity) { dx = gx - p.x; dy = gy - p.y; }
    else { const a = f * 0.004; dx = Math.cos(a); dy = Math.sin(a); }
  }
  const bl = Math.hypot(dx, dy) || 1;
  dx /= bl; dy /= bl;

  // ② 叠加：回响同步拉力 —— 离残影越远，越要把自己拉回刚走过的轨迹上
  const sx = w.echo.x - p.x, sy = w.echo.y - p.y;
  const sd = Math.hypot(sx, sy) || 1;
  const over = sd - 100;                          // 100px 内不加权，避免抖成原地不动
  if (over > 0) {
    const wgt = Math.min(2.6, over / 90);
    dx += (sx / sd) * wgt;
    dy += (sy / sd) * wgt;
  }

  // ③ 叠加：弹幕垂直侧移
  let dodgeX = 0, dodgeY = 0;
  for (const b of w.bullets.items) {
    if (!b.active || !b.hostile) continue;
    const bx = p.x - b.x, by = p.y - b.y;
    const d2 = bx * bx + by * by;
    if (d2 > 300 * 300) continue;
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const ux = b.vx / sp, uy = b.vy / sp;
    const along = bx * ux + by * uy;
    if (along <= 0) continue;
    const perp = bx * uy - by * ux;
    const danger = Math.max(0, 1 - Math.abs(perp) / 80) * Math.max(0, 1 - Math.sqrt(d2) / 300);
    if (danger <= 0.02) continue;
    const sign = perp >= 0 ? 1 : -1;
    dodgeX += -uy * sign * danger * 1.8;
    dodgeY += ux * sign * danger * 1.8;
  }
  // ④ 叠加：危险区规避
  for (const h of w.hazards.items) {
    if (!h.active) continue;
    const hx = p.x - h.x, hy = p.y - h.y;
    const d = Math.hypot(hx, hy) || 1;
    const safeR = h.r + 60;
    if (d >= safeR) continue;
    const danger = Math.max(0, 1 - d / safeR) * (h.tele > 0 ? 1.5 : 1.1);
    dodgeX += (hx / d) * danger * 1.6;
    dodgeY += (hy / d) * danger * 1.6;
  }
  dx += dodgeX; dy += dodgeY;

  // ⑤ 方向承诺（同躲弹幕机器人：无平滑会在弹道两侧翻转 → 原地不动 → 被围死）
  const prev = window.__botSyncDir;
  if (prev) { dx = prev.x * 0.72 + dx * 0.28; dy = prev.y * 0.72 + dy * 0.28; }
  if (Math.hypot(dx, dy) < 0.05) { const a = f * 0.01; dx = Math.cos(a); dy = Math.sin(a); }
  const L = Math.hypot(dx, dy) || 1;
  const nx = dx / L, ny = dy / L;
  window.__botSyncDir = { x: nx, y: ny };
  w.input.x = nx; w.input.y = ny;
};`;

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    this.consoleErrors = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.errors.push(d?.exception?.description ?? d?.text ?? 'exception');
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.exception?.description ?? d.text ?? 'eval failed');
    }
    return r.result.value;
  }
}

async function findTarget(port) {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* 浏览器尚未就绪 */
    }
    await sleep(250);
  }
  throw new Error('未能找到 CDP page target（浏览器未启动？）');
}

export async function waitFor(cdp, expr, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await cdp.eval(expr)) return Date.now() - t0;
    } catch {
      /* 页面尚未就绪 */
    }
    await sleep(200);
  }
  throw new Error(`等待超时（${timeoutMs}ms）：${label}`);
}

/** 启动无头浏览器并打开应用，返回 { cdp, browser, close } */
export async function openApp(url, port) {
  // CHROME_PATH 可显式指定浏览器（CI 或非标准安装路径用）
  const envPath = process.env.CHROME_PATH;
  const browser = (envPath && existsSync(envPath) ? envPath : undefined) ?? BROWSERS.find((p) => existsSync(p));
  if (!browser) {
    throw new Error(
      '未找到 Edge/Chrome。请安装任一浏览器后重试（Linux CI 可 apt-get install -y google-chrome-stable，或设置 CHROME_PATH 环境变量）',
    );
  }
  const cdpPort = port ?? 9200 + Math.floor(Math.random() * 600);
  const profile = mkdtempSync(join(tmpdir(), 'twin-echo-cdp-'));
  const proc = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--enable-unsafe-swiftshader',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      '--window-size=1600,900',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${cdpPort}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  // 杀进程树：proc.kill 只杀启动器；Windows 的 taskkill /T 对"已被重新挂载的孙进程"同样无效，
  // 故 Windows 上再按唯一 profile 路径兜底清理（否则每次测试残留数十个浏览器进程，抢占 CPU 并污染性能测量）。
  // 类 Unix（CI）走进程组信号即可。
  const profileTag = profile.split(/[\\/]/).pop();
  const killTree = () => {
    killProcessTree(proc.pid);
    if (process.platform !== 'win32') return;
    try {
      spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${profileTag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
        ],
        { stdio: 'ignore' },
      );
    } catch {
      /* 清理失败不阻塞测试 */
    }
  };
  const watchdog = setTimeout(() => {
    console.error('\n[cdp] 看门狗超时，清理浏览器并退出');
    killTree();
    process.exit(3);
  }, Number(process.env.CDP_WATCHDOG_MS ?? 600000));
  watchdog.unref?.();

  let ws;
  try {
    const target = await findTarget(cdpPort);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await Promise.race([
      new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true });
        ws.addEventListener('error', () => rej(new Error('CDP WebSocket 连接失败')), { once: true });
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('CDP WebSocket 连接超时（10s）')), 10000)),
    ]);
    const cdp = new CDP(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url });
    await waitFor(cdp, 'window.__twinEcho !== undefined', 25000, '游戏实例挂载');
    try {
      await waitFor(cdp, 'window.__twinEcho.ready === true', 25000, 'Game.init 完成');
    } catch (e) {
      const banner = await cdp
        .eval('document.getElementById("errbanner")?.textContent ?? "(无错误横幅)"')
        .catch(() => '(无法读取)');
      throw new Error(`Game.init 未完成：${banner}\n${e instanceof Error ? e.message : e}`);
    }
    // 停掉 rAF ticker：测试侧改为确定性步进，避免无头环境 rAF 节流干扰
    await cdp.eval('(() => { const t = __twinEcho.app && __twinEcho.app.ticker; if (t) t.stop(); return !!t; })()');
    return {
      cdp,
      browser,
      close: () => {
        clearTimeout(watchdog);
        try {
          ws.close();
        } catch {
          /* 已关闭 */
        }
        killTree();
      },
    };
  } catch (err) {
    clearTimeout(watchdog);
    killTree();
    throw err;
  }
}
