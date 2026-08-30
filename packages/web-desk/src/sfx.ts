/**
 * WebAudio 合成音效：全部由振荡器/噪声实时生成，无音频资源文件。
 * 首次用户手势后惰性创建 AudioContext（浏览器自动播放策略）。
 */

export type SfxName =
  | "click"
  | "confirm"
  | "cancel"
  | "coin"
  | "deal"
  | "flip"
  | "reveal"
  | "challenge"
  | "block"
  | "eliminate"
  | "victory"
  | "turn"
  | "join"
  | "leave"
  | "tick"
  | "error"
  | "timeout";

const STORAGE_KEY = "coup.sfxEnabled";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let cachedEnabled: boolean | null = null;

function loadEnabled(): boolean {
  if (cachedEnabled != null) return cachedEnabled;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    cachedEnabled = raw !== "0";
  } catch {
    cachedEnabled = true;
  }
  return cachedEnabled;
}

function saveEnabled(value: boolean): void {
  cachedEnabled = value;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // ignore quota / private mode
  }
}

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  return ctx;
}

function getNoise(context: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const length = Math.floor(context.sampleRate * 0.5);
    noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  return noiseBuffer;
}

type ToneOptions = {
  type?: OscillatorType;
  /** 起始频率 Hz。 */
  from: number;
  /** 结束频率 Hz（默认与 from 相同）。 */
  to?: number;
  /** 相对起始时间 s。 */
  at?: number;
  /** 时长 s。 */
  dur: number;
  /** 峰值音量。 */
  gain: number;
  /** 攻击时间 s（默认 0.004）。 */
  attack?: number;
};

function tone(options: ToneOptions): void {
  const context = audioContext();
  if (!context || !master) return;
  const {
    type = "sine",
    from,
    to = from,
    at = 0,
    dur,
    gain,
    attack = 0.004,
  } = options;
  const t0 = context.currentTime + at;
  const osc = context.createOscillator();
  const env = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, from), t0);
  if (to !== from) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  }
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env);
  env.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

type NoiseOptions = {
  at?: number;
  dur: number;
  gain: number;
  /** 带通中心频率 Hz。 */
  freq: number;
  /** 带通 Q。 */
  q?: number;
  /** 中心频率滑到（Hz）。 */
  sweepTo?: number;
};

function noise(options: NoiseOptions): void {
  const context = audioContext();
  if (!context || !master) return;
  const { at = 0, dur, gain, freq, q = 1.2, sweepTo } = options;
  const t0 = context.currentTime + at;
  const src = context.createBufferSource();
  src.buffer = getNoise(context);
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(freq, t0);
  if (sweepTo) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
  }
  filter.Q.value = q;
  const env = context.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(env);
  env.connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

const RECIPES: Record<SfxName, () => void> = {
  click: () => {
    tone({ type: "triangle", from: 1750, dur: 0.045, gain: 0.06 });
  },
  confirm: () => {
    tone({ type: "triangle", from: 620, to: 780, dur: 0.09, gain: 0.14 });
    tone({ type: "sine", from: 930, to: 1180, at: 0.07, dur: 0.12, gain: 0.1 });
  },
  cancel: () => {
    tone({ type: "triangle", from: 340, to: 220, dur: 0.11, gain: 0.11 });
  },
  coin: () => {
    tone({ type: "sine", from: 2350, dur: 0.32, gain: 0.1 });
    tone({ type: "sine", from: 3150, at: 0.015, dur: 0.26, gain: 0.06 });
    tone({ type: "triangle", from: 1560, at: 0.005, dur: 0.14, gain: 0.05 });
  },
  deal: () => {
    noise({ dur: 0.22, gain: 0.12, freq: 2600, sweepTo: 900, q: 0.8 });
  },
  flip: () => {
    noise({ dur: 0.09, gain: 0.1, freq: 1800, sweepTo: 3200, q: 1.4 });
    tone({ type: "triangle", from: 900, to: 620, at: 0.05, dur: 0.07, gain: 0.07 });
  },
  reveal: () => {
    tone({ type: "sawtooth", from: 180, to: 560, dur: 0.5, gain: 0.05 });
    noise({ at: 0.34, dur: 0.4, gain: 0.12, freq: 500, sweepTo: 160, q: 0.7 });
    tone({ type: "sine", from: 110, to: 58, at: 0.36, dur: 0.55, gain: 0.16 });
  },
  challenge: () => {
    tone({ type: "square", from: 220, dur: 0.13, gain: 0.07 });
    tone({ type: "square", from: 196, at: 0.12, dur: 0.2, gain: 0.07 });
    noise({ at: 0.1, dur: 0.16, gain: 0.06, freq: 900, q: 0.9 });
  },
  block: () => {
    noise({ dur: 0.1, gain: 0.13, freq: 420, q: 0.6 });
    tone({ type: "sine", from: 150, to: 95, dur: 0.16, gain: 0.13 });
  },
  eliminate: () => {
    tone({ type: "sine", from: 75, to: 40, dur: 0.85, gain: 0.24 });
    noise({ at: 0.02, dur: 0.5, gain: 0.1, freq: 300, sweepTo: 90, q: 0.5 });
  },
  victory: () => {
    const notes = [523, 659, 784, 1046];
    notes.forEach((freq, i) => {
      tone({ type: "triangle", from: freq, at: i * 0.13, dur: 0.3, gain: 0.11 });
      tone({ type: "sine", from: freq * 2, at: i * 0.13, dur: 0.22, gain: 0.04 });
    });
    tone({ type: "triangle", from: 1046, at: 0.55, dur: 0.7, gain: 0.1 });
    tone({ type: "sine", from: 1319, at: 0.55, dur: 0.6, gain: 0.05 });
  },
  turn: () => {
    tone({ type: "sine", from: 880, dur: 0.4, gain: 0.09 });
    tone({ type: "sine", from: 1320, at: 0.02, dur: 0.32, gain: 0.05 });
  },
  join: () => {
    tone({ type: "triangle", from: 660, dur: 0.1, gain: 0.1 });
    tone({ type: "triangle", from: 880, at: 0.09, dur: 0.14, gain: 0.1 });
  },
  leave: () => {
    tone({ type: "triangle", from: 660, dur: 0.1, gain: 0.08 });
    tone({ type: "triangle", from: 440, at: 0.09, dur: 0.16, gain: 0.08 });
  },
  tick: () => {
    tone({ type: "square", from: 1050, dur: 0.03, gain: 0.05 });
  },
  error: () => {
    tone({ type: "square", from: 160, to: 120, dur: 0.14, gain: 0.09 });
  },
  timeout: () => {
    tone({ type: "square", from: 780, dur: 0.09, gain: 0.08 });
    tone({ type: "square", from: 620, at: 0.12, dur: 0.16, gain: 0.08 });
  },
};

export const sfx = {
  isEnabled(): boolean {
    return loadEnabled();
  },
  setEnabled(value: boolean): void {
    saveEnabled(value);
    if (value) {
      audioContext();
    }
  },
  /** 预热：在首次用户手势里调用，解锁 AudioContext。 */
  unlock(): void {
    if (loadEnabled()) {
      audioContext();
    }
  },
  play(name: SfxName): void {
    if (!loadEnabled()) return;
    try {
      RECIPES[name]();
    } catch {
      // 音效失败不影响交互
    }
  },
};
