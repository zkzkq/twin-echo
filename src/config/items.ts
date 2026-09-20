import type { PlayerState } from '../game/types';

export type WeaponKind =
  | 'orbit' | 'bolt' | 'pulse' | 'butterfly' | 'chain' | 'trail'
  // M3 新增 6 把（覆盖"扇形 / 往返 / 落点 / 减速 / 双影 / 残影"六种打法）
  | 'pendulum' | 'boomerang' | 'rain' | 'web' | 'prism' | 'chime';

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

  // ---------- M3 新增 6 武器（GDD §6.2 全表） ----------
  {
    id: 'pendulum', name: '钟摆镰', glyph: '摆', kind: 'pendulum', tags: ['扇形'],
    base: 20, interval: 1.5, max: 6,
    desc: '朝面向挥出 120° 扇形镰刃（半径 170）',
    maxDesc: '半径 230 · 击退翻倍',
  },
  {
    id: 'boomerang', name: '回旋镖', glyph: '镖', kind: 'boomerang', tags: ['往返'],
    base: 15, interval: 1.4, max: 6,
    desc: '掷出回旋镖，去程与回程各造成一次伤害',
    maxDesc: '2 枚回旋镖 · 回程伤害 ×1.6',
  },
  {
    id: 'rain', name: '时之沙暴', glyph: '沙', kind: 'rain', tags: ['落点'],
    base: 24, interval: 1.9, max: 6,
    desc: '在最近的 3 个敌人头顶落下沙柱（半径 70）',
    maxDesc: '5 个落点 · 半径 110',
  },
  {
    id: 'web', name: '命运织网', glyph: '网', kind: 'web', tags: ['减速'],
    base: 8, interval: 2.2, max: 6,
    desc: '在敌群中心织出减速网（半径 130 · 移速 −35% · 3s）',
    maxDesc: '半径 180 · 减速 −50%',
  },
  {
    id: 'prism', name: '双生棱镜', glyph: '镜', kind: 'prism', tags: ['双影', '共鸣'],
    base: 16, interval: 1.5, max: 6,
    desc: '本体与**残影**同时射出光矢（残影那发按残影命中结算，可触发共鸣）',
    maxDesc: '各 2 发 · 贯穿 3 个',
  },
  {
    id: 'chime', name: '回响钟鸣', glyph: '鸣', kind: 'chime', tags: ['残影', '共鸣'],
    base: 13, interval: 1.7, max: 6,
    desc: '以**残影**为中心释放钟鸣脉冲（半径 140）——残影离敌群越近越强',
    maxDesc: '半径 210 · 击退',
  },
];

export interface PassiveDef {
  id: string;
  name: string;
  glyph: string;
  max: number;
  desc: string;
}

/** M2 首发 8 被动 + M3 补足 7 项（GDD §6.3 全表，满级 Lv5） */
export const PASSIVES: readonly PassiveDef[] = [
  { id: 'power', name: '力量', glyph: '力', max: 5, desc: '伤害 +8% / 级' },
  { id: 'haste', name: '急速', glyph: '速', max: 5, desc: '攻击间隔 −7% / 级（下限 0.4×）' },
  { id: 'crit', name: '会心', glyph: '暴', max: 5, desc: '暴击率 +4% / 级（基础 5% · 暴伤 1.5×）' },
  { id: 'vigor', name: '活力', glyph: '活', max: 5, desc: '生命上限 +15 / 级（拾取时立即回复 15）' },
  { id: 'swift', name: '疾足', glyph: '疾', max: 5, desc: '移速 +5% / 级' },
  { id: 'resonance', name: '共振', glyph: '振', max: 5, desc: '共鸣伤害 +10% / 级 · 共鸣值获取 +8% / 级' },
  { id: 'cd', name: '冷却', glyph: '却', max: 5, desc: '冷却 −6% / 级（与急速叠乘，下限 0.4×）' },
  { id: 'area', name: '幅域', glyph: '域', max: 5, desc: '武器范围 +8% / 级（半径/落点域）' },
  // ---- M3 ----
  { id: 'echo', name: '回响', glyph: '响', max: 5, desc: '残影伤害 +12% / 级（编队流的伤害来源）' },
  { id: 'magnet', name: '磁引', glyph: '磁', max: 5, desc: '拾取半径 +18% / 级' },
  { id: 'armor', name: '甲壳', glyph: '甲', max: 5, desc: '受到伤害 −5% / 级' },
  { id: 'regen', name: '再生', glyph: '生', max: 5, desc: '每秒回复 0.5 生命 / 级' },
  { id: 'greed', name: '丰收', glyph: '丰', max: 5, desc: '经验获取 +10% / 级' },
  { id: 'damp', name: '滞时', glyph: '滞', max: 5, desc: '敌人移速 −3% / 级（全局时间阻尼）' },
  { id: 'burstcore', name: '共鸣核', glyph: '核', max: 5, desc: '同步爆发伤害 +20% / 级' },
];

/**
 * 武器进化配方（GDD §6.5，祭坛制确定性进化）。
 * M2 交付前 2 条；M3 补齐到 6 条（覆盖 6 件武器 × 6 项被动）。
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
  // ---- M3 新增 4 条（2 → 6）----
  {
    id: 'metronome', name: '命运节拍器', weapon: 'boomerang', passive: 'haste',
    desc: '回旋镖 ×2 · 往返速度 +40% · 回程伤害 ×1.6',
  },
  {
    id: 'sandstorm', name: '时之沙暴', weapon: 'rain', passive: 'area',
    desc: '落点 +3 · 半径 +40% · 命中附加 0.5s 定身',
  },
  {
    id: 'mirror', name: '双生镜界', weapon: 'prism', passive: 'echo',
    desc: '棱镜变 3 向散射 · 残影那发伤害 ×1.25',
  },
  {
    id: 'singularity', name: '时空奇点', weapon: 'chime', passive: 'cd',
    desc: '钟鸣半径 +60% · 每次命中回复 1 点共鸣值',
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
  // ---- M3 新增被动的派生属性 ----
  s.echoDmg = 0.12 * lv('echo');
  s.pickup = 0.18 * lv('magnet');
  s.armor = 0.05 * lv('armor');
  s.regen = 0.5 * lv('regen');
  s.greed = 0.1 * lv('greed');
  s.damp = 0.03 * lv('damp');
  s.burstDmg = 0.2 * lv('burstcore');
  p.maxHp = 100 + 15 * lv('vigor');
  p.speed = 190 * (1 + s.moveSpd);
}
