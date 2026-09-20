import { BAL } from '../config/balance';
import { panelDps } from './combat';
import { COLORS } from './textures';
import type { World } from './world';

export type EventKind = 'tide' | 'spring' | 'stasis';

/**
 * 局内事件（GDD §6.7）：每 120s roll 1 次、Boss 战期间禁用。
 * M2 首批 3 件均为"效果型"（无需额外面板）：时潮涌动 / 共鸣泉 / 停滞领域。
 */
export function rollEvent(w: World): void {
  const list = BAL.events.list;
  const kind = list[w.rng.int(0, list.length - 1)] as EventKind;
  w.eventKind = kind;
  w.stats.eventsFired++;
  w.onEvent('event-start');

  if (kind === 'stasis') {
    // 全场定身（解除时在 updateEvents 里结算冲击）
    for (const e of w.enemies.items) if (e.active) e.frozenT = BAL.events.stasis.dur;
    w.eventT = BAL.events.stasis.dur;
    w.spawnRing(w.player.x, w.player.y, 40, 1200, 0.5, COLORS.echo, 1);
    return;
  }
  if (kind === 'tide') {
    w.eventT = BAL.events.tide.dur;
    return;
  }
  w.eventT = BAL.events.spring.dur;
}

export function updateEvents(w: World, dt: number): void {
  if (w.eventKind === null) return;
  w.eventT -= dt;
  if (w.eventT > 0) return;

  // 事件结束结算
  if (w.eventKind === 'tide') {
    // 宝石雨 ×60（GDD §6.7：结束掉落宝石雨）
    for (let i = 0; i < BAL.events.tide.gemRain; i++) {
      const a = w.rng.angle();
      const d = w.rng.range(60, 320);
      w.spawnXpGem(w.player.x + Math.cos(a) * d, w.player.y + Math.sin(a) * d);
    }
  } else if (w.eventKind === 'stasis') {
    // 解除时的冲击 = 当前面板 DPS × 2
    const dmg = panelDps(w) * BAL.events.stasis.dmgMult;
    const tmp: import('./types').Enemy[] = [];
    w.hash.query(w.player.x, w.player.y, 1400, tmp);
    for (const e of tmp) {
      if (e.active) w.applyDamagePublic(e, dmg, 'body', { noRes: true });
    }
    w.shake = 0.16;
    w.spawnRing(w.player.x, w.player.y, 30, 900, 0.5, COLORS.player, 1);
  }
  w.onEvent('event-end');
  w.eventKind = null;
  w.eventT = 0;
}

/** 事件期间的生成倍率（时潮涌动 ×2.5） */
export function eventSpawnMult(w: World): number {
  return w.eventKind === 'tide' ? BAL.events.tide.spawnMult : 1;
}

/** 事件期间的共鸣值获取倍率（共鸣泉 ×2） */
export function eventGaugeMult(w: World): number {
  return w.eventKind === 'spring' ? BAL.events.spring.gaugeMult : 1;
}

export function eventLabel(kind: EventKind): string {
  switch (kind) {
    case 'tide': return '时潮涌动';
    case 'spring': return '共鸣泉';
    default: return '停滞领域';
  }
}
