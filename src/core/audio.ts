/**
 * WebAudio 程序化占位音效（GDD §12.1：音阶音频占位即可）。
 * 共鸣 chime 使用五声音阶（C-D-E-G-A）随连击上行 —— 音效即连击计。
 */
export class AudioSys {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastPick = 0;
  private lastHit = 0;
  private lastKill = 0;
  private combo = 0;
  private lastChime = 0;

  private readonly pentatonic = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];

  /** 在首次用户手势时调用（自动播放策略） */
  ensure(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.32;
        this.master.connect(this.ctx.destination);
      } catch {
        /* 无音频环境时静默 */
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (slide !== 0) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  /** 共鸣击：五声音阶上行（连击 2s 内递增） */
  chime(): void {
    const now = performance.now();
    if (now - this.lastChime > 2000) this.combo = 0;
    this.lastChime = now;
    const f = this.pentatonic[Math.min(this.combo, this.pentatonic.length - 1)]!;
    this.combo++;
    this.tone(f, 0.18, 'sine', 0.22);
    this.tone(f * 2, 0.1, 'sine', 0.06);
  }

  pickup(): void {
    const n = performance.now();
    if (n - this.lastPick < 70) return;
    this.lastPick = n;
    this.tone(920, 0.06, 'sine', 0.1, 500);
  }

  hit(): void {
    const n = performance.now();
    if (n - this.lastHit < 70) return;
    this.lastHit = n;
    this.tone(190, 0.035, 'square', 0.045);
  }

  kill(): void {
    const n = performance.now();
    if (n - this.lastKill < 90) return;
    this.lastKill = n;
    this.tone(320, 0.07, 'triangle', 0.08, -170);
  }

  hurt(): void {
    this.tone(200, 0.25, 'sawtooth', 0.2, -140);
    this.tone(90, 0.3, 'square', 0.12, -40);
  }

  heal(): void {
    this.tone(520, 0.15, 'sine', 0.14, 140);
  }

  /** 同步爆发：低频对冲波 + 高频裂响 */
  burst(): void {
    this.tone(70, 0.5, 'sine', 0.5, -40);
    this.tone(1400, 0.35, 'sawtooth', 0.14, -1300);
    this.tone(660, 0.5, 'sine', 0.18, 330, 0.05);
  }

  warn(): void {
    this.tone(440, 0.15, 'square', 0.15);
    this.tone(440, 0.15, 'square', 0.15, 0, 0.22);
  }

  levelup(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.15, 0, i * 0.07));
  }

  bossDie(): void {
    this.tone(160, 0.8, 'sawtooth', 0.28, -120);
    [660, 880, 1320].forEach((f, i) => this.tone(f, 0.3, 'sine', 0.12, 0, 0.1 + i * 0.12));
  }

  victory(): void {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.16, 0, i * 0.12));
  }

  defeat(): void {
    [440, 349, 262].forEach((f, i) => this.tone(f, 0.5, 'sawtooth', 0.14, -30, i * 0.25));
  }
}
