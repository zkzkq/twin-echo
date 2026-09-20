import { BAL } from '../config/balance';
import { characterById, type CharacterDef } from '../config/characters';
import { paradoxByLvl, type ParadoxMods } from '../config/paradox';
import { dailyKey, dailyMod, type DailyMod } from '../config/daily';

/** 一局的可配置来源：角色 / 悖论等级 / 每日挑战 */
export interface RunOptions {
  character: string;
  paradox: number;
  daily: boolean;
  /** 地图 id（GDD §6.7；默认时钟平原） */
  map?: string;
}

/** 汇总后的局内修正（角色 + 悖论 + 每日；密库增益单独走 world.meta） */
export interface RunMods {
  character: string;
  characterName: string;
  paradox: number;
  daily: boolean;
  /** 地图 id（世界按此查 MapDef） */
  map: string;
  dailyModName: string;
  dailyModDesc: string;
  /** 残影 */
  echoDelayFrames: number;
  echoCoeff: number;
  /** 伤害 */
  bodyDmgPct: number;
  resDmgPct: number;
  resWindowBonus: number;
  gaugeGainPct: number;
  /** 玩家属性 */
  hpPct: number;
  hpDelta: number;
  moveSpdPct: number;
  xpPct: number;
  pickupPct: number;
  sandPct: number;
  /** 开局/升级 */
  startWeapon: string;
  choiceCount: number;
  noPassive: boolean;
  /** 特殊机制 */
  stasisOnHitChance: number;
  burstRadiusPct: number;
  burstHastePct: number;
  /** 难度修正（敌方） */
  enemySpeedPct: number;
  enemyDmgPct: number;
  spawnPct: number;
  eliteFreqMult: number;
  bossHpPct: number;
}

function fromParadox(p: ParadoxMods, m: RunMods): void {
  m.enemySpeedPct += p.enemySpeedPct ?? 0;
  m.spawnPct += p.spawnPct ?? 0;
  m.eliteFreqMult *= p.eliteFreqMult ?? 1;
  m.hpPct += p.hpPct ?? 0;
  m.enemyDmgPct += p.enemyDmgPct ?? 0;
  m.bossHpPct += p.bossHpPct ?? 0;
}

function fromDaily(d: DailyMod, m: RunMods): void {
  m.dailyModName = d.name;
  m.dailyModDesc = d.desc;
  m.enemySpeedPct += d.enemySpeedPct ?? 0;
  m.spawnPct += d.spawnPct ?? 0;
  m.eliteFreqMult *= d.eliteFreqMult ?? 1;
  m.gaugeGainPct += d.gaugeGainPct ?? 0;
  m.resWindowBonus += d.resWindowBonus ?? 0;
  m.noPassive = m.noPassive || !!d.noPassive;
  if (d.echoCoeff !== undefined) m.echoCoeff = d.echoCoeff;
}

function fromCharacter(c: CharacterDef, m: RunMods): void {
  m.character = c.id;
  m.characterName = c.name;
  const mods = c.mods;
  if (mods.echoDelayFrames !== undefined) m.echoDelayFrames = mods.echoDelayFrames;
  if (mods.echoCoeff !== undefined) m.echoCoeff = mods.echoCoeff;
  m.bodyDmgPct += mods.bodyDmgPct ?? 0;
  m.resWindowBonus += mods.resWindowBonus ?? 0;
  m.resDmgPct += mods.resDmgPct ?? 0;
  m.hpDelta += mods.hpDelta ?? 0;
  m.moveSpdPct += mods.moveSpdPct ?? 0;
  m.xpPct += mods.xpPct ?? 0;
  m.pickupPct += mods.pickupPct ?? 0;
  m.sandPct += mods.sandPct ?? 0;
  m.stasisOnHitChance = Math.max(m.stasisOnHitChance, mods.stasisOnHitChance ?? 0);
  if (mods.choiceCount) m.choiceCount = mods.choiceCount;
  m.burstRadiusPct += mods.burstRadiusPct ?? 0;
  m.burstHastePct = Math.max(m.burstHastePct, mods.burstHastePct ?? 0);
  if (c.startWeapon) m.startWeapon = c.startWeapon;
}

/** 汇总修正：角色 → 悖论 → 每日（顺序无关，均为加算/乘算） */
export function computeRunMods(opts: RunOptions): RunMods {
  const m: RunMods = {
    character: 'otto', characterName: '', paradox: opts.paradox, daily: opts.daily,
    map: opts.map ?? 'plain',
    dailyModName: '', dailyModDesc: '',
    echoDelayFrames: BAL.echo.delayFrames,
    echoCoeff: BAL.echo.coeff,
    bodyDmgPct: 0, resDmgPct: 0, resWindowBonus: 0, gaugeGainPct: 0,
    hpPct: 0, hpDelta: 0, moveSpdPct: 0, xpPct: 0, pickupPct: 0, sandPct: 0,
    startWeapon: '', choiceCount: 3, noPassive: false,
    stasisOnHitChance: 0, burstRadiusPct: 0, burstHastePct: 0,
    enemySpeedPct: 0, enemyDmgPct: 0, spawnPct: 0, eliteFreqMult: 1, bossHpPct: 0,
  };
  fromCharacter(characterById(opts.character), m);
  fromParadox(paradoxByLvl(opts.paradox).mods, m);
  if (opts.daily) fromDaily(dailyMod(dailyKey()), m);
  return m;
}

/** 默认（标准局、首角色）修正 */
export function defaultRunMods(): RunMods {
  return computeRunMods({ character: 'otto', paradox: 0, daily: false });
}
