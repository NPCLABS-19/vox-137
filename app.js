import {
  VOICES,
  EFFECTS,
  KO_EFFECTS,
  NAMES,
  DRUMS,
  SCALES,
  KEYS,
  clamp,
  createState,
  noteForPad,
  setStep,
  copyPattern,
  blankPattern,
} from "./model.js";
import {
  Engine,
  starterSample,
  drumSample,
  toWav,
  decodePcmWav,
} from "./engine.js";
import {
  saveSession,
  loadSession,
  packSession,
  unpackSession,
  backupWave,
  readBackupWave,
} from "./storage.js";
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let state = createState();
state.samples = Array.from({ length: 15 }, (_, i) => starterSample(i));
let factorySamples = state.samples;
const engine = new Engine();
let tabName = "sounds",
  writeMode = false,
  bank = 0,
  fxBank = "voice",
  held = new Set(),
  consumed = new Set(),
  latched = false,
  lastNote = 0,
  playing = false,
  nextStep = 0,
  nextTime = 0,
  chainPos = 0,
  barCount = 0,
  displayStep = -1,
  timeline = [],
  liveFx = 16,
  selectedStep = 0,
  saveTimer,
  toastTimer,
  schedulerId,
  recordTimer,
  recordTarget = -1,
  recordPending = false,
  recordFinishing = false,
  recordRequest = 0,
  recordStarted = 0,
  captureStarted = 0,
  lastInteraction = Date.now(),
  sleeping = false,
  inputDevice = "",
  syncWaiting = false,
  lastClock = -1,
  clockToggle = 0,
  alarmLast = "",
  pendingImport = "voice",
  receiveMode = false,
  exporting = false,
  dragging = false,
  frame = 0;
