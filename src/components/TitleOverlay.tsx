import { useMemo } from 'react';
import { COURSE_LIST, RADIO_STATIONS, TUNING_SPECS } from '../game/courses';
import type {
  CourseId,
  CourseTheme,
  GameMode,
  LiveryConfig,
  RadioStationId,
  TimeOfDay,
} from '../game/types';

interface TitleOverlayProps {
  selectedCourse: CourseId;
  selectedMode: GameMode;
  timeOfDay: TimeOfDay;
  trackLengthMeters: number | null;
  liveryConfig: LiveryConfig;
  radioStation: RadioStationId;
  onSelectCourse: (id: CourseId) => void;
  onSelectMode: (mode: GameMode) => void;
  onSelectTimeOfDay: (tod: TimeOfDay) => void;
  onStart: () => void;
  onOpenGarage: () => void;
}

function buildMiniOutlinePath(course: CourseTheme): string {
  const pts = course.controlPoints;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const span = Math.max(1, maxX - minX, maxZ - minZ);
  const pad = 4;
  const inner = 32 - pad * 2;
  const ox = (span - (maxX - minX)) * 0.5;
  const oz = (span - (maxZ - minZ)) * 0.5;

  return (
    pts
      .map((p, i) => {
        const sx = pad + ((p.x - minX + ox) / span) * inner;
        const sy = pad + ((p.z - minZ + oz) / span) * inner;
        return `${i === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`;
      })
      .join(' ') + ' Z'
  );
}

const TIME_OPTIONS: Array<{ id: TimeOfDay; label: string }> = [
  { id: 'golden', label: 'Golden' },
  { id: 'noon', label: 'Noon' },
  { id: 'twilight', label: 'Twilight' },
];

