import { useMemo, useState } from 'react';
import { COURSE_LIST, COURSES, TUNING_SPECS } from '../game/courses';
import { buildTrack } from '../game/track';
import type {
  CourseId,
  CourseLengthCategory,
  CourseTheme,
  GameMode,
  LiveryConfig,
  TimeOfDay,
} from '../game/types';

interface TitleOverlayProps {
  selectedCourse: CourseId;
  selectedMode: GameMode;
  timeOfDay: TimeOfDay;
  trackLengthMeters: number | null;
  liveryConfig: LiveryConfig;
  onSelectCourse: (courseId: CourseId) => void;
  onSelectMode: (mode: GameMode) => void;
  onSelectTimeOfDay: (tod: TimeOfDay) => void;
  onStart: () => void;
  onOpenGarage: () => void;
}

const MODE_OPTIONS: Array<{ id: GameMode; label: string }> = [
  { id: 'grand-prix', label: 'Grand Prix (12)' },
  { id: 'time-trial', label: 'Time Trial' },
  { id: 'free-roam', label: 'Free Roam' },
];

const TIME_OPTIONS: Array<{ id: TimeOfDay; label: string }> = [
  { id: 'golden', label: 'Golden' },
  { id: 'noon', label: 'Noon' },
  { id: 'twilight', label: 'Twilight' },
];

const LENGTH_FILTERS: Array<{ id: 'All' | CourseLengthCategory; label: string }> = [
  { id: 'All', label: 'All (8)' },
  { id: 'Short', label: 'Short' },
  { id: 'Medium', label: 'Medium' },
  { id: 'Long', label: 'Long' },
];

function computeExactLengthKm(course: CourseTheme): string {
  return (buildTrack(course, 96).totalLength / 1000).toFixed(2);
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
  const w = 44;
  const h = 30;
  const scale = Math.min((w - 8) / Math.max(1, maxX - minX), (h - 6) / Math.max(1, maxZ - minZ));
  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  if (!Number.isFinite(span)) return '';
  return (
    pts
      .map((p, i) => {
        const sx = (w * 0.5 + (p.x - cx) * scale).toFixed(1);
        const sy = (h * 0.5 - (p.z - cz) * scale).toFixed(1);
        return `${i === 0 ? 'M' : 'L'}${sx},${sy}`;
      })
      .join(' ') + ' Z'
  );
}

