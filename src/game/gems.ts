import { BAL } from '../config/balance';
import { COLORS } from './textures';
import type { Gem } from './types';
import type { World } from './world';

/** 掉落 XP 宝石（tier 0-3：蓝/绿/金/虹）。
 *  §7.2 性能护栏：同屏拾取物达上限（500）时强制合并，合并后仍满则丢弃该次掉落。 */
export function spawnGem(w: World, tier: number, x: number, y: number): void {
  if (!w.merging && w.gems.count >= BAL.gems.cap) {
    w.merging = true;
    mergeNow(w);
    w.merging = false;
    if (w.gems.count >= BAL.gems.cap) return;
  }
  const g = w.gems.obtain();
  g.tier = tier;
  g.heal = 0;
  g.crystal = 0;
  g.x = x;
  g.y = y;
  g.vx = 0;
  g.vy = 0;
  g.magnet = false;
  g.sprite.texture = w.tex.gem;
  g.sprite.tint = COLORS.gems[tier] ?? 0xffffff;
  g.sprite.scale.set(0.75 + tier * 0.15);
  g.sprite.visible = true;
}

/** 回复晶（精英/Boss 掉落的生存补给） */
export function spawnHeal(w: World, x: number, y: number, amount: number): void {
  const g = w.gems.obtain();
  g.tier = 0;
  g.heal = amount;
  g.crystal = 0;
  g.x = x;
  g.y = y;
  g.vx = 0;
  g.vy = 0;
  g.magnet = false;
  g.sprite.texture = w.tex.heal;
  g.sprite.tint = COLORS.heal;
  g.sprite.scale.set(1.1);
  g.sprite.visible = true;
}

/** 回响结晶（GDD §6.5 进化材料：精英必掉 1、Boss 必掉 2） */
export function spawnCrystal(w: World, x: number, y: number): void {
  const g = w.gems.obtain();
  g.tier = 0;
  g.heal = 0;
  g.crystal = 1;
  g.x = x;
  g.y = y;
  g.vx = 0;
  g.vy = 0;
  g.magnet = false;
  g.sprite.texture = w.tex.altar;
  g.sprite.tint = COLORS.altar;
  g.sprite.scale.set(0.85);
  g.sprite.visible = true;
}

/** 磁吸拾取（0.3s 内加速飞向玩家，防"宝石尾巴"） + 合并（同级 ≥5 → 1 上级） */
export function updateGems(w: World, dt: number): void {
  const p = w.player;
  for (const g of w.gems.items) {
    if (!g.active) continue;
    const dx = p.x - g.x;
    const dy = p.y - g.y;
    const d = Math.hypot(dx, dy) || 1;
    // 回响吸取（M3）：同步 ramp 同时放大拾取半径（最高 +60%）——让"留在编队里"也能吃到经验
    // 被动「磁引」（M3）：固定拾取半径加成
    const pr = p.pickupR * (1 + p.stats.pickup) * (1 + w.syncBonus() * BAL.resonance.syncPickupPct);
    if (!g.magnet && d <= pr) g.magnet = true;
    if (g.magnet) {
      g.vx += (dx / d) * BAL.player.magnetAccel * dt;
      g.vy += (dy / d) * BAL.player.magnetAccel * dt;
      const s = Math.hypot(g.vx, g.vy);
      if (s > BAL.player.magnetMax) {
        g.vx *= BAL.player.magnetMax / s;
        g.vy *= BAL.player.magnetMax / s;
      }
      g.x += g.vx * dt;
      g.y += g.vy * dt;
    }
    const d2 = Math.hypot(p.x - g.x, p.y - g.y);
    if (d2 <= BAL.player.collectR) {
      if (g.crystal > 0) {
        p.crystals += g.crystal;
        w.audio.heal();
        w.spawnRing(g.x, g.y, 4, 40, 0.3, COLORS.altar, 0.9);
        w.onEvent('crystal-picked');
      } else if (g.heal > 0) {
        p.hp = Math.min(p.maxHp, p.hp + g.heal);
        w.audio.heal();
        w.spawnParticle(g.x, g.y, COLORS.heal, 60, 0.25, 3);
      } else {
        w.addXp(BAL.gems.values[g.tier] ?? 1);
        w.audio.pickup();
        w.spawnParticle(g.x, g.y, COLORS.gems[g.tier] ?? 0xffffff, 60, 0.25, 2);
      }
      w.gems.release(g);
    }
  }
}

/** 周期合并（每 2s 一次，§7.1：同屏同级 ≥5 → 1 个上级，+20% 价值） */
export function mergePass(w: World, dt: number): void {
  w.mergeT -= dt;
  if (w.mergeT > 0) return;
  w.mergeT = BAL.gems.mergeEvery;
  mergeNow(w);
}

/**
 * 立即合并全部档位。
 * 单次扫描实现（O(n)）：旧版是"反复全表扫描凑 5 个"，宝石堆到数千时会退化成 O(n²)，
 * 实测满构筑 300 敌下造成每 2s 一次 100–250ms 卡顿（见 M1 实测与调参记录）。
 */
export function mergeNow(w: World): void {
  for (let tier = 0; tier <= 2; tier++) {
    const list: Gem[] = [];
    for (const g of w.gems.items) {
      if (g.active && g.heal === 0 && g.crystal === 0 && g.tier === tier) list.push(g);
    }
    const need = BAL.gems.mergeNeed;
    for (let i = 0; i + need <= list.length; i += need) {
      let cx = 0;
      let cy = 0;
      for (let k = 0; k < need; k++) {
        const g = list[i + k]!;
        cx += g.x;
        cy += g.y;
        w.gems.release(g);
      }
      spawnGem(w, tier + 1, cx / need, cy / need);
    }
  }
}
