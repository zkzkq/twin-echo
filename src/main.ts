import './style.css';
import { BAL } from './config/balance';
import { EVOLUTIONS, PASSIVES, WEAPONS, passiveById, recompute, weaponById } from './config/items';
import { META_NODES, metaPrereq } from './config/meta';
import { diag } from './core/diagnostics';
import {
  ACHIEVEMENTS, EMPTY_CTX, achievementById, emitUnlock, evaluateAchievements, registerSink,
} from './config/achievements';
import { CHEATS, applyCheat, findCheat, normalizeCheat } from './game/cheats';
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

// 会话与稳定性诊断（M3 验收）：必须在 Game 之前登记，才能判定"上一次会话是否正常收尾"
diag.beginSession();

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
// 诊断钩子（M3 验收）：崩溃率 / 回访 / 中位局时长
(window as unknown as { __diag?: unknown }).__diag = diag;
// 成就钩子（M3）：冒烟测试校验判定表、阈值与 Steamworks 适配层
(window as unknown as { __achv?: unknown }).__achv = {
  ACHIEVEMENTS, EMPTY_CTX, achievementById, evaluateAchievements, registerSink, emitUnlock,
};
// 作弊码钩子（M3）：冒烟测试逐条验证效果与归一化
(window as unknown as { __cheats?: unknown }).__cheats = { CHEATS, findCheat, normalizeCheat, applyCheat };

game
  .init()
  .then(() => {
    console.log('[Twin Echo] 原型已启动');
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    diag.record('error', `init 失败：${msg}`);
    showErr(msg);
  });

window.addEventListener('error', (e) => {
  diag.record('error', e.message, e.error instanceof Error ? e.error.stack : undefined, {
    runId: game.telemetry.runIdNow(),
    gameTime: game.world ? Math.round(game.world.time * 10) / 10 : undefined,
  });
  showErr(e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  diag.record('rejection', String(e.reason), e.reason instanceof Error ? e.reason.stack : undefined, {
    runId: game.telemetry.runIdNow(),
    gameTime: game.world ? Math.round(game.world.time * 10) / 10 : undefined,
  });
  showErr(String(e.reason));
});
// 正常收尾标记：崩溃率的分母/分子全靠它（漏标就会把正常退出算成崩溃）
window.addEventListener('pagehide', () => diag.endSession());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') diag.endSession();
});
