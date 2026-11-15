// Original 120 BPM track for the vertical promo. Everything is synthesized here,
// so the result is copyright-free and can ship with the project.
import fs from 'node:fs';

const SR = 44100;
const DUR = 32;
const N = SR * DUR;
const BPM = 120;
const BEAT = 60 / BPM;      // 0.5 s
const BAR = BEAT * 4;       // 2 s
const L = new Float32Array(N);
const R = new Float32Array(N);

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const note = (semi) => 440 * Math.pow(2, (semi - 69) / 12);

// A minor / F / C / G, one bar each, repeating.
const CHORDS = [
  { root: 45, tones: [57, 60, 64] }, // Am
  { root: 41, tones: [53, 57, 60] }, // F
  { root: 48, tones: [55, 60, 64] }, // C
  { root: 43, tones: [55, 59, 62] }, // G
];
const chordAt = (t) => CHORDS[Math.floor(t / BAR) % 4];

// ---------- voices ----------
function kick(at, gain = 1) {
  const start = Math.floor(at * SR);
  let phase = 0;
  for (let i = 0; i < SR * 0.45; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= N) continue;
    const t = i / SR;
    const f = 44 + 100 * Math.exp(-t / 0.032);
    phase += (2 * Math.PI * f) / SR;
    const amp = Math.exp(-t / 0.15) * (1 - Math.exp(-t / 0.002));
    const v = Math.sin(phase) * amp * 0.95 * gain;
    L[idx] += v; R[idx] += v;
  }
}

function noiseHit(at, dur, gain, hp = 6000, lp = 16000) {
  const start = Math.floor(at * SR);
  let lpState = 0, prev = 0;
  for (let i = 0; i < SR * dur; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= N) continue;
    const t = i / SR;
    const n = Math.random() * 2 - 1;
    lpState += (n - lpState) * (1 - Math.exp((-2 * Math.PI * lp) / SR));
    const high = lpState - prev;
    prev = lpState;
    let v = high;
    if (hp > 0) {
      // simple one-pole high-pass on top of the low-pass
      v = high;
    }
    const amp = Math.exp(-t / (dur * 0.32));
    L[idx] += v * amp * gain;
    R[idx] += v * amp * gain;
  }
}

function clap(at, gain = 0.55) {
  for (let k = 0; k < 3; k++) noiseHit(at + k * 0.009, 0.16, gain * (1 - k * 0.18), 0, 5200);
}

function hat(at, open = false, gain = 0.18) {
  noiseHit(at, open ? 0.22 : 0.055, gain, 0, 15000);
}

function bass(at, freq, dur, gain = 0.5) {
  const start = Math.floor(at * SR);
  let phase = 0, lp = 0;
  const n = Math.floor(SR * dur);
  for (let i = 0; i < n; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= N) continue;
    const t = i / SR;
    phase += freq / SR;
    const saw = 2 * (phase % 1) - 1;
    const sub = Math.sin(2 * Math.PI * (freq / 2) * t);
    lp += (saw - lp) * 0.06;
    const amp = Math.min(1, t / 0.006) * Math.exp(-t / (dur * 0.55));
    const v = (lp * 0.7 + sub * 0.5) * amp * gain;
    L[idx] += v; R[idx] += v;
  }
}

function pluck(at, freq, dur, gain = 0.2, pan = 0) {
  const start = Math.floor(at * SR);
  let p1 = 0, p2 = 0, lp = 0;
  const n = Math.floor(SR * dur);
  for (let i = 0; i < n; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= N) continue;
    const t = i / SR;
    p1 += freq / SR; p2 += (freq * 2.002) / SR;
    const saw = 2 * (p1 % 1) - 1;
    const sq = (p2 % 1) < 0.5 ? 1 : -1;
    const raw = saw * 0.7 + sq * 0.3;
    const cut = 5200 * Math.exp(-t / 0.09) + 700;
    lp += (raw - lp) * (1 - Math.exp((-2 * Math.PI * cut) / SR));
    const amp = Math.min(1, t / 0.004) * Math.exp(-t / (dur * 0.4));
    const v = lp * amp * gain;
    L[idx] += v * (1 - Math.max(0, pan));
    R[idx] += v * (1 + Math.min(0, pan));
  }
}

function pad(at, freqs, dur, gain = 0.13) {
  const start = Math.floor(at * SR);
  const n = Math.floor(SR * dur);
  freqs.forEach((f, fi) => {
    for (const detune of [-0.004, 0, 0.004]) {
      let p = 0, lp = 0;
      const ff = f * (1 + detune);
      for (let i = 0; i < n; i++) {
        const idx = start + i;
        if (idx < 0 || idx >= N) continue;
        const t = i / SR;
        p += ff / SR;
        const saw = 2 * (p % 1) - 1;
        lp += (saw - lp) * (1 - Math.exp((-2 * Math.PI * 1400) / SR));
        const env = Math.min(1, t / 0.35) * Math.min(1, (dur - t) / 0.5);
        const v = lp * env * gain;
        const spread = detune > 0 ? 1 : detune < 0 ? 0 : 0.6;
        L[idx] += v * (0.5 + spread * 0.5);
        R[idx] += v * (1 - spread * 0.5);
      }
    }
  });
}

