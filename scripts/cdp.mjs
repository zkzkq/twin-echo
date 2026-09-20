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

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

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

/** 生存优先机器人（量测"会风筝的玩家"上限）：远离最近敌人，只顺路吃安全宝石 */
export const BOT_SAFE_FN = `window.__botSafe = (f) => {
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
  const browser = BROWSERS.find((p) => existsSync(p));
  if (!browser) throw new Error('未找到 Edge/Chrome，无法执行 headless 测试');
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

  // 杀进程树：proc.kill 只杀启动器；taskkill /T 对"已被重新挂载的孙进程"同样无效，
  // 故再按唯一 profile 路径兜底清理（否则每次测试残留数十个浏览器进程，抢占 CPU 并污染性能测量）。
  const profileTag = profile.split(/[\\/]/).pop();
  const killTree = () => {
    try {
      spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      proc.kill();
    }
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
