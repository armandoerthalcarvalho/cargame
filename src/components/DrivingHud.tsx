import { useEffect, useMemo, useRef, useState } from 'react';
import { RADIO_STATIONS } from '../game/courses';
import type { TrackData } from '../game/track';
import type { HudTelemetry, RadioStationId } from '../game/types';
import type { TouchInputState } from '../three/sceneEngine';

interface DrivingHudProps {
  telemetry: HudTelemetry;
  track: TrackData | null;
  muted: boolean;
  radioStation: RadioStationId;
  onCycleCamera: () => void;
  onCycleRadio: () => void;
  onResetToTrack: () => void;
  onToggleMute: () => void;
  onPause: () => void;
  onRestart: () => void;
  onTouchChange: (partial: Partial<TouchInputState>) => void;
}

export function formatRaceTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--:--.--';
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  const hundredths = Math.floor((clamped % 1) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function ordinalSuffix(pos: number): string {
  if (pos === 1) return 'ST';
  if (pos === 2) return 'ND';
  if (pos === 3) return 'RD';
  return 'TH';
}

const TACH_TICKS = [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.84, 1.0];

export function DrivingHud({
  telemetry,
  track,
  muted,
  radioStation,
  onCycleCamera,
  onCycleRadio,
  onResetToTrack,
  onToggleMute,
  onPause,
  onRestart,
  onTouchChange,
}: DrivingHudProps) {
  // Trailing boost ghost bar so rapid Overdrive burn reads with motorsport clarity
  const [ghostBoost, setGhostBoost] = useState(telemetry.boostEnergy);
  const ghostRef = useRef(telemetry.boostEnergy);

  useEffect(() => {
    if (telemetry.boostEnergy >= ghostRef.current) {
      ghostRef.current = telemetry.boostEnergy;
      setGhostBoost(telemetry.boostEnergy);
    } else {
      const id = window.setTimeout(() => {
        ghostRef.current = telemetry.boostEnergy;
        setGhostBoost(telemetry.boostEnergy);
      }, 240);
      return () => window.clearTimeout(id);
    }
  }, [telemetry.boostEnergy]);

  const minimapData = useMemo(() => {
    if (!track) return null;
    const pad = 16;
    const size = 132;
    const inner = size - pad * 2;
    const span = Math.max(track.bounds.width, track.bounds.depth);
    const offsetX = (span - track.bounds.width) * 0.5;
    const offsetZ = (span - track.bounds.depth) * 0.5;

    const toSvg = (wx: number, wz: number) => ({
      x: pad + ((wx - track.bounds.minX + offsetX) / span) * inner,
      y: pad + ((wz - track.bounds.minZ + offsetZ) / span) * inner,
    });

    const pts: string[] = [];
    for (let i = 0; i < track.samples.length; i += 4) {
      const s = track.samples[i].pos;
      const p = toSvg(s.x, s.z);
      pts.push(`${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    pts.push('Z');

    const startSample = track.samples[Math.min(track.samples.length - 1, 8)];
    const startPt = toSvg(startSample.pos.x, startSample.pos.z);

    const featurePins = track.features.map((f) => ({
      id: f.id,
      type: f.type,
      ...toSvg(f.pos.x, f.pos.z),
    }));

    return { pathD: pts.join(' '), toSvg, size, featurePins, startPt };
  }, [track]);

  const rpmClamped = Math.max(0, Math.min(1, telemetry.rpm));
  const arcRadius = 46;
  const arcCircumference = 2 * Math.PI * arcRadius;
  const maxSweep = arcCircumference * 0.64;
  const dashOffset = maxSweep * (1 - rpmClamped);
  const redlineSweep = maxSweep * 0.16;
  const redlineOffset = -(maxSweep - redlineSweep);

  const cameraLabel =
    telemetry.cameraMode === 'chase' ? 'Chase' : telemetry.cameraMode === 'hood' ? 'Hood' : 'Helo';
  const radioName =
    RADIO_STATIONS.find((s) => s.id === radioStation)?.name.split(' ')[0] ?? 'Radio';

  const bannerBorder =
    telemetry.bannerTone === 'emerald'
      ? 'border-[#34d399]/70 text-[#d1fae5]'
      : telemetry.bannerTone === 'cyan'
        ? 'border-[#38bdf8]/70 text-[#e0f2fe]'
        : telemetry.bannerTone === 'red'
          ? 'border-[#f87171]/70 text-[#fee2e2]'
          : 'border-[#f59e0b]/70 text-[#f8f5ef]';

  const highSpeedBoostGlow = telemetry.isBoosting && telemetry.speedKmh > 170;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none">
      {/* Subtle compositor-only peripheral boost speed-vignette (zero backdrop-filter) */}
      <div
        className="fixed inset-0 pointer-events-none transition-opacity duration-200"
        style={{
          opacity: highSpeedBoostGlow ? 1 : 0,
          boxShadow: 'inset 0 0 96px rgba(56, 189, 248, 0.3)',
        }}
      />

      {/* Top-Left Cluster: Position, Lap, Timer, Progress Hairline & Stunt Combo */}
      <div className="fixed top-5 left-6 flex flex-col gap-2.5">
        <div
          className="rounded-xl border border-white/14 overflow-hidden"
          style={{ backgroundColor: 'rgba(11, 15, 22, 0.84)' }}
        >
          <div className="flex items-end gap-5 px-4 py-2.5">
            {telemetry.totalRacers > 1 && (
              <div className="flex flex-col">
                <span className="hud-kicker text-[10px] font-semibold uppercase text-[#b8c1d0]">
                  Pos
                </span>
                <div className="flex items-baseline gap-0.5 leading-none mt-0.5">
                  <span className="font-display tabular-nums text-3xl font-extrabold text-[#f7f4ec]">
                    {telemetry.position}
                  </span>
                  <span className="font-display text-xs font-bold text-[#f59e0b]">
                    {ordinalSuffix(telemetry.position)}
                  </span>
                  <span className="text-xs font-semibold text-[#9aa4b5] ml-0.5">
                    /{telemetry.totalRacers}
                  </span>
                </div>
              </div>
            )}

            <div className="flex flex-col">
              <span className="hud-kicker text-[10px] font-semibold uppercase text-[#b8c1d0]">
                {telemetry.mode === 'free-roam' ? 'Roam' : 'Lap'}
              </span>
              <div className="flex items-baseline gap-1 leading-none mt-0.5">
                <span className="font-display tabular-nums text-3xl font-extrabold text-[#f7f4ec]">
                  {telemetry.lap}
                </span>
                {telemetry.mode !== 'free-roam' && (
                  <span className="text-xs font-bold text-[#9aa4b5]">/{telemetry.totalLaps}</span>
                )}
              </div>
            </div>

            <div className="flex flex-col pl-3 border-l border-white/10">
              <span className="hud-kicker text-[10px] font-semibold uppercase text-[#b8c1d0]">
                Time
              </span>
              <span className="tabular-mono text-base font-bold text-[#f7f4ec] leading-tight mt-0.5">
                {formatRaceTime(telemetry.currentLapTime)}
              </span>
              {telemetry.bestLapTime !== null && (
                <span className="tabular-mono text-[11px] font-semibold text-[#fbbf24]">
                  Best {formatRaceTime(telemetry.bestLapTime)}
                </span>
              )}
            </div>
          </div>
          {/* Live circuit completion hairline */}
          <div className="w-full h-[3px] bg-white/8">
            <div
              className="h-full origin-left bg-[#f59e0b]"
              style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, telemetry.lapProgress))})` }}
            />
          </div>
        </div>

        {/* Live Stunt Combo & Style Score Readout */}
        {(telemetry.isDrifting ||
          telemetry.airborne ||
          telemetry.totalStyleScore > 0 ||
          telemetry.comboMultiplier > 1) && (
          <div
            className="flex flex-col gap-1.5 self-start rounded-lg px-3.5 py-2 border border-white/12 min-w-[178px]"
            style={{ backgroundColor: 'rgba(11, 15, 22, 0.84)' }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-2">
                {telemetry.comboMultiplier > 1 && (
                  <span className="font-display text-sm font-extrabold text-[#34d399]">
                    ×{telemetry.comboMultiplier}
                  </span>
                )}
                {telemetry.airborne ? (
                  <span className="hud-kicker text-xs font-extrabold uppercase text-[#38bdf8]">
                    Airtime
                  </span>
                ) : telemetry.isDrifting && telemetry.activeDriftScore > 5 ? (
                  <span className="font-display tabular-nums text-base font-extrabold text-[#fbbf24]">
                    +{telemetry.activeDriftScore}
                  </span>
                ) : (
                  <span className="hud-kicker text-[10px] font-bold uppercase text-[#9aa4b5]">
                    Style
                  </span>
                )}
              </div>
              <span className="tabular-mono text-xs font-bold text-[#f7f4ec]">
                {telemetry.totalStyleScore.toLocaleString()} PTS
              </span>
            </div>
            {telemetry.comboTimer > 0 && (
              <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full origin-left bg-[#34d399]"
                  style={{
                    transform: `scaleX(${Math.max(0, Math.min(1, telemetry.comboTimer / 5))})`,
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Top-Center: 3-2-1 Race Launch Gantry Lights OR Transient Event Banner */}
      {telemetry.countdownDigit > 0 ? (
        <div
          className="fixed top-7 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 rounded-xl px-6 py-3.5 border border-white/16"
          style={{ backgroundColor: 'rgba(11, 15, 22, 0.9)' }}
        >
          <div className="flex items-center gap-3">
            {[3, 2, 1].map((light) => {
              const lit = telemetry.countdownDigit <= light;
              return (
                <div
                  key={light}
                  className="w-6 h-6 rounded-full border-2 border-white/25"
                  style={{
                    backgroundColor: lit ? '#ef4444' : '#1f2633',
                    boxShadow: lit ? '0 0 14px rgba(239,68,68,0.85)' : 'none',
                  }}
                />
              );
            })}
          </div>
          <div className="font-display text-2xl font-extrabold text-[#f7f4ec] leading-none">
            {telemetry.countdownDigit}
          </div>
          <div className="text-[11px] font-medium text-[#b8c1d0]">
            Hold W on GO for Perfect Launch
          </div>
        </div>
      ) : (
        (telemetry.wrongWay || telemetry.bannerText) && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
            {telemetry.wrongWay && (
              <div className="px-4 py-1.5 rounded bg-[#991b1b]/92 border border-[#fca5a5]/50 text-[#fef2f2] font-display font-bold text-sm tracking-widest uppercase">
                Wrong Way — Press T to Reset
              </div>
            )}
            {telemetry.bannerText && !telemetry.wrongWay && (
              <div
                className={`px-5 py-1.5 rounded border font-display font-bold text-base tracking-widest uppercase ${bannerBorder}`}
                style={{ backgroundColor: 'rgba(13, 18, 27, 0.9)' }}
              >
                {telemetry.bannerText}
              </div>
            )}
          </div>
        )
      )}

      {/* Top-Right Compact Utility Controls */}
      <div className="fixed top-5 right-6 pointer-events-auto flex items-center gap-2">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Cycle radio station (${radioName})`}
          title={`Radio: ${radioName}`}
          onClick={(e) => {
            e.currentTarget.blur();
            onCycleRadio();
          }}
          className="h-10 px-3 rounded-lg bg-[#11151f]/90 hover:bg-[#1e2536] border border-white/14 text-[#f4f1ea] flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-colors"
        >
          <span className="text-[#f59e0b]">FM</span>
          <span className="hidden md:inline">{radioName}</span>
        </button>

        <button
          type="button"
          tabIndex={-1}
          aria-label={`Cycle camera view (${cameraLabel})`}
          title={`Camera: ${cameraLabel} [C]`}
          onClick={(e) => {
            e.currentTarget.blur();
            onCycleCamera();
          }}
          className="h-10 px-3 rounded-lg bg-[#11151f]/90 hover:bg-[#1e2536] border border-white/14 text-[#f4f1ea] flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2">
            <path d="M4 8h3l2-2h6l2 2h3v10H4z" />
            <circle cx="12" cy="13" r="3" />
          </svg>
          <span className="hidden sm:inline">{cameraLabel}</span>
        </button>

        <button
          type="button"
          tabIndex={-1}
          aria-label="Reset car onto track"
          title="Reset to Track [T]"
          onClick={(e) => {
            e.currentTarget.blur();
            onResetToTrack();
          }}
          className="h-10 px-2.5 rounded-lg bg-[#11151f]/90 hover:bg-[#1e2536] border border-white/14 text-[#f4f1ea] flex items-center justify-center text-xs font-bold cursor-pointer transition-colors"
        >
          T
        </button>

        <button
          type="button"
          tabIndex={-1}
          aria-label={muted ? 'Unmute audio' : 'Mute audio'}
          title="Mute / Unmute [M]"
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleMute();
          }}
          className="w-10 h-10 rounded-lg bg-[#11151f]/90 hover:bg-[#1e2536] border border-white/14 text-[#f4f1ea] flex items-center justify-center cursor-pointer transition-colors"
        >
          {muted ? (
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2">
              <path d="M11 5L6 9H3v6h3l5 4V5z" />
              <path d="M22 9l-6 6M16 9l6 6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2">
              <path d="M11 5L6 9H3v6h3l5 4V5z" />
              <path d="M15.5 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" />
            </svg>
          )}
        </button>

        <button
          type="button"
          tabIndex={-1}
          aria-label="Restart race"
          title="Restart [R]"
          onClick={(e) => {
            e.currentTarget.blur();
            onRestart();
          }}
          className="w-10 h-10 rounded-lg bg-[#11151f]/90 hover:bg-[#1e2536] border border-white/14 text-[#f4f1ea] flex items-center justify-center cursor-pointer transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2">
            <path d="M3 12a9 9 0 103-6.7L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>

        <button
          type="button"
          tabIndex={-1}
          aria-label="Pause game"
          title="Pause [Esc]"
          onClick={(e) => {
            e.currentTarget.blur();
            onPause();
          }}
          className="w-10 h-10 rounded-lg bg-[#11151f]/90 hover:bg-[#1e2536] border border-white/14 text-[#f4f1ea] flex items-center justify-center cursor-pointer transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        </button>
      </div>

      {/* Bottom-Left: Real Projected Track Minimap with Directional Player Arrow */}
      {minimapData && (
        <div
          className="fixed bottom-5 left-6 rounded-xl border border-white/14 p-1.5"
          style={{ backgroundColor: 'rgba(11, 15, 22, 0.84)' }}
          aria-label="Track minimap"
        >
          <svg
            width={minimapData.size}
            height={minimapData.size}
            viewBox={`0 0 ${minimapData.size} ${minimapData.size}`}
          >
            <path
              d={minimapData.pathD}
              fill="none"
              stroke="rgba(16,20,29,0.92)"
              strokeWidth="7.5"
              strokeLinejoin="round"
            />
            <path
              d={minimapData.pathD}
              fill="none"
              stroke="rgba(232,226,214,0.58)"
              strokeWidth="3.2"
              strokeLinejoin="round"
            />
            {/* Start/finish line marker */}
            <circle
              cx={minimapData.startPt.x}
              cy={minimapData.startPt.y}
              r={3.2}
              fill="#f8f5ef"
              stroke="#0c1018"
              strokeWidth="1.2"
            />
            {minimapData.featurePins.map((f) => (
              <circle
                key={f.id}
                cx={f.x}
                cy={f.y}
                r={2.1}
                fill={
                  f.type === 'boost-pad'
                    ? '#38bdf8'
                    : f.type === 'jump-ramp'
                      ? '#fbbf24'
                      : '#34d399'
                }
              />
            ))}
            {telemetry.minimapRacers.map((r) => {
              const pt = minimapData.toSvg(r.x, r.z);
              if (r.isPlayer) {
                const deg = ((-r.heading * 180) / Math.PI + 180).toFixed(1);
                return (
                  <g
                    key={r.id}
                    transform={`translate(${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}) rotate(${deg})`}
                  >
                    <polygon
                      points="0,-6.5 4.6,4.5 0,2.2 -4.6,4.5"
                      fill="#f59e0b"
                      stroke="#090c12"
                      strokeWidth="1.3"
                      strokeLinejoin="round"
                    />
                  </g>
                );
              }
              return (
                <circle
                  key={r.id}
                  cx={pt.x}
                  cy={pt.y}
                  r={3.3}
                  fill={r.colorHex}
                  stroke="#0b0e14"
                  strokeWidth="1.4"
                />
              );
            })}
          </svg>
        </div>
      )}

      {/* Bottom-Right: Calibrated Motorsport Tachometer, Shift Lights & Boost Gauge */}
      <div className="fixed bottom-5 right-6 flex flex-col items-end gap-2">
        {telemetry.slipstream > 0.2 && (
          <span
            className="hud-kicker text-[11px] font-bold uppercase text-[#38bdf8] px-2.5 py-0.5 rounded border border-[#38bdf8]/35"
            style={{ backgroundColor: 'rgba(11, 15, 22, 0.86)' }}
          >
            Slipstream Draft
          </span>
        )}

        <div className="flex items-center gap-3.5">
          {/* Overdrive Boost Meter with trailing ghost drain */}
          <div
            className="flex flex-col items-end gap-1.5 w-38 rounded-xl px-3.5 py-2.5 border border-white/14"
            style={{ backgroundColor: 'rgba(11, 15, 22, 0.84)' }}
          >
            <div className="flex items-center justify-between w-full">
              <span className="hud-kicker text-[10px] font-bold uppercase text-[#cbd2de]">
                Boost [Shift]
              </span>
              <span className="tabular-mono text-xs font-bold text-[#fbbf24]">
                {telemetry.boostEnergy}%
              </span>
            </div>
            <div className="relative w-full h-2.5 rounded-full bg-[#090c11] border border-white/15 overflow-hidden">
              <div
                className="absolute inset-0 h-full origin-left bg-white/35 transition-transform duration-200"
                style={{
                  transform: `scaleX(${Math.max(0, Math.min(1, ghostBoost / 100))})`,
                }}
              />
              <div
                className="relative h-full transition-transform duration-75 origin-left"
                style={{
                  transform: `scaleX(${Math.max(0, Math.min(1, telemetry.boostEnergy / 100))})`,
                  backgroundColor: telemetry.isBoosting ? '#38bdf8' : '#f59e0b',
                }}
              />
            </div>
          </div>

          {/* Calibrated Motorsport Tachometer with Redline & 5-LED Shift Strip */}
          <div className="relative w-[120px] h-[120px] flex items-center justify-center">
            <svg viewBox="0 0 116 116" className="w-[120px] h-[120px]">
              <circle cx="58" cy="58" r="51" fill="rgba(11,15,22,0.86)" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
              <g transform="rotate(155 58 58)">
                {/* Background track arc */}
                <circle
                  cx="58"
                  cy="58"
                  r={arcRadius}
                  fill="none"
                  stroke="rgba(255,255,255,0.13)"
                  strokeWidth="7"
                  strokeDasharray={`${maxSweep} ${arcCircumference}`}
                  strokeLinecap="round"
                />
                {/* Redline danger zone marker */}
                <circle
                  cx="58"
                  cy="58"
                  r={arcRadius}
                  fill="none"
                  stroke="rgba(239,68,68,0.42)"
                  strokeWidth="7"
                  strokeDasharray={`${redlineSweep} ${arcCircumference}`}
                  strokeDashoffset={redlineOffset}
                  strokeLinecap="round"
                />
                {/* Live RPM sweep */}
                <circle
                  cx="58"
                  cy="58"
                  r={arcRadius}
                  fill="none"
                  stroke={telemetry.isBoosting ? '#38bdf8' : rpmClamped > 0.84 ? '#ef4444' : '#f59e0b'}
                  strokeWidth="7"
                  strokeDasharray={`${maxSweep} ${arcCircumference}`}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                />
              </g>
              {/* Calibrated radial tick marks */}
              {TACH_TICKS.map((frac) => {
                const deg = 155 + frac * (360 * 0.64);
                const rad = (deg * Math.PI) / 180;
                const x1 = 58 + Math.cos(rad) * 38;
                const y1 = 58 + Math.sin(rad) * 38;
                const x2 = 58 + Math.cos(rad) * 41.5;
                const y2 = 58 + Math.sin(rad) * 41.5;
                return (
                  <line
                    key={frac}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={frac >= 0.84 ? '#f87171' : 'rgba(255,255,255,0.45)'}
                    strokeWidth="1.4"
                  />
                );
              })}
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center pt-1.5">
              {/* 5-LED RPM Shift-Light Strip */}
              <div className="flex items-center gap-1 mb-0.5" aria-hidden="true">
                {[0.55, 0.66, 0.76, 0.85, 0.93].map((thresh, i) => {
                  const lit = rpmClamped >= thresh;
                  const col = i < 2 ? '#34d399' : i < 4 ? '#f59e0b' : '#ef4444';
                  return (
                    <span
                      key={thresh}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: lit ? col : 'rgba(255,255,255,0.16)' }}
                    />
                  );
                })}
              </div>
              <span
                className="hud-num text-3xl font-extrabold text-[#f7f4ec] leading-none"
                data-testid="speed-readout"
              >
                {telemetry.speedKmh}
              </span>
              <span className="hud-kicker text-[9px] font-semibold uppercase text-[#c4cbd6] mt-0.5">
                KM/H
              </span>
              <span className="tabular-mono text-xs font-bold text-[#f59e0b] mt-0.5">
                {telemetry.gear === 0 ? 'R' : `G${telemetry.gear}`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Compact Mobile Touch Controls */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 sm:hidden pointer-events-auto flex items-center gap-2">
        <button
          type="button"
          aria-label="Steer left"
          onPointerDown={() => onTouchChange({ left: true })}
          onPointerUp={() => onTouchChange({ left: false })}
          onPointerLeave={() => onTouchChange({ left: false })}
          className="w-12 h-12 rounded-lg bg-[#141923]/92 border border-white/20 text-white font-bold text-sm"
        >
          L
        </button>
        <button
          type="button"
          aria-label="Steer right"
          onPointerDown={() => onTouchChange({ right: true })}
          onPointerUp={() => onTouchChange({ right: false })}
          onPointerLeave={() => onTouchChange({ right: false })}
          className="w-12 h-12 rounded-lg bg-[#141923]/92 border border-white/20 text-white font-bold text-sm"
        >
          R
        </button>
        <button
          type="button"
          aria-label="Accelerate"
          onPointerDown={() => onTouchChange({ throttle: true })}
          onPointerUp={() => onTouchChange({ throttle: false })}
          onPointerLeave={() => onTouchChange({ throttle: false })}
          className="px-4 h-12 rounded-lg bg-[#f59e0b] text-[#11151d] font-bold text-xs"
        >
          Gas
        </button>
        <button
          type="button"
          aria-label="Drift"
          onPointerDown={() => onTouchChange({ drift: true })}
          onPointerUp={() => onTouchChange({ drift: false })}
          onPointerLeave={() => onTouchChange({ drift: false })}
          className="px-3 h-12 rounded-lg bg-[#141923]/92 border border-white/20 text-[#fbbf24] font-bold text-xs"
        >
          Drift
        </button>
        <button
          type="button"
          aria-label="Boost"
          onPointerDown={() => onTouchChange({ boost: true })}
          onPointerUp={() => onTouchChange({ boost: false })}
          onPointerLeave={() => onTouchChange({ boost: false })}
          className="px-3 h-12 rounded-lg bg-[#141923]/92 border border-[#38bdf8]/40 text-[#38bdf8] font-bold text-xs"
        >
          NOS
        </button>
      </div>
    </div>
  );
}