const padKeys = [
  "1",
  "2",
  "3",
  "4",
  "q",
  "w",
  "e",
  "r",
  "a",
  "s",
  "d",
  "f",
  "z",
  "x",
  "c",
  "v",
];
const controlKeys = {
  s: "sound",
  p: "pattern",
  b: "bpm",
  m: "m",
  r: "record",
  f: "fx",
  w: "write",
  " ": "play",
};
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 2800);
}
function message(text) {
  $("#messageRead").textContent = text.toUpperCase().slice(0, 27);
}
function touch() {
  lastInteraction = Date.now();
  sleeping = false;
}
function locked() {
  if (state.locked) {
    toast("Session is locked. Unlock to edit.");
    return true;
  }
  return false;
}
function changed(render = true) {
  touch();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await saveSession(state);
      $("#saveStatus").textContent = "Session saved on this device";
    } catch {
      $("#saveStatus").textContent = "Storage unavailable · export a backup";
    }
  }, 400);
  update();
  if (render) renderWorkspace();
}
for (const [id, key, setter] of [
  ["masterVolume", "volume", "setVolume"],
  ["masterDrive", "drive", "setDrive"],
]) {
  $("#" + id).oninput = (e) => {
    if (locked()) return;
    state[key] = +e.target.value;
    engine[setter](state[key]);
    changed();
  };
}
async function enableAudio() {
  try {
    await engine.init();
    await engine.ctx.resume();
    engine.setVolume(state.volume);
    engine.setDrive(state.drive);
    engine.setSync(state.sync);
    engine.setMonitor(state.monitorInput);
    $("#audioStart").textContent = "Sound enabled ◉";
    $("#audioStatus").textContent = "Ready. Press play or touch a pad.";
    return true;
  } catch (e) {
    toast("Audio could not start: " + e.message);
    return false;
  }
}
for (let i = 1; i <= 16; i++) {
  $("#pads").insertAdjacentHTML(
    "beforeend",
    `<button class="pad" data-pad="${i}" aria-label="Pad ${i}">${String(i).padStart(2, "0")}<i class="led"></i><span class="pad-label">${i <= 8 ? VOICES[i - 1] : ["stutter", "gate", "half rate", "build up", "6/8", "retrigger", "reverse", "clear"][i - 9]}</span></button>`,
  );
  $("#screenSteps").insertAdjacentHTML("beforeend", "<i></i>");
}
function update() {
  $("#padLegendA").textContent = fxBank === "ko" ? "K.O. EFFECTS" : "VOICE 1–8";
  $("#padLegendB").textContent = fxBank === "ko" ? "PADS 1–16" : "EFFECT 9–16";
  $("#masterVolume").value = state.volume;
  $("#masterDrive").value = state.drive ?? 0;
  $("#masterVolumeValue").textContent = state.volume + " / 16";
  $("#masterDriveValue").textContent = (state.drive ?? 0) + " dB";

  const p = state.patterns[state.pattern];
  $("#bpmRead").textContent = Math.round(state.bpm);
  $("#soundRead").textContent = String(state.sound + 1).padStart(2, "0");
  $("#patternRead").textContent = String(state.pattern + 1).padStart(2, "0");
  $("#voiceRead").textContent =
    state.sound === 15
      ? DRUMS[state.drumHit].toUpperCase()
      : VOICES[state.voice].toUpperCase();
  $("#modeLabel").textContent = recordPending
    ? "MIC SETUP"
    : engine.recording
      ? "REC " +
        Math.min(8, (Date.now() - recordStarted) / 1000).toFixed(1) +
        "s"
      : sleeping
        ? "CLOCK"
        : syncWaiting
          ? "WAIT SYNC"
          : playing
            ? writeMode
              ? "PLAY + WRITE"
              : "PLAY"
            : writeMode
              ? "WRITE"
              : "READY";
  $("#syncRead").textContent = "SY" + state.sync;
  $("#lockButton").textContent = state.locked ? "● LOCKED" : "○ UNLOCKED";
  $("#stickyButton").textContent =
    "Latch controls: " + (latched ? "on" : "off");
  $("#stickyButton").setAttribute("aria-pressed", String(latched));
  $("#projectName").textContent = state.name;
  document.body.classList.toggle("locked", state.locked);
  $$("[data-control]").forEach((b) => {
    const c = b.dataset.control;
    b.classList.toggle("held", held.has(c));
    b.classList.toggle(
      "active",
      (c === "write" && writeMode) ||
        (c === "play" && playing) ||
        (c === "record" && engine.recording),
    );
    b.setAttribute(
      "aria-pressed",
      String(
        held.has(c) ||
          (c === "write" && writeMode) ||
          (c === "play" && playing),
      ),
    );
    if (c === "play") b.firstChild.textContent = playing ? "■ stop" : "▶ play";
  });
  $$(".pad").forEach((b, i) => {
    b.querySelector(".pad-label").textContent =
      fxBank === "ko"
        ? KO_EFFECTS[i] === 9
          ? "stutter 4"
          : EFFECTS[KO_EFFECTS[i] - 9]
        : i < 8
          ? VOICES[i]
          : EFFECTS[i - 8];
    const step = p.steps[i];
    const on = held.has("pattern")
      ? i === state.pattern
      : held.has("sound")
        ? i === state.sound
        : writeMode
          ? state.sound === 15
            ? step.drum?.hit === state.drumHit
            : step.voice?.slot === state.sound
          : false;
    b.classList.toggle("on", !!on);
    b.classList.toggle("current", playing && i === displayStep);
    b.setAttribute(
      "aria-label",
      `Pad ${i + 1}, ${b.querySelector(".pad-label").textContent}${on ? ", active" : ""}`,
    );
  });
  $$("#screenSteps i").forEach((e, i) => {
    e.classList.toggle("on", !!(p.steps[i].voice || p.steps[i].drum));
    e.classList.toggle("current", playing && i === displayStep);
  });
  updateKnobs();
}
function knobSettings() {
  if (held.has("bpm"))
    return [
      {
        name: "SWING",
        val: state.swing * 200,
        text: Math.round(state.swing * 100) + "%",
      },
      {
        name: "TEMPO",
        val: ((state.bpm - 60) / 180) * 100,
        text: Math.round(state.bpm) + " bpm",
      },
    ];
  if (held.has("pattern"))
    return [
      { name: "KEY", val: (state.key / 11) * 100, text: KEYS[state.key] },
      {
        name: "SCALE",
        val: (state.scale / (SCALES.length - 1)) * 100,
        text: SCALES[state.scale].name,
      },
    ];
  if (state.sound === 15)
    return [
      {
        name: "PITCH",
        val: ((state.drumParams.pitch + 24) / 48) * 100,
        text: state.drumParams.pitch + " st",
      },
      {
        name: "MORPH",
        val: state.drumParams.morph * 100,
        text: Math.round(state.drumParams.morph * 100) + "%",
      },
    ];
  const p = state.params[state.sound];
  return bank === 0
    ? [
        {
          name: "PITCH",
          val: ((p.pitch + 24) / 48) * 100,
          text: p.pitch + " st",
        },
        {
          name: "FORMANT",
          val: ((p.formant + 12) / 24) * 100,
          text: p.formant.toFixed(1),
        },
      ]
    : [
        {
          name: "START",
          val: (p.start / 0.95) * 100,
          text: Math.round(p.start * 100) + "%",
        },
        {
          name: "SPEED",
          val: ((p.speed - 0.25) / 1.75) * 100,
          text: p.speed.toFixed(2) + "×",
        },
      ];
}
function updateKnobs() {
  const k = knobSettings();
  ["A", "B"].forEach((id, i) => {
    $("#knob" + id + "Label").textContent = k[i].name;
    $("#knob" + id + "Value").textContent = k[i].text;
    $("#knob" + id).setAttribute("aria-valuenow", Math.round(k[i].val));
    $("#knob" + id).setAttribute("aria-valuetext", k[i].text);
    $("#knob" + id + " i").style.transform =
      `rotate(${-135 + k[i].val * 2.7}deg)`;
  });
  $("#paramBank").textContent = k.map((x) => x.name).join(" / ");
}
function setKnob(which, val) {
  if (locked()) return;
  val = clamp(val, 0, 100);
  if (held.has("bpm")) {
    if (which === "A") state.swing = val / 200;
    else state.bpm = Math.round(60 + val * 1.8);
  } else if (held.has("pattern")) {
    if (which === "A") state.key = Math.round((val / 100) * 11);
    else state.scale = Math.round((val / 100) * (SCALES.length - 1));
  } else if (state.sound === 15) {
    if (which === "A")
      state.drumParams.pitch = Math.round((val / 100) * 48 - 24);
    else state.drumParams.morph = val / 100;
  } else {
    const p = state.params[state.sound];
    if (bank === 0) {
      if (which === "A") p.pitch = Math.round((val / 100) * 48 - 24);
      else p.formant = Math.round(((val / 100) * 24 - 12) * 10) / 10;
    } else {
      if (which === "A") p.start = (val / 100) * 0.95;
      else p.speed = 0.25 + (val / 100) * 1.75;
    }
    if (held.has("write")) {
      const step =
        state.patterns[state.pattern].steps[
          playing ? Math.max(0, displayStep) : selectedStep
        ];
      if (step.voice?.slot === state.sound) step.voice.params = { ...p };
    }
  }
  changed(false);
}
function durationForStep(i) {
  return (
    (60 / state.bpm / 4) * (i % 2 === 0 ? 1 + state.swing : 1 - state.swing)
  );
}
function scheduleStep(step, time) {
  const pattern = state.patterns[state.pattern];
  if (held.has("fx") && writeMode && !state.locked) {
    if (liveFx > 8) pattern.effects[step] = liveFx;
    if (pattern.steps[step].voice)
      pattern.steps[step].voice.voice = state.voice;
    changed(false);
  }
  const fx = liveFx !== 16 ? liveFx : pattern.effects[step];
  const dt = durationForStep(step);
  const base = 60 / state.bpm / 4;
  const effectTime =
    fx === 13 ? time + (Math.round(step * 1.5) / 1.5 - step) * base : time;
  engine.trigger(state, pattern.steps[step], fx, effectTime, dt, barCount);
  if (step % 2 === 0) engine.clockPulse(time);
  timeline.push({ step, time, pattern: state.pattern, chainPos });
  if (timeline.length > 64) timeline.shift();
}
function advance() {
  nextStep++;
  if (nextStep === 16) {
    nextStep = 0;
    barCount++;
    if (state.chain.length) {
      chainPos = (chainPos + 1) % state.chain.length;
      state.pattern = state.chain[chainPos];
    }
  }
}
function scheduler() {
  if (!playing || syncWaiting || !engine.ctx) return;
  while (nextTime < engine.ctx.currentTime + 0.1) {
    scheduleStep(nextStep, nextTime);
    nextTime += durationForStep(nextStep);
    advance();
  }
}
async function play() {
  touch();
  if (playing) {
    stop();
    return;
  }
  if (!(await enableAudio())) return;
  playing = true;
  barCount = 0;
  nextStep = 0;
  chainPos = 0;
  displayStep = -1;
  timeline = [];
  if (state.chain.length) state.pattern = state.chain[0];
  syncWaiting = [2, 3, 4, 5].includes(state.sync);
  nextTime = engine.ctx.currentTime + 0.05;
  clearInterval(schedulerId);
  if (!syncWaiting) schedulerId = setInterval(scheduler, 25);
  message(syncWaiting ? "WAITING FOR CLOCK" : "PLAYING");
  update();
  renderWorkspace();
}
function stop() {
  playing = false;
  syncWaiting = false;
  clearInterval(schedulerId);
  engine.stop();
  timeline = [];
  displayStep = -1;
  liveFx = 16;
  message("STOPPED");
  update();
  renderWorkspace();
}
engine.onClock = (time) => {
  if (!playing || ![2, 3, 4, 5].includes(state.sync)) return;
  if (lastClock > 0 && time - lastClock > 0.08 && time - lastClock < 2) {
    const bpm = 60 / (2 * (time - lastClock));
    state.bpm = clamp(bpm, 60, 240);
  }
  lastClock = time;
  syncWaiting = false;
  const dt = 60 / state.bpm / 4;
  const at = engine.ctx.currentTime + 0.015;
  scheduleStep(nextStep, at);
  advance();
  scheduleStep(nextStep, at + dt);
  advance();
  update();
};
engine.onInputLevel = (level) => {
  const meter = $("#inputLevel");
  if (meter) meter.style.width = Math.min(100, level * 100) + "%";
};
async function audition(note = lastNote) {
  if (!(await enableAudio())) return;
  const event = { multiplier: 1, voice: null, drum: null };
  if (state.sound === 15) event.drum = { hit: state.drumHit };
  else
    event.voice = { slot: state.sound, note, params: null, voice: state.voice };
  engine.trigger(
    state,
    event,
    liveFx,
    engine.ctx.currentTime,
    60 / state.bpm / 4,
    barCount,
  );
}

function mark(...controls) {
  controls.forEach((c) => consumed.add(c));
}
let alarmRinging = false;
function controlDown(c) {
  touch();
  if (alarmRinging) {
    alarmRinging = false;
    stop();
    mark(c);
    return;
  }
  if (latched && held.has(c)) {
    held.delete(c);
    if (c === "record" && engine.recording) endRecord();
    update();
    return;
  }
  held.add(c);
  if (c === "play") {
    mark(c);
    play();
  }
  if (held.has("record") && held.has("pattern")) {
    mark("record", "pattern");
    if (!locked()) {
      state.patterns[state.pattern] = blankPattern();
      changed();
      message("PATTERN CLEARED");
    }
  } else if (held.has("sound") && held.has("pattern")) {
    mark("sound", "pattern");
    openAlarm();
  } else if (held.has("record") && held.has("sound")) {
    mark("record", "sound");
    receiveMode = true;
    tabName = "session";
    renderWorkspace();
    message("RECEIVE · IMPORT BACKUP");
  } else if (held.has("write") && held.has("sound")) {
    mark("write", "sound");
    exportSession(false);
  } else if (held.has("record") && held.has("bpm")) {
    mark("record", "bpm");
    if (!locked()) {
      state.sync = (state.sync + 1) % 6;
      engine.setSync(state.sync);
      engine.setMonitor(state.monitorInput);
      changed();
      message("SYNC MODE " + state.sync);
    }
  } else if (held.has("sound") && held.has("bpm")) {
    mark("sound", "bpm");
    message(
      engine.ctx ? "AUDIO ON · LOCAL MEMORY" : "AUDIO OFF · LOCAL MEMORY",
    );
  }
  update();
}
function controlUp(c) {
  if (!latched) held.delete(c);
  if (!consumed.has(c)) {
    if (c === "write") {
      writeMode = !writeMode;
      message(writeMode ? "WRITE MODE" : "LIVE MODE");
    }
    if (c === "fx") {
      bank = 1 - bank;
      message(bank ? "START / SPEED" : "PITCH / FORMANT");
    }
    if (c === "bpm" && !locked()) {
      const bpms = [80, 120, 140];
      state.bpm = bpms[(bpms.indexOf(Math.round(state.bpm)) + 1) % 3];
      changed();
    }
    if (c === "record" && (engine.recording || recordPending)) endRecord();
  }
  consumed.delete(c);
  if (c === "pattern") {
    chainGesture = false;
    chainGestureCount = 0;
  }
  if (c === "fx") liveFx = 16;
  update();
}
let chainGesture = false,
  chainGestureCount = 0;
