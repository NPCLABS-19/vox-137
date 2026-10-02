export const VOICES = [
  "neutral",
  "autotune",
  "retro",
  "noise",
  "robot",
  "fifth",
  "vocoder",
  "chorus",
  "chipmunk",
  "giant",
  "telephone",
  "whisper",
  "megaphone",
  "alien",
  "double",
  "underwater",
];
export const EFFECTS = [
  "stutter sweep",
  "trance gate",
  "half rate",
  "16 bar build up",
  "6/8 quantize",
  "retrigger pattern",
  "reverse",
  "no effect",
  "loop 16",
  "loop 12",
  "loop short",
  "loop shorter",
  "unison",
  "unison low",
  "octave up",
  "octave down",
  "stutter 3",
  "scratch",
  "scratch fast",
];
export const KO_EFFECTS = [
  17, 18, 19, 20, 21, 22, 23, 24, 9, 25, 26, 27, 13, 14, 15, 16,
];
export const NAMES = [
  "Hello, operator",
  "Circuit talk",
  "Out of orbit",
  "Small hours",
  "Transmission",
  "Electric hum",
  "Low signal",
  "Vowel bloom",
  "Glass choir",
  "Soft machine",
  "Moon pulse",
  "Static reply",
  "Open channel",
  "Bit rhythm",
  "Last word",
];
export const DRUMS = [
  "Kick",
  "Snare",
  "Closed hat",
  "Open hat",
  "Clap",
  "Low tom",
  "High tom",
  "Rim",
  "Cowbell",
  "Shaker",
  "Metal",
  "Click",
  "Zap",
  "Boom",
  "Noise",
  "Blip",
];
export const SCALES = [
  { name: "Chromatic", notes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { name: "Major", notes: [0, 2, 4, 5, 7, 9, 11] },
  { name: "Minor", notes: [0, 2, 3, 5, 7, 8, 10] },
  { name: "Pentatonic", notes: [0, 3, 5, 7, 10] },
  { name: "Dorian", notes: [0, 2, 3, 5, 7, 9, 10] },
  { name: "Whole tone", notes: [0, 2, 4, 6, 8, 10] },
];
export const KEYS = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
];
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const blankPattern = () => ({
  steps: Array.from({ length: 16 }, () => ({
    voice: null,
    drum: null,
    multiplier: 1,
  })),
  effects: Array(16).fill(16),
});
export function createState() {
  const patterns = Array.from({ length: 16 }, blankPattern);
  for (let p = 0; p < 4; p++) {
    for (let i = 0; i < 16; i++) {
      if (i % 4 === 0) patterns[p].steps[i].drum = { hit: 0 };
      if (i % 8 === 4) patterns[p].steps[i].drum = { hit: 1 };
      if (i % 2 === 1) patterns[p].steps[i].drum = { hit: 2 };
      if ([0, 6, 10, 14].includes(i))
        patterns[p].steps[i].voice = {
          slot: p,
          note: [0, 3, 7, 5][Math.floor(i / 4)],
          params: null,
          voice: null,
        };
    }
    patterns[p].effects[14] = p === 2 ? 15 : 16;
  }
  return {
    version: 1,
    name: "Untitled session",
    bpm: 120,
    swing: 0,
    volume: 5,
    drive: 0,
    sound: 0,
    pattern: 0,
    voice: 0,
    drumHit: 0,
    key: 0,
    scale: 2,
    params: Array.from({ length: 15 }, () => ({
      pitch: 0,
      formant: 0,
      start: 0,
      speed: 1,
    })),
    drumParams: { pitch: 0, morph: 0.35 },
    patterns,
    chain: [],
    sync: 0,
    monitorInput: false,
    locked: false,
    clockOffset: 0,
    alarm: { enabled: false, hour: 9, minute: 0, pattern: 0 },
    samples: [],
    drumSamples: Array(16).fill(null),
  };
}
export function noteForPad(pad, scale, key) {
  const notes = SCALES[scale].notes;
  return (
    notes[(pad - 1) % notes.length] +
    12 * Math.floor((pad - 1) / notes.length) +
    key
  );
}
export function setStep(state, index, note = 0, hit = state.drumHit) {
  if (state.locked) return false;
  const step = state.patterns[state.pattern].steps[index];
  if (state.sound === 15) {
    if (step.drum?.hit === hit) step.drum = null;
    else step.drum = { hit };
  } else {
    if (step.voice?.slot === state.sound) step.voice = null;
    else step.voice = { slot: state.sound, note, params: null, voice: null };
  }
  return true;
}
export function copyPattern(state, to) {
  if (state.locked) return false;
  state.patterns[to] = structuredClone(state.patterns[state.pattern]);
  return true;
}
export function validateSession(s) {
  if (!s || s.version !== 1 || typeof s.name !== "string" || s.name.length > 80)
    throw Error("Not a valid VOX session.");
  s.monitorInput ??= false;
  s.drive ??= 0;
  if (typeof s.monitorInput !== "boolean")
    throw Error("Invalid input monitoring setting.");
  const int = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
  const num = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
  if (
    !num(s.bpm, 60, 240) ||
    !num(s.swing, 0, 0.5) ||
    !int(s.volume, 1, 16) ||
    !num(s.drive, 0, 24) ||
    !int(s.sound, 0, 15) ||
    !int(s.pattern, 0, 15) ||
    !int(s.voice, 0, VOICES.length - 1) ||
    !int(s.drumHit, 0, 15) ||
    !int(s.key, 0, 11) ||
    !int(s.scale, 0, SCALES.length - 1) ||
    !int(s.sync, 0, 5) ||
    typeof s.locked !== "boolean" ||
    !num(s.clockOffset, -86400000, 86400000)
  )
    throw Error("Session settings are out of range.");
  const validParams = (p) =>
    p &&
    num(p.pitch, -24, 24) &&
    num(p.formant, -12, 12) &&
    num(p.start, 0, 0.95) &&
    num(p.speed, 0.25, 2);
  if (
    !Array.isArray(s.params) ||
    s.params.length !== 15 ||
    !s.params.every(validParams) ||
    !s.drumParams ||
    !num(s.drumParams.pitch, -24, 24) ||
    !num(s.drumParams.morph, 0, 1)
  )
    throw Error("Invalid sound parameters.");
  if (!Array.isArray(s.patterns) || s.patterns.length !== 16)
    throw Error("Session needs 16 patterns.");
  for (const p of s.patterns) {
    if (
      !p ||
      p.steps?.length !== 16 ||
      p.effects?.length !== 16 ||
      !p.effects.every((e) => int(e, 9, 9 + EFFECTS.length - 1))
    )
      throw Error("Invalid pattern.");
    for (const step of p.steps) {
      if (!int(step.multiplier, 1, 16)) throw Error("Invalid step repeat.");
      if (
        step.voice &&
        (!int(step.voice.slot, 0, 14) ||
          !num(step.voice.note, -24, 72) ||
          (step.voice.voice !== null &&
            !int(step.voice.voice, 0, VOICES.length - 1)) ||
          (step.voice.params !== null && !validParams(step.voice.params)))
      )
        throw Error("Invalid voice step.");
      if (step.drum && !int(step.drum.hit, 0, 15))
        throw Error("Invalid drum step.");
    }
  }
  if (
    !Array.isArray(s.chain) ||
    s.chain.length > 64 ||
    !s.chain.every((n) => int(n, 0, 15))
  )
    throw Error("Invalid pattern chain.");
  if (
    !s.alarm ||
    typeof s.alarm.enabled !== "boolean" ||
    !int(s.alarm.hour, 0, 23) ||
    !int(s.alarm.minute, 0, 59) ||
    !int(s.alarm.pattern, 0, 15)
  )
    throw Error("Invalid alarm.");
  if (s.samples?.length !== 15 || s.drumSamples?.length !== 16)
    throw Error("Invalid sample bank.");
  for (const item of [...s.samples, ...s.drumSamples]) {
    if (item === null) continue;
    if (
      !item ||
      typeof item.name !== "string" ||
      item.name.length > 80 ||
      !num(item.rate, 8000, 192000) ||
      !(item.data instanceof Float32Array) ||
      !int(item.data.length, 1, Math.ceil(item.rate * 8)) ||
      !item.data.every((x) => num(x, -1, 1))
    )
      throw Error("Invalid audio sample.");
  }
  return s;
}
