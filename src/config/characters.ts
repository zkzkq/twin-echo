/**
 * 可选角色（GDD §6.1 首发 9 名）——M3 实装。
 *
 * 与 GDD 的差异（均已标注）：GDD 部分角色使用尚未实装的武器（蜂群折刃/悖论镜盾/时砂瓶），
 * 此处映射到现有 6 把武器，并在 traitNote 里写明；「影织者·薇」的"第二残影"与「商人的遗孤·皮普」
 * 的局内商栈折扣依赖 M3 后半系统，暂以已实现的效果替代，详见各项 note。
 */
export interface CharacterMods {
  /** 残影延迟（帧，60Hz）：覆盖全局默认 150（2.5s） */
  echoDelayFrames?: number;
  /** 残影伤害系数：覆盖全局默认 0.6 */
  echoCoeff?: number;
  /** 本体伤害加成（只作用于 body 来源） */
  bodyDmgPct?: number;
  /** 共鸣窗口加成（秒） */
  resWindowBonus?: number;
  /** 共鸣伤害加成 */
  resDmgPct?: number;
  /** 生命上限加/减（点） */
  hpDelta?: number;
  moveSpdPct?: number;
  xpPct?: number;
  pickupPct?: number;
  /** 结算时砂加成（皮普的开局时砂先以此形式落地） */
  sandPct?: number;
  /** 受击时停概率与内置冷却（诺亚） */
  stasisOnHitChance?: number;
  /** 升级选项数（提克为 4） */
  choiceCount?: number;
  /** 同步爆发半径加成 */
  burstRadiusPct?: number;
  /** 同步爆发后攻速加成（持续 3s） */
  burstHastePct?: number;
}

export interface CharacterDef {
  id: string;
  name: string;
  glyph: string;
  /** 起始武器 id（空串 = 默认时钟指针） */
  startWeapon: string;
  role: string;
  traitNote: string;
  /** 解锁花费（0 = 初始） */
  cost: number;
  /** 挑战解锁：条件键 + 人类可读描述（有则优先进挑战） */
  challenge?: { key: 'lv12in5' | 'burst10'; desc: string };
  mods: CharacterMods;
}

export const CHARACTERS: readonly CharacterDef[] = [
  {
    id: 'otto', name: '钟表匠·奥托', glyph: '奥', startWeapon: 'clock', role: '教学标准型',
    traitNote: '残影延迟 3.0s（更远的第二火力）；移速 −5%',
    cost: 0,
    mods: { echoDelayFrames: 180, moveSpdPct: -0.05 },
  },
  {
    id: 'mia', name: '见习者·米娅', glyph: '米', startWeapon: 'butterfly', role: '新手容错',
    traitNote: '经验获取 +10%；拾取半径 +25%',
    cost: 0,
    mods: { xpPct: 0.1, pickupPct: 0.25 },
  },
  {
    id: 'kai', name: '断剑士·凯', glyph: '凯', startWeapon: 'bolt', role: '本体流',
    traitNote: '本体伤害 +20%；残影系数 0.5（GDD 起始武器「蜂群折刃」未实装，暂用裂空弩）',
    cost: 150,
    mods: { bodyDmgPct: 0.2, echoCoeff: 0.5 },
  },
  {
    id: 'rin', name: '谐振者·铃', glyph: '铃', startWeapon: 'chain', role: '共鸣流',
    traitNote: '共鸣窗口 1.0s → 1.4s；共鸣伤 +15%',
    cost: 150,
    mods: { resWindowBonus: 0.4, resDmgPct: 0.15 },
  },
  {
    id: 'wei', name: '影织者·薇', glyph: '薇', startWeapon: 'trail', role: '双影流（高难）',
    traitNote: '残影延迟 1.5s（贴身双影）+ 残影系数 0.65；生命 −20（GDD「第二残影」依赖多残影系统，M3 后半实装）',
    cost: 600,
    mods: { echoDelayFrames: 90, echoCoeff: 0.65, hpDelta: -20 },
  },
  {
    id: 'pip', name: '商人的遗孤·皮普', glyph: '皮', startWeapon: '', role: '经济流',
    traitNote: '结算时砂 +80%；拾取半径 +10%（GDD 的局内商栈折扣依赖未实装的商栈事件）',
    cost: 1000,
    mods: { sandPct: 0.8, pickupPct: 0.1 },
  },
  {
    id: 'noah', name: '时停者·诺亚', glyph: '诺', startWeapon: 'pulse', role: '生存流',
    traitNote: '受击 30% 概率时停 0.5s（内置 CD 5s）（GDD 起始武器「悖论镜盾」未实装，暂用音波钟鸣）',
    cost: 1600,
    mods: { stasisOnHitChance: 0.3 },
  },
  {
    id: 'tik', name: '神童·提克', glyph: '提', startWeapon: 'bolt', role: '高手流',
    traitNote: '升级选项 4 选 1（其余角色为 3 选 1）',
    cost: 0,
    challenge: { key: 'lv12in5', desc: '挑战：5 分钟内达到 Lv12' },
    mods: { choiceCount: 4 },
  },
  {
    id: 'norn', name: '完美回响·诺恩', glyph: '恩', startWeapon: 'pulse', role: '主动技流',
    traitNote: '同步爆发半径 +30%；爆发后 3s 攻速 +25%',
    cost: 0,
    challenge: { key: 'burst10', desc: '挑战：单局同步爆发 ≥10 次（GDD 原文 25，实测单局上限约 14，暂降为 10 待定）' },
    mods: { burstRadiusPct: 0.3, burstHastePct: 0.25 },
  },
];

export function characterById(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0]!;
}
