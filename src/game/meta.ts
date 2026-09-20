import { META_NODES, metaCost, metaNodeById, metaPrereq, type MetaEffectKey } from '../config/meta';

/** 密库增益汇总（局外 → 局内）：全部为加算或简单乘算，便于调参 */
export interface MetaBonuses {
  hpBonus: number;
  levelHealBonus: number;
  windowBonus: number;
  gaugeGainPct: number;
  gaugeStart: number;
  resDmgPct: number;
  pincerDmgPct: number;
  syncBonusPct: number;
  sandPct: number;
  winSandPct: number;
  xpPct: number;
  rerollBonus: number;
  choiceBonus: number;
  critBonus: number;
  startWeaponLv: number;
  echoDmgPct: number;
  burstRadiusPct: number;
  burstDmgPct: number;
  burstInvulnBonus: number;
  pickupPct: number;
  moveSpdPct: number;
  cdPct: number;
  armorPct: number;
  regenPerSec: number;
}

export const EMPTY_BONUSES: MetaBonuses = {
  hpBonus: 0, levelHealBonus: 0, windowBonus: 0, gaugeGainPct: 0, gaugeStart: 0, resDmgPct: 0,
  pincerDmgPct: 0, syncBonusPct: 0, sandPct: 0, winSandPct: 0, xpPct: 0, rerollBonus: 0,
  choiceBonus: 0, critBonus: 0, startWeaponLv: 0, echoDmgPct: 0, burstRadiusPct: 0,
  burstDmgPct: 0, burstInvulnBonus: 0, pickupPct: 0, moveSpdPct: 0, cdPct: 0, armorPct: 0, regenPerSec: 0,
};

/** 由已解锁节点集合汇总增益（每个节点最多 2 条效果） */
export function computeBonuses(unlocked: readonly string[]): MetaBonuses {
  const b: MetaBonuses = { ...EMPTY_BONUSES };
  for (const id of unlocked) {
    const node = metaNodeById(id);
    if (!node) continue;
    b[node.effect as MetaEffectKey] += node.value;
    if (node.effect2 && node.value2 !== undefined) b[node.effect2] += node.value2;
  }
  return b;
}

export interface BuyResult {
  ok: boolean;
  reason?: string;
}

/** 购买校验（前置 + 时砂） */
export function canBuy(unlocked: readonly string[], id: string, sand: number): BuyResult {
  const node = metaNodeById(id);
  if (!node) return { ok: false, reason: '节点不存在' };
  if (unlocked.includes(id)) return { ok: false, reason: '已解锁' };
  const pre = metaPrereq(node);
  if (pre && !unlocked.includes(pre.id)) return { ok: false, reason: `需要先解锁「${pre.name}」` };
  const cost = metaCost(node.depth);
  if (sand < cost) return { ok: false, reason: `时砂不足（需 ${cost}，持有 ${sand}）` };
  return { ok: true };
}

/** 密库总花费（用于反通胀监控，GDD §6.8.5） */
export function totalMetaCost(): number {
  return META_NODES.reduce((p, n) => p + metaCost(n.depth), 0);
}