function padDown(n) {
  touch();
  if (alarmRinging) {
    alarmRinging = false;
    stop();
    return;
  }
  const i = n - 1;
  const b = $(`[data-pad="${n}"]`);
  b.classList.add("pressed");
  if (held.has("record")) {
    mark("record");
    if (n === 16) {
      toast("Slot 16 is the drum bank. Record into slots 1–15.");
      return;
    }
    if (engine.recording || recordPending) {
      endRecord();
      return;
    }
    beginRecord(i, latched);
    return;
  }
  if (held.has("pattern") && held.has("write")) {
    mark("pattern", "write");
    if (copyPattern(state, i)) {
      changed();
      message("COPIED TO PATTERN " + n);
    } else locked();
    return;
  }
  if (held.has("pattern")) {
    mark("pattern");
    if (locked()) return;
    if (!chainGesture) {
      chainGesture = true;
      chainGestureCount = 0;
      state.chain = [];
    }
    if (state.chain.length < 64) {
      state.chain.push(i);
      chainGestureCount++;
    }
    state.pattern = i;
    chainPos = 0;
    changed();
    message(
      chainGestureCount > 1
        ? "CHAIN " + state.chain.map((x) => x + 1).join("·")
        : "PATTERN " + n,
    );
    return;
  }
  if (held.has("sound")) {
    mark("sound");
    state.sound = i;
    lastNote = 0;
    changed();
    message(n === 16 ? "TONIC DRUM BANK" : "SOUND " + n);
    return;
  }
  if (held.has("bpm")) {
    mark("bpm");
    if (locked()) return;
    state.volume = n;
    engine.setVolume(n);
    changed();
    message("VOLUME " + n + "/16");
    return;
  }
  if (held.has("m")) {
    mark("m");
    if (locked()) return;
    selectedStep = i;
    const step = state.patterns[state.pattern].steps[i];
    step.multiplier = (step.multiplier % 16) + 1;
    changed();
    message("STEP " + n + " REPEAT " + step.multiplier + "×");
    return;
  }
  if (held.has("fx")) {
    mark("fx");
    if (locked()) return;
    if (n <= 8 && fxBank === "voice") {
      state.voice = i;
      if (writeMode && playing) {
        const st =
          state.patterns[state.pattern].steps[Math.max(0, displayStep)];
        if (st.voice) st.voice.voice = i;
      }
      message(VOICES[i]);
      changed();
    } else {
      const effect = fxBank === "ko" ? KO_EFFECTS[i] : n;
      liveFx = effect;
      if (writeMode) {
        const step = playing ? Math.max(0, displayStep) : selectedStep;
        state.patterns[state.pattern].effects[step] = effect;
        changed();
      }
      if (effect === 14 && playing) {
        nextStep = 0;
        nextTime = engine.ctx.currentTime + 0.01;
        engine.stop();
        timeline = [];
      }
      message(EFFECTS[effect - 9]);
    }
    return;
  }
  if (held.has("write") && playing) {
    mark("write");
    if (locked()) return;
    const nearest = timeline.length
      ? timeline.reduce(
          (best, t) =>
            Math.abs(t.time - engine.ctx.currentTime) <
            Math.abs(best.time - engine.ctx.currentTime)
              ? t
              : best,
          timeline[0],
        )
      : { step: 0, pattern: state.pattern };
    const st = state.patterns[nearest.pattern].steps[nearest.step];
    if (state.sound === 15) {
      state.drumHit = i;
      st.drum = { hit: i };
    } else {
      lastNote = noteForPad(n, state.scale, 0);
      st.voice = {
        slot: state.sound,
        note: lastNote,
        params: null,
        voice: null,
      };
    }
    audition();
    changed();
    message("LIVE NOTE RECORDED");
    return;
  }
  if (writeMode) {
    if (locked()) return;
    selectedStep = i;
    setStep(state, i, lastNote);
    changed();
    message(
      "STEP " +
        n +
        (state.patterns[state.pattern].steps[i].voice ||
        state.patterns[state.pattern].steps[i].drum
          ? " ON"
          : " OFF"),
    );
  } else {
    if (state.sound === 15) state.drumHit = i;
    else lastNote = noteForPad(n, state.scale, 0);
    audition();
    changed();
    message(state.sound === 15 ? DRUMS[i] : "NOTE " + lastNote);
  }
}
function padUp(n) {
  $(`[data-pad="${n}"]`).classList.remove("pressed");
  if (
    recordTarget === n - 1 &&
    !recordLatched &&
    (engine.recording || recordPending)
  )
    endRecord();
  if (held.has("fx") && n > 8) {
    liveFx = 16;
  }
  update();
}
let recordLatched = false;
async function beginRecord(slot, latch = true) {
  if (locked()) return;
  recordLatched = latch;
  recordTarget = slot;
  state.sound = slot;
  recordPending = true;
  const request = ++recordRequest;
  update();
  message("ALLOW MICROPHONE");
  try {
    await engine.startInputRecord(inputDevice);
    if (request !== recordRequest) {
      await engine.finishInputRecord();
      recordPending = false;
      update();
      renderWorkspace();
      return;
    }
    recordPending = false;
    recordStarted = Date.now();
    recordTimer = setTimeout(endRecord, 8000);
    message("RECORDING · MAX 8 SECONDS");
    renderWorkspace();
    update();
  } catch (e) {
    recordPending = false;
    recordTarget = -1;
    toast(
      e.name === "NotAllowedError"
        ? "Microphone access was denied. You can import audio instead."
        : "Input unavailable: " + e.message,
    );
    update();
  }
}
async function endRecord() {
  clearTimeout(recordTimer);
  if (recordPending) {
    recordRequest++;
    recordTarget = -1;
    message("RECORDING CANCELLED");
    update();
    return;
  }
  if (!engine.recording || recordFinishing) return;
  recordFinishing = true;
  const slot = recordTarget;
  recordTarget = -1;
  let sample;
  try {
    sample = await engine.finishInputRecord();
  } finally {
    recordFinishing = false;
  }
  if (sample) {
    sample.name = "Voice " + String(slot + 1).padStart(2, "0");
    state.samples[slot] = sample;
    engine.cache.clear();
    changed();
    message("RECORDED " + (sample.data.length / sample.rate).toFixed(1) + "s");
  } else toast("Recording was too short. Try again.");
  update();
  renderWorkspace();
}
function clearHeld() {
  for (const c of [...held]) {
    consumed.add(c);
    controlUp(c);
  }
  held.clear();
  consumed.clear();
  if (engine.recording && !recordLatched) endRecord();
  update();
}
$$("[data-control]").forEach((b) => {
  const c = b.dataset.control;
  b.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    controlDown(c);
  });
  b.addEventListener("pointerup", () => controlUp(c));
  b.addEventListener("pointercancel", () => {
    held.delete(c);
    consumed.delete(c);
    update();
  });
  b.addEventListener("click", (e) => {
    if (e.detail === 0) {
      if (["play", "write", "fx", "bpm"].includes(c)) {
        controlDown(c);
        controlUp(c);
      } else {
        held.has(c) ? held.delete(c) : held.add(c);
        update();
      }
    }
  });
});
$$(".pad").forEach((b) => {
  const n = +b.dataset.pad;
  b.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    padDown(n);
  });
  b.addEventListener("pointerup", () => padUp(n));
  b.addEventListener("pointercancel", () => padUp(n));
  b.addEventListener("click", (e) => {
    if (e.detail === 0) {
      padDown(n);
      padUp(n);
    }
  });
});
// Keyboard: unshifted 4×4 pads; Shift+letter holds the labeled control.
let keysDown = new Map();
addEventListener("keydown", (e) => {
  if (
    e.target.closest("input,select,textarea,dialog,[role=slider]") ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey
  )
    return;
  const key = e.key.toLowerCase();
  if (e.repeat) return;
  let action;
  if (key === " ") {
    action = { control: "play" };
  } else if (e.shiftKey && controlKeys[key]) {
    action = { control: controlKeys[key] };
  } else if (padKeys.includes(key)) {
    action = { pad: padKeys.indexOf(key) + 1 };
  } else if (key === "escape") {
    clearHeld();
    stop();
    return;
  } else return;
  e.preventDefault();
  keysDown.set(e.code, action);
  if (action.pad) padDown(action.pad);
  else controlDown(action.control);
});
addEventListener("keyup", (e) => {
  const action = keysDown.get(e.code);
  if (!action) return;
  e.preventDefault();
  keysDown.delete(e.code);
  if (action.pad) padUp(action.pad);
  else controlUp(action.control);
});
addEventListener("blur", () => {
  keysDown.clear();
  clearHeld();
});
["A", "B"].forEach((id, i) => {
  const el = $("#knob" + id);
  let startY, startValue;
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.focus({ preventScroll: true });
    startY = e.clientY;
    startValue = knobSettings()[i].val;
    dragging = true;
  });
  el.addEventListener("pointermove", (e) => {
    if (el.hasPointerCapture(e.pointerId))
      setKnob(id, startValue + (startY - e.clientY) * 0.5);
  });
  el.addEventListener("pointerup", () => {
    dragging = false;
    renderWorkspace();
  });
  el.addEventListener("pointercancel", () => {
    dragging = false;
  });
  el.addEventListener(
    "wheel",
    (e) => {
      if (document.activeElement !== el) return;
      e.preventDefault();
      setKnob(id, knobSettings()[i].val + (e.deltaY < 0 ? 2 : -2));
    },
    { passive: false },
  );
  el.addEventListener("keydown", (e) => {
    if (
      [
        "ArrowUp",
        "ArrowRight",
        "ArrowDown",
        "ArrowLeft",
        "Home",
        "End",
      ].includes(e.key)
    ) {
      e.preventDefault();
      e.stopPropagation();
      const v =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? 100
            : knobSettings()[i].val +
              (["ArrowUp", "ArrowRight"].includes(e.key) ? 1 : -1);
      setKnob(id, v);
    }
  });
  el.addEventListener("dblclick", () => {
    if (locked()) return;
    if (state.sound < 15)
      state.params[state.sound] = { pitch: 0, formant: 0, start: 0, speed: 1 };
    else state.drumParams = { pitch: 0, morph: 0.35 };
    changed();
  });
});
$("#audioStart").onclick = enableAudio;
$("#stickyButton").onclick = () => {
  latched = !latched;
  held.clear();
  update();
};
$("#lockButton").onclick = async () => {
  if (engine.recording || recordPending) await endRecord();
  state.locked = !state.locked;
  changed();
  toast(state.locked ? "Sounds and patterns are locked." : "Session unlocked.");
};
function openDialog(id) {
  clearHeld();
  $(id).showModal();
}
$("#helpOpen").onclick = () => openDialog("#guide");
$("#guideShortcut").onclick = () => openDialog("#guide");
$("#aboutOpen").onclick = () => openDialog("#about");
$$("dialog .close").forEach(
  (b) => (b.onclick = () => b.closest("dialog").close()),
);
$$("dialog").forEach((d) =>
  d.addEventListener("click", (e) => {
    const r = d.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      d.close();
  }),
);
$$("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      tabName = b.dataset.tab;
      renderWorkspace();
    }),
);
function miniWave(i) {
  return (
    '<span class="mini-wave" aria-hidden="true">' +
    Array.from(
      { length: 12 },
      (_, n) =>
        `<i style="height:${3 + (Math.sin(n * 1.9 + i) * 0.5 + 0.5) * 13}px"></i>`,
    ).join("") +
    "</span>"
  );
}
function renderWorkspace() {
  if (dragging) return;
  $$("[data-tab]").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.tab === tabName)),
  );
  const container = $("#workspaceContent");
  if (tabName === "sounds") {
    container.innerHTML = `<div class="panel-title">FX PAD BANK</div><select id="fxBank" aria-label="Effects pad bank"><option value="voice">Voice + original effects</option><option value="ko">K.O. · 16 performance effects</option></select><p class="helper">Hold FX + a pad. WRITE saves the effect to the pattern. Extra voice characters are below.</p><div class="panel-title">SOUND BANK <span>15 VOICES + DRUMS</span></div><div class="sound-list">${[...state.samples, { name: "Tonic drum bank" }].map((s, i) => `<button class="sound-item ${i === state.sound ? "selected" : ""}" data-sound="${i}"><span class="num">${String(i + 1).padStart(2, "0")}</span><span class="name">${esc(s.name)}</span>${miniWave(i)}<span class="duration">${i === 15 ? "16 hits" : (s.data.length / s.rate).toFixed(1) + "s"}</span></button>`).join("")}</div><div class="panel-buttons"><button class="secondary ${engine.recording ? "orange" : ""}" id="recordVoice">${engine.recording ? "Stop recording" : "Record voice"}</button><button class="secondary" id="importAudio">Import audio</button><button class="secondary" id="previewSound">Audition</button></div><p class="helper">${state.sound === 15 ? "Select a drum with a pad. Import audio replaces that hit." : `Slot ${state.sound + 1} · up to 8 seconds. Recording replaces this sound.`}</p>${state.sound < 15 ? `<div class="panel-title">VOICE CHARACTER</div><div class="voice-tags">${VOICES.map((v, i) => `<button data-voice="${i}" class="${state.voice === i ? "selected" : ""}">${v}</button>`).join("")}</div><div class="input-row"><label for="soundName">Sound name</label><input id="soundName" class="name-input" style="width:160px" maxlength="80" value="${esc(state.samples[state.sound].name)}"></div>` : `<div class="pattern-grid">${DRUMS.map((d, i) => `<button data-hit="${i}" class="${i === state.drumHit ? "selected" : ""}">${esc(d)}</button>`).join("")}</div>`}<div class="panel-section"><div class="panel-title">INPUT SOURCE <span>LOCAL AUDIO ONLY</span></div><select id="inputDevice" aria-label="Input device" style="width:100%"><option value="">Default microphone / audio input</option>${deviceOptions}</select><button class="text-button" id="listDevices">Choose connected input</button><p class="helper">Use an audio interface input for line-in recording. No live monitoring, so your speakers won’t feed back.</p></div>`;
    $$("[data-sound]").forEach(
      (b) =>
        (b.onclick = () => {
          state.sound = +b.dataset.sound;
          lastNote = 0;
          changed();
          message("SOUND " + (state.sound + 1));
        }),
    );
    $("#recordVoice").onclick = () => {
      if (engine.recording || recordPending) endRecord();
      else if (state.sound < 15) beginRecord(state.sound, true);
      else toast("Record into slots 1–15. Import audio to replace a drum hit.");
    };
    $("#importAudio").onclick = () => {
      if (locked()) return;
      pendingImport = state.sound === 15 ? "drum" : "voice";
      $("#audioFile").click();
    };
    $("#fxBank").value = fxBank;
    $("#fxBank").onchange = (e) => {
      fxBank = e.target.value;
      liveFx = 16;
      update();
    };
    $("#previewSound").onclick = () => audition();
    $$("[data-voice]").forEach(
      (b) =>
        (b.onclick = () => {
          if (locked()) return;
          state.voice = +b.dataset.voice;
          if (writeMode) {
            const step =
              state.patterns[state.pattern].steps[
                playing ? Math.max(0, displayStep) : selectedStep
              ];
            if (step.voice) step.voice.voice = state.voice;
          }
          changed();
        }),
    );
    $$("[data-hit]").forEach(
      (b) =>
        (b.onclick = () => {
          state.drumHit = +b.dataset.hit;
          changed();
          audition();
        }),
    );
    if ($("#soundName"))
      $("#soundName").onchange = (e) => {
        if (locked()) return;
        state.samples[state.sound].name =
          e.target.value.trim().slice(0, 80) || "Voice " + (state.sound + 1);
        engine.cache.clear();
        changed();
      };
    $("#inputDevice").value = inputDevice;
    $("#inputDevice").onchange = (e) => (inputDevice = e.target.value);
    $("#listDevices").onclick = listDevices;
  } else if (tabName === "pattern") {
    const p = state.patterns[state.pattern];
    container.innerHTML = `<div class="panel-title">PATTERNS <span>${state.pattern + 1} / 16</span></div><div class="pattern-grid">${state.patterns.map((p, i) => `<button data-pattern="${i}" class="${i === state.pattern ? "selected" : ""} ${p.steps.some((s) => s.voice || s.drum) ? "has" : ""}">${String(i + 1).padStart(2, "0")}</button>`).join("")}</div><div class="input-row"><label for="tempo">Tempo</label><input id="tempo" type="number" min="60" max="240" value="${Math.round(state.bpm)}"></div><div class="input-row"><label for="swing">Swing <span class="range-label">${Math.round(state.swing * 100)}%</span></label><input id="swing" type="range" min="0" max="50" value="${state.swing * 100}"></div><div class="input-row"><label for="scale">Scale</label><select id="scale">${SCALES.map((s, i) => `<option value="${i}" ${i === state.scale ? "selected" : ""}>${s.name}</option>`).join("")}</select></div><div class="input-row"><label for="key">Key</label><select id="key">${KEYS.map((k, i) => `<option value="${i}" ${i === state.key ? "selected" : ""}>${k}</option>`).join("")}</select></div><div class="panel-section"><div class="panel-title">STEP INSPECTOR <span>SOUND ${state.sound + 1}</span></div><div class="step-editor">${p.steps.map((s, i) => `<button data-step="${i}" class="${s.voice || s.drum ? "on" : ""} ${i === selectedStep ? "current" : ""}">${i + 1}</button>`).join("")}</div>${stepInspector(p.steps[selectedStep])}</div><div class="panel-section"><div class="panel-title">PATTERN CHAIN <span>${state.chain.length} / 64</span></div><div class="chain">${state.chain.length ? state.chain.map((n, i) => `<span class="${i === chainPos && playing ? "playing" : ""}">${n + 1}</span>`).join("") : "<span>Single pattern</span>"}</div><div class="panel-buttons"><select id="chainPattern" aria-label="Pattern to append"><option value="${state.pattern}">Pattern ${state.pattern + 1}</option>${state.patterns.map((p, i) => (i !== state.pattern ? `<option value="${i}">Pattern ${i + 1}</option>` : "")).join("")}</select><button class="secondary" id="appendChain">Append</button><button class="secondary" id="clearChain">Clear chain</button></div><div class="panel-buttons"><button class="secondary" id="copyPattern">Copy pattern</button><select id="copyTo" aria-label="Copy destination">${state.patterns.map((p, i) => `<option value="${i}" ${i === (state.pattern + 1) % 16 ? "selected" : ""}>To ${i + 1}</option>`).join("")}</select><button class="secondary danger" id="clearPattern">Clear pattern</button></div></div>`;
    $$("[data-pattern]").forEach(
      (b) =>
        (b.onclick = () => {
          state.pattern = +b.dataset.pattern;
          state.chain = [];
          changed();
        }),
    );
    $$("[data-step]").forEach(
      (b) =>
        (b.onclick = () => {
          selectedStep = +b.dataset.step;
          renderWorkspace();
        }),
    );
    $("#tempo").onchange = (e) => {
      if (locked()) return;
      state.bpm = clamp(Number(e.target.value) || 120, 60, 240);
      changed();
    };
    $("#swing").oninput = (e) => {
      if (locked()) return;
      state.swing = Number(e.target.value) / 100;
      changed(false);
      e.target.previousElementSibling.querySelector("span").textContent =
        Math.round(state.swing * 100) + "%";
    };
    $("#scale").onchange = (e) => {
      if (locked()) return;
      state.scale = +e.target.value;
      changed();
    };
    $("#key").onchange = (e) => {
      if (locked()) return;
      state.key = +e.target.value;
      changed();
    };
    $("#appendChain").onclick = () => {
      if (locked()) return;
      if (state.chain.length >= 64) {
        toast("The chain is full.");
        return;
      }
      state.chain.push(+$("#chainPattern").value);
      changed();
    };
    $("#clearChain").onclick = () => {
      if (locked()) return;
      state.chain = [];
      changed();
    };
    $("#copyPattern").onclick = () => {
      if (locked()) return;
      copyPattern(state, +$("#copyTo").value);
      changed();
      toast("Pattern copied.");
    };
    $("#clearPattern").onclick = () => {
      if (locked()) return;
      state.patterns[state.pattern] = blankPattern();
      changed();
    };
    bindInspector();
  } else {
    container.innerHTML = `<label for="sessionName" class="panel-title">SESSION NAME</label><input class="name-input" id="sessionName" maxlength="80" value="${esc(state.name)}"><div class="session-stats"><span><b>${state.patterns.filter((p) => p.steps.some((s) => s.voice || s.drum)).length}</b>PATTERNS</span><span><b>${state.samples.reduce((n, s) => n + s.data.length / s.rate, 0).toFixed(0)}s</b>VOICE AUDIO</span></div><div class="panel-buttons"><button class="secondary" id="backup">Save backup</button><button class="secondary" id="restore">${receiveMode ? "Receive backup" : "Restore backup"}</button><button class="secondary" id="audioBackup">Data WAV</button></div><p class="helper">Backups include every sound, pattern and setting. JSON or lossless VOX data WAV. Hardware data uses a different format.</p><div class="panel-section"><div class="panel-title">RECORD & EXPORT</div><div class="panel-buttons"><button class="secondary ${engine.capturing ? "orange" : ""}" id="capture">${engine.capturing ? "Finish recording" : "Record performance"}</button><button class="secondary" id="renderSong" ${exporting ? "disabled" : ""}>${exporting ? "Rendering…" : "Export loop WAV"}</button></div><p class="helper">Export one pass of your pattern chain, or record a live performance. Stereo WAV, with effects included.</p>${lastExport ? `<a id="exportDownload" href="${lastExport.url}" download="${esc(lastExport.name)}" class="download-link">Download ${esc(lastExport.name)}</a>${lastExport.type === "audio/wav" && !lastExport.name.endsWith("-backup.wav") ? `<audio controls src="${lastExport.url}" style="width:100%;height:34px;margin-top:10px"></audio>` : ""}` : ""}<div class="input-row"><label for="volume">Volume</label><input id="volume" type="range" min="1" max="16" value="${state.volume}"></div></div><div class="panel-section"><div class="panel-title">CLOCK & ALARM <span id="clockTime">${clockText()}</span></div><div class="input-row"><label for="clock">Set clock</label><input id="clock" type="time" value="${clockText()}"></div><div class="input-row"><label for="alarmTime">Alarm time</label><input id="alarmTime" type="time" value="${String(state.alarm.hour).padStart(2, "0")}:${String(state.alarm.minute).padStart(2, "0")}"></div><div class="input-row"><label for="alarmPattern">Alarm pattern</label><select id="alarmPattern">${state.patterns.map((p, i) => `<option value="${i}" ${state.alarm.pattern === i ? "selected" : ""}>Pattern ${i + 1}</option>`).join("")}</select></div><div class="input-row"><label for="alarmEnabled">Alarm enabled</label><input id="alarmEnabled" type="checkbox" ${state.alarm.enabled ? "checked" : ""}></div><p class="helper">Keep this page open with sound enabled for the alarm.</p></div><div class="panel-section"><div class="panel-title">SYNC <span>2 PULSES / QUARTER NOTE</span></div><select id="syncMode" aria-label="Sync mode" style="width:100%">${["SY0 · stereo audio", "SY1 · audio + clock out", "SY2 · clock in / stereo out", "SY3 · clock in / audio + clock out", "SY4 · audio + clock in / stereo out", "SY5 · audio + clock in / clock out"].map((s, i) => `<option value="${i}" ${state.sync === i ? "selected" : ""}>${s}</option>`).join("")}</select><div class="panel-buttons"><button class="secondary" id="syncInput">${engine.stream ? "Disconnect input" : "Connect clock input"}</button><button class="secondary" id="syncLink">Sync another tab</button></div><div class="input-row"><label for="monitorInput">Pass input audio through</label><input id="monitorInput" type="checkbox" ${state.monitorInput ? "checked" : ""}></div><div class="progress"><i id="inputLevel" style="width:0"></i></div><p class="helper">Clock is on the left channel; audio is on the right. Input audio passthrough is available in SY4/SY5; use headphones or line inputs to avoid feedback. Tab sync connects two VOX tabs on the same origin.</p></div><div class="panel-section"><div class="panel-buttons"><button class="secondary" id="resetSession">Factory reset</button><button class="secondary" id="newSession">Empty session</button><button class="secondary" id="power">${sleeping ? "Wake up" : "Sleep display"}</button></div><p class="helper">Factory reset restores original VOX sounds and demo patterns. Export a backup before resetting.</p></div>`;
    $("#sessionName").onchange = (e) => {
      if (locked()) return;
      state.name = e.target.value.trim().slice(0, 80) || "Untitled session";
      changed();
    };
    $("#backup").onclick = () => exportSession(false);
    $("#audioBackup").onclick = () => exportSession(true);
    $("#restore").onclick = () => {
      if (locked()) return;
      $("#sessionFile").click();
    };
    $("#capture").onclick = capturePerformance;
    $("#renderSong").onclick = renderSong;
    $("#volume").oninput = (e) => {
      state.volume = +e.target.value;
      engine.setVolume(state.volume);
      engine.setDrive(state.drive);
      changed(false);
    };
    $("#clock").onchange = (e) => {
      if (locked()) return;
      const [h, m] = e.target.value.split(":").map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return;
      const now = new Date();
      const set = new Date();
      set.setHours(h, m, 0, 0);
      state.clockOffset = set - now;
      changed(false);
    };
    $("#alarmTime").onchange = (e) => {
      if (locked()) return;
      const [h, m] = e.target.value.split(":").map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return;
      state.alarm.hour = h;
      state.alarm.minute = m;
      changed(false);
    };
    $("#alarmPattern").onchange = (e) => {
      if (locked()) return;
      state.alarm.pattern = +e.target.value;
      changed(false);
    };
    $("#alarmEnabled").onchange = (e) => {
      if (locked()) return;
      state.alarm.enabled = e.target.checked;
      changed(false);
    };
    $("#syncMode").onchange = (e) => {
      if (locked()) return;
      stop();
      state.sync = +e.target.value;
      engine.setSync(state.sync);
      engine.setMonitor(state.monitorInput);
      changed();
    };
    $("#monitorInput").onchange = (e) => {
      if (locked()) return;
      state.monitorInput = e.target.checked;
      engine.setMonitor(state.monitorInput);
      changed(false);
    };
    $("#syncInput").onclick = async () => {
      if (engine.stream) {
        engine.closeInput();
        renderWorkspace();
        return;
      }
      if (![2, 3, 4, 5].includes(state.sync)) {
        toast("Choose a clock input mode, SY2–SY5, first.");
        return;
      }
      try {
        await engine.openInput(inputDevice);
        toast("Clock input connected. Press play to wait.");
        renderWorkspace();
      } catch (e) {
        toast("Clock input unavailable: " + e.message);
      }
    };
    $("#syncLink").onclick = () => {
      tabSync = !tabSync;
      toast(
        tabSync
          ? "Tab sync enabled. SY1 master, SY2 follower."
          : "Tab sync disabled.",
      );
    };
    $("#resetSession").onclick = () => resetSession(true);
    $("#newSession").onclick = () => resetSession(false);
    $("#power").onclick = () => {
      sleeping = !sleeping;
      if (sleeping) {
        stop();
        sleeping = true;
      }
      update();
    };
  }
}
let lastExport = null;
let deviceOptions = "";
async function listDevices() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    deviceOptions = devices
      .filter((d) => d.kind === "audioinput")
      .map(
        (d) =>
          `<option value="${esc(d.deviceId)}">${esc(d.label || "Audio input")}</option>`,
      )
      .join("");
    renderWorkspace();
  } catch (e) {
    toast("Input access unavailable. Import an audio file instead.");
  }
}
function stepInspector(step) {
  return `<div class="step-detail">STEP ${selectedStep + 1} · ${step.voice ? "voice " + (step.voice.slot + 1) : "no voice"} · ${step.drum ? DRUMS[step.drum.hit] : "no drum"}${step.voice?.params ? " · parameters locked" : ""}${step.voice?.voice !== null && step.voice?.voice !== undefined ? " · " + VOICES[step.voice.voice] : ""}<div class="input-row"><label for="stepRepeat">Repeat</label><input id="stepRepeat" type="number" min="1" max="16" value="${step.multiplier}"></div><div class="input-row"><label for="stepNote">Voice note</label><input id="stepNote" type="number" min="-24" max="72" value="${step.voice?.note || 0}" ${!step.voice ? "disabled" : ""}></div><div class="input-row"><label for="stepFx">Effect</label><select id="stepFx">${EFFECTS.map((f, i) => `<option value="${i + 9}" ${state.patterns[state.pattern].effects[selectedStep] === i + 9 ? "selected" : ""}>${f}</option>`).join("")}</select></div><div class="panel-buttons"><button class="secondary" id="toggleStep">Toggle selected sound</button><button class="secondary" id="lockStep">${step.voice?.params ? "Clear locks" : "Lock parameters"}</button></div></div>`;
}
function bindInspector() {
  const step = state.patterns[state.pattern].steps[selectedStep];
  $("#stepRepeat").onchange = (e) => {
    if (locked()) return;
    step.multiplier = clamp(Math.round(+e.target.value) || 1, 1, 16);
    changed();
  };
  $("#stepNote").onchange = (e) => {
    if (locked() || !step.voice) return;
    step.voice.note = clamp(+e.target.value || 0, -24, 72);
    changed();
  };
  $("#stepFx").onchange = (e) => {
    if (locked()) return;
    state.patterns[state.pattern].effects[selectedStep] = +e.target.value;
    changed();
  };
  $("#toggleStep").onclick = () => {
    if (locked()) return;
    setStep(state, selectedStep, lastNote);
    changed();
  };
  $("#lockStep").onclick = () => {
    if (locked()) return;
    if (!step.voice) {
      toast("Add a voice to this step first.");
      return;
    }
    step.voice.params = step.voice.params
      ? null
      : { ...state.params[step.voice.slot] };
    step.voice.voice = step.voice.params ? state.voice : null;
    changed();
  };
}
function clockText() {
  const d = new Date(Date.now() + state.clockOffset);
  return (
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0")
  );
}
function openAlarm() {
  tabName = "session";
  renderWorkspace();
  $("#alarmTime")?.focus();
  message("SET ALARM IN SESSION");
}
function download(data, name, type) {
  if (lastExport) URL.revokeObjectURL(lastExport.url);
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  lastExport = { url, name, type };
  renderWorkspace();
}
function filename() {
  return (
    state.name
      .replace(/[^a-z0-9_-]/gi, "-")
      .replace(/-+/g, "-")
      .slice(0, 50) || "vox-session"
  );
}
function exportSession(audio) {
  try {
    const text = packSession(state);
    if (audio && text.length > 3000000) {
      toast("Data WAV would be too large. Save a JSON backup instead.");
      return;
    }
    download(
      audio ? backupWave(text) : text,
      filename() + (audio ? "-backup.wav" : ".vox.json"),
      audio ? "audio/wav" : "application/json",
    );
    message(audio ? "DATA WAV EXPORTED" : "SESSION BACKED UP");
  } catch (e) {
    toast("Backup failed: " + e.message);
  }
}
$("#audioFile").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || locked()) return;
  const slot = state.sound,
    hit = state.drumHit,
    isDrum = pendingImport === "drum";
  if (file.size > 50000000) {
    toast("Use an audio file smaller than 50 MB.");
    return;
  }
  try {
    if (!(await enableAudio())) return;
    const buffer = await engine.ctx.decodeAudioData(await file.arrayBuffer());
    const len = Math.min(buffer.length, buffer.sampleRate * 8);
    const data = new Float32Array(len);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c);
      for (let i = 0; i < len; i++) data[i] += src[i] / buffer.numberOfChannels;
    }
    const sample = {
      name: file.name.replace(/\.[^.]+$/, "").slice(0, 80),
      rate: buffer.sampleRate,
      data,
    };
    if (isDrum) state.drumSamples[hit] = sample;
    else state.samples[slot] = sample;
    engine.cache.clear();
    changed();
    toast(
      buffer.duration > 8 ? "Imported the first 8 seconds." : "Audio imported.",
    );
  } catch (e) {
    toast("Could not decode that audio file. Try WAV or MP3.");
  }
};
$("#sessionFile").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || locked()) return;
  if (file.size > 400000000) {
    toast("Backup is too large.");
    return;
  }
  try {
    let text = file.name.toLowerCase().endsWith(".wav")
      ? readBackupWave(await file.arrayBuffer())
      : await file.text();
    const restored = unpackSession(text);
    stop();
    if (engine.recording) await endRecord();
    state = restored;
    engine.cache.clear();
    engine.setVolume(state.volume);
    engine.setDrive(state.drive);
    engine.setSync(state.sync);
    engine.setMonitor(state.monitorInput);
    receiveMode = false;
    changed();
    toast("Session restored with sounds and patterns.");
  } catch (e) {
    toast(e.message || "Invalid backup. Your session was kept.");
  }
};
async function capturePerformance() {
  if (!(await enableAudio())) return;
  if (engine.capturing) {
    const wav = await engine.finishCapture();
    if (wav) download(wav, filename() + "-performance.wav", "audio/wav");
    else toast("No audio captured.");
    renderWorkspace();
    message("PERFORMANCE SAVED");
  } else {
    engine.startCapture();
    captureStarted = Date.now();
    message("PERFORMANCE RECORDING");
    toast("Recording output. Play and perform, then finish here.");
    renderWorkspace();
  }
}
async function renderSong() {
  if (exporting) return;
  exporting = true;
  renderWorkspace();
  try {
    const snapshot = structuredClone(state);
    const chain = snapshot.chain.length ? snapshot.chain : [snapshot.pattern];
    const seconds = (chain.length * 16 * 60) / snapshot.bpm / 4 + 2;
    const sampleRate = 22050;
    const ctx = new OfflineAudioContext(
      2,
      Math.ceil(seconds * sampleRate),
      sampleRate,
    );
    const offline = new Engine(ctx);
    offline.connectGraph();
    offline.setVolume(snapshot.volume);
    offline.setDrive(snapshot.drive);
    let t = 0;
    for (let bar = 0; bar < chain.length; bar++) {
      snapshot.pattern = chain[bar];
      const p = snapshot.patterns[snapshot.pattern];
      for (let step = 0; step < 16; step++) {
        const dt =
          (60 / snapshot.bpm / 4) *
          (step % 2 === 0 ? 1 + snapshot.swing : 1 - snapshot.swing);
        const base = 60 / snapshot.bpm / 4;
        const at =
          p.effects[step] === 13
            ? t + (Math.round(step * 1.5) / 1.5 - step) * base
            : t;
        offline.trigger(snapshot, p.steps[step], p.effects[step], at, dt, bar);
        t += dt;
      }
    }
    const buffer = await ctx.startRendering();
    download(
      toWav([buffer.getChannelData(0), buffer.getChannelData(1)], sampleRate),
      filename() + "-loop.wav",
      "audio/wav",
    );
    toast("Loop ready. Download or listen in Session.");
  } catch (e) {
    toast("Export failed: " + e.message);
  } finally {
    exporting = false;
    renderWorkspace();
  }
}
async function resetSession(demo) {
  if (locked()) return;
  if (
    !confirm(
      demo
        ? "Replace this session with the VOX factory sounds and demo patterns?"
        : "Clear all patterns and reset settings? Sounds return to the original VOX bank.",
    )
  )
    return;
  stop();
  if (engine.recording) await endRecord();
  recordRequest++;
  recordPending = false;
  state = createState();
  state.samples = structuredClone(factorySamples);
  if (!demo) state.patterns = Array.from({ length: 16 }, blankPattern);
  writeMode = false;
  engine.cache.clear();
  engine.setVolume(state.volume);
  engine.setDrive(state.drive);
  engine.setSync(state.sync);
  engine.setMonitor(state.monitorInput);
  changed();
  toast(demo ? "Factory session restored." : "Empty session ready.");
}
let tabSync = false,
  channel = null;
