import type { GameMode, RunSnapshot } from '../game/types';
import { formatRaceTime } from './DrivingHud';

interface PauseModalProps {
  courseName: string;
  mode: GameMode;
  lap: number;
  totalLaps: number;
  elapsedTime: number;
  onResume: () => void;
  onRestart: () => void;
  onOpenGarage: () => void;
  onTitle: () => void;
}

export function PauseModal({
  courseName,
  mode,
  lap,
  totalLaps,
  elapsedTime,
  onResume,
  onRestart,
  onOpenGarage,
  onTitle,
}: PauseModalProps) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(10, 13, 18, 0.72)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Game paused"
    >
      <div className="w-full max-w-md rounded-xl bg-[#141821] border border-white/15 p-6 shadow-2xl flex flex-col gap-5">
        <div className="flex items-baseline justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-[#f7f4ec]">Race Paused</h2>
            <p className="text-xs text-[#9ea8b8] mt-1">{courseName}</p>
          </div>
          <div className="text-right">
            <div className="tabular-mono text-sm font-bold text-[#f59e0b]">
              {mode === 'free-roam' ? `Free Roam · Lap ${lap}` : `Lap ${lap} / ${totalLaps}`}
            </div>
            <div className="tabular-mono text-xs text-[#b8c0ce]">{formatRaceTime(elapsedTime)}</div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="w-full py-3 px-4 rounded-lg bg-[#f59e0b] hover:bg-[#fbbf24] text-[#11151d] font-bold text-sm cursor-pointer transition-colors"
          >
            Resume Driving
          </button>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={onRestart}
              className="py-2.5 px-4 rounded-lg bg-[#1e2432] hover:bg-[#272f40] border border-white/12 text-[#f4f1ea] font-semibold text-sm cursor-pointer transition-colors"
            >
              Restart
            </button>
            <button
              type="button"
              onClick={onOpenGarage}
              className="py-2.5 px-4 rounded-lg bg-[#1e2432] hover:bg-[#272f40] border border-white/12 text-[#f4f1ea] font-semibold text-sm cursor-pointer transition-colors"
            >
              Garage &amp; Radio
            </button>
          </div>
          <button
            type="button"
            onClick={onTitle}
            className="w-full py-2.5 px-4 rounded-lg bg-transparent hover:bg-white/6 border border-white/10 text-[#c5ccd8] font-medium text-sm cursor-pointer transition-colors"
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
          ? `Podium Finish — #${snapshot.position}`
          : `Finished #${snapshot.position} of ${snapshot.totalRacers}`;

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(10, 13, 18, 0.78)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Race results"
    >
      <div className="w-full max-w-lg rounded-xl bg-[#141821] border border-white/15 p-6 sm:p-7 shadow-2xl flex flex-col gap-6">
        <div className="border-b border-white/10 pb-4">
          <p className="text-xs font-medium text-[#f59e0b] tracking-wide">
            {snapshot.courseName} ·{' '}
            {snapshot.mode === 'grand-prix'
              ? 'Grand Prix'
              : snapshot.mode === 'free-roam'
                ? 'Free Roam'
                : 'Time Trial'}
          </p>
          <h2 className="font-display text-3xl font-extrabold text-[#f7f4ec] mt-1">{headline}</h2>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg bg-[#1a202c] border border-white/10 p-3.5">
            <div className="text-xs text-[#9da7b8]">Total Time</div>
            <div className="tabular-mono text-xl font-bold text-[#f7f4ec] mt-1">
              {formatRaceTime(snapshot.totalTime)}
            </div>
          </div>
          <div className="rounded-lg bg-[#1a202c] border border-white/10 p-3.5">
            <div className="text-xs text-[#9da7b8]">Best Lap</div>
            <div className="tabular-mono text-xl font-bold text-[#fbbf24] mt-1">
              {formatRaceTime(snapshot.bestLapTime)}
            </div>
          </div>
          <div className="rounded-lg bg-[#1a202c] border border-white/10 p-3.5">
            <div className="text-xs text-[#9da7b8]">Style Score</div>
            <div className="tabular-mono text-xl font-bold text-[#34d399] mt-1">
              {snapshot.totalStyleScore.toLocaleString()}
            </div>
          </div>
          <div className="rounded-lg bg-[#1a202c] border border-white/10 p-3.5">
            <div className="text-xs text-[#9da7b8]">Top Speed</div>
            <div className="tabular-mono text-xl font-bold text-[#f7f4ec] mt-1">
              {snapshot.topSpeedKmh} km/h
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <button
            type="button"
            data-start="true"
            onClick={onPlayAgain}
            className="flex-1 py-3 px-5 rounded-lg bg-[#f59e0b] hover:bg-[#fbbf24] text-[#11151d] font-bold text-sm cursor-pointer transition-colors whitespace-nowrap"
          >
            Play Again
          </button>
          <button
            type="button"
            onClick={onNextCourse}
            className="py-3 px-4 rounded-lg bg-[#1e2432] hover:bg-[#272f40] border border-white/12 text-[#f4f1ea] font-semibold text-sm cursor-pointer transition-colors whitespace-nowrap"
          >
            Next Course
          </button>
          <button
            type="button"
            onClick={onTitle}
            className="py-3 px-4 rounded-lg bg-transparent hover:bg-white/6 border border-white/10 text-[#c5ccd8] font-medium text-sm cursor-pointer transition-colors whitespace-nowrap"
          >
            Title
          </button>
        </div>
      </div>
    </div>
  );
}
