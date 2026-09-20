import './style.css';
import { BAL } from './config/balance';
import { EVOLUTIONS, PASSIVES, WEAPONS, passiveById, recompute, weaponById } from './config/items';
import { META_NODES, metaPrereq } from './config/meta';
import { craftEvolution, satisfiableRecipes } from './game/altar';
import { computeBonuses, totalMetaCost } from './game/meta';
import { genChoices } from './game/upgrades';
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
// 全表钩子（M3）：冒烟测试用它校验 12 武器 / 15 被动 / 6 进化，以及进化的可获得性判定
(window as unknown as { __items?: unknown }).__items = {
  WEAPONS, PASSIVES, EVOLUTIONS, weaponById, passiveById, recompute, satisfiableRecipes, craftEvolution,
};
// 密库全表钩子（M3）：校验 42 节点 / 前置链 / 双效果汇总 / 升级面板选项数
(window as unknown as { __meta?: unknown }).__meta = {
  META_NODES, metaPrereq, computeBonuses, totalMetaCost, genChoices,
};

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
