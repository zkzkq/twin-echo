export interface Poolable {
  active: boolean;
  idx: number;
}

/** 对象池（GDD §11.2：敌人/弹幕/宝石/VFX 零运行时分配） */
export class Pool<T extends Poolable> {
  readonly items: T[] = [];
  private free: number[] = [];
  private readonly make: (idx: number) => T;

  constructor(make: (idx: number) => T, prealloc = 0) {
    this.make = make;
    for (let i = 0; i < prealloc; i++) {
      const it = this.obtain();
      this.release(it);
    }
  }

  obtain(): T {
    let i = this.free.pop();
    if (i === undefined) {
      i = this.items.length;
      this.items.push(this.make(i));
    }
    const it = this.items[i]!;
    it.active = true;
    return it;
  }

  release(it: T): void {
    if (!it.active) return;
    it.active = false;
    this.free.push(it.idx);
  }

  get count(): number {
    return this.items.length - this.free.length;
  }

  releaseAll(): void {
    for (const it of this.items) if (it.active) this.release(it);
  }
}
