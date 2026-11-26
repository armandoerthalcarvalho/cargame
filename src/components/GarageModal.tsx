import { useEffect, useState } from 'react';
import { LIVERY_PRESETS, RADIO_STATIONS, TUNING_SPECS } from '../game/courses';
import type {
  LiveryConfig,
  PaintFinish,
  RadioStationId,
  RimFinish,
  TuningClass,
} from '../game/types';

interface GarageModalProps {
  config: LiveryConfig;
  radioStation: RadioStationId;
  onChangeConfig: (next: LiveryConfig) => void;
  onSelectRadio: (station: RadioStationId) => void;
  onClose: () => void;
}

const PAINT_SWATCHES = [
  '#d94826',
  '#1565c0',
  '#f3ece7',
  '#1a1f28',
  '#115e45',
  '#e11d48',
  '#eab308',
  '#6d28d9',
  '#0891b2',
  '#334155',
];

const ACCENT_SWATCHES = [
  '#f6d38b',
  '#f8fafc',
  '#e11d48',
  '#eab308',
  '#38bdf8',
  '#34d399',
  '#fb923c',
  '#141820',
];

const STRIPE_STYLES: Array<{ id: LiveryConfig['stripeStyle']; label: string }> = [
  { id: 'twin', label: 'Twin' },
  { id: 'chevron', label: 'Chevron' },
  { id: 'horizon', label: 'Horizon' },
  { id: 'split', label: 'Split' },
  { id: 'carbon', label: 'Carbon' },
];

const PAINT_FINISHES: Array<{ id: PaintFinish; label: string }> = [
  { id: 'gloss', label: 'Gloss' },
  { id: 'metallic', label: 'Metallic' },
  { id: 'matte', label: 'Matte' },
];

const RIM_FINISHES: Array<{ id: RimFinish; label: string; dot: string }> = [
  { id: 'alloy', label: 'Alloy', dot: '#d8e1ec' },
  { id: 'gold', label: 'Gold', dot: '#dcb45c' },
  { id: 'obsidian', label: 'Obsidian', dot: '#1f2530' },
  { id: 'copper', label: 'Copper', dot: '#c8744b' },
];

const TUNING_ORDER: TuningClass[] = ['balanced', 'drift', 'aero'];

function SpecBar({ label, ratio }: { label: string; ratio: number }) {
  const clamped = Math.max(0.25, Math.min(1, ratio));
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[#9aa4b5] w-11 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full origin-left bg-[#f59e0b]"
          style={{ transform: `scaleX(${clamped})` }}
        />
      </div>
    </div>
  );
}