export function TitleOverlay({
  selectedCourse,
  selectedMode,
  timeOfDay,
  trackLengthMeters,
  liveryConfig,
  radioStation,
  onSelectCourse,
  onSelectMode,
  onSelectTimeOfDay,
  onStart,
  onOpenGarage,
}: TitleOverlayProps) {
  const coursePaths = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of COURSE_LIST) {
      map[c.id] = buildMiniOutlinePath(c);
    }
    return map;
  }, []);

  const currentCourse = COURSE_LIST.find((c) => c.id === selectedCourse) ?? COURSE_LIST[0];
  const tuningLabel = TUNING_SPECS[liveryConfig.tuning].label;
  const radioName = RADIO_STATIONS.find((s) => s.id === radioStation)?.name ?? 'Solstice FM';
  const lengthLabel = trackLengthMeters ? `${(trackLengthMeters / 1000).toFixed(2)} km` : '2.20 km';

  return (
    <div
      className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-5 sm:p-8 lg:p-10"
      style={{
        background:
          'linear-gradient(96deg, rgba(9,12,19,0.92) 0%, rgba(9,12,19,0.72) 34%, rgba(9,12,19,0.14) 62%, rgba(9,12,19,0) 100%)',
      }}
    >
      {/* Left-third editorial lockup & race configurator */}
      <div className="pointer-events-auto max-w-[448px] flex flex-col gap-5 my-auto">
        {/* Bespoke inline SVG Title Lockup */}
        <div>
          <svg
            viewBox="0 0 380 86"
            className="w-full max-w-[332px] h-auto"
            role="img"
            aria-label="Solstice Circuit"
          >
            <defs>
              <clipPath id="sunClip">
                <rect x="0" y="0" width="64" height="44" />
              </clipPath>
            </defs>
            <g transform="translate(2, 9)">
              <circle cx="30" cy="40" r="22" fill={currentCourse.accentHex} clipPath="url(#sunClip)" />
              <path d="M4 44 L58 44" stroke="#f7f4ec" strokeWidth="2.4" />
              <path d="M12 52 L50 52" stroke={currentCourse.accentHex} strokeWidth="2" opacity="0.88" />
              <path d="M22 60 L40 60" stroke="#f7f4ec" strokeWidth="1.5" opacity="0.55" />
            </g>
            <text
              x="76"
              y="43"
              fill="#f8f5ef"
              fontFamily="Oxanium, sans-serif"
              fontWeight="800"
              fontSize="37"
              letterSpacing="0.06em"
            >
              SOLSTICE
            </text>
            <text
              x="78"
              y="70"
              fill={currentCourse.accentHex}
              fontFamily="Oxanium, sans-serif"
              fontWeight="600"
              fontSize="19"
              letterSpacing="0.3em"
            >
              CIRCUIT
            </text>
          </svg>
        </div>

        {/* 4-World Grand Circuit Selector */}
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Select course">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#d5dce8] tracking-wide">Circuit</span>
            <span className="text-[#a4afc2] tabular-mono">
              {currentCourse.region} · {lengthLabel}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {COURSE_LIST.map((course) => {
              const active = course.id === selectedCourse;
              return (
                <button
                  key={course.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onSelectCourse(course.id)}
                  className={`text-left px-3.5 py-2.5 rounded-lg border transition-colors duration-150 cursor-pointer flex items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f59e0b] ${
                    active
                      ? 'bg-[#1a2232]/95 text-[#f8f6f0]'
                      : 'bg-[#10141d]/85 border-white/12 text-[#cfd5df] hover:bg-[#19202e]/92 hover:border-white/25'
                  }`}
                  style={active ? { borderColor: course.accentHex } : undefined}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-xs sm:text-sm text-[#f8f6f0] truncate">
                      {course.name}
                    </div>
                    <div className="text-[11px] text-[#9aa4b5] mt-0.5 tabular-mono">
                      {course.difficulty} · {course.totalLaps} Laps
                    </div>
                  </div>
                  <svg
                    viewBox="0 0 32 32"
                    className="w-8 h-8 shrink-0 opacity-90"
                    aria-hidden="true"
                  >
                    <path
                      d={coursePaths[course.id]}
                      fill="none"
                      stroke={active ? course.accentHex : '#848fa3'}
                      strokeWidth="2.4"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-[#bcc6d6] leading-relaxed pt-0.5">{currentCourse.tagline}</p>
        </div>

        {/* Mode & Live Atmosphere Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-[#c9d2e0]">Mode</span>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#0f131b]/92 border border-white/12">
              {(
                [
                  { id: 'grand-prix', label: 'GP' },
                  { id: 'time-trial', label: 'Trial' },
                  { id: 'free-roam', label: 'Roam' },
                ] as Array<{ id: GameMode; label: string }>
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onSelectMode(m.id)}
                  aria-pressed={selectedMode === m.id}
                  className={`py-1.5 px-2 rounded-md text-xs font-semibold transition-colors duration-150 whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f59e0b] ${
                    selectedMode === m.id
                      ? 'bg-[#f6f3ec] text-[#11151d]'
                      : 'text-[#c2c8d4] hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-[#c9d2e0]">Atmosphere</span>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#0f131b]/92 border border-white/12">
              {TIME_OPTIONS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectTimeOfDay(t.id)}
                  aria-pressed={timeOfDay === t.id}
                  className={`py-1.5 px-2 rounded-md text-xs font-semibold transition-colors duration-150 whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f59e0b] ${
                    timeOfDay === t.id
                      ? 'bg-[#f6f3ec] text-[#11151d]'
                      : 'text-[#c2c8d4] hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Quiet inline active car build summary (zero pill boxes) */}
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-white/10 text-xs text-[#a9b4c7]">
          <div className="flex items-center gap-2 min-w-0 truncate">
            <span
              className="w-3 h-3 rounded-sm border border-white/30 shrink-0"
              style={{ backgroundColor: liveryConfig.bodyColor }}
              aria-hidden="true"
            />
            <span className="text-[#ece9e0] font-semibold tabular-mono">
              #{liveryConfig.racingNumber}
            </span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{tuningLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{radioName}</span>
          </div>
        </div>

        {/* Primary & Secondary Actions */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-start="true"
            onClick={onStart}
            className="flex-1 py-3.5 px-6 rounded-lg bg-[#f59e0b] hover:bg-[#fbbf24] text-[#11141a] font-bold text-sm tracking-wide transition-transform duration-150 active:scale-[0.98] cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {selectedMode === 'free-roam' ? 'Start Free Roam' : 'Start Race'}
          </button>
          <button
            type="button"
            onClick={onOpenGarage}
            className="py-3.5 px-4 rounded-lg bg-[#171d29]/94 hover:bg-[#222a3a] border border-white/15 text-[#f2f0ea] font-semibold text-sm transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f59e0b]"
          >
            Garage &amp; Radio
          </button>
        </div>
      </div>

      {/* Single flat borderless inline control hint line in bottom safe margin */}
      <div className="text-xs text-[#cfd5df]/85 tracking-wide">
        WASD / Arrows Drive · Space Drift · Shift Boost · C Camera · T Reset · M Mute · Esc Pause
      </div>
    </div>
  );
}
