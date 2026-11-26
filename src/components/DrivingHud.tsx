import { useMemo } from 'react';
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
  const minimapData = useMemo(() => {
    if (!track) return null;
    const pad = 16;
    const size = 128;
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

    const featurePins = track.features.map((f) => ({
      id: f.id,
      type: f.type,
      ...toSvg(f.pos.x, f.pos.z),
    }));

    return { pathD: pts.join(' '), toSvg, size, featurePins };
  }, [track]);

  const rpmClamped = Math.max(0, Math.min(1, telemetry.rpm));
  const arcRadius = 46;
  const arcCircumference = 2 * Math.PI * arcRadius;
  const maxSweep = arcCircumference * 0.62;
  const dashOffset = maxSweep * (1 - rpmClamped);

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
      {/* Subtle compositor-only peripheral boost speed-vignette (zero backdrop-filter!) */}
      <div
        className="fixed inset-0 pointer-events-none transition-opacity duration-200"
        style={{
          opacity: highSpeedBoostGlow ? 1 : 0,
          boxShadow: 'inset 0 0 95px rgba(56, 189, 248, 0.28)',
        }}
      />

      {/* Top-Left Cluster: Position, Lap, Timer, Style Score & Combo Multiplier */}
      <div className="fixed top-5 left-6 flex flex-col gap-2.5">
        <div
          className="flex items-end gap-5 rounded-xl px-4 py-2.5 border border-white/12"
          style={{ backgroundColor: 'rgba(13, 17, 24, 0.8)' }}
        >
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

        {/* Live Stunt Combo & Style Score Readout */}
        {(telemetry.isDrifting ||
          telemetry.airborne ||
          telemetry.totalStyleScore > 0 ||
          telemetry.comboMultiplier > 1) && (
          <div
            className="flex flex-col gap-1.5 self-start rounded-lg px-3.5 py-2 border border-white/12 min-w-[172px]"
            style={{ backgroundColor: 'rgba(13, 17, 24, 0.82)' }}
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
          className="fixed top-7 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 rounded-xl px-6 py-3.5 border border-white/15"
          style={{ backgroundColor: 'rgba(12, 16, 24, 0.88)' }}
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
                style={{ backgroundColor: 'rgba(15, 20, 29, 0.88)' }}
              >
                {telemetry.bannerText}
              </div>
            )}
          </div>
        )
      )}

      {/* Top-Right Compact Utility Buttons */}
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
          className="h-10 px-3 rounded-lg bg-[#121620]/88 hover:bg-[#1e2534] border border-white/15 text-[#f4f1ea] flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-colors"
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
          className="h-10 px-3 rounded-lg bg-[#121620]/88 hover:bg-[#1e2534] border border-white/15 text-[#f4f1ea] flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-colors"
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
          className="h-10 px-2.5 rounded-lg bg-[#121620]/88 hover:bg-[#1e2534] border border-white/15 text-[#f4f1ea] flex items-center justify-center text-xs font-bold cursor-pointer transition-colors"
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
          className="w-10 h-10 rounded-lg bg-[#121620]/88 hover:bg-[#1e2534] border border-white/15 text-[#f4f1ea] flex items-center justify-center cursor-pointer transition-colors"
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
          className="w-10 h-10 rounded-lg bg-[#121620]/88 hover:bg-[#1e2534] border border-white/15 text-[#f4f1ea] flex items-center justify-center cursor-pointer transition-colors"
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
          className="w-10 h-10 rounded-lg bg-[#121620]/88 hover:bg-[#1e2534] border border-white/15 text-[#f4f1ea] flex items-center justify-center cursor-pointer transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        </button>
      </div>

      {/* Bottom-Left: Real Projected Track Minimap with Feature Markers */}
      {minimapData && (
        <div
          className="fixed bottom-5 left-6 rounded-xl border border-white/12 p-1.5"
          style={{ backgroundColor: 'rgba(13, 17, 24, 0.82)' }}
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
              stroke="rgba(16,20,29,0.9)"
              strokeWidth="7"
              strokeLinejoin="round"
            />
            <path
              d={minimapData.pathD}
              fill="none"
              stroke="rgba(232,226,214,0.58)"
              strokeWidth="3.2"
              strokeLinejoin="round"
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
              return (
                <circle
                  key={r.id}
                  cx={pt.x}
                  cy={pt.y}
                  r={r.isPlayer ? 4.8 : 3.4}
                  fill={r.isPlayer ? '#f59e0b' : r.colorHex}
                  stroke="#0b0e14"
                  strokeWidth="1.5"
                />
              );
            })}
          </svg>
        </div>
      )}

      {/* Bottom-Right: Motorsport Speedometer, Gear & Solar Overdrive Boost Gauge */}
      <div className="fixed bottom-5 right-6 flex flex-col items-end gap-2">
        {telemetry.slipstream > 0.2 && (
          <span
            className="hud-kicker text-[11px] font-bold uppercase text-[#38bdf8] px-2.5 py-0.5 rounded"
            style={{ backgroundColor: 'rgba(13, 17, 24, 0.82)' }}
          >
            Slipstream Draft
          </span>
        )}

        <div className="flex items-center gap-3.5">
          <div
            className="flex flex-col items-end gap-1.5 w-36 rounded-xl px-3 py-2 border border-white/12"
            style={{ backgroundColor: 'rgba(13, 17, 24, 0.82)' }}
          >
            <div className="flex items-center justify-between w-full">
              <span className="hud-kicker text-[10px] font-bold uppercase text-[#cbd2de]">
                Boost [Shift]
              </span>
              <span className="tabular-mono text-xs font-bold text-[#fbbf24]">
                {telemetry.boostEnergy}%
              </span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-[#090c11] border border-white/15 overflow-hidden">
              <div
                className="h-full transition-transform duration-75 origin-left"
                style={{
                  transform: `scaleX(${Math.max(0, Math.min(1, telemetry.boostEnergy / 100))})`,
                  backgroundColor: telemetry.isBoosting ? '#38bdf8' : '#f59e0b',
                }}
              />
            </div>
          </div>

          <div className="relative w-28 h-28 flex items-center justify-center">
            <svg viewBox="0 0 112 112" className="w-28 h-28 -rotate-[202deg]">
              <circle
                cx="56"
                cy="56"
                r={arcRadius}
                fill="rgba(12,16,23,0.82)"
                stroke="rgba(255,255,255,0.14)"
                strokeWidth="7"
                strokeDasharray={`${maxSweep} ${arcCircumference}`}
                strokeLinecap="round"
              />
              <circle
                cx="56"
                cy="56"
                r={arcRadius}
                fill="none"
                stroke={telemetry.isBoosting ? '#38bdf8' : rpmClamped > 0.86 ? '#ef4444' : '#f59e0b'}
                strokeWidth="7"
                strokeDasharray={`${maxSweep} ${arcCircumference}`}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
              <span
                className="hud-num text-3xl font-extrabold text-[#f7f4ec] leading-none"
                data-testid="speed-readout"
              >
                {telemetry.speedKmh}
              </span>
              <span className="hud-kicker text-[10px] font-semibold uppercase text-[#c4cbd6] mt-0.5">
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
          className="w-12 h-12 rounded-lg bg-[#141923]/90 border border-white/20 text-white font-bold text-sm"
        >
          L
        </button>
        <button
          type="button"
          aria-label="Steer right"
          onPointerDown={() => onTouchChange({ right: true })}
          onPointerUp={() => onTouchChange({ right: false })}
          onPointerLeave={() => onTouchChange({ right: false })}
          className="w-12 h-12 rounded-lg bg-[#141923]/90 border border-white/20 text-white font-bold text-sm"
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
          className="px-3 h-12 rounded-lg bg-[#141923]/90 border border-white/20 text-[#fbbf24] font-bold text-xs"
        >
          Drift
        </button>
      </div>
    </div>
  );
}
