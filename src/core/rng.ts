/** mulberry32 —— 确定性种子随机（GDD §6.8.4 固定种子基础） */
export class RNG {
  private s: number;

  constructor(seed: number) {
    this.s = (seed >>> 0) || 1;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }

  /** 闭区间整数 [a, b] */
  int(a: number, b: number): number {
    return Math.floor(a + this.next() * (b - a + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  angle(): number {
    return this.next() * Math.PI * 2;
  }
}