export function GarageModal({
  config,
  radioStation,
  onChangeConfig,
  onSelectRadio,
  onClose,
}: GarageModalProps) {
  const [tab, setTab] = useState<'workshop' | 'radio'>('workshop');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const patch = (partial: Partial<LiveryConfig>) => {
    onChangeConfig({ ...config, ...partial });
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center sm:justify-start p-4 sm:p-7"
      style={{
        background:
          'linear-gradient(92deg, rgba(8,11,17,0.82) 0%, rgba(8,11,17,0.45) 45%, rgba(8,11,17,0.06) 100%)',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Garage and Radio"
    >
      <div className="w-full max-w-[500px] max-h-[90vh] rounded-xl bg-[#111520]/96 border border-white/15 shadow-2xl flex flex-col overflow-hidden">
        {/* Header & Tabs */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3.5">
            <h2 className="font-display text-lg font-bold text-[#f7f4ec] whitespace-nowrap">
              Garage
            </h2>
            <div
              className="flex items-center gap-1 p-1 rounded-lg bg-[#0a0d14] border border-white/10"
              role="tablist"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'workshop'}
                onClick={() => setTab('workshop')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  tab === 'workshop'
                    ? 'bg-[#f59e0b] text-[#11151d]'
                    : 'text-[#b8c1d0] hover:text-white'
                }`}
              >
                Workshop
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'radio'}
                onClick={() => setTab('radio')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  tab === 'radio'
                    ? 'bg-[#f59e0b] text-[#11151d]'
                    : 'text-[#b8c1d0] hover:text-white'
                }`}
              >
                Radio Channels
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close garage"
            className="px-3.5 py-1.5 rounded-lg bg-[#f59e0b] hover:bg-[#fbbf24] text-[#11151d] text-xs font-bold cursor-pointer whitespace-nowrap"
          >
            Done
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto studio-scroll p-5">
          {tab === 'workshop' ? (
            <div className="flex flex-col gap-5">
              {/* Factory Spec Presets */}
              <div>
                <span className="block text-xs font-semibold text-[#cbd2de] mb-2">
                  Factory Editions
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {LIVERY_PRESETS.map((preset) => {
                    const active =
                      preset.bodyColor === config.bodyColor &&
                      preset.accentColor === config.accentColor &&
                      preset.stripeStyle === config.stripeStyle;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => onChangeConfig({ ...preset })}
                        className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#1e2636] border-[#f59e0b]'
                            : 'bg-[#151a25] border-white/10 hover:border-white/25'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span
                            className="w-4 h-4 rounded-full border border-white/25 shrink-0"
                            style={{ backgroundColor: preset.bodyColor }}
                          />
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-white/25 shrink-0"
                            style={{ backgroundColor: preset.accentColor }}
                          />
                          <span className="ml-auto tabular-mono text-[10px] text-[#9aa4b5]">
                            #{preset.racingNumber}
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-[#f3f0e8] truncate">
                          {preset.name}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Paint & Accent Swatches */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/10">
                <div>
                  <span className="block text-xs font-semibold text-[#cbd2de] mb-2">Body Paint</span>
                  <div className="flex flex-wrap gap-1.5">
                    {PAINT_SWATCHES.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        aria-label={`Body paint ${hex}`}
                        onClick={() => patch({ id: 'custom', bodyColor: hex })}
                        className={`w-7 h-7 rounded-md border-2 cursor-pointer transition-transform ${
                          config.bodyColor.toLowerCase() === hex.toLowerCase()
                            ? 'border-[#f59e0b] scale-110'
                            : 'border-white/20 hover:scale-105'
                        }`}
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-xs font-semibold text-[#cbd2de] mb-2">
                    Stripe &amp; Caliper Accent
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {ACCENT_SWATCHES.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        aria-label={`Accent color ${hex}`}
                        onClick={() => patch({ id: 'custom', accentColor: hex })}
                        className={`w-7 h-7 rounded-md border-2 cursor-pointer transition-transform ${
                          config.accentColor.toLowerCase() === hex.toLowerCase()
                            ? 'border-[#f59e0b] scale-110'
                            : 'border-white/20 hover:scale-105'
                        }`}
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Finish & Door Number */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <span className="block text-xs font-semibold text-[#cbd2de] mb-1.5">
                    Paint Finish
                  </span>
                  <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#0a0d14] border border-white/10">
                    {PAINT_FINISHES.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => patch({ paintFinish: f.id })}
                        className={`py-1.5 rounded text-xs font-semibold cursor-pointer transition-colors ${
                          config.paintFinish === f.id
                            ? 'bg-[#f5f3ee] text-[#11151d]'
                            : 'text-[#aeb7c6] hover:text-white'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="racing-number-input"
                    className="block text-xs font-semibold text-[#cbd2de] mb-1.5"
                  >
                    Door &amp; Hood Number
                  </label>
                  <input
                    id="racing-number-input"
                    type="text"
                    maxLength={2}
                    value={config.racingNumber}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 2);
                      patch({ racingNumber: clean || '07' });
                    }}
                    className="w-full rounded-lg bg-[#0a0d14] border border-white/15 px-3 py-1.5 font-display text-sm font-bold text-[#f7f4ec] tracking-widest focus:outline-none focus:border-[#f59e0b]"
                  />
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold text-[#cbd2de] mb-1.5">
                  Livery Stripe Pattern
                </span>
                <div className="grid grid-cols-5 gap-1 p-1 rounded-lg bg-[#0a0d14] border border-white/10">
                  {STRIPE_STYLES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => patch({ stripeStyle: s.id })}
                      className={`py-1.5 rounded text-xs font-semibold cursor-pointer transition-colors ${
                        config.stripeStyle === s.id
                          ? 'bg-[#f5f3ee] text-[#11151d]'
                          : 'text-[#aeb7c6] hover:text-white'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold text-[#cbd2de] mb-1.5">
                  Forged Wheel Finish
                </span>
                <div className="grid grid-cols-4 gap-2">
                  {RIM_FINISHES.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => patch({ rimFinish: r.id })}
                      className={`flex items-center justify-center gap-2 py-2 px-2 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${
                        config.rimFinish === r.id
                          ? 'bg-[#1e2636] border-[#f59e0b] text-[#f7f4ec]'
                          : 'bg-[#151a25] border-white/10 text-[#b8c1d0] hover:border-white/25'
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-full border border-white/30 shrink-0"
                        style={{ backgroundColor: r.dot }}
                      />
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Performance Setup with Quantitative Spec Bars */}
              <div className="pt-4 border-t border-white/10">
                <span className="block text-xs font-semibold text-[#cbd2de] mb-2">
                  Performance Setup
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {TUNING_ORDER.map((tId) => {
                    const spec = TUNING_SPECS[tId];
                    const active = config.tuning === tId;
                    return (
                      <button
                        key={tId}
                        type="button"
                        onClick={() => patch({ tuning: tId })}
                        className={`p-3 rounded-lg border text-left transition-colors cursor-pointer flex flex-col gap-2 ${
                          active
                            ? 'bg-[#1e2636] border-[#f59e0b]'
                            : 'bg-[#151a25] border-white/10 hover:border-white/25'
                        }`}
                      >
                        <div className="text-xs font-bold text-[#f7f4ec]">{spec.label}</div>
                        <div className="flex flex-col gap-1">
                          <SpecBar label="Speed" ratio={(spec.topSpeedMult - 0.85) / 0.25} />
                          <SpecBar label="Grip" ratio={(spec.driftGripMult - 0.65) / 0.6} />
                          <SpecBar label="Boost" ratio={(spec.boostChargeMult - 0.7) / 0.7} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-[#9ea8b8] leading-relaxed mb-1">
                Built-in live synthesized motorsport radio channels. Switch anytime while driving or in the garage.
              </p>
              {RADIO_STATIONS.map((st) => {
                const active = radioStation === st.id;
                return (
                  <button
                    key={st.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onSelectRadio(st.id)}
                    className={`flex items-center justify-between gap-4 px-4 py-3.5 rounded-lg border text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#1e2636] border-[#f59e0b]'
                        : 'bg-[#151a25] border-white/10 hover:border-white/25'
                    }`}
                  >
                    <div>
                      <div className="text-sm font-bold text-[#f7f4ec]">{st.name}</div>
                      <div className="text-xs text-[#9ea8b8] mt-0.5">{st.vibe}</div>
                    </div>
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded ${
                        active
                          ? 'bg-[#f59e0b] text-[#11151d]'
                          : 'bg-[#0a0d14] text-[#9ea8b8] border border-white/10'
                      }`}
                    >
                      {active ? 'Tuned' : 'Tune'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