export function TitleOverlay({
  selectedCourse,
  selectedMode,
  timeOfDay,
  trackLengthMeters,
  liveryConfig,
  onSelectCourse,
  onSelectMode,
  onSelectTimeOfDay,
  onStart,
  onOpenGarage,
}: TitleOverlayProps) {
  const [lengthFilter, setLengthFilter] = useState<'All' | CourseLengthCategory>('All');

  const activeCourse = COURSES[selectedCourse];
  const tuningSpec = TUNING_SPECS[liveryConfig.tuning];

  const courseMeta = useMemo(
    () =>
      COURSE_LIST.map((c) => ({
        course: c,
        path: buildMiniOutlinePath(c),
        km: computeExactLengthKm(c),
      })),
    [],
  );

  const visibleCourses =
    lengthFilter === 'All'
      ? courseMeta
      : courseMeta.filter((entry) => entry.course.lengthCategory === lengthFilter);

  const activeKmLabel =
    trackLengthMeters != null
      ? `${(trackLengthMeters / 1000).toFixed(2)} km`
      : `${computeExactLengthKm(activeCourse)} km`;

  return (
    <div
      className="fixed inset-0 z-10 flex flex-col justify-between p-6 sm:p-9 lg:p-11 pointer-events-none select-none"
      style={{
        background:
          'linear-gradient(96deg, rgba(8, 11, 16, 0.90) 0%, rgba(8, 11, 16, 0.70) 34%, rgba(8, 11, 16, 0.16) 60%, rgba(8, 11, 16, 0.0) 100%)',
      }}
    >
      {/* Left-aligned editorial column leaving the 12-car 3D starting grid clear on the right */}
      <div className="w-full max-w-[440px] flex flex-col gap-5 pointer-events-auto my-auto">
        {/* Identity Wordmark */}
        <header className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <svg width="28" height="28" viewBox="0 0 36 36" aria-hidden="true" className="shrink-0">
              <circle cx="18" cy="18" r="15" fill="none" stroke="#f59e0b" strokeWidth="2.4" />
              <path
                d="M9 22 C13 13, 21 12, 27 15"
                fill="none"
                stroke="#f5f3ee"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <path
                d="M11 26 C16 19, 23 18, 28 21"
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2.1"
                strokeLinecap="round"
              />
            </svg>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-[#f7f4ec] leading-none">
              SOLSTICE CIRCUIT
            </h1>
          </div>
          <p className="text-xs text-[#b8c1cf] tracking-wide">
            {activeCourse.region} · {activeKmLabel} · {activeCourse.difficulty}
          </p>
        </header>

        {/* Circuit Selector (clean hairline editorial list with length filter) */}
        <section aria-label="Select circuit" className="flex flex-col gap-2">
          <div className="flex items-center justify-between border-b border-white/12 pb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9ea8b8]">
              Circuits
            </span>
            <div className="flex items-center gap-3">
              {LENGTH_FILTERS.map((f) => {
                const active = lengthFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setLengthFilter(f.id)}
                    className={`text-[11px] font-semibold transition-colors cursor-pointer pb-0.5 border-b ${
                      active
                        ? 'text-[#f7f4ec] border-[#f59e0b]'
                        : 'text-[#8c96a8] border-transparent hover:text-[#d5dce8]'
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            className="max-h-[264px] overflow-y-auto studio-scroll divide-y divide-white/8 pr-1"
            role="radiogroup"
            aria-label="Circuit list"
          >
            {visibleCourses.map(({ course, path, km }) => {
              const active = course.id === selectedCourse;
              return (
                <button
                  key={course.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onSelectCourse(course.id)}
                  className={`w-full h-[52px] flex items-center justify-between gap-3 px-2.5 text-left transition-colors cursor-pointer border-l-2 ${
                    active
                      ? 'bg-[#f59e0b]/12 border-[#f59e0b]'
                      : 'bg-transparent border-transparent hover:bg-white/5'
                  }`}
                >
                  <div className="min-w-0">
                    <div
                      className={`font-display text-sm font-bold truncate ${
                        active ? 'text-[#f7f4ec]' : 'text-[#d3dae6]'
                      }`}
                    >
                      {course.name}
                    </div>
                    <div className="text-[11px] text-[#95a0b2] mt-0.5 tabular-mono">
                      {km} km · {course.totalLaps} laps · {course.difficulty}
                    </div>
                  </div>
                  <svg
                    width="44"
                    height="30"
                    viewBox="0 0 44 30"
                    className="shrink-0"
                    aria-hidden="true"
                  >
                    <path
                      d={path}
                      fill="none"
                      stroke={active ? course.accentHex : 'rgba(220,228,240,0.34)'}
                      strokeWidth={active ? 2.2 : 1.5}
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              );
            })}
          </div>
        </section>

        {/* Clean Unboxed Session & Lighting Controls */}
        <section className="flex flex-col gap-3 pt-1">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9ea8b8]">
              Event
            </span>
            <div className="flex items-center gap-4" role="radiogroup" aria-label="Race mode">
              {MODE_OPTIONS.map((m) => {
                const active = selectedMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onSelectMode(m.id)}
                    className={`text-xs font-semibold pb-0.5 border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'text-[#f7f4ec] border-[#f59e0b]'
                        : 'text-[#8e98aa] border-transparent hover:text-[#d8dee9]'
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9ea8b8]">
              Time
            </span>
            <div className="flex items-center gap-4" role="radiogroup" aria-label="Time of day">
              {TIME_OPTIONS.map((t) => {
                const active = timeOfDay === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onSelectTimeOfDay(t.id)}
                    className={`text-xs font-semibold pb-0.5 border-b-2 transition-colors cursor-pointer ${
                      active
                        ? 'text-[#f7f4ec] border-[#f59e0b]'
                        : 'text-[#8e98aa] border-transparent hover:text-[#d8dee9]'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Clear Primary Action + Quiet Secondary Garage Trigger */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            data-start="true"
            onClick={onStart}
            className="flex-1 py-3.5 px-6 rounded-md bg-[#f59e0b] hover:bg-[#fbbf24] active:bg-[#d97706] text-[#11151d] font-display font-extrabold text-base tracking-wide transition-colors cursor-pointer shadow-lg shadow-black/40 whitespace-nowrap"
          >
            {selectedMode === 'free-roam' ? 'Drive Circuit' : 'Start Race'}
          </button>

          <button
            type="button"
            onClick={onOpenGarage}
            className="py-3.5 px-4 rounded-md bg-[#111622]/85 hover:bg-[#1a2233] border border-white/15 text-[#f2efe8] text-xs font-semibold transition-colors cursor-pointer flex items-center gap-2.5 whitespace-nowrap"
          >
            <span
              className="w-2.5 h-2.5 rounded-full border border-white/30 shrink-0"
              style={{ backgroundColor: liveryConfig.bodyColor }}
            />
            <span>
              Garage · #{liveryConfig.racingNumber} {tuningSpec.label}
            </span>
          </button>
        </div>
      </div>

      {/* Subtle single-line driving hint */}
      <footer className="text-[11px] text-[#98a2b3] tracking-wide pointer-events-none">
        WASD / Arrows Drive · Space Drift · Shift Overdrive · C Camera · T Reset · Esc Pause
      </footer>
    </div>
  );
}
