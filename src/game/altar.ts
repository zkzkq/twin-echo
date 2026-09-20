import { Sprite } from 'pixi.js';
import { BAL } from '../config/balance';
import { EVOLUTIONS, evolutionById, type EvolutionDef } from '../config/items';
import { COLORS, hiddenSprite } from './textures';
import type { Altar } from './types';
import type { World } from './world';

/** 祭坛刷新（GDD §6.5：8:00 / 13:00 / 18:00，距玩家 300–500px 随机方位） */
export function spawnAltar(w: World): void {
  const a = w.rng.angle();
  const d = w.rng.range(BAL.altar.distMin, BAL.altar.distMax);
  const sprite = new Sprite(w.tex.altar);
  sprite.anchor.set(0.5);
  sprite.tint = COLORS.altar;
  sprite.position.set(w.player.x + Math.cos(a) * d, w.player.y + Math.sin(a) * d);
  const ring = new Sprite(w.tex.ring);
  ring.anchor.set(0.5);
  ring.tint = COLORS.echo;
  ring.alpha = 0.55;
  ring.scale.set(1.6);
  ring.position.copyFrom(sprite.position);
  w.layers.fx.addChild(ring);
  w.layers.gems.addChild(sprite);
  w.altars.push({ x: sprite.x, y: sprite.y, spawnedAt: w.time, used: false, channel: 0, sprite, ring });
  w.onEvent('altar-spawn');
}

/** 可从选项里做的进化（武器满级 + 配方被动满级 + 结晶 ×2 + 未做过） */
export function satisfiableRecipes(w: World): EvolutionDef[] {
  const p = w.player;
  if (p.crystals < 2) return [];
  return EVOLUTIONS.filter((e) => {
    if (p.evolutions.has(e.id)) return false;
    const ws = p.weapons.get(e.weapon);
    const pl = p.passives.get(e.passive) ?? 0;
    return !!ws && ws.lv >= BAL.altar.weaponMax && pl >= BAL.altar.passiveMax;
  });
}

/** 完成进化：消耗 2 结晶，写入 evolutions（效果由各系统读取） */
export function craftEvolution(w: World, id: string): boolean {
  const evo = evolutionById(id);
  if (!evo) return false;
  if (!satisfiableRecipes(w).some((e) => e.id === id)) return false;
  w.player.crystals -= 2;
  w.player.evolutions.add(id);
  w.stats.altarCrafted++;
  w.audio.bossDie();
  w.shake = 0.2;
  w.spawnRing(w.player.x, w.player.y, 20, 380, 0.7, COLORS.echo, 1);
  w.spawnRing(w.player.x, w.player.y, 10, 260, 0.55, COLORS.altar, 0.8);
  for (let i = 0; i < 40; i++) {
    w.spawnParticle(w.player.x, w.player.y, i % 2 === 0 ? COLORS.echo : COLORS.altar, w.rng.range(120, 520), w.rng.range(0.3, 0.7), w.rng.range(2, 5));
  }
  w.onEvent('evolved');
  return true;
}

/**
 * 祭坛逐帧更新：站入引导 2s 完成 → 有可做配方则请求打开面板；
 * 受击打断（由 world.damagePlayer 清零 channel 实现）。
 */
export function updateAltars(w: World, dt: number): void {
  const p = w.player;
  for (const alt of w.altars) {
    if (alt.used) continue;
    alt.ring.rotation += dt * 0.8;
    const inside = (p.x - alt.x) ** 2 + (p.y - alt.y) ** 2 <= BAL.altar.radius * BAL.altar.radius;
    if (!inside) {
      alt.channel = 0;
      continue;
    }
    if (alt.channel === 0) {
      w.stats.altarReached++;
      w.onEvent('altar-enter');
    }
    alt.channel += dt;
    if (alt.channel >= BAL.altar.channel) {
      const ready = satisfiableRecipes(w);
      if (ready.length > 0) {
        alt.used = true;
        alt.sprite.alpha = 0.35;
        alt.ring.visible = false;
        w.onEvent('altar-ready');
      } else {
        alt.channel = 0;
        w.onEvent('altar-unmet');
      }
    }
  }
}

/** 受击打断引导（GDD §6.5：引导 2s 不可受击——这是走位风险决策点） */
export function interruptAltars(w: World): void {
  for (const alt of w.altars) alt.channel = 0;
}

/** 清场（换局时销毁精灵） */
export function clearAltars(w: World): void {
  for (const alt of w.altars) {
    alt.sprite.destroy();
    alt.ring.destroy();
  }
  w.altars.length = 0;
}

/** 最近未使用祭坛（供 HUD 指引） */
export function nearestAltar(w: World): Altar | null {
  let best: Altar | null = null;
  let bd = Infinity;
  for (const alt of w.altars) {
    if (alt.used) continue;
    const d = (alt.x - w.player.x) ** 2 + (alt.y - w.player.y) ** 2;
    if (d < bd) {
      bd = d;
      best = alt;
    }
  }
  return best;
}

/** 创建精灵用的隐藏占位（保持 pool/纹理引用一致） */
export function altarHintSprite(w: World): Sprite {
  return hiddenSprite(w.tex.ring, w.layers.fx);
}
