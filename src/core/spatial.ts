import type { Enemy } from '../game/types';

/**
 * 空间哈希网格（cell 64px，GDD §11.2）。
 * 每个敌人只插入其中心所在 cell，查询方需自带半径余量（≥ 最大敌半径）。
 */
export class SpatialHash {
  private readonly cell = 64;
  private readonly map = new Map<number, Enemy[]>();

  clear(): void {
    for (const a of this.map.values()) a.length = 0;
  }

  private key(cx: number, cy: number): number {
    return cx * 131072 + cy;
  }

  insert(e: Enemy): void {
    const cx = Math.floor(e.x / this.cell);
    const cy = Math.floor(e.y / this.cell);
    const k = this.key(cx, cy);
    let a = this.map.get(k);
    if (!a) {
      a = [];
      this.map.set(k, a);
    }
    a.push(e);
  }

  /** 收集覆盖 (x,y,r) 的所有 cell 中的敌人到 out（调用方做精确距离判定） */
  query(x: number, y: number, r: number, out: Enemy[]): void {
    out.length = 0;
    const c0 = Math.floor((x - r) / this.cell);
    const c1 = Math.floor((x + r) / this.cell);
    const r0 = Math.floor((y - r) / this.cell);
    const r1 = Math.floor((y + r) / this.cell);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cy = r0; cy <= r1; cy++) {
        const a = this.map.get(this.key(cx, cy));
        if (a) for (let i = 0; i < a.length; i++) out.push(a[i]!);
      }
    }
  }
}
