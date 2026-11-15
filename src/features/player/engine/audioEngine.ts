/**
 * One <audio> element drives the whole app.
 *
 * Graph: media element → gain (volume/mute) → analyser (visuals) → destination.
 * The analyser stays in the chain permanently so the reactive background never
 * has to rebuild the graph when it is toggled; it simply reads zeroes when no
 * audio is playing.
 */
export const BAND_COUNT = 64;

/** The ten bands of the parametric EQ, low to high. */
export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export const EQ_RANGE_DB = 12;

const dbToGain = (db: number) => 10 ** (db / 20);

export interface DspSettings {
  /** 0..1 — wave-shaping saturation. */
  drive: number;
  /** 0..1 wet mix, 80–600 ms delay, feedback self-oscillates below 0.85. */
  delayMix: number;
  delayTime: number;
  delayFeedback: number;
  /** 0..1 convolution blend and 0..1 room size (short slap → long hall). */
  reverbMix: number;
  reverbSize: number;
  /** 0..1 — 0 is transparent, 1 is a hard squash. */
  compressor: number;
  /** Aim every track at roughly −16 LUFS during playback. */
  normalize: boolean;
}

export const DEFAULT_DSP: DspSettings = {
  drive: 0,
  delayMix: 0,
  delayTime: 0.3,
  delayFeedback: 0.28,
  reverbMix: 0,
  reverbSize: 0.45,
  compressor: 0,
  normalize: false,
};

/** tanh-ish curve; `drive` 0 is a straight line so the stage is transparent. */
function distortionCurve(drive: number) {
  const amount = Math.max(0, Math.min(1, drive));
  const samples = 1024;
  const curve = new Float32Array(samples);
  const k = 1 + amount * 80;
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = amount === 0 ? x : ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

/** Short noise burst with an exponential tail — a usable room without samples. */
function impulseResponse(ctx: AudioContext, seconds: number, decay: number) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
    }
  }
  return buffer;
}

type Listener = () => void;

