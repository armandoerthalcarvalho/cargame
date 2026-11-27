import { useMemo } from 'react';
import { Camera, Pause, Volume2, VolumeX } from 'lucide-react';
import type { TrackData } from '../game/track';
import type { HudTelemetry } from '../game/types';
import type { TouchInputState } from '../three/sceneEngine';

interface DrivingHudProps {
  telemetry: HudTelemetry;
  track: TrackData | null;
  muted: boolean;
  onCycleCamera: () => void;
  onResetToTrack: () => void;
  onToggleMute: () => void;
  onPause: () => void;
  onTouchChange: (partial: Partial<TouchInputState>) => void;
}

export function formatRaceTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--:--.--';
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  const hundredths = Math.floor((clamped - Math.floor(clamped)) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function ordinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

function TrackMinimap({
  track,
  racers,
}: {
  track: TrackData;
  racers: HudTelemetry['minimapRacers'];
}) {
  const size = 128;
  const pad = 12;

  const { pathD, project } = useMemo(() => {
    const b = track.bounds;
    const scale = Math.min((size - pad * 2) / b.width, (size - pad * 2) / b.depth);
    const cx = (b.minX + b.maxX) * 0.5;
    const cz = (b.minZ + b.maxZ) * 0.5;

    const proj = (x: number, z: number) => ({
      mx: size * 0.5 + (x - cx) * scale,
      my: size * 0.5 - (z - cz) * scale,
    });

    const step = Math.max(1, Math.floor(track.samples.length / 80));
    const cmds: string[] = [];
    for (let i = 0; i < track.samples.length; i += step) {
      const p = proj(track.samples[i].pos.x, track.samples[i].pos.z);
      cmds.push(`${cmds.length === 0 ? 'M' : 'L'}${p.mx.toFixed(1)},${p.my.toFixed(1)}`);
    }
    cmds.push('Z');
    return { pathD: cmds.join(' '), project: proj };
  }, [track]);

  const startPt = project(track.samples[0].pos.x, track.samples[0].pos.z);

  return (
    <div className="rounded-lg bg-[#0d1118]/78 border border-white/10 p-2 shadow-lg">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="Course map">
        <path
          d={pathD}
          fill="none"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth={5.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={pathD}
          fill="none"
          stroke="rgba(244,241,234,0.75)"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={startPt.mx} cy={startPt.my} r={2.8} fill="#f5f3ee" />
        {racers
          .filter((r) => !r.isPlayer)
          .map((r) => {
            const pt = project(r.x, r.z);
            return (
              <circle
                key={r.id}
                cx={pt.mx}
                cy={pt.my}
                r={3.0}
                fill={r.colorHex}
                stroke="#0b0e14"
                strokeWidth={1}
              />
            );
          })}
        {racers
          .filter((r) => r.isPlayer)
          .map((r) => {
            const pt = project(r.x, r.z);
            const deg = (r.heading * 180) / Math.PI;
            return (
              <g key={r.id} transform={`translate(${pt.mx.toFixed(1)}, ${pt.my.toFixed(1)}) rotate(${deg.toFixed(0)})`}>
                <polygon
                  points="0,-5.5 4.2,4.5 0,2.2 -4.2,4.5"
                  fill="#f59e0b"
                  stroke="#0b0e14"
                  strokeWidth={1}
                />
              </g>
            );
          })}
      </svg>
    </div>
  );
}

const BANNER_COLOR: Record<HudTelemetry['bannerTone'], string> = {
  amber: 'text-[#fbbf24]',
  emerald: 'text-[#34d399]',
  cyan: 'text-[#38bdf8]',
  rose: 'text-[#fb7185]',
};

export function DrivingHud({
  telemetry,
  track,
  muted,
  onCycleCamera,
  onResetToTrack,
  onToggleMute,
  onPause,
  onTouchChange,
}: DrivingHudProps) {
  const boostRatio = Math.max(0, Math.min(1, telemetry.boostEnergy / 100));
  const rpmSegments = 14;
  const activeRpmCount = Math.round(Math.max(0, Math.min(1, telemetry.rpm)) * rpmSegments);
  const gearLabel = telemetry.gear === 0 ? 'R' : String(telemetry.gear);

  const cameraLabel =
    telemetry.cameraMode === 'chase'
      ? 'Chase'
      : telemetry.cameraMode === 'hood'
        ? 'Hood'
        : 'Helo';

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none flex flex-col justify-between p-4 sm:p-5">
      {/* Top Row: Clean Race Telemetry + Minimal 3-Button Utility Group */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-5 px-4 py-2.5 rounded-lg bg-[#0d1118]/78 border border-white/10 shadow-lg">
          {telemetry.mode === 'grand-prix' && (
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-[0.14em] text-[#9aa5b6]">Pos</span>
              <span className="font-display text-2xl font-extrabold text-[#f7f4ec] leading-none mt-0.5">
                {ordinal(telemetry.position)}
                <span className="text-xs font-medium text-[#8f99aa] ml-1">
                  /{telemetry.totalRacers}
                </span>
              </span>
            </div>
          )}

          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[#9aa5b6]">Lap</span>
            <span className="font-display text-2xl font-extrabold text-[#f7f4ec] leading-none mt-0.5 tabular-mono">
              {telemetry.mode === 'free-roam'
                ? telemetry.lap
                : `${telemetry.lap}/${telemetry.totalLaps}`}
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[#9aa5b6]">Time</span>
            <span className="tabular-mono text-lg font-bold text-[#f7f4ec] leading-none mt-1">
              {formatRaceTime(telemetry.elapsedTime)}
            </span>
          </div>

          {telemetry.totalStyleScore > 0 && (
            <div className="hidden sm:flex flex-col border-l border-white/10 pl-4">
              <span className="text-[10px] uppercase tracking-[0.14em] text-[#9aa5b6]">
                Style {telemetry.comboMultiplier > 1 ? `×${telemetry.comboMultiplier}` : ''}
              </span>
              <span className="tabular-mono text-lg font-bold text-[#fbbf24] leading-none mt-1">
                {telemetry.totalStyleScore.toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {/* Minimal 3-Control Utility Bar (Camera, Audio, Pause) — zero redundant buttons */}
        <div className="flex items-center gap-1.5 pointer-events-auto">
          <button
            type="button"
            onClick={onCycleCamera}
            aria-label={`Camera view: ${cameraLabel}`}
            title="Cycle camera (C)"
            className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#0d1118]/78 hover:bg-[#19202e] border border-white/12 text-[#e8ecf4] text-xs font-semibold cursor-pointer transition-colors"
          >
            <Camera className="w-3.5 h-3.5 text-[#f59e0b]" />
            <span className="hidden sm:inline">{cameraLabel}</span>
          </button>

          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            title={muted ? 'Unmute (M)' : 'Mute (M)'}
            className="p-2 rounded-md bg-[#0d1118]/78 hover:bg-[#19202e] border border-white/12 text-[#e8ecf4] cursor-pointer transition-colors"
          >
            {muted ? <VolumeX className="w-4 h-4 text-[#fb7185]" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onPause}
            aria-label="Pause race"
            title="Pause (Esc)"
            className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#0d1118]/78 hover:bg-[#19202e] border border-white/12 text-[#e8ecf4] text-xs font-semibold cursor-pointer transition-colors"
          >
            <Pause className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Pause</span>
          </button>
        </div>
      </div>

      {/* Center Transient Callouts (Countdown, Event Banner, Drift/Draft, or Contextual Wrong-Way Reset) */}
      <div className="flex flex-col items-center justify-center gap-2.5 my-auto">
        {telemetry.countdownDigit > 0 && (
          <div className="flex flex-col items-center">
            <span
              className="font-display text-8xl font-black text-[#f7f4ec] leading-none"
              style={{ textShadow: '0 6px 28px rgba(0,0,0,0.75)' }}
            >
              {telemetry.countdownDigit}
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#fbbf24] mt-2">
              Hold W for Launch
            </span>
          </div>
        )}

        {telemetry.countdownDigit === 0 && telemetry.bannerText && (
          <div
            className={`font-display text-2xl sm:text-3xl font-black tracking-wide ${BANNER_COLOR[telemetry.bannerTone]}`}
            style={{ textShadow: '0 4px 18px rgba(0,0,0,0.8)' }}
          >
            {telemetry.bannerText}
          </div>
        )}

        {telemetry.wrongWay && (
          <div className="pointer-events-auto flex items-center gap-3 px-4 py-2 rounded-md bg-[#1a0d12]/90 border border-[#f43f5e]/60">
            <span className="font-display text-sm font-bold text-[#fda4af] tracking-wider uppercase">
              Wrong Way
            </span>
            <button
              type="button"
              onClick={onResetToTrack}
              className="px-2.5 py-1 rounded bg-[#f43f5e] text-white text-xs font-bold cursor-pointer"
            >
              Reset (T)
            </button>
          </div>
        )}

        {telemetry.countdownDigit === 0 && !telemetry.wrongWay && telemetry.isDrifting && telemetry.activeDriftScore > 10 && (
          <div
            className="font-display text-xl font-extrabold text-[#fbbf24] tabular-mono"
            style={{ textShadow: '0 3px 14px rgba(0,0,0,0.85)' }}
          >
            DRIFT +{telemetry.activeDriftScore}
          </div>
        )}

        {telemetry.countdownDigit === 0 && !telemetry.wrongWay && telemetry.slipstream > 0.35 && (
          <div
            className="text-xs font-bold uppercase tracking-[0.2em] text-[#38bdf8]"
            style={{ textShadow: '0 2px 10px rgba(0,0,0,0.85)' }}
          >
            Slipstream Draft
          </div>
        )}
      </div>

      {/* Bottom Row: 12-Car Minimap (left) + Calibrated Motorsport Tachometer & Boost (right) */}
      <div className="flex items-end justify-between gap-4">
        <div className="hidden sm:block">
          {track && <TrackMinimap track={track} racers={telemetry.minimapRacers} />}
        </div>

        {/* Touch controls on narrow touch screens */}
        <div className="flex sm:hidden items-center gap-2 pointer-events-auto">
          <button
            type="button"
            onPointerDown={() => onTouchChange({ left: true })}
            onPointerUp={() => onTouchChange({ left: false })}
            onPointerLeave={() => onTouchChange({ left: false })}
            className="w-12 h-12 rounded-lg bg-[#0d1118]/85 border border-white/15 text-white font-bold"
          >
            ◀
          </button>
          <button
            type="button"
            onPointerDown={() => onTouchChange({ right: true })}
            onPointerUp={() => onTouchChange({ right: false })}
            onPointerLeave={() => onTouchChange({ right: false })}
            className="w-12 h-12 rounded-lg bg-[#0d1118]/85 border border-white/15 text-white font-bold"
          >
            ▶
          </button>
        </div>

        {/* Calibrated Motorsport Instrument Cluster */}
        <div className="flex flex-col gap-2 px-4 py-3 rounded-lg bg-[#0d1118]/82 border border-white/10 shadow-lg min-w-[204px]">
          {/* Shift RPM LED strip */}
          <div className="flex items-center gap-1" aria-hidden="true">
            {Array.from({ length: rpmSegments }).map((_, idx) => {
              const lit = idx < activeRpmCount;
              const color =
                idx >= 11 ? '#ef4444' : idx >= 8 ? '#f59e0b' : '#22c55e';
              return (
                <div
                  key={idx}
                  className="h-1.5 flex-1 rounded-xs transition-opacity"
                  style={{
                    backgroundColor: lit ? color : 'rgba(255,255,255,0.1)',
                    opacity: lit ? 1 : 0.6,
                  }}
                />
              );
            })}
          </div>

          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-4xl font-black text-[#f7f4ec] tabular-mono leading-none">
                {telemetry.speedKmh}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8f99aa]">
                km/h
              </span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-[10px] uppercase tracking-wider text-[#8f99aa]">Gear</span>
              <span className="font-display text-2xl font-extrabold text-[#f59e0b] tabular-mono leading-none">
                {gearLabel}
              </span>
            </div>
          </div>

          {/* Integrated Overdrive Boost Bar */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9aa5b6] w-11 shrink-0">
              {telemetry.isBoosting ? 'Boost' : 'Nitro'}
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full origin-left transition-colors"
                style={{
                  transform: `scaleX(${boostRatio})`,
                  backgroundColor: telemetry.isBoosting ? '#38bdf8' : '#f59e0b',
                }}
              />
            </div>
            <span className="tabular-mono text-[10px] font-semibold text-[#cbd5e1] w-7 text-right">
              {telemetry.boostEnergy}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
