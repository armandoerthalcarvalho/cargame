import { useCallback, useEffect, useRef, useState } from 'react';
import { COURSE_LIST, COURSES, LIVERY_PRESETS } from './game/courses';
import type { TrackData } from './game/track';
import type {
  CourseId,
  GameMode,
  GamePhase,
  HudTelemetry,
  LiveryConfig,
  RadioStationId,
  RunSnapshot,
  TimeOfDay,
} from './game/types';
import { DrivingHud } from './components/DrivingHud';
import { GarageModal } from './components/GarageModal';
import { FinishModal, PauseModal } from './components/StatusModal';
import { TitleOverlay } from './components/TitleOverlay';
import { SolsticeSceneEngine } from './three/sceneEngine';
import type { TouchInputState } from './three/sceneEngine';

const INITIAL_TELEMETRY: HudTelemetry = {
  speedKmh: 0,
  gear: 1,
  rpm: 0.18,
  boostEnergy: 50,
  isBoosting: false,
  isDrifting: false,
  airborne: false,
  activeDriftScore: 0,
  totalStyleScore: 0,
  comboMultiplier: 1,
  comboTimer: 0,
  slipstream: 0,
  position: 10,
  totalRacers: 12,
  lap: 1,
  totalLaps: 3,
  lapProgress: 0,
  elapsedTime: 0,
  currentLapTime: 0,
  bestLapTime: null,
  countdownDigit: 0,
  wrongWay: false,
  bannerText: null,
  bannerTone: 'amber',
  cameraMode: 'chase',
  mode: 'grand-prix',
  minimapRacers: [],
  standingsTable: [],
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SolsticeSceneEngine | null>(null);

  const [phase, setPhase] = useState<GamePhase>('title');
  const [courseId, setCourseId] = useState<CourseId>('sunstone-canyon');
  const [mode, setMode] = useState<GameMode>('grand-prix');
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('golden');
  const [telemetry, setTelemetry] = useState<HudTelemetry>(INITIAL_TELEMETRY);
  const [trackData, setTrackData] = useState<TrackData | null>(null);
  const [muted, setMuted] = useState(false);
  const [runSnapshot, setRunSnapshot] = useState<RunSnapshot | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  const [garageOpen, setGarageOpen] = useState(false);
  const [liveryConfig, setLiveryConfig] = useState<LiveryConfig>({ ...LIVERY_PRESETS[0] });
  const [radioStation, setRadioStation] = useState<RadioStationId>('solstice');

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const params = new URLSearchParams(window.location.search);
    const autostart = params.get('autostart') === '1';
    const queryCourse = params.get('course') as CourseId | null;
    const startCourse: CourseId =
      queryCourse && queryCourse in COURSES ? queryCourse : 'sunstone-canyon';
    if (startCourse !== 'sunstone-canyon') {
      setCourseId(startCourse);
    }

    const engine = new SolsticeSceneEngine(
      container,
      {
        onPhaseChange: (next) => setPhase(next),
        onTelemetry: (next) => setTelemetry(next),
        onRaceFinish: (snap) => setRunSnapshot(snap),
        onMuteChange: (nextMuted) => setMuted(nextMuted),
        onCameraChange: () => {},
        onTrackReady: (nextTrack) => setTrackData(nextTrack),
        onWebglError: (msg) => setWebglError(msg),
      },
      startCourse,
      'grand-prix',
      autostart,
    );

    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setModalOpen(garageOpen);
  }, [garageOpen]);

  const handleSelectCourse = useCallback(
    (nextId: CourseId) => {
      setCourseId(nextId);
      engineRef.current?.loadCourseWorld(nextId, mode);
    },
    [mode],
  );

  const handleSelectMode = useCallback(
    (nextMode: GameMode) => {
      setMode(nextMode);
      engineRef.current?.loadCourseWorld(courseId, nextMode);
    },
    [courseId],
  );

  const handleSelectTimeOfDay = useCallback((tod: TimeOfDay) => {
    setTimeOfDay(tod);
    engineRef.current?.setTimeOfDay(tod);
  }, []);

  const handleStart = useCallback(() => {
    setRunSnapshot(null);
    setGarageOpen(false);
    engineRef.current?.startRace();
  }, []);

  const handleResume = useCallback(() => {
    setGarageOpen(false);
    engineRef.current?.resumeRace();
  }, []);

  const handlePause = useCallback(() => {
    engineRef.current?.pauseRace();
  }, []);

  const handleTitle = useCallback(() => {
    setRunSnapshot(null);
    setGarageOpen(false);
    engineRef.current?.returnToTitle();
  }, []);

  const handleNextCourse = useCallback(() => {
    const idx = COURSE_LIST.findIndex((c) => c.id === courseId);
    const next = COURSE_LIST[(idx + 1) % COURSE_LIST.length].id;
    setCourseId(next);
    setRunSnapshot(null);
    engineRef.current?.loadCourseWorld(next, mode);
    engineRef.current?.startRace();
  }, [courseId, mode]);

  const handleChangeLivery = useCallback((next: LiveryConfig) => {
    setLiveryConfig(next);
    engineRef.current?.applyLivery(next);
  }, []);

  const handleSelectRadio = useCallback((station: RadioStationId) => {
    setRadioStation(station);
    engineRef.current?.setRadioStation(station);
  }, []);

  const handleTouchChange = useCallback((partial: Partial<TouchInputState>) => {
    engineRef.current?.setTouchInput(partial);
  }, []);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0e1116]">
      <div ref={canvasMountRef} className="fixed inset-0 w-full h-full" />

      {webglError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0e1116] p-6">
          <div className="max-w-md rounded-lg bg-[#161b25] border border-white/15 p-6 text-center">
            <h1 className="font-display text-2xl font-bold text-[#f7f4ec]">3D Graphics Unavailable</h1>
            <p className="text-sm text-[#a6b0c0] mt-2 leading-relaxed">{webglError}</p>
          </div>
        </div>
      )}

      {phase === 'title' && !webglError && !garageOpen && (
        <TitleOverlay
          selectedCourse={courseId}
          selectedMode={mode}
          timeOfDay={timeOfDay}
          trackLengthMeters={trackData?.totalLength ?? null}
          liveryConfig={liveryConfig}
          onSelectCourse={handleSelectCourse}
          onSelectMode={handleSelectMode}
          onSelectTimeOfDay={handleSelectTimeOfDay}
          onStart={handleStart}
          onOpenGarage={() => setGarageOpen(true)}
        />
      )}

      {phase === 'playing' && !webglError && (
        <DrivingHud
          telemetry={telemetry}
          track={trackData}
          muted={muted}
          onCycleCamera={() => engineRef.current?.cycleCamera()}
          onResetToTrack={() => engineRef.current?.resetPlayerToTrack()}
          onToggleMute={() => engineRef.current?.toggleMute()}
          onPause={handlePause}
          onTouchChange={handleTouchChange}
        />
      )}

      {phase === 'paused' && !garageOpen && (
        <PauseModal
          courseName={COURSES[courseId].name}
          mode={mode}
          timeOfDay={timeOfDay}
          radioStation={radioStation}
          lap={telemetry.lap}
          totalLaps={telemetry.totalLaps}
          elapsedTime={telemetry.elapsedTime}
          standingsTable={telemetry.standingsTable}
          onSelectTimeOfDay={handleSelectTimeOfDay}
          onSelectRadio={handleSelectRadio}
          onResetToTrack={() => engineRef.current?.resetPlayerToTrack()}
          onResume={handleResume}
          onRestart={handleStart}
          onOpenGarage={() => setGarageOpen(true)}
          onTitle={handleTitle}
        />
      )}

      {phase === 'gameover' && runSnapshot && (
        <FinishModal
          snapshot={runSnapshot}
          onPlayAgain={handleStart}
          onNextCourse={handleNextCourse}
          onTitle={handleTitle}
        />
      )}

      {garageOpen && (
        <GarageModal
          config={liveryConfig}
          radioStation={radioStation}
          onChangeConfig={handleChangeLivery}
          onSelectRadio={handleSelectRadio}
          onClose={() => setGarageOpen(false)}
        />
      )}
    </main>
  );
}
