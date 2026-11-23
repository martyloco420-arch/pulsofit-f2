import React, { useEffect, useState } from 'react';
import {
  Bluetooth,
  Camera,
  Check,
  ChevronLeft,
  Droplets,
  Moon,
  Scale,
  Sparkles,
  X,
} from 'lucide-react';
import { triggerHaptic } from '../lib/haptics';
import { getTodayIsoDate } from '../lib/storage';
import {
  displayWeightToKg,
  formatLiquid,
  getLiquidUnit,
  getWeightUnit,
  kgToDisplayWeight,
} from '../lib/units';
import type { DailyReadinessEntry, UserProfile } from '../types/fitness';
import { calculateReadinessScore } from './HoyOverview';

type SheetView = 'menu' | 'weight' | 'checkin';

interface QuickActionSheetProps {
  isOpen: boolean;
  profile: UserProfile;
  latestWeightKg: number;
  todayWaterMl: number;
  todayReadiness: DailyReadinessEntry | null;
  onClose: () => void;
  onAddWater250Ml: (dateIso: string) => void;
  onOpenPlateScanner: () => void;
  onOpenSmartScale: () => void;
  onLogWeight: (weightKg: number, dateIso: string) => void;
  onSaveReadiness: (entry: DailyReadinessEntry) => void;
}

