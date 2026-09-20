/**
 * 全局数值配置 —— 与《双影回响》GDD §7 / §16 调参表对齐。
 * 所有数值均为 [待测试] 假设值，须经 M1 试玩验证后冻结。
 */

export const BAL = {
  meta: {
    /** 单局时长（秒）—— M2 恢复 GDD §4.2 的 20 分钟标准局 */
    runSeconds: 1200,
  },
  player: {
    hp: 100,
    speed: 190,
    radius: 13,
    pickupR: 80,
    magnetAccel: 2600,
    magnetMax: 950,
    collectR: 26,
    /** 全局受击宽限（M1 新增：GDD 只规定"每敌 0.8s"，但同时被 5 只贴身会秒融，
     *  加 0.25s 全局宽限把接触伤害上限从 ~60/s 压到 ~40/s，避免"被围即秒"） */
    hurtGrace: 1.0,
    /** 升级回复（M2 提高：20 分钟局要求死亡中位 ≥11min，需支撑更长的接触压力） */
    levelHeal: 15,
  },
  echo: {
    /** 环形缓冲帧数 = 60Hz × 2.5s */
    delayFrames: 150,
    /** 残影伤害系数（本体 × 0.6） */
    coeff: 0.6,
  },
  /**
   * 共鸣 KPI（**M2 口径变更**，见 GDD §5.2 变更记录）：
   * 覆盖率（共鸣击/总命中）在 AoE 武器下结构性偏低且不可达（M1 实测 16–18%，A/B 证明
   * 调延迟/射程均无效）。故主 KPI 改为**共鸣击频率**（次/分）——直接度量"玩家多久看到一次共鸣"，
   * 与 §5.2 的设计目的（共鸣可感，支柱 P2）一致。覆盖率降级为诊断量。
   */
  resonance: {
    /** 本体×残影命中窗口（秒） */
    window: 1.0,
    /** 共鸣击伤害乘区 */
    dmgMult: 1.3,
    /** 单次共鸣值（调节杠杆；0.8 使爆发节奏落在 §5.3 的 60–90s） */
    gaugeGain: 0.8,
    gaugeMax: 100,
    /** KPI：共鸣击频率目标区间（次/分）——基线实测 88.5，目标"每 0.5–1.5 秒一次火花" */
    perMinTarget: [50, 120] as const,
    /** 报警线：低于此值说明机制几乎不发生；高于此值说明判定太松 */
    perMinAlarm: [25, 200] as const,

    // ---------- M3 新增：让"编队走位"有收益（实测结论：当前数值下谨慎走位毫无回报，见调参记录 §21） ----------
    /**
     * 双影夹击：本体与残影从**相反方向**命中同一敌人（两侧夹角 >120°）时的额外奖励。
     * 设计意图：把"残影在你身后跟着"变成"把敌人夹在两个你之间"——位置编排第一次产生数值回报。
     */
    pincerAngleCos: -0.5,   // cos(120°)：两攻击方向夹角超过 120° 即判夹击
    pincerDmgMult: 1.35,    // 夹击共鸣的额外伤害乘区
    pincerGaugeMult: 1.5,   // 夹击共鸣的共鸣值乘区
    /**
     * 回响同步：本体与残影距离 ≤ syncRange 时进入同步态，**连续保持越久增益越高**（ramp）。
     * 设计意图与实测依据（见调参记录 §23）：
     *   固定 +15% 的版本实测无效——贪宝石机器人本来就有 20–38% 时间"顺带同步"，
     *   固定小加成既区分不出技巧，也抵不过"不追宝石 → 掉等级"的损失（编队 3.5min/Lv11 vs 贪宝石 4.2min/Lv14）。
     *   故改为叠加：只有**承诺编队**（连续贴住残影）才能拿到满额，从而让"贴着残影打"变成一条真正的强度路线；
     *   增益同时作用于伤害与共鸣值——共鸣值→同步爆发→清场→宝石→等级，把走位接回经济循环。
     */
    syncRange: 130,
    syncPerSec: 0.075,      // 每连续同步 1 秒 +7.5% 伤害与共鸣值
    syncMaxBonus: 0.6,      // 上限 +60%（8 秒叠满）
    syncDefMax: 0.25,       // 满 ramp 时受到的伤害 -25%（回响护体）
    syncPickupPct: 1,       // 拾取半径随 ramp 放大，满 ramp +60%（回响吸取）
    dampRange: 140,         // 回响阻尼半径：残影周围多少像素内的敌人会被拖慢
    dampMax: 0.25,          // 满 ramp、贴到残影脸上时最多 -25% 移速（回响阻尼）
    /** 兼容旧口径的展示用基础值（UI 文案用；实际乘区见 syncPerSec/syncMaxBonus） */
    syncDmgPct: 0.15,
  },
  burst: {
    radius: 360,
    dpsMult: 4,
    slowFactor: 0.6,
    slowDur: 3,
    invuln: 0.5,
    kb: 130,
  },
  weapons: {
    /** 急速叠加的间隔下限（× 基础间隔） */
    atkFloor: 0.4,
    boltSpeed: 460,
    butterflySpeed: 230,
    butterflyLife: 4,
    butterflyTurn: 5.2,
    /** 回旋镖（M3）：飞出速度 · 折返时刻（秒）· 回程伤害倍率 */
    boomerangSpeed: 330,
    boomerangTurnAt: 0.45,
    boomerangReturnMult: 1.6,
    orbitContactCd: 0.5,
    /** 残光轨迹：留痕间隔 / 单敌接触冷却（GDD §6.2 残光轨迹 8/0.3s） */
    trailEvery: 0.3,
    trailContactCd: 0.4,
  },
  gems: {
    /** 蓝 / 绿 / 金 / 虹 四档 XP */
    values: [1, 6, 36, 216],
    /** 同屏同级 ≥5 → 合并为 1 上级（+20% 价值） */
    mergeNeed: 5,
    cap: 500,
    mergeEvery: 2,
  },
  /** VFX 预算（GDD §10.2：同屏粒子 ≤1,500；此处留 100 余量作硬上限） */
  vfx: { particleCap: 1400 },
  /** 敌人 HP 成长（分钟 1 归一）：HP(m) = HP₀ × 该系数 */
  enemyHpScale: (m: number): number => Math.pow((1 + 0.18 * m) / 1.18, 1.35),
  spawn: {
    /** GDD §7.4 的分钟刻度（M2 扩展到 20 分钟） */
    minute: [1, 3, 5, 8, 10, 13, 15, 18, 20],
    interval: [1.4, 1.0, 0.8, 0.6, 0.5, 0.4, 0.35, 0.3, 0.25],
    /**
     * 每 tick 生成数（支持小数，导演用累积债务取整）。
     * 标定口径：**生成/分 ≈ 实测击杀能力 × 1.05**（M1 实测击杀 220–360/分），
     * 故 batch 大致与 interval 成反比（约 130/min → 360/min），密度由 cap 兜底。
     * 修正记录：M1 曾用 [1,2,3,4,5]（同屏 3–40，太稀疏）与 [4…12]（5.6min 被围阵亡）。
     */
    batch: [3, 3.5, 3, 2.5, 2.2, 2.0, 1.8, 1.6, 1.5],
    /** GDD §7.4 在场上限（桌面口径，M2 恢复全量） */
    cap: [120, 180, 240, 320, 380, 450, 520, 580, 600],
  },
  swarm: { first: 75, every: 60, base: 12 },
  elite: {
    first: 180,
    every: 90,
    jitter: 30,
    hpMult: 40,
    sizeMult: 1.3,
    gems: 5,
    heal: 30,
    auraEvery: 4,
    auraBullets: 12,
    /** 回响结晶：精英必掉 1（GDD §6.5） */
    crystals: 1,
  },
  /** 回响结晶 × 武器进化祭坛（GDD §6.5，M2 核心系统） */
  altar: {
    /** 刷新时刻（秒）：8:00 / 13:00 / 18:00 */
    at: [480, 780, 1080],
    /** 距玩家 300–500px 随机方位 */
    distMin: 300,
    distMax: 500,
    /** 交互：站入引导 2s，受击打断 */
    channel: 2,
    radius: 46,
    /** 进化配方所需的被动必须满级（Lv5）、武器满级（Lv6） */
    weaponMax: 6,
    passiveMax: 5,
  },
  /** 局内事件（GDD §6.7；M2 首批 3 件，均为"效果型"无需额外面板） */
  events: {
    /** 每 120s roll 1 次；Boss 战期间禁用 */
    every: 120,
    first: 90,
    list: ['tide', 'spring', 'stasis'] as const,
    /** 时潮涌动：30s 内生成 ×2.5，结束掉落宝石雨 ×60 */
    tide: { dur: 30, spawnMult: 2.5, gemRain: 60 },
    /** 共鸣泉：30s 内共鸣值获取 ×2 */
    spring: { dur: 30, gaugeMult: 2 },
    /** 停滞领域：全场定身 4s，解除时受一次冲击（面板 DPS ×2） */
    stasis: { dur: 4, dmgMult: 2 },
  },
  /**
   * Boss 连战（GDD §6.6：05:00 / 10:00 / 15:00 / 20:00）——M2 交付前两只，后两只为占位行为。
   * ⚠ 接触伤：GDD 原值 25（首只）是按 §7.5 的 6 武器+进化 DPS 曲线（500+@5min）标定的；
   * 实测 MVP 构筑 DPS 仅 ~200，Boss 接触伤 25 配合受击宽限 1.0s ⇒ 25/s，玩家贴身即秒。
   * M2 暂取 ~12（与弹幕同量级，保留扇形冲锋的威胁），M3 按最终 DPS 曲线复标。
   */
  bosses: [
    { at: 300, kind: 'minute' as const, name: '分针兽', hp: 6000, armor: 12, dmg: 12, speed: 55, radius: 34 },
    { at: 600, kind: 'hourglass' as const, name: '时漏巨像', hp: 18000, armor: 16, dmg: 14, speed: 42, radius: 42 },
    { at: 900, kind: 'twin' as const, name: '双生回响兽', hp: 36000, armor: 18, dmg: 15, speed: 60, radius: 38 },
    { at: 1200, kind: 'weaver' as const, name: '时间织造者·诺诺', hp: 58000, armor: 20, dmg: 17, speed: 50, radius: 48 },
  ],
  /**
   * 终 Boss 时间织造者·诺诺（20:00）——三阶段 + 领域（GDD §6.6）。
   * 主题：她"织"的是时间本身，所以三阶段都在改写玩家与残影的关系：
   *   P1 织梭（>66%）：弹幕 + 突进，先让玩家学会她的节奏；
   *   P2 静止织机（33–66%）：展开半径 300 的领域——**领域内残影延迟 +2s**，残影被"织慢"，配合被拆散；
   *   P3 终末织梭（<33%）：狂暴，全屏扩散弹幕波 + 高速突进 + 召唤织蛛。
   * 领域是**可读可躲**的减益：退到领域外输出即可规避（代价是与 Boss 拉开距离、命中率下降）。
   */
  weaver: {
    phase2At: 0.66,
    phase3At: 0.33,
    domainR: 300,
    domainExtraFrames: 120, // 领域内残影延迟 +2s（与双生回响兽同量级，但只在圈内生效）
    waveCount: 3,           // P3 全屏波：每轮 3 层扩散弹幕
    waveGap: 0.32,
  },
  boss: {
    at: 300,
    warnBefore: 3,
    hp: 6000,
    armor: 12,
    dmg: 25,
    speed: 55,
    radius: 34,
    bulletDmg: 12,
    bulletSpeed: 130,
    barrageCount: 20,
  },
  /** 终局冲刺 18:00–20:00（§8.4 超载时刻：密度上限放开 + 爆发循环） */
  rush: { start: 1080, intervalMult: 0.7, batchAdd: 2 },
  /** 减伤：敌甲 / (敌甲 + 80 + 12 × 分钟) */
  armorReduction: (armor: number, minutes: number): number =>
    armor <= 0 ? 0 : armor / (armor + 80 + 12 * minutes),
  /** 单级 XP 需求：6 + 4.5 × (l-1)^1.4 */
  xpCurve: (l: number): number => Math.round(6 + 4.5 * Math.pow(Math.max(1, l) - 1, 1.4)),
  /** 时砂结算（GDD §6.8.1） */
  sand: (minutes: number, kills: number, elites: number, bosses: number, win: boolean): number =>
    Math.floor(minutes * 10 + kills / 80 + elites * 5 + bosses * 20 + (win ? 100 : 0)),
};

/** 分段线性插值（按分钟） */
export function interp(minute: readonly number[], vals: readonly number[], m: number): number {
  const mm = Math.max(0, m);
  if (mm <= minute[0]) return vals[0];
  for (let i = 1; i < minute.length; i++) {
    if (mm <= minute[i]) {
      const t = (mm - minute[i - 1]) / (minute[i] - minute[i - 1]);
      return vals[i - 1] + (vals[i] - vals[i - 1]) * t;
    }
  }
  return vals[vals.length - 1];
}
