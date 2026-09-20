import './style.css';
import { BAL } from './config/balance';
import { Game } from './game/game';

function showErr(msg: string): void {
  const el = document.getElementById('errbanner');
  if (el) {
    el.textContent = `⚠ 运行错误：${msg}`;
    el.classList.remove('hidden');
  }
}

const game = new Game();

// 调试 / 自动化钩子（供 headless 冒烟测试、性能压测、A/B 实验读取与注入配置）
(window as unknown as { __twinEcho?: Game; __BAL?: typeof BAL }).__twinEcho = game;
(window as unknown as { __BAL?: typeof BAL }).__BAL = BAL;

game
  .init()
  .then(() => {
    console.log('[Twin Echo] M1 原型已启动');
  })
  .catch((err: unknown) => {
    showErr(err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err));
  });

window.addEventListener('error', (e) => {
  showErr(e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  showErr(String(e.reason));
});
