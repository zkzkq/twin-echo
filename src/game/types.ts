import type { Sprite } from 'pixi.js';

/** 伤害来源：本体 / 残影（共鸣判定的两极） */
export type Src = 'body' | 'echo';

export type EnemyKind = 'moth' | 'idol' | 'hopper' | 'cultist' | 'boss';

/** Boss 种类（GDD §6.6 四连战；M2 实装前两种，后两种暂用占位行为） */
export type BossKind = 'minute' | 'hourglass' | 'twin' | 'weaver';

export interface Enemy {
  idx: number;
  active: boolean;
  id: number;
  kind: EnemyKind;
  /** Boss 变体（非 Boss 为空串） */
  bossKind: BossKind | '';
  elite: boolean;
  boss: boolean;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dmg: number;
  speed: number;
  xpVal: number;
  radius: number;
  armor: number;
  tint: number;
  /** 减速剩余（同步爆发） */
  slowT: number;
  /** 定身剩余（停滞领域事件） */
  frozenT: number;
  /** 受击白闪剩余 */
  flashT: number;
  /** 对玩家碰撞冷却（0.8s/敌） */
  hitCd: number;
  /** 蓄力预警（跳针/Boss 技前摇） */
  tele: boolean;
  /** 行为状态机 */
  st: number;
  stT: number;
  /** 辅助：游走方向 / Boss 技能轮转 */
  pat: number;
  ax: number;
  ay: number;
  /** 击退速度 */
  kx: number;
  ky: number;
  fireCd: number;
  auraCd: number;
  /** 共鸣标记：上一跳来源与时间 */
  lastHitSrc: Src | null;
  lastHitT: number;
  /** 时钟针对该敌人的接触冷却（本体/残影各一） */
  orbitCdB: number;
  orbitCdE: number;
  /** 残光轨迹对该敌人的接触冷却 */
  trailCd: number;
  sprite: Sprite;
  /** 精英光环圈 */
  ring: Sprite | null;
}

export interface Bullet {
  idx: number;
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  r: number;
  life: number;
  hostile: boolean;
  /** 剩余可命中数 */
  pierce: number;
  hitIds: Set<number>;
  homing: boolean;
  retarget: number;
  target: Enemy | null;
  src: Src;
  kind: 'bolt' | 'butterfly' | 'enemy';
  /** 进化体「贯穿命运之矢」：该弹必暴 */
  forceCrit: boolean;
  /** 归属武器 id（用于进化判定的击杀叠伤） */
  weaponId: string;
  sprite: Sprite;
}

export interface Gem {
  idx: number;
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tier: number;
  /** > 0 时为回复晶 */
  heal: number;
  /** > 0 时为回响结晶（进化材料，GDD §6.5） */
  crystal: number;
  magnet: boolean;
  sprite: Sprite;
}

/** 场地危险区（双生回响兽的镜像刃 / 地图危险区 / BOSS 减速带通用） */
export interface Hazard {
  idx: number;
  active: boolean;
  x: number;
  y: number;
  r: number;
  /** 剩余存活时间 */
  t: number;
  /** 预警剩余（>0 时不结算伤害，只显示预警） */
  tele: number;
  /** 每秒对玩家造成的伤害（0 = 只减速不掉血） */
  dps: number;
  /** 玩家在区内的减速系数（1 = 不减速） */
  slowFactor: number;
  kind: 'blade' | 'sand' | 'vortex';
  color: number;
  sprite: Sprite;
}

/** 残光轨迹段（残光轨迹武器） */
export interface TrailSeg {
  idx: number;
  active: boolean;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  /** 归属：残影的痕迹伤害同样走 echo 系数 */
  src: Src;
  sprite: Sprite;
}

export interface Particle {
  idx: number;
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
  sprite: Sprite;
}

/** 扩散圆环 VFX（脉冲/共鸣/爆发） */
export interface RingFx {
  idx: number;
  active: boolean;
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  maxLife: number;
  color: number;
  sprite: Sprite;
}

/** 武器进化祭坛（GDD §6.5：8/13/18 分钟刷新，站入引导 2s，受击打断） */
export interface Altar {
  x: number;
  y: number;
  spawnedAt: number;
  used: boolean;
  channel: number;
  sprite: Sprite;
  ring: Sprite;
}

export interface WeaponState {
  lv: number;
  cd: number;
}

export interface PlayerStats {
  dmg: number;
  atkSpd: number;
  critCh: number;
  critDmg: number;
  moveSpd: number;
  resDmg: number;
  resGain: number;
  /** 冷却缩减（与急速叠乘，下限 0.4×） */
  cd: number;
  /** 武器范围加成 */
  area: number;
  /** 残影攻击范围倍率（默认 1；共鸣 A/B 实验与后续被动用） */
  echoRange: number;
}

export interface PlayerState {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  pickupR: number;
  facing: number;
  invulnT: number;
  /** 全局受击宽限剩余 */
  hurtCd: number;
  /** 玩家减速剩余（时漏巨像沙流带） */
  slowT: number;
  level: number;
  xp: number;
  xpNeed: number;
  /** 共鸣值 0-100 */
  gauge: number;
  /** 回响结晶持有数 */
  crystals: number;
  /** 已完成的进化 */
  evolutions: Set<string>;
  weapons: Map<string, WeaponState>;
  passives: Map<string, number>;
  stats: PlayerStats;
}

/** 残影攻击事件（本体火力 → 2.5s 后由残影重演） */
export interface EchoEvent {
  frame: number;
  id: string;
  kind: 'bolt' | 'pulse' | 'butterfly' | 'chain';
  x: number;
  y: number;
  ang: number;
  count: number;
}

/** 残影双子状态：位置/朝向环形缓冲 + 待重演攻击事件 */
export interface EchoState {
  x: number;
  y: number;
  facing: number;
  bx: Float32Array;
  by: Float32Array;
  br: Float32Array;
  head: number;
  count: number;
  events: EchoEvent[];
}

export interface OrbitNeedle {
  x: number;
  y: number;
  sprite: Sprite;
}

export interface OrbitState {
  phase: number;
  needles: OrbitNeedle[];
}

export interface RunStats {
  kills: number;
  hits: number;
  resHits: number;
  bursts: number;
  elitesKilled: number;
  elitesSpawned: number;
  bossKills: number;
  levelsGained: number;
  skipped: number;
  sandBonus: number;
  damageTaken: number;
  /** 祭坛到达 / 完成进化 / 事件触发次数（§14 埋点） */
  altarReached: number;
  altarCrafted: number;
  eventsFired: number;
}

export interface WorldFlags {
  resToasted: boolean;
  gaugeToasted: boolean;
  moveToasted: boolean;
  rushToasted: boolean;
  firstEliteToasted: boolean;
}
