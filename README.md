# VOX / 137

An independent browser recreation of the PO-137's documented controls and workflow. Vanilla JavaScript, Web Audio, AudioWorklets, and IndexedDB. No application server or account is needed for the instrument itself.

[Play VOX / 137](https://npclabs-19.github.io/vox-137/)

## Run locally

Serve `dist` on localhost or HTTPS. Microphone and AudioWorklet access requires a secure context.

```sh
python3 -m http.server 8787 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:8787 and press Enable sound, then Play. The instrument includes 15 original spoken starters and four demo patterns.

## Controls

The in-app Field guide documents all button combinations. Use multi-touch, keyboard modifiers, or Latch controls for holding buttons with a mouse. The keyboard pad grid is:

```
1 2 3 4
Q W E R
A S D F
Z X C V
```

Hold Shift+S/P/B/M/R/F/W for Sound/Pattern/BPM/M/Record/FX/Write. Space starts/stops. Knobs support dragging, focused mouse wheel, arrow keys, and double-click reset.

## Implemented

- 15 voice slots × 8 seconds, microphone/audio-interface recording, mono audio file import; 16 original synthesized drum hits in slot 16, with individual imported replacements.
- Sixteen recreated voice characters (Synth removed; Chorus, Chipmunk, Giant, Telephone, Whisper, Megaphone, Alien, Double and Underwater added), pitch/formant and independent start/speed controls, two monophonic lanes (one vocal, one drum).
- 16 × 16-step patterns, live quantized note entry, per-step parameter/voice locks, up to 16 repeats per step, copy/clear, 64-entry pattern chains.
- Original performance effects plus a PO-33 K.O. bank (loop variants, unison, octave shifts, stutter and scratch), with per-step effect recording and clearing. Triplet quantization, stutter/build-up repeats, gating, half-speed, live pattern restart, and reversal.
- 60–240 BPM, swing, selectable key/scales, visible master volume and 0–24 dB drive with soft saturation and compressor limiting. Both controls apply to playback and WAV exports.
- Local session persistence, versioned JSON backup/restore, VOX-specific lossless stereo data WAV backup/restore.
- Stereo WAV loop/chain rendering with tail, live performance capture with a five-minute limit, audio preview and download links.
- Clock setting, alarm pattern, idle auto-sleep, reversible session lock, factory reset.
- SY0–SY5 audio output routing, synthesized 2-PPQN clock output, AudioWorklet clock-input detection, optional same-origin tab clock sync.
- Feature-detected WebMCP session read and atomic batch pattern programming tools.

## Fidelity limits

This is a functional browser reinterpretation, not a firmware emulation. Teenage Engineering's proprietary voice algorithms, PO-32/Microtonic synthesis model, exact scale tables, and encoded data protocols are not reproduced. Voice/formant/pitch processing uses granular resampling, bandpass filtering, pitch estimation, ring modulation, quantization and envelope/carrier synthesis. Vocal characters and performance effects approximate the corresponding musical behavior rather than matching hardware output sample for sample. Microtonic patch transmission is not supported; drum audio import is the alternative. Hardware backup signals are not compatible with VOX backups.

Physical voltage, battery state, circuit-board tabs, hardware speaker/case and analog jack detection cannot be emulated in a web page. Lock and battery-status combinations have explicit browser equivalents. M+pad cycles the repeat count, and a step inspector permits direct entry. Browser scheduling, suspended tabs and permission prompts differ from hardware. Alarms require the page to remain open and audio enabled. Audio clock sync is best-effort, not voltage-calibrated hardware clock. SY4/SY5 detect clock on the input's left channel and optionally pass the right-channel audio through when the Session monitoring checkbox is enabled. Monitoring is muted while recording a vocal. The audio interface must expose an input device to the browser.

Starter recordings are original text synthesized using the system Samantha voice. No Rick and Morty samples, firmware, logos or animations are included. The design and branding are original. The clear shell exposes an illustrated circuit board, traces, chips, capacitors and colored wires.

The K.O. bank is based on the [official PO-33 effects list](https://teenage.engineering/guides/po-33/en). Select it under Sound Bank, then hold FX + a pad. Effects can also be selected per step in the Pattern inspector. The loop and scratch DSP are browser approximations. Existing Synth locks use Chorus in the new version.

## Verification

```sh
node --experimental-default-type=module tests/audio-model.mjs
```

Tests cover pattern edits, copy isolation, lock guards, malformed-import rejection, exact JSON and data-WAV backup round trips, output from eight voice modes and sixteen drums, independent speed/pitch duration, reversal and stereo PCM encoding.

For browser audio verification, temporarily copy `tests/browser-audio.html` to `dist/__qa.html`, serve `dist`, and open `/__qa.html`. It verifies non-silent live output, real AudioWorklet performance capture, simulated input capture, clock pulse detection, and offline rendering. It uses a generated buffer, not the user's microphone. Remove the temporary page before deployment.

Browser UI checks verified play/stop, held Sound + pad selection, pattern programming, invalid tempo rejection, local state restoration, loop rendering and a playable exported WAV. Actual microphone permission/device behavior, external hardware clock reliability, and download completion in the in-app browser were not verified. The generated WAV loaded successfully in the page's native audio player. The in-app viewport tool did not expose a phone-sized viewport, so the mobile CSS was reviewed but not validated on a physical device.

## Files

- `dist/app.js`: user interaction, scheduling, sidebar, file flows, WebMCP.
- `dist/model.js`: session schema, sequencing operations, validation.
- `dist/engine.js`: synthesis, audio routing, capture, WAV encoding.
- `dist/worklet.js`: input/output capture and pulse detection.
- `dist/storage.js`: IndexedDB, JSON/PCM codecs, backup carrier.
- `dist/index.html`, `dist/style.css`: original interface and responsive layout.
- `dist/sounds`: original speech WAVs.

Hosted on GitHub Pages from the `gh-pages` branch. The editable application source is on `main`. To redeploy after committing changes, run `git subtree push --prefix dist origin gh-pages`.
