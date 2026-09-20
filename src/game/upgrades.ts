import type { RNG } from '../core/rng';
import { PASSIVES, WEAPONS, recompute, type PassiveDef, type WeaponDef } from '../config/items';
import type { World } from './world';

/** 升级三选一选项（GDD §6.4 受控随机） */
export interface Choice {
  kind: 'weapon' | 'passive' | 'sand';
  id: string;
  name: string;
  glyph: string;
  /** 当前等级（新获得为 0） */
  lv: number;
  isNew: boolean;
  desc: string;
  tagLabel: string;
  maxDesc: string;
}

function mkWeapon(def: WeaponDef, lv: number, isNew: boolean): Choice {
  return {
    kind: 'weapon', id: def.id, name: def.name, glyph: def.glyph, lv, isNew,
    desc: def.desc, tagLabel: def.tags[0] ?? '', maxDesc: def.maxDesc,
  };
}

function mkPassive(def: PassiveDef, lv: number, isNew: boolean): Choice {
  return {
    kind: 'passive', id: def.id, name: def.name, glyph: def.glyph, lv, isNew,
    desc: def.desc, tagLabel: def.id === 'resonance' ? '共鸣' : '辅助', maxDesc: '',
  };
}

interface PoolEntry {
  c: Choice;
  weight: number;
}

/** 无放回加权抽样 */
function weightedSampleN(rng: RNG, arr: PoolEntry[], n: number): PoolEntry[] {
  const pool = arr.slice();
  const out: PoolEntry[] = [];
  while (out.length < n && pool.length > 0) {
    let total = 0;
    for (const x of pool) total += x.weight;
    let r = rng.next() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    out.push(pool.splice(idx, 1)[0]!);
  }
  return out;
}

/**
 * 生成三选一：
 * - 权重：持有武器升级 1.0 / 新武器 0.9 / 持有被动 1.1 / 新被动 0.8（GDD §6.4）
 * - 命运加权保底：至少 1 项为当前最高等级武器的升级（消灭"三个废选项"）
 * - 全满级 → 时砂 ×15（满级项防废）
 */
export function genChoices(w: World): Choice[] {
  const p = w.player;
  const pool: PoolEntry[] = [];

  for (const def of WEAPONS) {
    const st = p.weapons.get(def.id);
    if (st) {
      if (st.lv < def.max) pool.push({ c: mkWeapon(def, st.lv, false), weight: 1.0 });
    } else if (p.weapons.size < 6) {
      pool.push({ c: mkWeapon(def, 0, true), weight: 0.9 });
    }
  }
  for (const def of PASSIVES) {
    if (w.run.noPassive) break; // 每日挑战「无被动日」
    const lv = p.passives.get(def.id) ?? 0;
    if (lv > 0) {
      if (lv < def.max) pool.push({ c: mkPassive(def, lv, false), weight: 1.1 });
    } else if (p.passives.size < 8) {
      pool.push({ c: mkPassive(def, 0, true), weight: 0.8 });
    }
  }

  if (pool.length === 0) {
    return [{
      kind: 'sand', id: 'sand', name: '时砂 ×15', glyph: '砂', lv: 0, isNew: false,
      desc: '所有选项都已满级——收割者顺手捋走了 15 枚时砂（满级防废转化）',
      tagLabel: 'Meta', maxDesc: '',
    }];
  }

  // 密库「四选一 / 命运主宰」（M3）：升级面板选项数 +1/+2
  const n = Math.min(w.run.choiceCount + w.meta.choiceBonus, pool.length);
  const chosen = weightedSampleN(w.rng, pool, n);

  // 命运加权保底
  let topId: string | null = null;
  let best = -1;
  for (const [id, st] of p.weapons) {
    if (st.lv < 6 && st.lv > best) {
      best = st.lv;
      topId = id;
    }
  }
  if (topId !== null && !chosen.some((x) => x.c.id === topId)) {
    const rep = pool.find((x) => x.c.id === topId);
    if (rep) chosen[Math.min(chosen.length - 1, 2)] = rep;
  }

  return chosen.map((x) => x.c);
}

/** 应用选项（活力拾取时立即回复 15） */
export function applyChoice(w: World, c: Choice): void {
  if (c.kind === 'sand') {
    w.stats.sandBonus += 15;
    return;
  }
  if (c.kind === 'weapon') {
    let st = w.player.weapons.get(c.id);
    if (!st) {
      st = { lv: 0, cd: 0.2 };
      w.player.weapons.set(c.id, st);
    }
    st.lv++;
    return;
  }
  const lv = (w.player.passives.get(c.id) ?? 0) + 1;
  w.player.passives.set(c.id, lv);
  recompute(w.player);
  if (c.id === 'vigor') {
    w.player.hp = Math.min(w.player.maxHp, w.player.hp + 15);
  }
}