try {
  channel = new BroadcastChannel("vox-137-clock");
  channel.onmessage = (e) => {
    if (
      tabSync &&
      [2, 3, 4, 5].includes(state.sync) &&
      e.data.type === "clock" &&
      engine.ctx
    )
      engine.onClock(engine.ctx.currentTime);
  };
} catch {}
const originalSchedule = scheduleStep;
scheduleStep = function (step, time) {
  originalSchedule(step, time);
  if (tabSync && step % 2 === 0 && [1, 3, 5].includes(state.sync)) {
    const delay = Math.max(0, (time - engine.ctx.currentTime) * 1000);
    setTimeout(() => {
      if (playing) channel?.postMessage({ type: "clock" });
    }, delay);
  }
};
const guideRows = [
  ["PLAY / Space", "Start or stop the sequence."],
  ["SOUND + 1–16", "Select a vocal slot or drum bank 16."],
  [
    "Pads in live mode",
    "Play notes in the selected scale; in slot 16, choose a drum hit.",
  ],
  ["WRITE", "Toggle step entry. Tap pads to add or remove the selected sound."],
  [
    "WRITE held + pads while playing",
    "Record notes into the nearest sequencer step.",
  ],
  ["RECORD + 1–15", "Hold both to record. Up to 8 seconds. Release to finish."],
  [
    "PATTERN + 1–16",
    "Select a pattern. Tap more pads while held to chain up to 64 entries.",
  ],
  ["WRITE + PATTERN + pad", "Copy the current pattern to that slot."],
  ["RECORD + PATTERN", "Clear the current pattern."],
  ["FX (tap)", "Switch knob banks: pitch/formant and start/speed."],
  [
    "FX + 1–8",
    "Choose a voice character. WRITE saves a voice change at the current step.",
  ],
  [
    "FX + 9–15",
    "Hold a performance effect. WRITE saves it at the current step.",
  ],
  ["FX + 16", "Clear the effect at the current step in WRITE mode."],
  [
    "WRITE + knobs",
    "Record parameter locks at the current step, or the inspected step when stopped.",
  ],
  ["BPM (tap)", "Cycle 80, 120 and 140 BPM."],
  ["BPM + knob A / B", "Adjust swing / tempo. Range: 60–240 BPM."],
  ["BPM + 1–16", "Set master volume. Start low with headphones."],
  ["PATTERN + knob A / B", "Change key / scale."],
  [
    "M + step",
    "Cycle that step’s repeat count from 1 to 16. Or set it in the step inspector.",
  ],
  ["SOUND + PATTERN", "Open clock and alarm settings."],
  [
    "SOUND + BPM",
    "Show audio/session status instead of physical battery level.",
  ],
  ["RECORD + BPM", "Cycle sync modes SY0–SY5. Connect clock input in Session."],
  ["WRITE + SOUND", "Download a complete session backup."],
  ["RECORD + SOUND", "Enter receive mode; import a VOX backup."],
  ["Lock", "Freeze sounds, patterns and settings. Click again to unlock."],
  ["Factory reset", "Restore original VOX sounds and demo patterns."],
  [
    "Knob drag / wheel / arrow keys",
    "Adjust a value. Double-click a knob to reset sound parameters.",
  ],
];
$("#guideContent").innerHTML =
  `<p>Use the device like a Pocket Operator: hold a labeled control, then press a numbered pad. With a mouse, use keyboard modifiers or turn on <b>Latch controls</b> to keep a control held across clicks. Touch supports holding two controls at once.</p><h3 class="guide-section">Keyboard</h3><div class="keymap">${padKeys.map((k) => `<kbd>${k.toUpperCase()}</kbd>`).join("")}</div><p>The keys above map to the 4×4 pads. Hold <b>Shift + S / P / B / M / R / F / W</b> for Sound / Pattern / BPM / M / Record / FX / Write. Space starts or stops. Release the letter to release its control. Escape stops and releases controls.</p><table class="guide-table"><tbody>${guideRows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</tbody></table><h3 class="guide-section">What differs from the hardware</h3><p>Voice synthesis and drum morphing are original approximations. VOX backups and tab sync work between VOX sessions; hardware backup and Microtonic data aren’t compatible. Slot 16 accepts imported drum hits as an alternative. Clock alarms need an open, active page. Auto-sleep leaves the clock visible.</p>`;