export const QuickActionSheet: React.FC<QuickActionSheetProps> = ({
  isOpen,
  profile,
  latestWeightKg,
  todayWaterMl,
  todayReadiness,
  onClose,
  onAddWater250Ml,
  onOpenPlateScanner,
  onOpenSmartScale,
  onLogWeight,
  onSaveReadiness,
}) => {
  const [view, setView] = useState<SheetView>('menu');
  const [waterFlashText, setWaterFlashText] = useState<string | null>(null);

  const weightUnit = getWeightUnit(profile.weightUnit);
  const liquidUnit = getLiquidUnit(profile.liquidUnit);

  const [weightInput, setWeightInput] = useState(() =>
    kgToDisplayWeight(latestWeightKg, weightUnit).toFixed(1),
  );
  const [weightError, setWeightError] = useState<string | null>(null);
  const [weightSavedMsg, setWeightSavedMsg] = useState<string | null>(null);

  const [sleepHours, setSleepHours] = useState(todayReadiness?.sleepHours ?? 7.5);
  const [sleepQuality, setSleepQuality] = useState(todayReadiness?.sleepQuality ?? 4);
  const [energyLevel, setEnergyLevel] = useState(todayReadiness?.energyLevel ?? 4);
  const [sorenessLevel, setSorenessLevel] = useState(todayReadiness?.sorenessLevel ?? 2);
  const [checkinSavedMsg, setCheckinSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setView('menu');
    setWaterFlashText(null);
    setWeightError(null);
    setWeightSavedMsg(null);
    setCheckinSavedMsg(null);
    setWeightInput(kgToDisplayWeight(latestWeightKg, weightUnit).toFixed(1));
    setSleepHours(todayReadiness?.sleepHours ?? 7.5);
    setSleepQuality(todayReadiness?.sleepQuality ?? 4);
    setEnergyLevel(todayReadiness?.energyLevel ?? 4);
    setSorenessLevel(todayReadiness?.sorenessLevel ?? 2);
  }, [isOpen, latestWeightKg, weightUnit, todayReadiness]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        triggerHaptic('light');
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const todayIso = getTodayIsoDate();
  const previewScore = calculateReadinessScore(
    sleepHours,
    sleepQuality,
    energyLevel,
    sorenessLevel,
  );

  const handleQuickWater = () => {
    onAddWater250Ml(todayIso);
    triggerHaptic('success');
    const updatedTotal = todayWaterMl + 250;
    setWaterFlashText(
      `+${formatLiquid(250, liquidUnit)} guardado · Hoy: ${formatLiquid(updatedTotal, liquidUnit)}`,
    );
  };

  const handleQuickPlateScan = () => {
    triggerHaptic('light');
    onClose();
    onOpenPlateScanner();
  };

  const handleSubmitWeight = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(weightInput.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setWeightError(`Ingresa un peso válido en ${weightUnit}.`);
      return;
    }
    const kg = displayWeightToKg(parsed, weightUnit);
    if (kg < 25 || kg > 320) {
      setWeightError('El peso está fuera del rango esperado (25–320 kg).');
      return;
    }
    setWeightError(null);
    onLogWeight(Math.round(kg * 100) / 100, todayIso);
    triggerHaptic('success');
    setWeightSavedMsg(
      `Peso registrado: ${parsed.toFixed(1)} ${weightUnit} (${todayIso})`,
    );
    window.setTimeout(() => {
      onClose();
    }, 850);
  };

  const handleSubmitCheckin = (e: React.FormEvent) => {
    e.preventDefault();
    const entry: DailyReadinessEntry = {
      date: todayIso,
      sleepHours,
      sleepQuality,
      energyLevel,
      sorenessLevel,
      score: previewScore,
      source: 'manual',
      updatedAt: new Date().toISOString(),
    };
    onSaveReadiness(entry);
    triggerHaptic('success');
    setCheckinSavedMsg(`Check-in guardado · Preparación ${previewScore}/100`);
    window.setTimeout(() => {
      onClose();
    }, 850);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label="Acciones rápidas de PulsoFit"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          triggerHaptic('light');
          onClose();
        }
      }}
    >
      <div className="w-full max-w-lg rounded-t-3xl border-t border-x border-zinc-800 bg-zinc-950/95 backdrop-blur-xl px-4 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl space-y-4">
        {/* Grab handle */}
        <div className="flex justify-center">
          <span className="h-1 w-10 rounded-full bg-zinc-700" aria-hidden="true" />
        </div>

        {/* Sheet Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {view !== 'menu' && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('light');
                  setView('menu');
                }}
                aria-label="Volver a acciones rápidas"
                className="min-h-[36px] min-w-[36px] rounded-xl border border-zinc-800 bg-zinc-900 flex items-center justify-center text-zinc-300 hover:text-white"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-base font-extrabold text-white truncate">
                {view === 'menu'
                  ? 'Registro Rápido'
                  : view === 'weight'
                    ? 'Registrar Peso'
                    : 'Check-In Rápido'}
              </h2>
              <p className="text-[11px] text-zinc-400 truncate">
                {view === 'menu'
                  ? 'Atajos en 1 toque para tu día'
                  : `Fecha local: ${todayIso}`}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              triggerHaptic('light');
              onClose();
            }}
            aria-label="Cerrar panel de acciones rápidas"
            className="min-h-[36px] min-w-[36px] rounded-xl border border-zinc-800 bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {view === 'menu' && (
          <>
            {waterFlashText && (
              <div
                role="status"
                className="rounded-2xl border border-sky-400/40 bg-sky-500/12 px-3.5 py-2.5 flex items-center gap-2 text-xs font-bold text-sky-200"
              >
                <Check className="w-4 h-4 text-sky-300 shrink-0" />
                <span>{waterFlashText}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              {/* 1. +250 ml Agua */}
              <button
                type="button"
                onClick={handleQuickWater}
                className="min-h-[96px] rounded-2xl border border-sky-400/35 bg-sky-500/10 hover:bg-sky-500/15 p-3.5 text-left flex flex-col justify-between gap-2 active:scale-[0.98] transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="w-9 h-9 rounded-xl bg-sky-400/20 border border-sky-400/35 flex items-center justify-center text-sky-300">
                    <Droplets className="w-4 h-4" />
                  </span>
                  <span className="text-[10px] font-mono font-bold text-sky-300">
                    1 toque
                  </span>
                </div>
                <div>
                  <p className="text-sm font-extrabold text-white">+250 ml Agua</p>
                  <p className="text-[11px] text-zinc-400">
                    Hoy: {formatLiquid(todayWaterMl, liquidUnit)}
                  </p>
                </div>
              </button>

              {/* 2. Escanear Plato IA */}
              <button
                type="button"
                onClick={handleQuickPlateScan}
                className="min-h-[96px] rounded-2xl border border-lime-400/35 bg-lime-400/10 hover:bg-lime-400/15 p-3.5 text-left flex flex-col justify-between gap-2 active:scale-[0.98] transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="w-9 h-9 rounded-xl bg-lime-400/20 border border-lime-400/40 flex items-center justify-center text-lime-300">
                    <Camera className="w-4 h-4" />
                  </span>
                  <span className="text-[10px] font-mono font-bold text-lime-300">
                    Visión IA
                  </span>
                </div>
                <div>
                  <p className="text-sm font-extrabold text-white">Escanear Plato IA</p>
                  <p className="text-[11px] text-zinc-400">
                    Foto y cálculo de macros
                  </p>
                </div>
              </button>

              {/* 3. Registrar Peso */}
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('light');
                  setView('weight');
                }}
                className="min-h-[96px] rounded-2xl border border-emerald-400/30 bg-emerald-500/10 hover:bg-emerald-500/15 p-3.5 text-left flex flex-col justify-between gap-2 active:scale-[0.98] transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="w-9 h-9 rounded-xl bg-emerald-400/20 border border-emerald-400/35 flex items-center justify-center text-emerald-300">
                    <Scale className="w-4 h-4" />
                  </span>
                  <span className="text-[10px] font-mono font-bold text-emerald-300">
                    {kgToDisplayWeight(latestWeightKg, weightUnit).toFixed(1)} {weightUnit}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-extrabold text-white">Registrar Peso</p>
                  <p className="text-[11px] text-zinc-400">
                    Manual o báscula BLE
                  </p>
                </div>
              </button>

              {/* 4. Check-In Rápido */}
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('light');
                  setView('checkin');
                }}
                className="min-h-[96px] rounded-2xl border border-amber-400/30 bg-amber-500/10 hover:bg-amber-500/15 p-3.5 text-left flex flex-col justify-between gap-2 active:scale-[0.98] transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="w-9 h-9 rounded-xl bg-amber-400/20 border border-amber-400/35 flex items-center justify-center text-amber-300">
                    <Sparkles className="w-4 h-4" />
                  </span>
                  <span className="text-[10px] font-mono font-bold text-amber-300">
                    {todayReadiness ? `${todayReadiness.score}/100` : '10 seg'}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-extrabold text-white">Check-In Rápido</p>
                  <p className="text-[11px] text-zinc-400">
                    Sueño, energía y fatiga
                  </p>
                </div>
              </button>
            </div>
          </>
        )}

        {view === 'weight' && (
          <form onSubmit={handleSubmitWeight} className="space-y-3.5">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3.5 space-y-2">
              <label
                htmlFor="quick-sheet-weight"
                className="block text-xs font-bold text-zinc-300"
              >
                Peso actual ({weightUnit})
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    const cur = parseFloat(weightInput.replace(',', '.')) || 70;
                    setWeightInput(Math.max(25, cur - 0.5).toFixed(1));
                  }}
                  className="min-h-[44px] min-w-[44px] rounded-xl border border-zinc-700 bg-zinc-900 text-sm font-extrabold text-zinc-200"
                >
                  -0.5
                </button>
                <input
                  id="quick-sheet-weight"
                  type="text"
                  inputMode="decimal"
                  value={weightInput}
                  onChange={(e) => setWeightInput(e.target.value)}
                  className="flex-1 min-h-[44px] rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-center text-lg font-mono font-extrabold text-white focus:border-lime-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    const cur = parseFloat(weightInput.replace(',', '.')) || 70;
                    setWeightInput((cur + 0.5).toFixed(1));
                  }}
                  className="min-h-[44px] min-w-[44px] rounded-xl border border-zinc-700 bg-zinc-900 text-sm font-extrabold text-zinc-200"
                >
                  +0.5
                </button>
              </div>
              {weightError && (
                <p role="alert" className="text-xs font-semibold text-rose-400">
                  {weightError}
                </p>
              )}
              {weightSavedMsg && (
                <p role="status" className="text-xs font-semibold text-lime-400">
                  {weightSavedMsg}
                </p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="submit"
                className="min-h-[46px] flex-1 rounded-2xl bg-lime-400 text-sm font-extrabold text-zinc-950 active:scale-[0.98] transition-transform"
              >
                Guardar peso
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('light');
                  onClose();
                  onOpenSmartScale();
                }}
                className="min-h-[46px] inline-flex items-center justify-center gap-1.5 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 text-xs font-bold text-zinc-200 hover:border-lime-400/50"
              >
                <Bluetooth className="w-4 h-4 text-lime-400" />
                Báscula Bluetooth / IA
              </button>
            </div>
          </form>
        )}

        {view === 'checkin' && (
          <form onSubmit={handleSubmitCheckin} className="space-y-3">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                  <Moon className="w-4 h-4 text-lime-400" />
                  Horas de sueño
                </span>
                <span className="font-mono text-sm font-extrabold text-lime-400">
                  {sleepHours} h · Índice {previewScore}/100
                </span>
              </div>
              <input
                type="range"
                min={3}
                max={11}
                step={0.5}
                value={sleepHours}
                onChange={(e) => setSleepHours(parseFloat(e.target.value))}
                className="w-full accent-lime-400"
              />

              <div className="grid grid-cols-1 gap-2.5">
                <div>
                  <span className="block text-[11px] text-zinc-400 mb-1">
                    Calidad de sueño (1–5)
                  </span>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => {
                          triggerHaptic('light');
                          setSleepQuality(n);
                        }}
                        className={`min-h-[36px] rounded-xl text-xs font-mono font-bold ${
                          sleepQuality === n
                            ? 'bg-lime-400 text-zinc-950'
                            : 'bg-zinc-950 border border-zinc-800 text-zinc-300'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-[11px] text-zinc-400 mb-1">
                    Energía hoy (1–5)
                  </span>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => {
                          triggerHaptic('light');
                          setEnergyLevel(n);
                        }}
                        className={`min-h-[36px] rounded-xl text-xs font-mono font-bold ${
                          energyLevel === n
                            ? 'bg-lime-400 text-zinc-950'
                            : 'bg-zinc-950 border border-zinc-800 text-zinc-300'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-[11px] text-zinc-400 mb-1">
                    Dolor muscular (1 limpio · 5 muy cargado)
                  </span>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => {
                          triggerHaptic('light');
                          setSorenessLevel(n);
                        }}
                        className={`min-h-[36px] rounded-xl text-xs font-mono font-bold ${
                          sorenessLevel === n
                            ? 'bg-lime-400 text-zinc-950'
                            : 'bg-zinc-950 border border-zinc-800 text-zinc-300'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {checkinSavedMsg && (
              <p role="status" className="text-xs font-semibold text-lime-400">
                {checkinSavedMsg}
              </p>
            )}

            <button
              type="submit"
              className="w-full min-h-[46px] rounded-2xl bg-lime-400 text-sm font-extrabold text-zinc-950 active:scale-[0.98] transition-transform"
            >
              Guardar Check-In de Hoy
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
