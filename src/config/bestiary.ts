/**
 * 图鉴（M3，GDD §6.9）：敌人 / 精英 / Boss 的资料页。
 * 解锁规则很简单——**遇到过就解锁**，击杀数累计写进存档（saved.codex）。
 * 数据不重复定义数值：敌人的基础数值来自 BASE（enemies.ts），Boss 来自 BAL.bosses，
 * 这里只补"玩家看得懂的那部分"（行为描述 + 应对提示）。
 */
import { BAL } from './balance';

export type CodexKind = 'enemy' | 'elite' | 'boss';

export interface CodexEntry {
  /** 与 enemies.ts 的 kind / BossKind 对齐（用于统计击杀数） */
  id: string;
  kind: CodexKind;
  name: string;
  glyph: string;
  color: number;
  /** 基础数值一行（HP / 速度 / 接触伤；Boss 另加护甲） */
  stats: string;
  behavior: string;
  tip: string;
}

export const CODEX_ENEMIES: readonly CodexEntry[] = [
  {
    id: 'moth', kind: 'enemy', name: '时蛾', glyph: '蛾', color: 0xa9b4c8,
    stats: 'HP 12 · 速度 120 · 接触伤 3', behavior: '直线蜂群，带轻微正弦摆动，数量最多',
    tip: '密度最高的杂兵；残光轨迹与音波脉冲对它最划算',
  },
  {
    id: 'hopper', kind: 'enemy', name: '跳针', glyph: '针', color: 0xc96a50,
    stats: 'HP 18 · 速度 95 · 接触伤 4', behavior: '周期性跳跃突进，落地有小停顿',
    tip: '突进前有前摇——它起跳的瞬间就是你拉开残影距离的窗口',
  },
  {
    id: 'idol', kind: 'enemy', name: '膜拜者', glyph: '偶', color: 0x8a6f4d,
    stats: 'HP 40 · 速度 60 · 接触伤 3', behavior: '缓慢推进，血量厚，常在中后期堆成墙',
    tip: '厚甲吃减伤，优先用贯穿类武器（裂空弩 / 双生棱镜）穿透',
  },
  {
    id: 'cultist', kind: 'enemy', name: '织网蛛', glyph: '蛛', color: 0xb08968,
    stats: 'HP 26 · 速度 80 · 接触伤 3', behavior: '保持中距游走，偶尔绕后',
    tip: '它绕后时会落到你的残影附近——正好是制造夹击的位置',
  },
  {
    id: 'elite', kind: 'elite', name: '精英（时相畸变体）', glyph: '精', color: 0xffd23e,
    stats: 'HP ×40 · 体型 ×1.3 · 随机光环', behavior: '3:00 起每 90s 一只（18:00 后 45s）；光环有三类：移速场 / 再生 / 环形弹幕',
    tip: '击杀掉回响结晶 ×1（进化材料）；环形弹幕那类不要贴脸打',
  },
  ...BAL.bosses.map((b): CodexEntry => ({
    id: b.kind, kind: 'boss', name: b.name, glyph: '王', color: b.kind === 'weaver' ? 0x9a6bff : b.kind === 'hourglass' ? 0xc9a227 : 0xd95f4a,
    stats: `HP ${b.hp.toLocaleString('en-US')} · 护甲 ${b.armor} · 接触伤 ${b.dmg}`,
    behavior: {
      minute: '环形弹幕（多波错相）+ 扇形冲锋',
      hourglass: '激光扫场 + 召唤时蛾潮 + 沙流减速带',
      twin: '镜像玩家 4 秒前的轨迹：延迟领域（残影 +2s）/ 镜像突进 / 回响刃',
      weaver: '三阶段：P1 弹幕突进 → P2 静止织机（圈内残影延迟 +2s）+ 召唤 → P3 全屏扩散弹幕波',
    }[b.kind] ?? '未知',
    tip: {
      minute: '弹幕波之间有空隙，沿切线走位即可；冲锋前摇 0.8s，别直线后退',
      hourglass: '激光按固定角速度扫，绕着她转圈就能躲；沙流带只是减速，不要为躲它撞进蛾潮',
      twin: '她会打你 4 秒前站的位置——主动"错位"自己的走法，别踩在自己刚走过的路上',
      weaver: 'P2 的紫圈是领域：退到圈外输出就能解除残影延迟；P3 全屏波要留一次同步爆发当无敌帧',
    }[b.kind] ?? '',
  })),
];

export const CODEX: readonly CodexEntry[] = [...CODEX_ENEMIES];

export function codexById(id: string): CodexEntry | undefined {
  return CODEX.find((c) => c.id === id);
}