function riser(at, dur) {
  const start = Math.floor(at * SR);
  const n = Math.floor(SR * dur);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= N) continue;
    const t = i / n;
    const cut = 400 + 9000 * t * t;
    lp += ((Math.random() * 2 - 1) - lp) * (1 - Math.exp((-2 * Math.PI * cut) / SR));
    const v = lp * t * t * 0.22;
    L[idx] += v; R[idx] += v;
  }
}

function impact(at) {
  const start = Math.floor(at * SR);
  let phase = 0;
  for (let i = 0; i < SR * 1.6; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= N) continue;
    const t = i / SR;
    const f = 38 + 60 * Math.exp(-t / 0.09);
    phase += (2 * Math.PI * f) / SR;
    L[idx] += Math.sin(phase) * Math.exp(-t / 0.55) * 0.6;
    R[idx] += Math.sin(phase) * Math.exp(-t / 0.55) * 0.6;
  }
  noiseHit(at, 0.9, 0.25, 0, 900);
}

// ---------- arrangement ----------
const bars = DUR / BAR; // 16

for (let b = 0; b < bars; b++) {
  const barT = b * BAR;
  const chord = chordAt(barT + 0.01);
  const full = barT >= 22;       // logo drop
  const thin = barT >= 20 && barT < 22; // "best part" break
  const outro = barT >= 28;

  // pad: whole bar (skip the break, thin out in outro)
  if (!thin) {
    const padGain = outro ? 0.09 : 0.14;
    pad(barT, chord.tones.map((n) => note(n - 12)), BAR * 0.98, padGain);
  }

  for (let beat = 0; beat < 4; beat++) {
    const t = barT + beat * BEAT;
    if (!thin) kick(t, outro ? 0.85 : 1);

    if (beat % 2 === 1 && b >= 1 && !thin) clap(t, outro ? 0.4 : 0.6);
    if (thin && beat % 2 === 1) clap(t, 0.7);
  }

  // hats on the off-beats
  for (let eighth = 0; eighth < 8; eighth++) {
    const t = barT + eighth * (BEAT / 2);
    if (thin) continue;
    const open = eighth === 7 && b >= 3;
    hat(t, open, eighth % 2 === 0 ? 0.19 : 0.11);
  }

  // bass: driving 8ths with octave lift
  if (!thin) {
    const pattern = [0, 0, 12, 0, 0, 7, 12, 7];
    pattern.forEach((semi, i) => {
      const t = barT + i * (BEAT / 2);
      const g = outro ? 0.32 : 0.46;
      bass(t, note(chord.root - 12 + semi), BEAT * 0.42, g);
    });
  }

  // arp over the chord tones
  if (!thin) {
    const shape = [0, 1, 2, 1, 2, 1, 0, 2, 0, 2, 1, 2, 1, 0, 2, 1];
    shape.forEach((idx, step) => {
      const t = barT + step * (BEAT / 4);
      const octave = b >= 8 && b < 12 ? 12 : 0;
      const f = note(chord.tones[idx] + 12 + octave);
      const pan = step % 2 === 0 ? -0.25 : 0.25;
      pluck(t, f, BEAT * 0.5, outro ? 0.1 : 0.18, pan);
    });
  }

  // snare build into the logo card
  if (b === 9 || b === 8) {
    const step = b === 8 ? BEAT / 2 : BEAT / 4;
    for (let t = 0; t < BAR; t += step) {
      if (b === 8 && t < BAR / 2) continue;
      noiseHit(barT + t, 0.08, 0.12 + (t / BAR) * 0.2, 0, 7000);
    }
  }
}

riser(18, 2);
impact(22);
riser(27, 1);

// ---------- sidechain + master ----------
const kickTimes = [];
for (let b = 0; b < bars; b++) for (let beat = 0; beat < 4; beat++) {
  const t = b * BAR + beat * BEAT;
  if (!(t >= 20 && t < 22)) kickTimes.push(t);
}

let k = 0;
let lastKick = -1;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  while (k < kickTimes.length && kickTimes[k] <= t) { lastKick = kickTimes[k]; k++; }
  let duck = 1;
  if (lastKick >= 0) {
    const dt = t - lastKick;
    duck = dt < 0.02 ? 0.55 : Math.min(1, 0.55 + (dt - 0.02) / 0.22);
  }
  const g = 0.78 + 0.22 * duck;
  L[i] *= g; R[i] *= g;
}

let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const norm = 0.89 / (peak || 1);
const out = Buffer.alloc(44 + N * 4);
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVE', 8);
out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20);
out.writeUInt16LE(2, 22); out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28);
out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const l = Math.tanh(L[i] * norm * 1.1);
  const r = Math.tanh(R[i] * norm * 1.1);
  out.writeInt16LE(Math.round(clamp(l, -1, 1) * 32767), 44 + i * 4);
  out.writeInt16LE(Math.round(clamp(r, -1, 1) * 32767), 44 + i * 4 + 2);
}
fs.writeFileSync(new URL('./soundtrack.wav', import.meta.url), out);
console.log('wrote soundtrack.wav', (out.length / 1e6).toFixed(2), 'MB', 'peak before norm', peak.toFixed(2));