const canvas = $("#visual"),
  g = canvas.getContext("2d"),
  wave = new Uint8Array(128);
let lastDrawStep = -2;
function animate() {
  frame++;
  const now = engine.ctx?.currentTime || 0;
  if (playing && timeline.length) {
    let current = null;
    for (const t of timeline) if (t.time <= now) current = t;
    if (current && current.step !== lastDrawStep) {
      displayStep = current.step;
      lastDrawStep = displayStep;
      $("#patternRead").textContent = String(current.pattern + 1).padStart(
        2,
        "0",
      );
      update();
    }
  }
  if (frame % 15 === 0) {
    if (
      Date.now() - lastInteraction > 120000 &&
      !playing &&
      !engine.recording &&
      !recordPending
    )
      sleeping = true;
    update();
    if (engine.capturing && Date.now() - captureStarted > 300000)
      capturePerformance();
    const clock = $("#clockTime");
    if (clock) clock.textContent = clockText();
    if (
      state.alarm.enabled &&
      clockText() ===
        String(state.alarm.hour).padStart(2, "0") +
          ":" +
          String(state.alarm.minute).padStart(2, "0")
    ) {
      const day =
        new Date(Date.now() + state.clockOffset).toDateString() +
        " " +
        clockText();
      if (alarmLast !== day && engine.ctx?.state === "running") {
        alarmLast = day;
        stop();
        state.pattern = state.alarm.pattern;
        state.chain = [];
        play();
        alarmRinging = true;
        toast("Alarm · press any control to stop.");
      }
    }
  }
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.strokeStyle = "#405631";
  g.fillStyle = "#405631";
  g.lineWidth = 2;
  if (sleeping) {
    g.font = "30px monospace";
    g.textAlign = "center";
    g.fillText(clockText(), 120, 53);
  } else {
    if (engine.analyser) engine.analyser.getByteTimeDomainData(wave);
    else wave.fill(128);
    g.beginPath();
    for (let i = 0; i < wave.length; i++) {
      const x = (i / (wave.length - 1)) * 240;
      const y = 45 + ((wave[i] - 128) / 128) * 38;
      const idle = playing
        ? 0
        : Math.sin(i * 0.14 + frame * 0.025) * Math.sin(i * 0.025) * 4;
      i ? g.lineTo(x, y + idle) : g.moveTo(x, y + idle);
    }
    g.stroke();
    g.fillRect(15, 77, 6, 3);
    for (let i = 0; i < 22; i++) {
      const h =
        3 +
        (playing
          ? Math.abs(wave[i * 5] - 128) * 0.17
          : 2 + Math.sin(i * 0.6 + frame * 0.05) * 2);
      g.fillRect(23 + i * 8, 79 - h, 3, h);
    }
  }
  requestAnimationFrame(animate);
}
async function restore() {
  try {
    factorySamples = await Promise.all(
      NAMES.map(async (name, i) => {
        const response = await fetch(
          "./sounds/voice-" + String(i + 1).padStart(2, "0") + ".wav",
        );
        if (!response.ok) throw Error("Starter audio unavailable");
        return decodePcmWav(await response.arrayBuffer(), name);
      }),
    );
    state.samples = structuredClone(factorySamples);
  } catch {}
  try {
    const saved = await loadSession();
    if (saved) {
      state = saved;
      message("SESSION RESTORED");
    }
  } catch {
    $("#saveStatus").textContent = "Storage unavailable · export a backup";
  }
  update();
  renderWorkspace();
}
await restore();
animate();
// Structured tools mirror the device and sidebar; they never request microphone access.
if (document.modelContext?.registerTool) {
  const tools = [
    {
      name: "read_vox_session",
      description:
        "Read the current instrument settings, patterns and sound names.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: () => ({
        name: state.name,
        bpm: state.bpm,
        sound: state.sound + 1,
        pattern: state.pattern + 1,
        playing,
        writeMode,
        voice: VOICES[state.voice],
        chain: state.chain.map((x) => x + 1),
        sounds: state.samples.map((s) => s.name),
        patterns: state.patterns,
      }),
    },
    {
      name: "configure_vox_pattern",
      description:
        "Set tempo and program a batch of voice or drum steps in the current pattern.",
      inputSchema: {
        type: "object",
        properties: {
          bpm: { type: "number", minimum: 60, maximum: 240 },
          steps: {
            type: "array",
            maxItems: 16,
            items: {
              type: "object",
              properties: {
                step: { type: "integer", minimum: 1, maximum: 16 },
                sound: { type: "integer", minimum: 1, maximum: 16 },
                note: { type: "integer", minimum: -24, maximum: 72 },
                drum: { type: "integer", minimum: 1, maximum: 16 },
                enabled: { type: "boolean" },
              },
              required: ["step", "sound", "enabled"],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input) => {
        if (state.locked) throw Error("Session is locked.");
        if (
          !input ||
          typeof input !== "object" ||
          Object.keys(input).some((k) => !["bpm", "steps"].includes(k)) ||
          (input.bpm !== undefined &&
            (!Number.isFinite(input.bpm) ||
              input.bpm < 60 ||
              input.bpm > 240)) ||
          (input.steps !== undefined &&
            (!Array.isArray(input.steps) || input.steps.length > 16))
        )
          throw Error("Invalid settings.");
        for (const s of input.steps || [])
          if (
            !s ||
            Object.keys(s).some(
              (k) => !["step", "sound", "note", "drum", "enabled"].includes(k),
            ) ||
            !Number.isInteger(s.step) ||
            s.step < 1 ||
            s.step > 16 ||
            !Number.isInteger(s.sound) ||
            s.sound < 1 ||
            s.sound > 16 ||
            typeof s.enabled !== "boolean" ||
            (s.note !== undefined &&
              (!Number.isInteger(s.note) || s.note < -24 || s.note > 72)) ||
            (s.drum !== undefined &&
              (!Number.isInteger(s.drum) || s.drum < 1 || s.drum > 16))
          )
            throw Error("Invalid step.");
        if (input.bpm !== undefined) state.bpm = input.bpm;
        for (const s of input.steps || []) {
          const step = state.patterns[state.pattern].steps[s.step - 1];
          if (s.sound === 16)
            step.drum = s.enabled ? { hit: (s.drum || 1) - 1 } : null;
          else
            step.voice = s.enabled
              ? {
                  slot: s.sound - 1,
                  note: s.note || 0,
                  params: null,
                  voice: null,
                }
              : null;
        }
        changed();
        return {
          pattern: state.pattern + 1,
          bpm: state.bpm,
          steps: state.patterns[state.pattern].steps,
        };
      },
    },
  ];
  for (const tool of tools)
    try {
      await document.modelContext.registerTool(tool);
    } catch (e) {
      console.warn("Instrument tools unavailable", e.message);
    }
}
