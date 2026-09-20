import type { PlayerState } from '../game/types';

export type WeaponKind = 'orbit' | 'bolt' | 'pulse' | 'butterfly' | 'chain' | 'trail';

export interface WeaponDef {
  id: string;
  name: string;
  glyph: string;
  kind: WeaponKind;
  tags: readonly string[];
  /** Lv1 基伤 */
  base: number;
  /** 触发间隔（秒），环绕/轨迹类为 0 */
  interval: number;
  max: number;
  desc: string;
  maxDesc: string;
}

/** M2 首发 6 武器（GDD §6.2 的子集，每级 +10% 基伤，Lv6 满级特效） */
export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'clock', name: '时钟指针', glyph: '针', kind: 'orbit', tags: ['环绕'],
    base: 12, interval: 0, max: 6,
    desc: '2 根指针环绕自身旋转，接触敌人造成伤害（每个敌人 0.5s 一次）',
    maxDesc: '3 根指针 · 半径 90 → 120',
  },
  {
    id: 'bolt', name: '裂空弩', glyph: '弩', kind: 'bolt', tags: ['弹幕'],
    base: 18, interval: 1.1, max: 6,
    desc: '向最近的敌人射出贯穿弩矢（最多命中 3 个）',
    maxDesc: '3 连发 · 最多命中 5 个',
  },
  {
    id: 'pulse', name: '音波钟鸣', glyph: '钟', kind: 'pulse', tags: ['脉冲'],
    base: 14, interval: 1.6, max: 6,
    desc: '以自身为中心释放音波脉冲（半径 150）',
    maxDesc: '半径 240 · 击退敌人',
  },
  {
    id: 'butterfly', name: '回声蝶', glyph: '蝶', kind: 'butterfly', tags: ['追踪'],
    base: 9, interval: 0.9, max: 6,
    desc: '放出 2 只追踪敌人的回声蝶',
    maxDesc: '5 只回声蝶',
  },
  {
    id: 'chain', name: '电弧链', glyph: '链', kind: 'chain', tags: ['连锁', '共鸣'],
    base: 16, interval: 1.3, max: 6,
    desc: '电弧在 200px 内的敌人间连锁（跳 3 个目标）',
    maxDesc: '跳 5 个目标',
  },
  {
    id: 'trail', name: '残光轨迹', glyph: '痕', kind: 'trail', tags: ['轨迹'],
    base: 8, interval: 0.3, max: 6,
    desc: '移动留下 0.8s 残光痕迹，敌人触碰受伤（每敌 0.4s 一次）',
    maxDesc: '痕迹延至 1.6s',
  },
];

export interface PassiveDef {
  id: string;
  name: string;
  glyph: string;
  max: number;
  desc: string;
}

/** M2 首发 8 被动（GDD §6.3 的子集，满级 Lv5） */
export const PASSIVES: readonly PassiveDef[] = [
  { id: 'power', name: '力量', glyph: '力', max: 5, desc: '伤害 +8% / 级' },
  { id: 'haste', name: '急速', glyph: '速', max: 5, desc: '攻击间隔 −7% / 级（下限 0.4×）' },
  { id: 'crit', name: '会心', glyph: '暴', max: 5, desc: '暴击率 +4% / 级（基础 5% · 暴伤 1.5×）' },
  { id: 'vigor', name: '活力', glyph: '活', max: 5, desc: '生命上限 +15 / 级（拾取时立即回复 15）' },
  { id: 'swift', name: '疾足', glyph: '疾', max: 5, desc: '移速 +5% / 级' },
  { id: 'resonance', name: '共振', glyph: '振', max: 5, desc: '共鸣伤害 +10% / 级 · 共鸣值获取 +8% / 级' },
  { id: 'cd', name: '冷却', glyph: '却', max: 5, desc: '冷却 −6% / 级（与急速叠乘，下限 0.4×）' },
  { id: 'area', name: '幅域', glyph: '域', max: 5, desc: '武器范围 +8% / 级（半径/落点域）' },
];

/**
 * 武器进化配方（GDD §6.5，祭坛制确定性进化）。
 * M2 交付前 2 条（时钟指针+冷却 / 裂空弩+会心）；其余 4 条排入 M3。
 */
export interface EvolutionDef {
  id: string;
  name: string;
  weapon: string;
  passive: string;
  desc: string;
}

export const EVOLUTIONS: readonly EvolutionDef[] = [
  {
    id: 'duet', name: '永恒二重奏', weapon: 'clock', passive: 'cd',
    desc: '双环反向旋转（覆盖角 ×2）· 伤害 +40%',
  },
  {
    id: 'arrow', name: '贯穿命运之矢', weapon: 'bolt', passive: 'crit',
    desc: '必暴 2.5× · 每次击杀永久 +2% 伤害（当局累计，上限 10 层）',
  },
];

export function weaponById(id: string): WeaponDef {
  return WEAPONS.find((w) => w.id === id)!;
}

export function passiveById(id: string): PassiveDef {
  return PASSIVES.find((p) => p.id === id)!;
}

export function evolutionById(id: string): EvolutionDef | undefined {
  return EVOLUTIONS.find((e) => e.id === id);
}

/** 由被动等级重算玩家派生属性（GDD §6.3 / §7.3） */
export function recompute(p: PlayerState): void {
  const s = p.stats;
  const lv = (id: string): number => p.passives.get(id) ?? 0;
  s.dmg = 0.08 * lv('power');
  s.atkSpd = 0.07 * lv('haste');
  s.critCh = 0.05 + 0.04 * lv('crit');
  s.critDmg = 1.5;
  s.moveSpd = 0.05 * lv('swift');
  s.resDmg = 0.1 * lv('resonance');
  s.resGain = 0.08 * lv('resonance');
  s.cd = 0.06 * lv('cd');
  s.area = 0.08 * lv('area');
  s.echoRange = 1;
  p.maxHp = 100 + 15 * lv('vigor');
  p.speed = 190 * (1 + s.moveSpd);
}
