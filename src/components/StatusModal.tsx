import { RADIO_STATIONS } from '../game/courses';
import type {
  GameMode,
  RadioStationId,
  RunSnapshot,
  StandingsEntry,
  TimeOfDay,
} from '../game/types';
import { formatRaceTime } from './DrivingHud';

interface PauseModalProps {
  courseName: string;
  mode: GameMode;
  timeOfDay: TimeOfDay;
  radioStation: RadioStationId;
  lap: number;
  totalLaps: number;
  elapsedTime: number;
  standingsTable: StandingsEntry[];
  onSelectTimeOfDay: (tod: TimeOfDay) => void;
  onSelectRadio: (station: RadioStationId) => void;
  onResetToTrack: () => void;
  onResume: () => void;
  onRestart: () => void;
  onOpenGarage: () => void;
  onTitle: () => void;
}

const TIME_OPTIONS: Array<{ id: TimeOfDay; label: string }> = [
  { id: 'golden', label: 'Golden' },
  { id: 'noon', label: 'Noon' },
  { id: 'twilight', label: 'Twilight' },
];

function StandingsList({ entries, compact = false }: { entries: StandingsEntry[]; compact?: boolean }) {
  return (
    <div
      className={`${compact ? 'max-h-[210px]' : 'max-h-[245px]'} overflow-y-auto studio-scroll divide-y divide-white/8 border-y border-white/10`}
    >
      {entries.map((row) => (
        <div
          key={row.id}
          className={`flex items-center justify-between gap-3 py-2 px-2.5 text-xs ${
            row.isPlayer ? 'bg-[#f59e0b]/14' : ''
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={`tabular-mono font-bold w-6 shrink-0 ${
                row.position === 1
                  ? 'text-[#fbbf24]'
                  : row.isPlayer
                    ? 'text-[#f7f4ec]'
                    : 'text-[#8c96a8]'
              }`}
            >
              P{row.position}
            </span>
            <span
              className="w-1.5 h-4 rounded-xs shrink-0"
              style={{ backgroundColor: row.colorHex }}
            />
            <span className="tabular-mono text-[11px] text-[#98a2b4] w-6 shrink-0">
              #{row.racingNumber}
            </span>
            <div className="min-w-0">
              <span
                className={`font-semibold truncate block ${
                  row.isPlayer ? 'text-[#f7f4ec]' : 'text-[#dce2ec]'
                }`}
              >
                {row.name}
                <span className="text-[#8e98aa] font-normal ml-1.5">· {row.vehicleModel}</span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline text-[11px] text-[#95a0b3]">{row.specialty}</span>
            <span className="tabular-mono text-[11px] font-semibold text-[#cbd5e1] w-16 text-right">
              {row.finished && row.finishTime !== null
                ? formatRaceTime(row.finishTime)
                : row.position === 1
                  ? 'Leader'
                  : `-${row.gapMeters}m`}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function PauseModal({
  courseName,
  mode,
  timeOfDay,
  radioStation,
  lap,
  totalLaps,
  elapsedTime,
  standingsTable,
  onSelectTimeOfDay,
  onSelectRadio,
  onResetToTrack,
  onResume,
  onRestart,
  onOpenGarage,
  onTitle,
}: PauseModalProps) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(9, 12, 18, 0.78)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Game paused"
    >
      <div className="w-full max-w-lg rounded-lg bg-[#11151f] border border-white/14 p-6 shadow-2xl flex flex-col gap-5">
        <div className="flex items-baseline justify-between gap-4 border-b border-white/10 pb-3.5">
          <div>
            <h2 className="font-display text-2xl font-extrabold text-[#f7f4ec]">Race Paused</h2>
            <p className="text-xs text-[#9ea8b8] mt-0.5">{courseName}</p>
          </div>
          <div className="text-right">
            <div className="tabular-mono text-sm font-bold text-[#f59e0b]">
              {mode === 'free-roam' ? `Free Roam · Lap ${lap}` : `Lap ${lap} / ${totalLaps}`}
            </div>
            <div className="tabular-mono text-xs text-[#b8c0ce]">{formatRaceTime(elapsedTime)}</div>
          </div>
        </div>

        {/* Clean Unboxed Lighting & Radio Controls */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-[#a5afbf]">Time of Day</span>
            <div className="flex items-center gap-4">
              {TIME_OPTIONS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectTimeOfDay(t.id)}
                  aria-pressed={timeOfDay === t.id}
                  className={`text-xs font-semibold pb-0.5 border-b-2 cursor-pointer transition-colors ${
                    timeOfDay === t.id
                      ? 'text-[#f7f4ec] border-[#f59e0b]'
                      : 'text-[#8e98aa] border-transparent hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-[#a5afbf]">Radio</span>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {RADIO_STATIONS.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => onSelectRadio(st.id)}
                  aria-pressed={radioStation === st.id}
                  className={`text-xs font-semibold pb-0.5 border-b-2 cursor-pointer transition-colors ${
                    radioStation === st.id
                      ? 'text-[#f7f4ec] border-[#f59e0b]'
                      : 'text-[#8e98aa] border-transparent hover:text-white'
                  }`}
                >
                  {st.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live 12-Car Grid Standings in Grand Prix */}
        {mode === 'grand-prix' && standingsTable.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9aa5b6]">
              Running Order ({standingsTable.length} Cars)
            </span>
            <StandingsList entries={standingsTable} compact />
          </div>
        )}

        {/* Clear Action Hierarchy */}
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="w-full py-3 px-4 rounded-md bg-[#f59e0b] hover:bg-[#fbbf24] text-[#11151d] font-display font-extrabold text-sm tracking-wide cursor-pointer transition-colors"
          >
            Resume Driving
          </button>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => {
                onResetToTrack();
                onResume();
              }}
              className="py-2.5 px-3 rounded-md bg-[#1a202d] hover:bg-[#232b3c] border border-white/10 text-[#ece9e2] font-semibold text-xs cursor-pointer transition-colors"
            >
              Reset Car
            </button>
            <button
              type="button"
              onClick={onRestart}
              className="py-2.5 px-3 rounded-md bg-[#1a202d] hover:bg-[#232b3c] border border-white/10 text-[#ece9e2] font-semibold text-xs cursor-pointer transition-colors"
            >
              Restart
            </button>
            <button
              type="button"
              onClick={onOpenGarage}
              className="py-2.5 px-3 rounded-md bg-[#1a202d] hover:bg-[#232b3c] border border-white/10 text-[#ece9e2] font-semibold text-xs cursor-pointer transition-colors"
            >
              Garage
            </button>
          </div>
          <button
            type="button"
            onClick={onTitle}
            className="w-full py-2 px-4 text-[#9ea8b8] hover:text-[#f7f4ec] font-medium text-xs cursor-pointer transition-colors"
          >
            Return to Title
          </button>
        </div>
      </div>
    </div>
  );
}

interface FinishModalProps {
  snapshot: RunSnapshot;
  onPlayAgain: () => void;
  onNextCourse: () => void;
  onTitle: () => void;
}

export function FinishModal({
  snapshot,
  onPlayAgain,
  onNextCourse,
  onTitle,
}: FinishModalProps) {
  const headline =
    snapshot.mode !== 'grand-prix'
      ? 'Session Complete'
      : snapshot.position === 1
        ? '1st Place — Victory'
        : snapshot.position <= 3
          ? `Podium Finish — P${snapshot.position}`
          : `Finished P${snapshot.position} of ${snapshot.totalRacers}`;

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(9, 12, 18, 0.82)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Race results"
    >
      <div className="w-full max-w-xl rounded-lg bg-[#11151f] border border-white/14 p-6 sm:p-7 shadow-2xl flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <p className="text-xs font-semibold text-[#f59e0b] tracking-wide">
              {snapshot.courseName} ·{' '}
              {snapshot.mode === 'grand-prix'
                ? 'Grand Prix (12 Cars)'
                : snapshot.mode === 'free-roam'
                  ? 'Free Roam'
                  : 'Time Trial'}
            </p>
            <h2 className="font-display text-3xl font-extrabold text-[#f7f4ec] mt-1">{headline}</h2>
          </div>
        </div>

        {/* Clean Unboxed Telemetry Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <div className="text-[11px] text-[#95a0b3]">Total Time</div>
            <div className="tabular-mono text-lg font-bold text-[#f7f4ec] mt-0.5">
              {formatRaceTime(snapshot.totalTime)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#95a0b3]">Best Lap</div>
            <div className="tabular-mono text-lg font-bold text-[#fbbf24] mt-0.5">
              {formatRaceTime(snapshot.bestLapTime)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#95a0b3]">Style Score</div>
            <div className="tabular-mono text-lg font-bold text-[#34d399] mt-0.5">
              {snapshot.totalStyleScore.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#95a0b3]">Top Speed</div>
            <div className="tabular-mono text-lg font-bold text-[#f7f4ec] mt-0.5">
              {snapshot.topSpeedKmh} km/h
            </div>
          </div>
        </div>

        {/* Full 12-Car Classification Sheet */}
        {snapshot.mode === 'grand-prix' && snapshot.standingsTable.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9aa5b6]">
              Final Classification
            </span>
            <StandingsList entries={snapshot.standingsTable} />
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
          <button
            type="button"
            data-start="true"
            onClick={onPlayAgain}
            className="flex-1 py-3 px-5 rounded-md bg-[#f59e0b] hover:bg-[#fbbf24] text-[#11151d] font-display font-extrabold text-sm cursor-pointer transition-colors whitespace-nowrap"
          >
            Race Again
          </button>
          <button
            type="button"
            onClick={onNextCourse}
            className="py-3 px-4 rounded-md bg-[#1a202d] hover:bg-[#232b3c] border border-white/12 text-[#f4f1ea] font-semibold text-sm cursor-pointer transition-colors whitespace-nowrap"
          >
            Next Circuit
          </button>
          <button
            type="button"
            onClick={onTitle}
            className="py-3 px-4 text-[#a4aebf] hover:text-[#f7f4ec] font-medium text-sm cursor-pointer transition-colors whitespace-nowrap"
          >
            Title
          </button>
        </div>
      </div>
    </div>
  );
}
