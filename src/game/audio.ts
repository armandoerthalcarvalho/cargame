import type { RaceEvent, RadioStationId } from './types';

export class DrivingAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOscA: OscillatorNode | null = null;
  private engineOscB: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private driftNoise: AudioBufferSourceNode | null = null;
  private driftFilter: BiquadFilterNode | null = null;
  private driftGain: GainNode | null = null;
  private hihatBuffer: AudioBuffer | null = null;

  private muted = false;
  private station: RadioStationId = 'solstice';
  private radioIntervalId: number | null = null;
  private radioStep = 0;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.45;
      this.masterGain.connect(this.ctx.destination);

      // Dual-oscillator GT engine synth
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 340;
      this.engineFilter.Q.value = 2.4;

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0001;

      this.engineOscA = this.ctx.createOscillator();
      this.engineOscA.type = 'sawtooth';
      this.engineOscA.frequency.value = 62;

      this.engineOscB = this.ctx.createOscillator();
      this.engineOscB.type = 'triangle';
      this.engineOscB.frequency.value = 124;

      this.engineOscA.connect(this.engineFilter);
      this.engineOscB.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.engineOscA.start();
      this.engineOscB.start();

      // Filtered white-noise tire drift screech
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      // Short percussion noise burst buffer for Velocity Pulse radio hi-hat
      const hhLen = Math.floor(this.ctx.sampleRate * 0.06);
      this.hihatBuffer = this.ctx.createBuffer(1, hhLen, this.ctx.sampleRate);
      const hhData = this.hihatBuffer.getChannelData(0);
      for (let i = 0; i < hhLen; i++) {
        hhData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (hhLen * 0.28));
      }

      this.driftNoise = this.ctx.createBufferSource();
      this.driftNoise.buffer = noiseBuffer;
      this.driftNoise.loop = true;

      this.driftFilter = this.ctx.createBiquadFilter();
      this.driftFilter.type = 'bandpass';
      this.driftFilter.frequency.value = 1450;
      this.driftFilter.Q.value = 4.2;

      this.driftGain = this.ctx.createGain();
      this.driftGain.gain.value = 0.0001;

      this.driftNoise.connect(this.driftFilter);
      this.driftFilter.connect(this.driftGain);
      this.driftGain.connect(this.masterGain);
      this.driftNoise.start();
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public unlock(): void {
    this.ensureContext();
    if (this.station !== 'off' && this.radioIntervalId === null) {
      this.startRadioTimer();
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.45, this.ctx.currentTime, 0.04);
    }
  }

  public getRadioStation(): RadioStationId {
    return this.station;
  }

  public setRadioStation(station: RadioStationId): void {
    this.station = station;
    this.radioStep = 0;
    if (this.radioIntervalId !== null) {
      window.clearInterval(this.radioIntervalId);
      this.radioIntervalId = null;
    }
    if (station !== 'off') {
      this.ensureContext();
      this.startRadioTimer();
    }
  }

  private startRadioTimer(): void {
    if (typeof window === 'undefined' || this.station === 'off') return;
    if (this.radioIntervalId !== null) {
      window.clearInterval(this.radioIntervalId);
    }
    const stepMs = this.station === 'velocity' ? 114 : this.station === 'coastal' ? 245 : 215;
    this.radioIntervalId = window.setInterval(() => this.playRadioStep(), stepMs);
  }

  private playRadioStep(): void {
    if (!this.ctx || !this.masterGain || this.muted || this.station === 'off') return;
    if (this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    const bar = Math.floor(this.radioStep / 8) % 4;
    const beat = this.radioStep % 8;

    if (this.station === 'solstice') {
      // Warm golden-hour grand touring arpeggio (Dmaj9 -> Bm7 -> Gmaj7 -> A6)
      const bassNotes = [73.42, 61.74, 98.0, 110.0];
      const chordArps = [
        [293.66, 369.99, 440.0, 554.37],
        [246.94, 293.66, 369.99, 440.0],
        [196.0, 293.66, 369.99, 493.88],
        [220.0, 329.63, 440.0, 554.37],
      ];

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(chordArps[bar][beat % 4], now);
      gain.gain.setValueAtTime(0.055, now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.19);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.2);

      if (beat % 2 === 0) {
        const bass = this.ctx.createOscillator();
        const bGain = this.ctx.createGain();
        bass.type = 'sine';
        bass.frequency.setValueAtTime(bassNotes[bar], now);
        bGain.gain.setValueAtTime(0.1, now);
        bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
        bass.connect(bGain);
        bGain.connect(this.masterGain);
        bass.start(now);
        bass.stop(now + 0.35);
      }
    } else if (this.station === 'coastal') {
      // Breezy Mediterranean lounge (Fmaj7 -> G6 -> Em7 -> Am9)
      const chords = [
        [174.61, 220.0, 261.63, 329.63],
        [196.0, 246.94, 293.66, 329.63],
        [164.81, 196.0, 246.94, 293.66],
        [220.0, 261.63, 329.63, 493.88],
      ];
      if (beat === 0 || beat === 3 || beat === 6) {
        for (const freq of chords[bar]) {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now);
          gain.gain.setValueAtTime(0.025, now);
          gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.42);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 0.44);
        }
      }
      // Subtle marimba melody note
      const melody = chords[bar][(beat + bar) % 4] * 2;
      const mOsc = this.ctx.createOscillator();
      const mGain = this.ctx.createGain();
      mOsc.type = 'triangle';
      mOsc.frequency.setValueAtTime(melody, now);
      mGain.gain.setValueAtTime(0.035, now);
      mGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.16);
      mOsc.connect(mGain);
      mGain.connect(this.masterGain);
      mOsc.start(now);
      mOsc.stop(now + 0.18);
    } else if (this.station === 'velocity') {
      // High-energy 132 BPM motorsport synthwave pulse (E minor -> C -> G -> D)
      const roots = [82.41, 65.41, 98.0, 73.42];
      const root = roots[bar];
      const octaveFreq = beat % 2 === 0 ? root : root * 2;

      const bass = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const bGain = this.ctx.createGain();
      bass.type = 'sawtooth';
      bass.frequency.setValueAtTime(octaveFreq, now);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(680, now);
      filter.frequency.exponentialRampToValueAtTime(190, now + 0.09);
      bGain.gain.setValueAtTime(0.08, now);
      bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      bass.connect(filter);
      filter.connect(bGain);
      bGain.connect(this.masterGain);
      bass.start(now);
      bass.stop(now + 0.11);

      if (beat % 2 === 1 && this.hihatBuffer) {
        const hh = this.ctx.createBufferSource();
        hh.buffer = this.hihatBuffer;
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 6500;
        const hGain = this.ctx.createGain();
        hGain.gain.setValueAtTime(0.055, now);
        hh.connect(hp);
        hp.connect(hGain);
        hGain.connect(this.masterGain);
        hh.start(now);
      }
    }

    this.radioStep = (this.radioStep + 1) % 32;
  }

  public updateDrivingLoop(opts: {
    active: boolean;
    rpm: number;
    speedKmh: number;
    isDrifting: boolean;
    driftAngle: number;
    isBoosting: boolean;
    airborne?: boolean;
  }): void {
    if (
      !this.ctx ||
      !this.engineOscA ||
      !this.engineOscB ||
      !this.engineFilter ||
      !this.engineGain ||
      !this.driftGain ||
      !this.driftFilter
    ) {
      return;
    }

    const now = this.ctx.currentTime;
    if (!opts.active || this.muted) {
      this.engineGain.gain.setTargetAtTime(0.0001, now, 0.08);
      this.driftGain.gain.setTargetAtTime(0.0001, now, 0.06);
      return;
    }

    const baseFreq = 56 + opts.rpm * 148 + (opts.isBoosting ? 36 : 0) + (opts.airborne ? 18 : 0);
    this.engineOscA.frequency.setTargetAtTime(baseFreq, now, 0.04);
    this.engineOscB.frequency.setTargetAtTime(baseFreq * 1.995, now, 0.04);
    this.engineFilter.frequency.setTargetAtTime(
      260 + opts.rpm * 1080 + (opts.isBoosting ? 580 : 0),
      now,
      0.05,
    );
    const throttleGain =
      0.08 + Math.min(0.11, (opts.speedKmh / 240) * 0.1) + (opts.isBoosting ? 0.04 : 0);
    this.engineGain.gain.setTargetAtTime(throttleGain, now, 0.06);

    const driftIntensity =
      opts.isDrifting && !opts.airborne
        ? Math.min(1, Math.abs(opts.driftAngle) * 2.2) * Math.min(1, opts.speedKmh / 70)
        : 0;
    this.driftGain.gain.setTargetAtTime(driftIntensity * 0.14, now, 0.05);
    this.driftFilter.frequency.setTargetAtTime(1250 + driftIntensity * 550, now, 0.05);
  }

  public triggerEvents(events: RaceEvent[]): void {
    if (this.muted || events.length === 0) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    for (const ev of events) {
      if (ev.type === 'boost-ignite' || ev.type === 'boost-pad' || ev.type === 'perfect-launch') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = ev.type === 'boost-pad' ? 'triangle' : 'sawtooth';
        const startF = ev.type === 'boost-pad' ? 240 : 165;
        const endF = ev.type === 'boost-pad' ? 780 : 540;
        osc.frequency.setValueAtTime(startF, now);
        osc.frequency.exponentialRampToValueAtTime(endF, now + 0.28);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.36);
      } else if (ev.type === 'jump-launch') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(420, now + 0.22);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.26);
      } else if (ev.type === 'jump-land' || ev.type === 'barrier-hit' || ev.type === 'car-bump') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        const pitchVar = 0.92 + Math.random() * 0.16;
        osc.frequency.setValueAtTime((ev.type === 'jump-land' ? 98 : 125) * pitchVar, now);
        osc.frequency.exponentialRampToValueAtTime(36, now + 0.18);
        gain.gain.setValueAtTime(Math.min(0.3, 0.12 + ev.intensity * 0.2), now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.24);
      } else if (ev.type === 'apex-ring') {
        const notes = [659.25, 880, 1174.66];
        notes.forEach((f, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          const t0 = now + idx * 0.045;
          osc.frequency.setValueAtTime(f, t0);
          gain.gain.setValueAtTime(0.14, t0);
          gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.24);
          osc.connect(gain);
          gain.connect(this.masterGain!);
          osc.start(t0);
          osc.stop(t0 + 0.25);
        });
      } else if (ev.type === 'countdown-tick') {
        const isGo = ev.label === 'GO!';
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(isGo ? 880 : 440, now);
        gain.gain.setValueAtTime(isGo ? 0.22 : 0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + (isGo ? 0.36 : 0.16));
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + (isGo ? 0.38 : 0.18));
      } else if (ev.type === 'checkpoint' || ev.type === 'drift-bank') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const base = ev.type === 'checkpoint' ? 587.33 : 783.99;
        osc.frequency.setValueAtTime(base, now);
        osc.frequency.setValueAtTime(base * 1.25, now + 0.06);
        gain.gain.setValueAtTime(0.13, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.24);
      } else if (ev.type === 'lap-complete' || ev.type === 'race-finish') {
        const notes =
          ev.type === 'race-finish' ? [523.25, 659.25, 783.99, 1046.5] : [440, 554.37, 659.25];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          const t0 = now + idx * 0.08;
          osc.frequency.setValueAtTime(freq, t0);
          gain.gain.setValueAtTime(0.16, t0);
          gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.34);
          osc.connect(gain);
          gain.connect(this.masterGain!);
          osc.start(t0);
          osc.stop(t0 + 0.36);
        });
      }
    }
  }

  public dispose(): void {
    if (this.radioIntervalId !== null) {
      window.clearInterval(this.radioIntervalId);
      this.radioIntervalId = null;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
