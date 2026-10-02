import { clamp, NAMES } from "./model.js";
const RATE = 22050;
let seed = 137;
const noise = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
  return ((seed >>> 0) / 4294967296) * 2 - 1;
};
export function starterSample(index) {
  const duration = 1.05 + (index % 5) * 0.18;
  const data = new Float32Array(Math.floor(RATE * duration));
  const vowels = [
    [700, 1200, 2500],
    [300, 2300, 3000],
    [400, 800, 2600],
    [500, 1500, 2500],
    [350, 650, 2200],
  ];
  let phase = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE;
    const syllable = Math.floor(t / 0.19);
    const f0 = 90 + index * 7 + 25 * Math.sin(syllable * 1.7);
    phase += f0 / RATE;
    const env =
      Math.pow(Math.sin(Math.PI * ((t % 0.19) / 0.19)), 0.7) *
      Math.min(1, t / 0.02) *
      Math.min(1, (duration - t) / 0.04);
    const f = vowels[(syllable + index) % 5];
    let val = 0;
    for (let h = 1; h < 32; h++) {
      const freq = h * f0;
      const weight = f.reduce(
        (a, v) => a + Math.exp(-Math.pow((freq - v) / 220, 2)),
        0,
      );
      val += (Math.sin(2 * Math.PI * phase * h) * weight) / h;
    }
    data[i] = clamp((val * 0.45 + noise() * 0.025) * env, -1, 1);
  }
  return { name: NAMES[index], rate: RATE, data };
}
export function drumSample(hit, pitch = 0, morph = 0.35) {
  const duration = [
    0.6, 0.35, 0.1, 0.5, 0.32, 0.5, 0.3, 0.1, 0.28, 0.15, 0.6, 0.04, 0.4, 0.8,
    0.3, 0.16,
  ][hit];
  const data = new Float32Array(Math.floor(RATE * duration));
  const tune = 2 ** (pitch / 12);
  let phase = 0,
    last = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE;
    let v = 0;
    const n = noise();
    switch (hit) {
      case 0:
      case 13:
        phase += ((42 + 150 * Math.exp(-t * 35)) * tune) / RATE;
        v =
          Math.sin(phase * 2 * Math.PI) * Math.exp(-t * (hit === 13 ? 6 : 10)) +
          n * Math.exp(-t * 180) * 0.25;
        break;
      case 1:
        v =
          (n * 0.75 + Math.sin(t * 2 * Math.PI * 180 * tune) * 0.3) *
          Math.exp(-t * 16);
        break;
      case 2:
      case 3:
        last = 0.8 * last + 0.2 * n;
        v = (n - last) * Math.exp(-t * (hit === 2 ? 60 : 9));
        break;
      case 4:
        v =
          n *
          (Math.exp(-t * 18) +
            (t > 0.022 ? Math.exp(-(t - 0.022) * 45) : 0) +
            (t > 0.045 ? Math.exp(-(t - 0.045) * 30) : 0)) *
          0.6;
        break;
      case 5:
      case 6:
        v =
          Math.sin(2 * Math.PI * (hit === 5 ? 90 : 165) * tune * t) *
          Math.exp(-t * 12);
        break;
      case 7:
        v =
          (Math.sin(t * 2 * Math.PI * 1700 * tune) + n * 0.3) *
          Math.exp(-t * 70) *
          0.6;
        break;
      case 8:
        v =
          (Math.sign(Math.sin(t * 2 * Math.PI * 540 * tune)) +
            Math.sign(Math.sin(t * 2 * Math.PI * 800 * tune))) *
          Math.exp(-t * 15) *
          0.25;
        break;
      case 9:
        v = n * Math.exp(-t * 30) * Math.min(1, t * 300);
        break;
      case 10:
        v =
          [421, 687, 1131, 1643].reduce(
            (a, f) => a + Math.sin(t * 2 * Math.PI * f * tune),
            0,
          ) *
          Math.exp(-t * 7) *
          0.14;
        break;
      case 11:
        v = n * Math.exp(-t * 140);
        break;
      case 12:
        phase += ((80 + 1400 * Math.exp(-t * 15)) * tune) / RATE;
        v = Math.sin(phase * 2 * Math.PI) * Math.exp(-t * 12) * 0.7;
        break;
      case 14:
        v = n * Math.exp(-t * 12) * 0.5;
        break;
      case 15:
        v = Math.sin(t * 2 * Math.PI * 440 * tune) * Math.exp(-t * 25) * 0.6;
        break;
    }
    data[i] = Math.tanh(v * (0.65 + morph * 1.8)) * 0.65;
  }
  return { rate: RATE, data };
}
function read(data, pos) {
  const k = Math.floor(pos);
  if (k < 0 || k >= data.length - 1) return 0;
  return data[k] + (data[k + 1] - data[k]) * (pos - k);
}
function bandpass(input, rate, freq, q = 1.5) {
  const out = new Float32Array(input.length);
  const w = (2 * Math.PI * Math.min(freq, rate * 0.45)) / rate;
  const alpha = Math.sin(w) / (2 * q),
    a0 = 1 + alpha,
    b0 = alpha / a0,
    b2 = -b0,
    a1 = (-2 * Math.cos(w)) / a0,
    a2 = (1 - alpha) / a0;
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}
function estimatePitch(data, rate) {
  const start = Math.min(
    Math.floor(rate * 0.12),
    Math.max(0, data.length - 1400),
  );
  const count = Math.min(1024, data.length - start - 1);
  if (count < 128) return 0;
  let best = 0,
    bestLag = 0;
  const min = Math.floor(rate / 350),
    max = Math.min(Math.floor(rate / 70), Math.floor(count / 2));
  for (let lag = min; lag <= max; lag++) {
    let sum = 0,
      a = 0,
      b = 0;
    for (let i = 0; i < count - lag; i += 2) {
      const x = data[start + i],
        y = data[start + i + lag];
      sum += x * y;
      a += x * x;
      b += y * y;
    }
    const corr = sum / Math.sqrt(a * b || 1);
    if (corr > best) {
      best = corr;
      bestLag = lag;
    }
  }
  return best > 0.35 ? rate / bestLag : 0;
}
export function decodePcmWav(buffer, name) {
  const v = new DataView(buffer);
  let rate = 22050,
    channels = 1,
    bits = 16,
    dataOffset = 0,
    dataLength = 0;
  for (let o = 12; o + 8 <= buffer.byteLength; ) {
    const tag = String.fromCharCode(...new Uint8Array(buffer, o, 4)),
      len = v.getUint32(o + 4, true);
    if (o + 8 + len > buffer.byteLength) throw Error("Truncated sample.");
    if (tag === "fmt ") {
      channels = v.getUint16(o + 10, true);
      rate = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
    }
    if (tag === "data") {
      dataOffset = o + 8;
      dataLength = len;
    }
    o += 8 + len + (len % 2);
  }
  if (bits !== 16 || !dataOffset || channels < 1)
    throw Error("Unsupported starter sample.");
  const length = Math.min(Math.floor(dataLength / (channels * 2)), rate * 8),
    data = new Float32Array(length);
  for (let i = 0; i < length; i++)
    for (let c = 0; c < channels; c++)
      data[i] +=
        v.getInt16(dataOffset + (i * channels + c) * 2, true) /
        32768 /
        channels;
  return { name, rate, data };
}
export function renderVocal(sample, params, voice, note = 0, reverse = false) {
  const rate = sample.rate;
  const start = Math.floor(params.start * sample.data.length);
  const source = sample.data.subarray(start);
  let pitch = params.pitch + note;
  if (voice === 8) pitch += 12;
  if (voice === 9) pitch -= 12;
  if (voice === 1) pitch = Math.round(pitch);
  let ratio = 2 ** (pitch / 12);
  if (voice === 1) {
    const f = estimatePitch(source, rate);
    if (f > 0) {
      const midi = 69 + 12 * Math.log2(f / 440);
      ratio *= 2 ** ((Math.round(midi) - midi) / 12);
    }
  }
  const speed = params.speed;
  const length = Math.max(
    1,
    Math.min(rate * 24, Math.floor(source.length / speed)),
  );
  const out = new Float32Array(length);
  if (Math.abs(speed - ratio) < 0.01) {
    for (let i = 0; i < length; i++) out[i] = read(source, i * ratio);
  } else {
    const grain = Math.floor(rate * 0.055),
      hop = Math.floor(grain / 4);
    const weights = new Float32Array(length);
    for (let dst = -grain; dst < length; dst += hop) {
      const src = dst * speed;
      for (let j = 0; j < grain; j++) {
        const k = dst + j;
        if (k < 0 || k >= length) continue;
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / grain);
        out[k] += read(source, src + j * ratio) * w;
        weights[k] += w;
      }
    }
    for (let i = 0; i < length; i++) out[i] /= weights[i] || 1;
  }
  let filtered = out;
  const formant = 2 ** (params.formant / 12);
  if (params.formant !== 0) {
    const a = bandpass(out, rate, 500 * formant),
      b = bandpass(out, rate, 1500 * formant),
      c = bandpass(out, rate, 2800 * formant);
    filtered = new Float32Array(length);
    for (let i = 0; i < length; i++)
      filtered[i] = out[i] * 0.3 + (a[i] + b[i] + c[i]) * 0.9;
  }
  if (voice === 10 || voice === 12)
    filtered = bandpass(filtered, rate, voice === 10 ? 1400 : 1900, 0.65);
  if (voice === 15) {
    const low = new Float32Array(length);
    let value = 0;
    const a = 1 - Math.exp((-2 * Math.PI * 650) / rate);
    for (let i = 0; i < length; i++) {
      value += a * (filtered[i] - value);
      low[i] = value;
    }
    filtered = low;
  }
  const f0 = 130 * ratio;
  let envelope = 0,
    held = 0;
  const result = new Float32Array(length);
  if (voice === 6) {
    const carrier = new Float32Array(length);
    for (let i = 0; i < length; i++)
      carrier[i] = 2 * (((i * f0) / rate) % 1) - 1;
    for (const freq of [180, 350, 650, 1000, 1600, 2500, 3600]) {
      const mod = bandpass(filtered, rate, freq * formant, 2),
        car = bandpass(carrier, rate, freq * formant, 2);
      let env = 0;
      for (let i = 0; i < length; i++) {
        env += 0.012 * (Math.abs(mod[i]) - env);
        result[i] += car[i] * env * 8;
      }
    }
  } else {
    for (let i = 0; i < length; i++) {
      const t = i / rate,
        x = filtered[i];
      envelope += 0.01 * (Math.abs(x) - envelope);
      let v = x;
      switch (voice) {
        case 2:
          if (i % 4 === 0) held = Math.round(x * 16) / 16;
          v = held;
          break;
        case 3:
          v = noise() * envelope * 3;
          break;
        case 4:
          v = x * Math.sign(Math.sin(2 * Math.PI * 65 * t)) * 1.1;
          break;
        case 5:
          v = x * 0.65 + read(filtered, i * 1.4983) * 0.5;
          break;
        case 7:
          v =
            x * 0.65 +
            read(
              filtered,
              i - rate * (0.018 + 0.004 * Math.sin(t * 2 * Math.PI * 0.8)),
            ) *
              0.55;
          break;
        case 10:
          v = x;
          break;
        case 11:
          v = noise() * envelope * 2 + x * 0.12;
          break;
        case 12:
          v = Math.tanh(x * 5) * 0.65;
          break;
        case 13:
          v = x * Math.sin(2 * Math.PI * 95 * t + 2 * Math.sin(t * 17));
          break;
        case 14:
          v = x * 0.65 + read(filtered, i - rate * 0.035) * 0.65;
          break;
        case 15:
          v = x * (0.65 + 0.35 * Math.sin(t * 2 * Math.PI * 5));
          break;
      }
      result[i] = v;
    }
  }
  for (let i = 0; i < length; i++) {
    const env =
      Math.min(1, i / (rate * 0.005)) *
      Math.min(1, (length - i) / (rate * 0.008));
    result[i] = Math.tanh(result[i] * 1.25) * env * 0.8;
  }
  if (reverse) result.reverse();
  return { rate, data: result };
}
export function toWav(channels, rate) {
  const length = channels[0].length,
    count = channels.length;
  const buf = new ArrayBuffer(44 + length * count * 2),
    v = new DataView(buf);
  const str = (off, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + length * count * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, count, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * count * 2, true);
  v.setUint16(32, count * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, length * count * 2, true);
  for (let i = 0; i < length; i++)
    for (let c = 0; c < count; c++) {
      const x = clamp(channels[c][i], -1, 1);
      v.setInt16(44 + (i * count + c) * 2, x < 0 ? x * 32768 : x * 32767, true);
    }
  return buf;
}
function resampleKO(source, ratio) {
  const out = new Float32Array(Math.max(1, Math.floor(source.length / ratio)));
  for (let i = 0; i < out.length; i++) out[i] = read(source, i * ratio);
  return out;
}
export function renderKOEffect(sample, effect) {
  const { data, rate } = sample;
  const out = new Float32Array(data.length);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    if (effect === 21 || effect === 22) {
      const ratio = effect === 22 ? 0.5 : 1.008;
      out[i] = data[i] * 0.6 + read(data, i * ratio - rate * 0.012) * 0.6;
    } else if (effect === 26 || effect === 27) {
      const cycle = effect === 27 ? 0.075 : 0.18;
      const position = (t % cycle) / cycle;
      const triangle = position < 0.5 ? position * 2 : (1 - position) * 2;
      const start = Math.floor(t / cycle) * cycle * rate;
      out[i] = read(data, start + triangle * cycle * rate) * 0.9;
    } else out[i] = data[i];
  }
  return { rate, data: out };
}
export class Engine {
  constructor(context = null) {
    this.ctx = context;
    this.cache = new Map();
    this.active = { voice: null, drum: null };
    this.sources = new Set();
    this.captureChunks = [];
    this.inputChunks = [];
    this.recording = false;
    this.capturing = false;
    this.sync = 0;
    this.onClock = () => {};
    this.onInputLevel = () => {};
  }
  async init() {
    if (this.ctx) return;
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.connectGraph();
    await this.ctx.audioWorklet.addModule("./worklet.js");
    this.capture = new AudioWorkletNode(this.ctx, "vox-capture");
    this.output.connect(this.capture);
    this.capture.connect(this.ctx.destination);
    this.capture.port.onmessage = ({ data }) => {
      if (data.kind === "chunk" && this.capturing)
        this.captureChunks.push(data.channels);
      if (data.kind === "finished") this.captureDone?.();
    };
    this.output.disconnect(this.ctx.destination);
    await this.ctx.resume();
  }
  connectGraph() {
    const c = this.ctx;
    this.driveGain = c.createGain();
    this.saturation = c.createWaveShaper();
    this.saturation.oversample = "2x";
    this.driveGain.connect(this.saturation);
    this.master = c.createGain();
    this.saturation.connect(this.master);
    this.master.gain.value = 0.35;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 4;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.08;
    this.master.connect(this.limiter);
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 256;
    this.limiter.connect(this.analyser);
    this.output = c.createChannelMerger(2);
    this.limiter.connect(this.output, 0, 0);
    this.limiter.connect(this.output, 0, 1);
    this.output.connect(c.destination);
  }
  setDrive(db = 0) {
    if (!this.ctx) return;
    this.driveGain.gain.setTargetAtTime(
      10 ** (db / 20),
      this.ctx.currentTime,
      0.015,
    );
    if (db === 0) {
      this.saturation.curve = null;
      return;
    }
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.5) / Math.tanh(1.5);
    }
    this.saturation.curve = curve;
  }
  setVolume(v) {
    if (this.ctx)
      this.master.gain.setTargetAtTime(
        (v / 16) ** 1.1 * 0.9,
        this.ctx.currentTime,
        0.015,
      );
  }
  setSync(mode) {
    this.sync = mode;
    this.setMonitor(this.monitorEnabled);
    if (!this.ctx) return;
    this.limiter.disconnect(this.output);
    if ([1, 3, 5].includes(mode)) {
      this.limiter.connect(this.output, 0, 1);
    } else {
      this.limiter.connect(this.output, 0, 0);
      this.limiter.connect(this.output, 0, 1);
    }
  }
  setMonitor(enabled) {
    this.monitorEnabled = !!enabled;
    if (this.inputMonitor)
      this.inputMonitor.gain.setTargetAtTime(
        this.monitorEnabled && [4, 5].includes(this.sync) && !this.recording
          ? 0.5
          : 0,
        this.ctx.currentTime,
        0.02,
      );
  }
  buffer(sample) {
    const c = this.ctx,
      b = c.createBuffer(1, sample.data.length, sample.rate);
    b.copyToChannel(sample.data, 0);
    return b;
  }
  stop() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {}
    }
    this.sources.clear();
    this.active = { voice: null, drum: null };
  }
  play(
    sample,
    params,
    voice,
    note,
    channel,
    when,
    duration = null,
    reverse = false,
    effect = 16,
  ) {
    const key =
      channel === "voice"
        ? `${sample.name}:${sample.data.length}:${JSON.stringify(params)}:${voice}:${note}:${reverse}`
        : null;
    let rendered;
    if (key && this.cache.has(key)) rendered = this.cache.get(key);
    else {
      rendered =
        channel === "voice"
          ? renderVocal(sample, params, voice, note, reverse)
          : reverse
            ? { rate: sample.rate, data: sample.data.slice().reverse() }
            : sample;
      if (key) {
        if (this.cache.size > 48)
          this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, rendered);
      }
    }
    if ([21, 22, 26, 27].includes(effect))
      rendered = renderKOEffect(rendered, effect);
    const s = this.ctx.createBufferSource(),
      g = this.ctx.createGain();
    s.buffer = this.buffer(rendered);
    s.connect(g);
    g.connect(this.driveGain);
    when = Math.max(this.ctx.currentTime, when);
    const old = this.active[channel];
    if (old) {
      try {
        old.stop(when);
      } catch {}
    }
    this.active[channel] = s;
    this.sources.add(s);
    s.onended = () => this.sources.delete(s);
    g.gain.setValueAtTime(1, when);
    if (duration && duration < rendered.data.length / rendered.rate) {
      g.gain.setValueAtTime(1, when + Math.max(0, duration - 0.008));
      g.gain.linearRampToValueAtTime(0, when + duration);
      s.start(when);
      s.stop(when + duration + 0.001);
    } else s.start(when);
    return s;
  }
  trigger(state, event, fx, time, stepDuration, bar = 0) {
    if (!this.ctx) return;
    const params = event.voice
      ? event.voice.params || state.params[event.voice.slot]
      : null;
    let count = event.multiplier || 1;
    if (fx === 14) count = Math.max(count, 2);
    if (fx === 9) count = Math.max(count, 4);
    const repeats = { 17: 16, 18: 12, 19: 8, 20: 32, 25: 3 };
    if (repeats[fx]) count = Math.max(count, repeats[fx]);
    if (fx === 12)
      count = Math.max(
        count,
        Math.min(16, 2 ** (Math.floor((bar % 16) / 4) + 1)),
      );
    for (let repeat = 0; repeat < count; repeat++) {
      const t = time + (repeat * stepDuration) / count;
      const limit = count > 1 ? stepDuration / count : null;
      if (event.voice) {
        const e = event.voice,
          s = state.samples[e.slot];
        if (s) {
          const p = { ...params };
          if (fx === 23) p.pitch += 12;
          if (fx === 24) p.pitch -= 12;
          if (fx === 11) {
            p.pitch -= 12;
            p.speed *= 0.5;
          }
          if (fx === 9) p.start = clamp(p.start + repeat * 0.04, 0, 0.95);
          this.play(
            s,
            p,
            e.voice ?? state.voice,
            e.note + state.key,
            "voice",
            t,
            fx === 10 ? stepDuration * 0.45 : limit,
            fx === 15,
            fx,
          );
        }
      }
      if (event.drum) {
        const hit = event.drum.hit;
        const sample =
          state.drumSamples[hit] ||
          drumSample(hit, state.drumParams.pitch, state.drumParams.morph);
        const pitchedSample = [23, 24].includes(fx)
          ? {
              rate: sample.rate,
              data: resampleKO(sample.data, fx === 23 ? 2 : 0.5),
            }
          : sample;
        this.play(
          pitchedSample,
          null,
          0,
          0,
          "drum",
          t,
          fx === 10 ? stepDuration * 0.45 : limit,
          fx === 15,
          fx,
        );
      }
    }
  }
  clockPulse(time) {
    if (![1, 3, 5].includes(this.sync)) return;
    const s = this.ctx.createBufferSource(),
      b = this.ctx.createBuffer(
        1,
        Math.ceil(this.ctx.sampleRate * 0.005),
        this.ctx.sampleRate,
      );
    const a = b.getChannelData(0);
    for (let i = 0; i < a.length; i++) a[i] = 0.45 * (1 - i / a.length);
    s.buffer = b;
    s.connect(this.output, 0, 0);
    s.start(time);
    this.sources.add(s);
    s.onended = () => this.sources.delete(s);
  }
  async openInput(deviceId = "") {
    await this.init();
    this.closeInput();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
        },
      });
      this.input = this.ctx.createMediaStreamSource(this.stream);
      this.inputCapture = new AudioWorkletNode(this.ctx, "vox-input");
      this.input.connect(this.inputCapture);
      this.inputSplitter = this.ctx.createChannelSplitter(2);
      this.inputMonitor = this.ctx.createGain();
      this.inputMonitor.gain.value = 0;
      this.input.connect(this.inputSplitter);
      this.inputSplitter.connect(this.inputMonitor, 1, 0);
      this.inputMonitor.connect(this.driveGain);
      this.setMonitor(this.monitorEnabled);
      const silent = this.ctx.createGain();
      silent.gain.value = 0;
      this.inputCapture.connect(silent);
      silent.connect(this.ctx.destination);
      this.inputCapture.port.onmessage = ({ data }) => {
        if (data.kind === "chunk" && this.recording)
          this.inputChunks.push(data.channels[0]);
        if (data.kind === "clock") this.onClock(data.time);
        if (data.kind === "level") this.onInputLevel(data.level);
        if (data.kind === "finished") this.inputDone?.();
      };
      return this.stream;
    } catch (e) {
      this.closeInput();
      throw e;
    }
  }
  closeInput() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.input?.disconnect();
    this.inputCapture?.disconnect();
    this.inputSplitter?.disconnect();
    this.inputMonitor?.disconnect();
    this.inputSplitter = null;
    this.inputMonitor = null;
    this.input = null;
    this.inputCapture = null;
  }
  async startInputRecord(device = "") {
    await this.openInput(device);
    this.inputChunks = [];
    this.recording = true;
    this.setMonitor(this.monitorEnabled);
    this.inputCapture.port.postMessage({ record: true });
  }
  async finishInputRecord() {
    if (!this.recording) return null;
    await new Promise((resolve) => {
      this.inputDone = resolve;
      this.inputCapture.port.postMessage({ record: false });
    });
    this.recording = false;
    let length = Math.min(
      this.ctx.sampleRate * 8,
      this.inputChunks.reduce((a, b) => a + b.length, 0),
    );
    if (length < 1) {
      this.closeInput();
      return null;
    }
    const data = new Float32Array(length);
    let offset = 0;
    for (const chunk of this.inputChunks) {
      const n = Math.min(chunk.length, length - offset);
      if (n <= 0) break;
      data.set(chunk.subarray(0, n), offset);
      offset += n;
    }
    this.closeInput();
    return { name: "Recorded voice", rate: this.ctx.sampleRate, data };
  }
  startCapture() {
    this.captureChunks = [];
    this.capturing = true;
    this.capture.port.postMessage({ record: true });
  }
  async finishCapture() {
    await new Promise((resolve) => {
      this.captureDone = resolve;
      this.capture.port.postMessage({ record: false });
    });
    this.capturing = false;
    const chunks = this.captureChunks;
    if (!chunks.length) return null;
    const length = chunks.reduce((n, c) => n + c[0].length, 0),
      channels = [new Float32Array(length), new Float32Array(length)];
    let i = 0;
    for (const c of chunks) {
      channels[0].set(c[0], i);
      channels[1].set(c[1] || c[0], i);
      i += c[0].length;
    }
    return toWav(channels, this.ctx.sampleRate);
  }
}
