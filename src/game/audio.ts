import type { RaceEvent, RadioStationId } from './types';

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Generates an algorithmic stereo concert-hall / touring-studio impulse response
 * for warm spatial depth without any external audio assets.
 */
function createStereoReverbImpulse(ctx: AudioContext, durationSec = 2.1, decay = 2.8): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * durationSec);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.pow(1 - t, decay);
      // Slight early-reflection shimmer + smooth low-passed stereo tail
      const white = Math.random() * 2 - 1;
      lp = lp * 0.72 + white * 0.28;
      const early = i < rate * 0.045 ? (i % 317 === 0 ? 0.45 : 0.15) : 1.0;
      data[i] = lp * env * early * 0.55;
    }
  }
  return buffer;
}

/**
 * Soft-clipping analog saturation curve for realistic GT exhaust harmonics.
 */
function createExhaustDriveCurve(amount = 22): Float32Array<ArrayBuffer> {
  const n = 512;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

export class DrivingAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private musicBus: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private delayLeft: DelayNode | null = null;
  private delayRight: DelayNode | null = null;
  private delaySend: GainNode | null = null;
  private sfxBus: GainNode | null = null;

  // Multi-harmonic GT V10 / Flat-6 engine rig
  private engineSubOsc: OscillatorNode | null = null;
  private engineOscA: OscillatorNode | null = null;
  private engineOscB: OscillatorNode | null = null;
  private engineOscC: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private enginePresence: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  // Turbo spool whine
  private turboOsc: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;

  // Dual-band realistic tire drift screech + road/gravel + aerodynamic wind rush
  private driftNoise: AudioBufferSourceNode | null = null;
  private driftFilterA: BiquadFilterNode | null = null;
  private driftFilterB: BiquadFilterNode | null = null;
  private driftGain: GainNode | null = null;

  private windNoise: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  private gravelFilter: BiquadFilterNode | null = null;
  private gravelGain: GainNode | null = null;

  private snareBuffer: AudioBuffer | null = null;
  private hihatBuffer: AudioBuffer | null = null;

  private muted = false;
  private station: RadioStationId = 'solstice';

  // Sample-accurate DAW-style lookahead music sequencer
  private schedulerId: number | null = null;
  private nextStepTime = 0;
  private stepIndex = 0;

  // Stateful vehicle sound tracking for gear-shift pops & turbo BOV flutter
  private lastGear = 1;
  private lastBoosting = false;
  private lastRpm = 0;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      const ctx = new AudioCtx();
      this.ctx = ctx;

      // 1. Mastering bus with gentle studio glue compression
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 3.2;
      this.compressor.attack.value = 0.008;
      this.compressor.release.value = 0.16;

      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.56;
      this.compressor.connect(this.masterGain);
      this.masterGain.connect(ctx.destination);

      // 2. Music bus + Stereo Convolution Hall Reverb + Stereo Ping-Pong Delay
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.88;
      this.musicBus.connect(this.compressor);

      const convolver = ctx.createConvolver();
      convolver.buffer = createStereoReverbImpulse(ctx, 2.0, 2.7);
      const reverbHp = ctx.createBiquadFilter();
      reverbHp.type = 'highpass';
      reverbHp.frequency.value = 260;
      const reverbReturn = ctx.createGain();
      reverbReturn.gain.value = 0.34;
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 1.0;
      this.reverbSend.connect(reverbHp);
      reverbHp.connect(convolver);
      convolver.connect(reverbReturn);
      reverbReturn.connect(this.musicBus);

      // Stereo ping-pong echo for lush synth leads & arpeggios
      this.delaySend = ctx.createGain();
      this.delaySend.gain.value = 0.38;
      this.delayLeft = ctx.createDelay(1.0);
      this.delayRight = ctx.createDelay(1.0);
      this.delayLeft.delayTime.value = 0.388; // dotted-8th @ 116 BPM
      this.delayRight.delayTime.value = 0.388;

      const delayFilter = ctx.createBiquadFilter();
      delayFilter.type = 'lowpass';
      delayFilter.frequency.value = 2600;
      const delayFb = ctx.createGain();
      delayFb.gain.value = 0.36;
      const merger = ctx.createChannelMerger(2);
      const delayReturn = ctx.createGain();
      delayReturn.gain.value = 0.34;

      this.delaySend.connect(this.delayLeft);
      this.delayLeft.connect(delayFilter);
      delayFilter.connect(this.delayRight);
      this.delayRight.connect(delayFb);
      delayFb.connect(this.delayLeft);

      this.delayLeft.connect(merger, 0, 0);
      this.delayRight.connect(merger, 0, 1);
      merger.connect(delayReturn);
      delayReturn.connect(this.musicBus);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0.92;
      this.sfxBus.connect(this.compressor);

      // 3. 4-Harmonic Sculpted GT Supercar Engine Synthesizer + Exhaust Drive
      const drive = ctx.createWaveShaper();
      drive.curve = createExhaustDriveCurve(16);
      drive.oversample = '2x';

      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 320;
      this.engineFilter.Q.value = 2.6;

      this.enginePresence = ctx.createBiquadFilter();
      this.enginePresence.type = 'peaking';
      this.enginePresence.frequency.value = 820;
      this.enginePresence.Q.value = 1.4;
      this.enginePresence.gain.value = 4.5;

      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0.0001;

      const subGain = ctx.createGain();
      subGain.gain.value = 0.45;
      const aGain = ctx.createGain();
      aGain.gain.value = 0.44;
      const bGain = ctx.createGain();
      bGain.gain.value = 0.28;
      const cGain = ctx.createGain();
      cGain.gain.value = 0.16;

      this.engineSubOsc = ctx.createOscillator();
      this.engineSubOsc.type = 'sine';
      this.engineSubOsc.frequency.value = 38;

      this.engineOscA = ctx.createOscillator();
      this.engineOscA.type = 'sawtooth';
      this.engineOscA.frequency.value = 76;

      this.engineOscB = ctx.createOscillator();
      this.engineOscB.type = 'triangle';
      this.engineOscB.frequency.value = 152;

      this.engineOscC = ctx.createOscillator();
      this.engineOscC.type = 'sawtooth';
      this.engineOscC.frequency.value = 228; // V10/Flat-6 3rd-order harmonic howl

      this.engineSubOsc.connect(subGain).connect(drive);
      this.engineOscA.connect(aGain).connect(drive);
      this.engineOscB.connect(bGain).connect(drive);
      this.engineOscC.connect(cGain).connect(drive);

      drive.connect(this.engineFilter);
      this.engineFilter.connect(this.enginePresence);
      this.enginePresence.connect(this.engineGain);
      this.engineGain.connect(this.sfxBus);

      this.engineSubOsc.start();
      this.engineOscA.start();
      this.engineOscB.start();
      this.engineOscC.start();

      // Turbocharger turbine spool whine
      this.turboOsc = ctx.createOscillator();
      this.turboOsc.type = 'sine';
      this.turboOsc.frequency.value = 2200;
      this.turboGain = ctx.createGain();
      this.turboGain.gain.value = 0.0001;
      this.turboOsc.connect(this.turboGain).connect(this.sfxBus);
      this.turboOsc.start();

      // 4. Shared Pink/White Noise Buffers for Tires, Wind, Gravel, Snare & Hi-Hat
      const bufferSize = ctx.sampleRate * 2;
      const whiteBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const pinkBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const wData = whiteBuffer.getChannelData(0);
      const pData = pinkBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const w = Math.random() * 2 - 1;
        wData[i] = w;
        b0 = 0.997 * b0 + w * 0.029;
        b1 = 0.985 * b1 + w * 0.032;
        b2 = 0.950 * b2 + w * 0.048;
        pData[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + w * 0.02) * 2.2));
      }

      const snLen = Math.floor(ctx.sampleRate * 0.24);
      this.snareBuffer = ctx.createBuffer(1, snLen, ctx.sampleRate);
      const snData = this.snareBuffer.getChannelData(0);
      for (let i = 0; i < snLen; i++) {
        snData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (snLen * 0.28));
      }

      const hhLen = Math.floor(ctx.sampleRate * 0.075);
      this.hihatBuffer = ctx.createBuffer(1, hhLen, ctx.sampleRate);
      const hhData = this.hihatBuffer.getChannelData(0);
      for (let i = 0; i < hhLen; i++) {
        hhData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (hhLen * 0.24));
      }

      // Dual-band realistic tire screech
      this.driftNoise = ctx.createBufferSource();
      this.driftNoise.buffer = whiteBuffer;
      this.driftNoise.loop = true;

      this.driftFilterA = ctx.createBiquadFilter();
      this.driftFilterA.type = 'bandpass';
      this.driftFilterA.frequency.value = 1280;
      this.driftFilterA.Q.value = 5.5;

      this.driftFilterB = ctx.createBiquadFilter();
      this.driftFilterB.type = 'bandpass';
      this.driftFilterB.frequency.value = 2450;
      this.driftFilterB.Q.value = 6.5;

      this.driftGain = ctx.createGain();
      this.driftGain.gain.value = 0.0001;

      this.driftNoise.connect(this.driftFilterA).connect(this.driftGain);
      this.driftNoise.connect(this.driftFilterB).connect(this.driftGain);
      this.driftGain.connect(this.sfxBus);
      this.driftNoise.start();

      // Aerodynamic wind rush + gravel shoulder crunch
      this.windNoise = ctx.createBufferSource();
      this.windNoise.buffer = pinkBuffer;
      this.windNoise.loop = true;

      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 420;
      this.windFilter.Q.value = 0.85;

      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0.0001;

      this.gravelFilter = ctx.createBiquadFilter();
      this.gravelFilter.type = 'bandpass';
      this.gravelFilter.frequency.value = 920;
      this.gravelFilter.Q.value = 1.6;

      this.gravelGain = ctx.createGain();
      this.gravelGain.gain.value = 0.0001;

      this.windNoise.connect(this.windFilter).connect(this.windGain).connect(this.sfxBus);
      this.windNoise.connect(this.gravelFilter).connect(this.gravelGain).connect(this.sfxBus);
      this.windNoise.start();
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && this.station !== 'off' && this.schedulerId === null) {
      this.startScheduler();
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.56, this.ctx.currentTime, 0.04);
    }
  }

  public getRadioStation(): RadioStationId {
    return this.station;
  }

  public setRadioStation(station: RadioStationId): void {
    this.station = station;
    this.stepIndex = 0;
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    if (station !== 'off') {
      const ctx = this.ensureContext();
      if (ctx) {
        this.syncDelayToStation();
        this.startScheduler();
      }
    }
  }

  private getStepDurationSec(): number {
    // 16th-note duration per station BPM
    const bpm = this.station === 'velocity' ? 132 : this.station === 'coastal' ? 106 : 116;
    return 60 / bpm / 4;
  }

  private syncDelayToStation(): void {
    if (!this.delayLeft || !this.delayRight || !this.ctx) return;
    const dottedEighth = this.getStepDurationSec() * 3;
    this.delayLeft.delayTime.setTargetAtTime(dottedEighth, this.ctx.currentTime, 0.05);
    this.delayRight.delayTime.setTargetAtTime(dottedEighth * 0.992, this.ctx.currentTime, 0.05);
  }

  private startScheduler(): void {
    if (typeof window === 'undefined' || !this.ctx || this.station === 'off') return;
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
    }
    this.syncDelayToStation();
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.schedulerId = window.setInterval(() => this.schedulerTick(), 30);
  }

  private schedulerTick(): void {
    if (!this.ctx || !this.musicBus || this.muted || this.station === 'off') return;
    if (this.ctx.state !== 'running') {
      this.nextStepTime = this.ctx.currentTime + 0.05;
      return;
    }

    const lookahead = 0.14;
    const stepDur = this.getStepDurationSec();

    // Prevent catch-up burst after background tab resume
    if (this.nextStepTime < this.ctx.currentTime - 0.35) {
      this.nextStepTime = this.ctx.currentTime + 0.04;
    }

    while (this.nextStepTime < this.ctx.currentTime + lookahead) {
      this.scheduleStep(this.stepIndex, this.nextStepTime, stepDur);
      this.nextStepTime += stepDur;
      this.stepIndex = (this.stepIndex + 1) % 128; // 8-bar evolving arrangement (128 16th notes)
    }
  }

  // ---- Studio Instrument Primitives ----

  private trigKick(t: number, punch = 1.0, bodyHz = 46): void {
    if (!this.ctx || !this.musicBus) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, t);
    osc.frequency.exponentialRampToValueAtTime(bodyHz, t + 0.075);
    osc.frequency.exponentialRampToValueAtTime(34, t + 0.24);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.24 * punch, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.26);
    osc.connect(gain).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + 0.28);
  }

  private trigSnare(t: number, level = 0.12, snappy = 1.0): void {
    if (!this.ctx || !this.musicBus || !this.snareBuffer) return;
    // Noise snap through bandpass
    const src = this.ctx.createBufferSource();
    src.buffer = this.snareBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = 1400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(level * snappy, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.19);
    src.connect(bp).connect(g);
    g.connect(this.musicBus);
    if (this.reverbSend) g.connect(this.reverbSend);
    src.start(t);

    // Punchy woody body
    const body = this.ctx.createOscillator();
    const bg = this.ctx.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(215, t);
    body.frequency.exponentialRampToValueAtTime(118, t + 0.07);
    bg.gain.setValueAtTime(level * 0.72, t);
    bg.gain.exponentialRampToValueAtTime(0.0008, t + 0.09);
    body.connect(bg).connect(this.musicBus);
    body.start(t);
    body.stop(t + 0.1);
  }

  private trigHat(t: number, open = false, level = 0.055): void {
    if (!this.ctx || !this.musicBus || !this.hihatBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.hihatBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = open ? 6200 : 8200;
    const g = this.ctx.createGain();
    const dur = open ? 0.14 : 0.042;
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    src.connect(hp).connect(g).connect(this.musicBus);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  private trigAnalogBass(
    t: number,
    midi: number,
    dur: number,
    cutoffStart: number,
    cutoffEnd: number,
    level = 0.14,
  ): void {
    if (!this.ctx || !this.musicBus) return;
    const freq = midiToHz(midi);
    const oscA = this.ctx.createOscillator();
    const oscB = this.ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscB.type = 'triangle';
    oscA.frequency.setValueAtTime(freq, t);
    oscB.frequency.setValueAtTime(freq * 0.5, t); // warm sub-octave foundation

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 3.2;
    filter.frequency.setValueAtTime(cutoffStart, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(85, cutoffEnd), t + dur * 0.85);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(g).connect(this.musicBus);

    oscA.start(t);
    oscB.start(t);
    oscA.stop(t + dur + 0.02);
    oscB.stop(t + dur + 0.02);
  }

  private trigLushPad(
    t: number,
    notes: number[],
    dur: number,
    wave: OscillatorType,
    cutoff: number,
    level = 0.042,
  ): void {
    if (!this.ctx || !this.musicBus) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(cutoff * 0.55, t);
    filter.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.42);
    filter.frequency.exponentialRampToValueAtTime(cutoff * 0.45, t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0008, t);
    g.gain.linearRampToValueAtTime(level, t + Math.min(0.28, dur * 0.25));
    g.gain.setValueAtTime(level * 0.85, t + dur * 0.72);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);

    filter.connect(g);
    g.connect(this.musicBus);
    if (this.reverbSend) g.connect(this.reverbSend);

    for (const m of notes) {
      const freq = midiToHz(m);
      // Warm detuned chorus pair per chord voice
      for (const detune of [-5, 5]) {
        const osc = this.ctx.createOscillator();
        osc.type = wave;
        osc.frequency.setValueAtTime(freq, t);
        osc.detune.setValueAtTime(detune, t);
        osc.connect(filter);
        osc.start(t);
        osc.stop(t + dur + 0.04);
      }
    }
  }

  private trigRhodesElectricPiano(t: number, notes: number[], dur: number, level = 0.048): void {
    if (!this.ctx || !this.musicBus) return;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    g.connect(this.musicBus);
    if (this.reverbSend) g.connect(this.reverbSend);

    for (const m of notes) {
      const f = midiToHz(m);
      // Warm fundamental + glassy bell tine harmonic
      const fund = this.ctx.createOscillator();
      fund.type = 'sine';
      fund.frequency.setValueAtTime(f, t);
      fund.connect(g);
      fund.start(t);
      fund.stop(t + dur + 0.03);

      const tine = this.ctx.createOscillator();
      const tineG = this.ctx.createGain();
      tine.type = 'triangle';
      tine.frequency.setValueAtTime(f * 3, t);
      tineG.gain.setValueAtTime(level * 0.26, t);
      tineG.gain.exponentialRampToValueAtTime(0.0004, t + Math.min(0.18, dur * 0.4));
      tine.connect(tineG).connect(g);
      tine.start(t);
      tine.stop(t + Math.min(0.2, dur));
    }
  }

  private trigPluckOrLead(
    t: number,
    midi: number,
    dur: number,
    wave: OscillatorType,
    cutoff: number,
    level = 0.068,
    sendDelay = true,
  ): void {
    if (!this.ctx || !this.musicBus) return;
    const f = midiToHz(midi);
    const oscA = this.ctx.createOscillator();
    const oscB = this.ctx.createOscillator();
    oscA.type = wave;
    oscB.type = 'triangle';
    oscA.frequency.setValueAtTime(f, t);
    oscB.frequency.setValueAtTime(f, t);
    oscA.detune.setValueAtTime(-6, t);
    oscB.detune.setValueAtTime(6, t);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2.4;
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(420, cutoff * 0.3), t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(g);
    g.connect(this.musicBus);
    if (this.reverbSend) g.connect(this.reverbSend);
    if (sendDelay && this.delaySend) g.connect(this.delaySend);

    oscA.start(t);
    oscB.start(t);
    oscA.stop(t + dur + 0.03);
    oscB.stop(t + dur + 0.03);
  }

  // ---- 3 Evolving Studio-Quality Original Soundtracks ----

  private scheduleStep(step: number, t: number, dur: number): void {
    const bar = Math.floor(step / 16) % 8; // 8-bar harmonic journey
    const beat16 = step % 16;

    if (this.station === 'solstice') {
      // "GOLDEN HORIZON" — 116 BPM Cinematic Grand-Touring Synth-Fusion (Forza Horizon sunset vibe)
      // 8-bar progression: Dmaj9 -> F#m11 -> Gmaj9 -> A13sus4 -> Bm9 -> Gmaj9 -> Em11 -> A9
      const bassRoots = [38, 42, 43, 45, 47, 43, 40, 45];
      const chords = [
        [62, 66, 69, 73, 76], // Dmaj9
        [61, 64, 66, 69, 71], // F#m11
        [62, 66, 67, 71, 74], // Gmaj9
        [62, 64, 67, 69, 73], // A13sus4
        [61, 62, 66, 69, 71], // Bm9
        [62, 66, 67, 71, 74], // Gmaj9
        [59, 62, 64, 67, 71], // Em11
        [61, 64, 67, 69, 71], // A9
      ];
      const leadBars: Array<Array<number | null>> = [
        [78, null, null, 76, null, null, 73, null, 74, null, null, null, 76, null, 73, null],
        [76, null, null, 73, null, null, 71, null, 69, null, null, null, 73, null, null, null],
        [74, null, 76, 78, null, null, 81, null, 78, null, 76, null, 74, null, 71, null],
        [76, null, null, 74, null, null, 73, null, 71, null, null, 73, 76, null, null, null],
      ];

      // Four-on-the-floor warm touring kick + crisp backbeat snare + airy swung hats
      if (beat16 === 0 || beat16 === 4 || beat16 === 8 || beat16 === 12) {
        this.trigKick(t, 0.92, 48);
      }
      if (beat16 === 4 || beat16 === 12) {
        this.trigSnare(t, 0.085, 0.9);
      }
      if (beat16 % 2 === 0) {
        this.trigHat(t, beat16 === 14, beat16 % 4 === 2 ? 0.048 : 0.026);
      }

      // Lush swelling analog pad every bar
      if (beat16 === 0) {
        this.trigLushPad(t, chords[bar], dur * 15.5, 'sawtooth', 1650, 0.028);
      }

      // Warm rolling Moog bass groove
      if (beat16 === 0 || beat16 === 3 || beat16 === 6 || beat16 === 8 || beat16 === 11 || beat16 === 14) {
        const oct = beat16 === 6 || beat16 === 14 ? 12 : 0;
        this.trigAnalogBass(t, bassRoots[bar] + oct, dur * 2.2, 680, 180, 0.13);
      }

      // Shimmering delayed synth-pluck arpeggio
      const arpNote = chords[bar][(beat16 + bar) % chords[bar].length] + (beat16 % 8 === 7 ? 12 : 0);
      if (beat16 % 2 === 0 || beat16 === 11 || beat16 === 15) {
        this.trigPluckOrLead(t, arpNote, dur * 1.9, 'triangle', 2800, 0.044, true);
      }

      // Soaring melodic lead entering on bars 4–7 (chorus lift!)
      if (bar >= 4) {
        const lNote = leadBars[bar - 4][beat16];
        if (lNote !== null) {
          this.trigPluckOrLead(t, lNote, dur * 3.4, 'sawtooth', 3200, 0.056, true);
        }
      }
    } else if (this.station === 'coastal') {
      // "AMALFI DRIFT" — 106 BPM Sun-Drenched Mediterranean Nu-Disco & Electric Rhodes Lounge
      const bassRoots = [41, 43, 40, 45, 38, 43, 36, 45];
      const chords = [
        [60, 64, 67, 69, 72], // Fmaj9
        [59, 62, 64, 67, 71], // G13
        [59, 62, 64, 67, 74], // Em9
        [60, 64, 67, 71, 74], // Am11
        [60, 64, 65, 69, 72], // Dm9
        [60, 62, 65, 67, 71], // G9sus4
        [59, 62, 64, 67, 72], // Cmaj9
        [60, 64, 67, 71, 76], // Am9
      ];
      const melodyPattern: Array<number | null> = [
        76, null, 79, null, 81, null, null, 79, 76, null, 74, null, 72, null, 74, null,
      ];

      // Deep warm Balearic kick + crisp rimshot + breezy shaker groove
      if (beat16 === 0 || beat16 === 4 || beat16 === 8 || beat16 === 12) {
        this.trigKick(t, 0.85, 50);
      }
      if (beat16 === 4 || beat16 === 12) {
        this.trigSnare(t, 0.072, 0.78);
      }
      if (beat16 % 2 === 1) {
        this.trigHat(t, beat16 === 15, 0.042);
      }

      // Syncopated warm Fender Rhodes stabs
      if (beat16 === 0 || beat16 === 6 || beat16 === 10) {
        this.trigRhodesElectricPiano(t, chords[bar], dur * (beat16 === 0 ? 5.5 : 3.5), 0.052);
      }

      // Funky octave-jumping Mediterranean bassline
      if (beat16 === 0 || beat16 === 3 || beat16 === 6 || beat16 === 10 || beat16 === 14) {
        const oct = beat16 === 6 || beat16 === 14 ? 12 : 0;
        this.trigAnalogBass(t, bassRoots[bar] + oct, dur * 2.1, 820, 210, 0.125);
      }

      // Silky sunlit pad underneath on bar 1 & 5
      if (beat16 === 0 && (bar % 2 === 0)) {
        this.trigLushPad(t, chords[bar], dur * 16, 'sine', 1400, 0.025);
      }

      // Breezy glass-marimba topline melody
      const mNote = melodyPattern[(beat16 + bar * 2) % 16];
      if (mNote !== null && (bar % 2 === 1 || beat16 < 8)) {
        this.trigPluckOrLead(t, mNote, dur * 2.2, 'triangle', 3400, 0.046, true);
      }
    } else if (this.station === 'velocity') {
      // "APEX OVERDRIVE" — 132 BPM High-Octane Gran Turismo / Outrun Motorsport Synthwave Anthem
      const bassRoots = [40, 36, 43, 38, 40, 36, 45, 47];
      const chords = [
        [59, 64, 67, 71], // Em
        [60, 64, 67, 71], // Cmaj7
        [59, 62, 67, 71], // G
        [57, 62, 66, 69], // D
        [59, 64, 67, 74], // Em7
        [60, 64, 67, 74], // Cadd9
        [60, 64, 67, 71], // Am9
        [59, 63, 66, 71], // B
      ];
      const anthemLead: Array<number | null> = [
        76, null, 79, null, 83, null, 79, 76, 74, null, 76, null, 79, null, null, null,
      ];

      // Driving punchy motorsport drum kit
      if (beat16 === 0 || beat16 === 4 || beat16 === 8 || beat16 === 12 || (bar === 7 && beat16 === 14)) {
        this.trigKick(t, 1.08, 44);
      }
      if (beat16 === 4 || beat16 === 12) {
        this.trigSnare(t, 0.125, 1.15);
      }
      this.trigHat(t, beat16 === 10 || beat16 === 14, beat16 % 2 === 1 ? 0.056 : 0.025);

      // Rolling 16th-note octave synthwave bassline with animated cutoff sweep
      const isOff = beat16 % 2 === 1;
      const sweep = 780 + Math.sin(step * 0.14) * 320 + (bar >= 4 ? 260 : 0);
      this.trigAnalogBass(t, bassRoots[bar] + (isOff ? 12 : 0), dur * 0.92, sweep, 180, 0.115);

      // Anthemic supersaw pads on every bar downbeat
      if (beat16 === 0) {
        this.trigLushPad(t, chords[bar], dur * 14.5, 'sawtooth', 2400, 0.032);
      }

      // Razor-sharp 16th arpeggio + blazing lead on bars 4–7
      if (beat16 % 2 === 0) {
        const arp = chords[bar][(beat16 / 2) % chords[bar].length] + 12;
        this.trigPluckOrLead(t, arp, dur * 1.4, 'sawtooth', 3600, 0.038, true);
      }
      if (bar >= 4) {
        const lNote = anthemLead[beat16];
        if (lNote !== null) {
          this.trigPluckOrLead(t, lNote, dur * 2.6, 'sawtooth', 4200, 0.058, true);
        }
      }
    }
  }

  // ---- Dynamic Vehicle Telemetry Soundscape ----

  private triggerGearShiftPop(): void {
    if (!this.ctx || !this.sfxBus || !this.snareBuffer || this.muted) return;
    const now = this.ctx.currentTime;

    // Authentic sequential gearbox ignition-cut exhaust crackle / pop!
    const src = this.ctx.createBufferSource();
    src.buffer = this.snareBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 340 + Math.random() * 140;
    bp.Q.value = 2.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    src.connect(bp).connect(g).connect(this.sfxBus);
    src.start(now);

    const thump = this.ctx.createOscillator();
    const tg = this.ctx.createGain();
    thump.type = 'triangle';
    thump.frequency.setValueAtTime(110, now);
    thump.frequency.exponentialRampToValueAtTime(42, now + 0.065);
    tg.gain.setValueAtTime(0.16, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    thump.connect(tg).connect(this.sfxBus);
    thump.start(now);
    thump.stop(now + 0.08);
  }

  private triggerTurboFlutter(): void {
    if (!this.ctx || !this.sfxBus || !this.hihatBuffer || this.muted) return;
    const now = this.ctx.currentTime;
    // Authentic triple-pulse wastegate blow-off valve flutter (stu-tu-tu!)
    for (let i = 0; i < 3; i++) {
      const t0 = now + i * 0.055;
      const src = this.ctx.createBufferSource();
      src.buffer = this.hihatBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3200 - i * 380;
      bp.Q.value = 3.8;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.08 * (1 - i * 0.25), t0);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.05);
      src.connect(bp).connect(g).connect(this.sfxBus);
      src.start(t0);
    }
  }

  public updateDrivingLoop(opts: {
    active: boolean;
    rpm: number;
    speedKmh: number;
    isDrifting: boolean;
    driftAngle: number;
    isBoosting: boolean;
    airborne?: boolean;
    gear?: number;
    surface?: 'asphalt' | 'curb' | 'shoulder';
  }): void {
    if (
      !this.ctx ||
      !this.engineSubOsc ||
      !this.engineOscA ||
      !this.engineOscB ||
      !this.engineOscC ||
      !this.engineFilter ||
      !this.enginePresence ||
      !this.engineGain ||
      !this.turboOsc ||
      !this.turboGain ||
      !this.driftGain ||
      !this.driftFilterA ||
      !this.driftFilterB ||
      !this.windFilter ||
      !this.windGain ||
      !this.gravelGain
    ) {
      return;
    }

    const now = this.ctx.currentTime;
    if (!opts.active || this.muted) {
      this.engineGain.gain.setTargetAtTime(0.0001, now, 0.08);
      this.turboGain.gain.setTargetAtTime(0.0001, now, 0.06);
      this.driftGain.gain.setTargetAtTime(0.0001, now, 0.06);
      this.windGain.gain.setTargetAtTime(0.0001, now, 0.08);
      this.gravelGain.gain.setTargetAtTime(0.0001, now, 0.06);
      return;
    }

    // Detect sequential gear shift for exhaust crackle pop!
    const gear = opts.gear ?? this.lastGear;
    if (gear !== this.lastGear && opts.speedKmh > 35 && gear > 0) {
      this.triggerGearShiftPop();
    }
    this.lastGear = gear;

    // Detect boost lift-off for turbo BOV flutter!
    if (this.lastBoosting && !opts.isBoosting && opts.speedKmh > 60) {
      this.triggerTurboFlutter();
    }
    this.lastBoosting = opts.isBoosting;
    this.lastRpm = opts.rpm;

    // 4-harmonic GT V10 / Flat-6 scream
    const baseFreq = 52 + opts.rpm * 158 + (opts.isBoosting ? 34 : 0) + (opts.airborne ? 18 : 0);
    this.engineSubOsc.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.035);
    this.engineOscA.frequency.setTargetAtTime(baseFreq, now, 0.035);
    this.engineOscB.frequency.setTargetAtTime(baseFreq * 2.002, now, 0.035);
    this.engineOscC.frequency.setTargetAtTime(baseFreq * 2.996, now, 0.035);

    this.engineFilter.frequency.setTargetAtTime(
      240 + opts.rpm * 1350 + (opts.isBoosting ? 720 : 0),
      now,
      0.045,
    );
    this.enginePresence.frequency.setTargetAtTime(620 + opts.rpm * 850, now, 0.05);

    const throttleGain =
      0.07 + Math.min(0.11, (opts.speedKmh / 260) * 0.1) + (opts.isBoosting ? 0.04 : 0);
    this.engineGain.gain.setTargetAtTime(throttleGain, now, 0.05);

    // Subtle high-tech twin-turbo spool whine during boost & upper RPM band
    const turboLevel = opts.isBoosting ? 0.028 : Math.max(0, opts.rpm - 0.62) * 0.024;
    this.turboOsc.frequency.setTargetAtTime(1950 + opts.rpm * 2100 + (opts.isBoosting ? 850 : 0), now, 0.05);
    this.turboGain.gain.setTargetAtTime(turboLevel, now, 0.06);

    // Realistic dual-band tire screech (asphalt & curb)
    const onGravel = opts.surface === 'shoulder';
    const onCurb = opts.surface === 'curb';
    const driftIntensity =
      opts.isDrifting && !opts.airborne && !onGravel
        ? Math.min(1, Math.abs(opts.driftAngle) * 2.2) * Math.min(1, opts.speedKmh / 65)
        : 0;
    this.driftGain.gain.setTargetAtTime(driftIntensity * 0.115, now, 0.045);
    this.driftFilterA.frequency.setTargetAtTime(1180 + driftIntensity * 460, now, 0.045);
    this.driftFilterB.frequency.setTargetAtTime(2280 + driftIntensity * 680, now, 0.045);

    // Gravel shoulder crunch & serrated apex curb rumble
    const gravelLevel =
      !opts.airborne && onGravel
        ? Math.min(1, opts.speedKmh / 120) * 0.11
        : !opts.airborne && onCurb
          ? Math.min(1, opts.speedKmh / 130) * 0.058
          : 0.0001;
    this.gravelGain.gain.setTargetAtTime(gravelLevel, now, 0.05);

    // Aerodynamic high-speed wind rush (immersive sense of 200+ KM/H airflow!)
    const windRatio = Math.max(0, (opts.speedKmh - 75) / 210);
    const windLevel = windRatio * windRatio * 0.14 + (opts.airborne ? 0.045 : 0);
    this.windFilter.frequency.setTargetAtTime(340 + windRatio * 960, now, 0.08);
    this.windGain.gain.setTargetAtTime(Math.max(0.0001, windLevel), now, 0.08);
  }

  public triggerEvents(events: RaceEvent[]): void {
    if (this.muted || events.length === 0) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxBus || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    for (const ev of events) {
      if (ev.type === 'boost-ignite' || ev.type === 'boost-pad' || ev.type === 'perfect-launch') {
        // Layered jet afterburner whoosh + harmonic surge
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        filter.type = 'lowpass';
        const startF = ev.type === 'boost-pad' ? 220 : 155;
        const endF = ev.type === 'boost-pad' ? 760 : 520;
        osc.frequency.setValueAtTime(startF, now);
        osc.frequency.exponentialRampToValueAtTime(endF, now + 0.32);
        filter.frequency.setValueAtTime(600, now);
        filter.frequency.exponentialRampToValueAtTime(3200, now + 0.25);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
        osc.connect(filter).connect(gain).connect(this.sfxBus);
        if (this.reverbSend) gain.connect(this.reverbSend);
        osc.start(now);
        osc.stop(now + 0.4);
      } else if (ev.type === 'jump-launch') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(175, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.24);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.connect(gain).connect(this.sfxBus);
        osc.start(now);
        osc.stop(now + 0.29);
      } else if (ev.type === 'jump-land' || ev.type === 'barrier-hit' || ev.type === 'car-bump') {
        // Deep suspension thump + metallic/carbon impact transient
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        const pitchVar = 0.92 + Math.random() * 0.16;
        osc.frequency.setValueAtTime((ev.type === 'jump-land' ? 92 : 132) * pitchVar, now);
        osc.frequency.exponentialRampToValueAtTime(32, now + 0.2);
        gain.gain.setValueAtTime(Math.min(0.32, 0.14 + ev.intensity * 0.2), now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
        osc.connect(gain).connect(this.sfxBus);
        osc.start(now);
        osc.stop(now + 0.26);

        if (ev.type !== 'jump-land' && this.snareBuffer) {
          const src = ctx.createBufferSource();
          src.buffer = this.snareBuffer;
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = 1150;
          const ng = ctx.createGain();
          ng.gain.setValueAtTime(Math.min(0.18, 0.08 + ev.intensity * 0.12), now);
          ng.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
          src.connect(bp).connect(ng).connect(this.sfxBus);
          src.start(now);
        }
      } else if (ev.type === 'post-hit') {
        // Tactile hollow-polymer bollard shear & snap transient
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        const pitchVar = 0.88 + Math.random() * 0.24;
        osc.frequency.setValueAtTime(340 * pitchVar, now);
        osc.frequency.exponentialRampToValueAtTime(115 * pitchVar, now + 0.11);
        gain.gain.setValueAtTime(Math.min(0.24, 0.1 + ev.intensity * 0.12), now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.connect(gain).connect(this.sfxBus);
        osc.start(now);
        osc.stop(now + 0.15);

        if (this.snareBuffer) {
          const src = ctx.createBufferSource();
          src.buffer = this.snareBuffer;
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = 1850;
          bp.Q.value = 1.6;
          const ng = ctx.createGain();
          ng.gain.setValueAtTime(Math.min(0.14, 0.06 + ev.intensity * 0.08), now);
          ng.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
          src.connect(bp).connect(ng).connect(this.sfxBus);
          src.start(now);
        }
      } else if (ev.type === 'apex-ring') {
        const notes = [659.25, 880, 1174.66, 1318.51];
        notes.forEach((f, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          const t0 = now + idx * 0.04;
          osc.frequency.setValueAtTime(f, t0);
          gain.gain.setValueAtTime(0.12, t0);
          gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.28);
          osc.connect(gain).connect(this.sfxBus!);
          if (this.reverbSend) gain.connect(this.reverbSend);
          osc.start(t0);
          osc.stop(t0 + 0.3);
        });
      } else if (ev.type === 'countdown-tick') {
        const isGo = ev.label === 'GO!';
        const freqs = isGo ? [587.33, 880, 1174.66] : [440];
        freqs.forEach((f) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(f, now);
          gain.gain.setValueAtTime(isGo ? 0.13 : 0.15, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + (isGo ? 0.42 : 0.16));
          osc.connect(gain).connect(this.sfxBus!);
          if (this.reverbSend) gain.connect(this.reverbSend);
          osc.start(now);
          osc.stop(now + (isGo ? 0.45 : 0.18));
        });
      } else if (ev.type === 'checkpoint' || ev.type === 'drift-bank') {
        const base = ev.type === 'checkpoint' ? 587.33 : 783.99;
        [1, 1.25, 1.5].forEach((mult, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          const t0 = now + idx * 0.042;
          osc.frequency.setValueAtTime(base * mult, t0);
          gain.gain.setValueAtTime(0.1, t0);
          gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.24);
          osc.connect(gain).connect(this.sfxBus!);
          if (this.reverbSend) gain.connect(this.reverbSend);
          osc.start(t0);
          osc.stop(t0 + 0.26);
        });
      } else if (ev.type === 'lap-complete' || ev.type === 'race-finish') {
        const notes =
          ev.type === 'race-finish'
            ? [523.25, 659.25, 783.99, 987.77, 1046.5]
            : [440, 554.37, 659.25, 880];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          const t0 = now + idx * 0.075;
          osc.frequency.setValueAtTime(freq, t0);
          gain.gain.setValueAtTime(0.14, t0);
          gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.45);
          osc.connect(gain).connect(this.sfxBus!);
          if (this.reverbSend) gain.connect(this.reverbSend);
          osc.start(t0);
          osc.stop(t0 + 0.48);
        });
      }
    }
  }

  public dispose(): void {
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