class AudioEngine {
  readonly element: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private frequency: Uint8Array = new Uint8Array(0);
  private freqBytes: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));
  private bands = new Float32Array(BAND_COUNT);
  private listeners = new Map<string, Set<Listener>>();
  private volume = 0.8;
  private muted = false;
  /** EQ values live here so a preset applied before the graph exists still sticks. */
  private eqGains: number[] = EQ_FREQUENCIES.map(() => 0);
  private preampDb = 0;
  private tempo = 1;
  private preamp: GainNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private dsp: DspSettings = { ...DEFAULT_DSP };
  private shaper: WaveShaperNode | null = null;
  private driveWet: GainNode | null = null;
  private driveDry: GainNode | null = null;
  private delay: DelayNode | null = null;
  private delayFeedback: GainNode | null = null;
  private delayWet: GainNode | null = null;
  private delayDry: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private reverbWet: GainNode | null = null;
  private reverbDry: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private norm: GainNode | null = null;
  private fade: GainNode | null = null;
  private panner: StereoPannerNode | null = null;
  private monoNode: GainNode | null = null;
  private panValue = 0;
  private monoSettings = false;
  private impulseKey = '';
  private normTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.element = document.createElement('audio');
    this.element.preload = 'auto';
    this.element.crossOrigin = 'anonymous';
    this.element.setAttribute('playsinline', '');
    this.element.style.display = 'none';
    document.body.appendChild(this.element);

    for (const event of ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'waiting', 'playing', 'error', 'durationchange', 'ratechange']) {
      this.element.addEventListener(event, () => this.emit(event));
    }
    this.element.volume = this.volume;
  }

  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  private emit(event: string) {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  /** Build the Web Audio graph on the first real playback (autoplay policy). */
  private ensureGraph() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext({ latencyHint: 'playback' });
      const source = ctx.createMediaElementSource(this.element);
      const gain = ctx.createGain();
      gain.gain.value = this.muted ? 0 : this.volume;

      // Ten peaking filters in series: the EQ sits after the volume stage so
      // boosts never depend on how loud the user has the player.
      // Output shaping: stereo position, then an optional mono downmix, before
      // the EQ/effects so nothing downstream has to know about channel layout.
      const panner = ctx.createStereoPanner();
      panner.pan.value = this.panValue;
      const monoNode = ctx.createGain();
      if (this.monoSettings) {
        monoNode.channelCount = 1;
        monoNode.channelCountMode = 'explicit';
      } else {
        monoNode.channelCount = 2;
        monoNode.channelCountMode = 'max';
      }

      const preamp = ctx.createGain();
      preamp.gain.value = dbToGain(this.preampDb);
      const filters = EQ_FREQUENCIES.map((frequency) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = frequency;
        filter.Q.value = 1.05;
        filter.gain.value = 0;
        return filter;
      });

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.78;
      analyser.minDecibels = -85;
      analyser.maxDecibels = -20;

      // --- effects chain -------------------------------------------------
      // Each wet stage merges back with its dry partner into an output gain so
      // a 0% mix is bit-for-bit the untouched signal.
      const driveIn = ctx.createGain();
      const shaper = ctx.createWaveShaper();
      shaper.curve = distortionCurve(this.dsp.drive);
      shaper.oversample = '4x';
      const driveWet = ctx.createGain();
      const driveDry = ctx.createGain();
      const driveOut = ctx.createGain();

      const compressor = ctx.createDynamicsCompressor();
      compressor.knee.value = 6;

      const delay = ctx.createDelay(1.5);
      const delayFeedback = ctx.createGain();
      const delayWet = ctx.createGain();
      const delayDry = ctx.createGain();
      const delayOut = ctx.createGain();

      const convolver = ctx.createConvolver();
      const reverbWet = ctx.createGain();
      const reverbDry = ctx.createGain();
      const reverbOut = ctx.createGain();

      const norm = ctx.createGain();
      const fade = ctx.createGain();

      source.connect(gain);
      gain.connect(panner);
      panner.connect(monoNode);
      monoNode.connect(preamp);
      let tail: AudioNode = preamp;
      for (const filter of filters) {
        tail.connect(filter);
        tail = filter;
      }

      tail.connect(driveIn);
      driveIn.connect(shaper);
      shaper.connect(driveWet);
      driveWet.connect(driveOut);
      driveIn.connect(driveDry);
      driveDry.connect(driveOut);
      driveOut.connect(compressor);

      compressor.connect(delayDry);
      delayDry.connect(delayOut);
      compressor.connect(delay);
      delay.connect(delayWet);
      delayWet.connect(delayOut);
      delay.connect(delayFeedback);
      delayFeedback.connect(delay);

      delayOut.connect(reverbDry);
      reverbDry.connect(reverbOut);
      delayOut.connect(convolver);
      convolver.connect(reverbWet);
      reverbWet.connect(reverbOut);

      reverbOut.connect(norm);
      norm.connect(fade);
      fade.connect(analyser);
      analyser.connect(ctx.destination);

      this.ctx = ctx;
      this.gain = gain;
      this.preamp = preamp;
      this.filters = filters;
      this.shaper = shaper;
      this.driveWet = driveWet;
      this.driveDry = driveDry;
      this.delay = delay;
      this.delayFeedback = delayFeedback;
      this.delayWet = delayWet;
      this.delayDry = delayDry;
      this.convolver = convolver;
      this.reverbWet = reverbWet;
      this.reverbDry = reverbDry;
      this.compressor = compressor;
      this.norm = norm;
      this.fade = fade;
      this.panner = panner;
      this.monoNode = monoNode;
      this.analyser = analyser;
      this.frequency = new Uint8Array(analyser.frequencyBinCount);
      this.applyEq();
      this.applyDsp();
      this.element.preservesPitch = true;
      this.element.playbackRate = this.tempo;
    } catch {
      // Visuals degrade to the resting gradient if Web Audio is unavailable.
      this.ctx = null;
    }
  }

  async load(url: string) {
    this.ensureGraph();
    if (!url) {
      this.element.removeAttribute('src');
      this.element.load();
      return;
    }
    if (this.element.src !== url) {
      this.element.src = url;
      this.element.load();
    }
  }

  /**
   * Every intentional track change bumps this. A play() that resolves after a
   * newer track was chosen stops itself instead of sounding over it.
   */
  private playToken = 0;

  setPlayToken(token: number) {
    this.playToken = token;
  }

  async play() {
    this.ensureGraph();
    const token = this.playToken;
    try {
      await this.element.play();
      if (this.playToken !== token) {
        this.element.pause();
        return;
      }
    } catch (error) {
      // Only a genuine autoplay block is worth announcing; an interrupted
      // play() is just the user skipping or pausing mid-load.
      if (!(error instanceof Error) || error.name !== 'AbortError') this.emit('blocked');
      throw error;
    }
  }

  pause() {
    this.element.pause();
  }

  /** Stop and drop the current source, so no stale audio can resume. */
  halt() {
    this.element.pause();
    if (this.element.hasAttribute('src')) {
      this.element.removeAttribute('src');
      this.element.load();
    }
  }

  seek(seconds: number) {
    if (!Number.isFinite(seconds)) return;
    const duration = this.element.duration || Infinity;
    this.element.currentTime = Math.max(0, Math.min(seconds, duration - 0.05));
    this.emit('timeupdate');
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    this.element.volume = this.volume;
    if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.element.muted = muted;
    if (this.gain) this.gain.gain.value = muted ? 0 : this.volume;
  }

  setRate(rate: number) {
    this.element.playbackRate = Math.max(0.5, Math.min(2, rate));
  }

  /** Speed without pitch shift — the element keeps the key and stretches time. */
  setTempo(rate: number) {
    this.tempo = Math.max(0.5, Math.min(2, Number(rate) || 1));
    this.element.preservesPitch = true;
    this.element.playbackRate = this.tempo;
  }

  get tempoRate() {
    return this.tempo;
  }

  /** dB per band, −12…+12, low to high. */
  setEq(gains: number[]) {
    this.eqGains = EQ_FREQUENCIES.map((_, index) => {
      const value = Number(gains[index]);
      return Number.isFinite(value) ? Math.max(-EQ_RANGE_DB, Math.min(EQ_RANGE_DB, value)) : 0;
    });
    this.applyEq();
  }

  /** −1 hard left … 1 hard right. */
  setPan(value: number) {
    this.panValue = Math.max(-1, Math.min(1, Number(value) || 0));
    if (this.panner && this.ctx) {
      this.panner.pan.setTargetAtTime(this.panValue, this.ctx.currentTime, 0.02);
    }
  }

  setMono(on: boolean) {
    this.monoSettings = Boolean(on);
    if (!this.monoNode) return;
    if (this.monoSettings) {
      this.monoNode.channelCount = 1;
      this.monoNode.channelCountMode = 'explicit';
    } else {
      this.monoNode.channelCount = 2;
      this.monoNode.channelCountMode = 'max';
    }
  }

  get panCurrent() {
    return this.panValue;
  }

  get monoCurrent() {
    return this.monoSettings;
  }

  setPreampDb(db: number) {
    this.preampDb = Math.max(-12, Math.min(12, Number(db) || 0));
    if (this.preamp && this.ctx) {
      this.preamp.gain.setTargetAtTime(dbToGain(this.preampDb), this.ctx.currentTime, 0.02);
    }
  }

  get eqValues() {
    return [...this.eqGains];
  }

  get preampValue() {
    return this.preampDb;
  }

  get dspValues() {
    return { ...this.dsp };
  }

  /** Live values, used by checks to confirm the chain is actually applied. */
  get fadeLevel() {
    return this.fade?.gain.value ?? 1;
  }

  get normalizationGain() {
    return this.norm?.gain.value ?? 1;
  }

  /** Merge a partial DSP config; safe to call before the graph exists. */
  setDsp(next: Partial<DspSettings>) {
    this.dsp = { ...this.dsp, ...next };
    this.applyDsp();
  }

  /** Ramp the master fade in. 0 ms means an instant start. */
  fadeIn(ms: number) {
    if (!this.ctx || !this.fade) return;
    const now = this.ctx.currentTime;
    const param = this.fade.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(Math.max(0.0001, param.value), now);
    if (ms <= 0) param.setValueAtTime(1, now);
    else param.linearRampToValueAtTime(1, now + ms / 1000);
  }

  /** Ramp out, then pause once the tail is silent. */
  fadeOutThenPause(ms: number) {
    if (!this.ctx || !this.fade || ms <= 0) {
      this.element.pause();
      return;
    }
    const now = this.ctx.currentTime;
    const param = this.fade.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(Math.max(0.0001, param.value), now);
    param.linearRampToValueAtTime(0.0001, now + ms / 1000);
    window.setTimeout(() => {
      this.element.pause();
      if (this.fade && this.ctx) this.fade.gain.setValueAtTime(1, this.ctx.currentTime);
    }, ms + 30);
  }

  private applyDsp() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const dsp = this.dsp;

    if (this.shaper) this.shaper.curve = distortionCurve(dsp.drive);
    if (this.driveWet && this.driveDry) {
      const wet = Math.max(0, Math.min(1, dsp.drive));
      this.driveWet.gain.setTargetAtTime(wet, now, 0.02);
      this.driveDry.gain.setTargetAtTime(1 - wet * 0.85, now, 0.02);
    }

    if (this.delay && this.delayWet && this.delayDry && this.delayFeedback) {
      const mix = Math.max(0, Math.min(1, dsp.delayMix));
      this.delay.delayTime.setTargetAtTime(0.08 + dsp.delayTime * 0.52, now, 0.05);
      this.delayFeedback.gain.setTargetAtTime(Math.min(0.85, Math.max(0, dsp.delayFeedback) * 0.85), now, 0.05);
      this.delayWet.gain.setTargetAtTime(mix, now, 0.02);
      this.delayDry.gain.setTargetAtTime(1 - mix * 0.4, now, 0.02);
    }

    if (this.compressor) {
      const amount = Math.max(0, Math.min(1, dsp.compressor));
      this.compressor.threshold.setTargetAtTime(amount === 0 ? 0 : -6 - amount * 34, now, 0.05);
      this.compressor.ratio.setTargetAtTime(1 + amount * 11, now, 0.05);
      this.compressor.attack.setTargetAtTime(0.004, now, 0.05);
      this.compressor.release.setTargetAtTime(0.25, now, 0.05);
    }

    if (this.convolver) {
      const size = Math.max(0, Math.min(1, dsp.reverbSize));
      const key = size.toFixed(2);
      if (key !== this.impulseKey || !this.convolver.buffer) {
        this.convolver.buffer = impulseResponse(this.ctx, 0.4 + size * 3.2, 2 + size * 2.5);
        this.impulseKey = key;
      }
      const mix = Math.max(0, Math.min(1, dsp.reverbMix));
      this.reverbWet?.gain.setTargetAtTime(mix, now, 0.02);
      this.reverbDry?.gain.setTargetAtTime(1 - mix * 0.35, now, 0.02);
    }

    this.syncNormalizer();
  }

  private syncNormalizer() {
    if (this.dsp.normalize && !this.normTimer) {
      this.normTimer = setInterval(() => this.tickNormalizer(), 400);
      return;
    }
    if (!this.dsp.normalize && this.normTimer) {
      clearInterval(this.normTimer);
      this.normTimer = null;
      if (this.norm && this.ctx) this.norm.gain.setTargetAtTime(1, this.ctx.currentTime, 0.15);
    }
  }

  /**
   * RMS → an approximate LUFS reading. Not the full BS.1770 chain, but it keeps
   * a quiet master and a loud one sitting at a similar level, which is the
   * point of the setting.
   */
  private tickNormalizer() {
    if (!this.analyser || !this.ctx || !this.norm || !this.dsp.normalize) return;
    const samples = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    if (rms < 0.0012) return;
    const approxLufs = -0.691 + 10 * Math.log10(rms * rms);
    const delta = Math.max(-9, Math.min(9, -16 - approxLufs));
    this.norm.gain.setTargetAtTime(10 ** (delta / 20), this.ctx.currentTime, 0.5);
  }

  private applyEq() {
    if (!this.ctx || !this.filters.length) return;
    const now = this.ctx.currentTime;
    this.filters.forEach((filter, index) => {
      // A short ramp avoids the click that a jump on a live graph would make.
      filter.gain.setTargetAtTime(this.eqGains[index] ?? 0, now, 0.02);
    });
  }

  get currentTime() {
    return this.element.currentTime || 0;
  }

  get duration() {
    return Number.isFinite(this.element.duration) ? this.element.duration : 0;
  }

  get paused() {
    return this.element.paused;
  }

  get buffered() {
    const ranges = this.element.buffered;
    if (!ranges.length) return 0;
    return ranges.end(ranges.length - 1);
  }

  /**
   * Energy of the 20–200 Hz band, 0..1. Drives the wavy progress ring: this is
   * the range a kick and a bass line live in, which is what makes a ring feel
   * like it is breathing with the track rather than with the hi-hats.
   */
  getBassEnergy(): number {
    if (!this.analyser || !this.ctx) return 0;
    if (this.freqBytes.length !== this.analyser.frequencyBinCount) {
      this.freqBytes = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    }
    this.analyser.getByteFrequencyData(this.freqBytes);
    const nyquist = this.ctx.sampleRate / 2;
    const hzPerBin = nyquist / this.freqBytes.length;
    const from = Math.max(0, Math.floor(20 / hzPerBin));
    const to = Math.min(this.freqBytes.length - 1, Math.ceil(200 / hzPerBin));
    let sum = 0;
    for (let i = from; i <= to; i++) sum += this.freqBytes[i];
    const average = sum / Math.max(1, to - from + 1);
    return Math.min(1, average / 190);
  }

  /** 64 log-spaced bands, 0..1, ready for the shader. */
  getBands(): Float32Array {
    if (!this.analyser) {
      this.bands.fill(0);
      return this.bands;
    }
    this.analyser.getByteFrequencyData(this.frequency as Uint8Array<ArrayBuffer>);
    const nyquist = (this.ctx?.sampleRate ?? 44100) / 2;
    const binHz = nyquist / this.frequency.length;
    for (let i = 0; i < BAND_COUNT; i++) {
      // 30Hz → 16kHz on a log scale, so bass gets real resolution.
      const low = 30 * Math.pow(16000 / 30, i / BAND_COUNT);
      const high = 30 * Math.pow(16000 / 30, (i + 1) / BAND_COUNT);
      const start = Math.max(0, Math.floor(low / binHz));
      const end = Math.min(this.frequency.length - 1, Math.ceil(high / binHz));
      let sum = 0;
      let count = 0;
      for (let bin = start; bin <= end; bin++) {
        sum += this.frequency[bin];
        count++;
      }
      const raw = count ? sum / count / 255 : 0;
      // Slight boost so quiet material still moves the background.
      this.bands[i] = Math.min(1, Math.pow(raw, 0.85) * 1.18);
    }
    return this.bands;
  }

  dispose() {
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.load();
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const audioEngine = new AudioEngine();
