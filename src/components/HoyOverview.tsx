import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Brain,
  ChevronDown,
  ChevronUp,
  Droplets,
  Dumbbell,
  Flame,
  HeartPulse,
  Moon,
  Play,
  Sparkles,
  Utensils,
} from 'lucide-react';
import { computeDailyExerciseBurn } from '../lib/crossModuleIntelligence';
import { computeHydrationGoal } from '../lib/hydration';
import { getTodayIsoDate } from '../lib/storage';
import { formatLiquidPrimary, getLiquidUnit } from '../lib/units';
import type {
  ActiveFastState,
  AdaptiveNutritionState,
  BodyCompositionScan,
  BodyWeightEntry,
  CardioSession,
  DailyReadinessEntry,
  FoodEntry,
  HiitSession,
  HydrationSettings,
  TabId,
  UserProfile,
  WorkoutSession,
} from '../types/fitness';
import { calculateNutritionTargets } from '../data/foods';

interface HoyOverviewProps {
  profile: UserProfile;
  workouts: WorkoutSession[];
  cardioSessions: CardioSession[];
  hiitSessions?: HiitSession[];
  bodyWeights: BodyWeightEntry[];
  bodyScans: BodyCompositionScan[];
  foodLogs: FoodEntry[];
  hydrationByDate: Record<string, number>;
  hydrationSettings?: HydrationSettings;
  adaptiveNutrition?: AdaptiveNutritionState | null;
  activeFast?: ActiveFastState | null;
  todayReadiness: DailyReadinessEntry | null;
  recommendedTitle: string;
  onStartRecommended: () => void;
  onSaveReadiness: (entry: DailyReadinessEntry) => void;
  onNavigateTab: (tab: TabId) => void;
  onOpenSleep?: () => void;
  onOpenPulse?: () => void;
}

export function calculateReadinessScore(
  sleepHours: number,
  sleepQuality: number,
  energyLevel: number,
  sorenessLevel: number,
): number {
  // sleepHours optimal ~7.5-9h (0-30 pts), sleepQuality 1-5 (0-25 pts), energy 1-5 (0-25 pts), low soreness (0-20 pts)
  const sleepHrScore = Math.min(30, Math.max(5, Math.round((sleepHours / 8) * 30)));
  const qualScore = Math.round(((sleepQuality - 1) / 4) * 25);
  const energyScore = Math.round(((energyLevel - 1) / 4) * 25);
  const sorenessScore = Math.round(((5 - sorenessLevel) / 4) * 20);
  return Math.max(10, Math.min(100, sleepHrScore + qualScore + energyScore + sorenessScore));
}

export const HoyOverview: React.FC<HoyOverviewProps> = ({
  profile,
  workouts,
  cardioSessions,
  hiitSessions = [],
  bodyWeights,
  bodyScans,
  foodLogs,
  hydrationByDate,
  hydrationSettings = {
    mlPerKg: 35,
    containerMl: 500,
    wakeHour: 7,
    sleepHour: 22,
    hotDayByDate: {},
    remindersEnabled: false,
  },
  adaptiveNutrition,
  activeFast,
  todayReadiness,
  recommendedTitle,
  onStartRecommended,
  onSaveReadiness,
  onNavigateTab,
  onOpenSleep,
  onOpenPulse,
}) => {
  const today = getTodayIsoDate();
  const liquidUnit = getLiquidUnit(profile.liquidUnit);
  const [collapsed, setCollapsed] = useState(false);
  const [showCheckinForm, setShowCheckinForm] = useState(false);

  const [sleepHours, setSleepHours] = useState(todayReadiness?.sleepHours ?? 7.5);
  const [sleepQuality, setSleepQuality] = useState(todayReadiness?.sleepQuality ?? 4);
  const [energyLevel, setEnergyLevel] = useState(todayReadiness?.energyLevel ?? 4);
  const [sorenessLevel, setSorenessLevel] = useState(todayReadiness?.sorenessLevel ?? 2);

  useEffect(() => {
    if (!todayReadiness) return;
    setSleepHours(todayReadiness.sleepHours);
    setSleepQuality(todayReadiness.sleepQuality);
    setEnergyLevel(todayReadiness.energyLevel);
    setSorenessLevel(todayReadiness.sorenessLevel);
  }, [todayReadiness]);

  const targets = useMemo(() => {
    if (adaptiveNutrition) {
      return {
        calories: adaptiveNutrition.calorieTarget,
        proteinG: adaptiveNutrition.proteinG,
      };
    }
    const base = calculateNutritionTargets(profile);
    return { calories: base.calories, proteinG: base.proteinG };
  }, [adaptiveNutrition, profile]);

  const dayFoods = useMemo(
    () => foodLogs.filter((f) => f.date === today),
    [foodLogs, today],
  );
  const dayExerciseBurn = useMemo(
    () =>
      computeDailyExerciseBurn(
        profile,
        workouts,
        cardioSessions,
        hiitSessions,
        today,
      ),
    [profile, workouts, cardioSessions, hiitSessions, today],
  );
  const consumedCal = dayFoods.reduce((sum, f) => sum + f.calories, 0);
  const consumedProtein = dayFoods.reduce((sum, f) => sum + f.proteinG, 0);
  const remainingCal = Math.max(
    0,
    targets.calories + dayExerciseBurn.totalExerciseKcal - consumedCal,
  );
  const remainingProtein = Math.max(0, targets.proteinG - consumedProtein);

  const waterMl = hydrationByDate[today] ?? 0;
  const hydGoal = useMemo(
    () =>
      computeHydrationGoal(
        profile,
        bodyWeights,
        bodyScans,
        workouts,
        hydrationSettings,
        today,
        cardioSessions,
        hiitSessions,
      ),
    [profile, bodyWeights, bodyScans, workouts, cardioSessions, hiitSessions, hydrationSettings, today],
  );

  const fastLabel = useMemo(() => {
    if (!activeFast) return 'Ventana abierta';
    const startMs = Date.parse(activeFast.startedAt);
    const hrs = Number.isNaN(startMs)
      ? 0
      : Math.max(0, (Date.now() - startMs) / (1000 * 60 * 60));
    return `${hrs.toFixed(1)}h / ${activeFast.targetHours}h`;
  }, [activeFast]);

  const previewScore = calculateReadinessScore(
    sleepHours,
    sleepQuality,
    energyLevel,
    sorenessLevel,
  );

  const handleSaveCheckin = (e: React.FormEvent) => {
    e.preventDefault();
    const score = calculateReadinessScore(
      sleepHours,
      sleepQuality,
      energyLevel,
      sorenessLevel,
    );
    onSaveReadiness({
      date: today,
      sleepHours,
      sleepQuality,
      energyLevel,
      sorenessLevel,
      score,
      updatedAt: new Date().toISOString(),
      source: 'manual',
      sleepSessionId: todayReadiness?.sleepSessionId,
      physicalRecoveryPct: todayReadiness?.physicalRecoveryPct,
      mentalRecoveryPct: todayReadiness?.mentalRecoveryPct,
      sleepRecommendation: todayReadiness?.sleepRecommendation,
      deepSleepPct: todayReadiness?.deepSleepPct,
      remSleepPct: todayReadiness?.remSleepPct,
      completedCycles90: todayReadiness?.completedCycles90,
      restingBpm: todayReadiness?.restingBpm,
      hrvRmssdMs: todayReadiness?.hrvRmssdMs,
      pulseRecordId: todayReadiness?.pulseRecordId,
    });
    setShowCheckinForm(false);
  };

  const readinessTone = !todayReadiness
    ? { text: 'Sin check-in', color: 'text-zinc-300' }
    : todayReadiness.score >= 78
      ? { text: 'Óptima', color: 'text-emerald-400' }
      : todayReadiness.score >= 55
        ? { text: 'Moderada', color: 'text-[#D4FF33]' }
        : { text: 'Descarga ligera', color: 'text-amber-400' };

  return (
    <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-[#D4FF33]">Resumen diario unificado</p>
          <h2 className="text-xl sm:text-2xl font-extrabold font-display text-white">
            Hoy en PulsoFit
          </h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowCheckinForm((v) => !v)}
            className="min-h-[40px] rounded-xl border border-[#2B303C] bg-[#181B23] hover:border-[#D4FF33]/50 px-3 text-xs font-bold text-white flex items-center gap-1.5"
          >
            <HeartPulse className="w-3.5 h-3.5 text-[#D4FF33]" />
            {todayReadiness ? `${todayReadiness.score}%` : 'Check-in'}
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expandir resumen de hoy' : 'Contraer resumen de hoy'}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-[#222631] bg-[#161922] text-zinc-400 hover:text-white"
          >
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {showCheckinForm && (
        <form
          onSubmit={handleSaveCheckin}
          className="rounded-2xl border border-[#D4FF33]/35 bg-[#0D0F14] p-4 space-y-3.5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Moon className="w-4 h-4 text-[#D4FF33]" />
              <span className="text-sm font-bold text-white">
                Check-in de recuperación (10 seg)
              </span>
            </div>
            <span className="font-mono tabular-nums text-sm font-extrabold text-[#D4FF33]">
              Índice: {previewScore}/100
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-zinc-300">Horas de sueño</span>
                <span className="font-mono font-bold text-white">{sleepHours} h</span>
              </div>
              <input
                type="range"
                min={3}
                max={11}
                step={0.5}
                value={sleepHours}
                onChange={(e) => setSleepHours(parseFloat(e.target.value))}
                className="w-full accent-[#D4FF33]"
              />
            </div>

            <div>
              <span className="block text-xs text-zinc-300 mb-1">Calidad de sueño (1–5)</span>
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setSleepQuality(n)}
                    className={`min-h-[38px] rounded-xl text-xs font-mono font-bold ${
                      sleepQuality === n
                        ? 'bg-[#D4FF33] text-[#0A0B0D]'
                        : 'bg-[#171A23] text-zinc-300'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="block text-xs text-zinc-300 mb-1">Energía hoy (1–5)</span>
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setEnergyLevel(n)}
                    className={`min-h-[38px] rounded-xl text-xs font-mono font-bold ${
                      energyLevel === n
                        ? 'bg-[#D4FF33] text-[#0A0B0D]'
                        : 'bg-[#171A23] text-zinc-300'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="block text-xs text-zinc-300 mb-1">
                Dolor muscular (1 limpio · 5 muy cargado)
              </span>
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setSorenessLevel(n)}
                    className={`min-h-[38px] rounded-xl text-xs font-mono font-bold ${
                      sorenessLevel === n
                        ? 'bg-[#D4FF33] text-[#0A0B0D]'
                        : 'bg-[#171A23] text-zinc-300'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {todayReadiness &&
            typeof todayReadiness.physicalRecoveryPct === 'number' &&
            typeof todayReadiness.mentalRecoveryPct === 'number' && (
              <div className="rounded-xl border border-[#222735] bg-[#12151E] p-3 space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-200">
                      <Dumbbell className="w-3.5 h-3.5 text-emerald-400" />
                      Recuperación Física
                    </span>
                    <span className="font-mono tabular-nums text-sm font-extrabold text-emerald-300">
                      {todayReadiness.physicalRecoveryPct}%
                    </span>
                  </div>
                  <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 px-3 py-2 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-cyan-200">
                      <Brain className="w-3.5 h-3.5 text-cyan-400" />
                      Recuperación Mental / Enfoque
                    </span>
                    <span className="font-mono tabular-nums text-sm font-extrabold text-cyan-300">
                      {todayReadiness.mentalRecoveryPct}%
                    </span>
                  </div>
                </div>
                {todayReadiness.sleepRecommendation && (
                  <p className="text-[11px] text-zinc-300 leading-relaxed flex items-start gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#D4FF33] shrink-0 mt-0.5" />
                    <span>{todayReadiness.sleepRecommendation}</span>
                  </p>
                )}
              </div>
            )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {onOpenSleep && (
                <button
                  type="button"
                  onClick={() => {
                    setShowCheckinForm(false);
                    onOpenSleep();
                  }}
                  className="min-h-[42px] rounded-xl border border-indigo-400/40 bg-indigo-500/10 px-3.5 text-xs font-bold text-indigo-200 inline-flex items-center gap-1.5"
                >
                  <Moon className="w-3.5 h-3.5" />
                  Sueño y Descanso
                </button>
              )}
              {onOpenPulse && (
                <button
                  type="button"
                  onClick={() => {
                    setShowCheckinForm(false);
                    onOpenPulse();
                  }}
                  className="min-h-[42px] rounded-xl border border-rose-400/40 bg-rose-500/10 px-3.5 text-xs font-bold text-rose-200 inline-flex items-center gap-1.5"
                >
                  <HeartPulse className="w-3.5 h-3.5" />
                  Pulso y Presión (PPG)
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCheckinForm(false)}
                className="min-h-[42px] rounded-xl bg-[#181B23] px-4 text-xs font-semibold text-zinc-300"
              >
                Cerrar
              </button>
              <button
                type="submit"
                className="min-h-[42px] rounded-xl bg-[#D4FF33] px-4 text-xs font-extrabold text-[#0A0B0D]"
              >
                Guardar recuperación
              </button>
            </div>
          </div>
        </form>
      )}

      {!collapsed && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <button
              type="button"
              onClick={() => setShowCheckinForm(true)}
              className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3 text-left hover:border-[#D4FF33]/40 transition-colors"
            >
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>Preparación hoy</span>
                <Activity className="w-3.5 h-3.5 text-[#D4FF33]" />
              </div>
              <p className={`mt-1 text-base font-extrabold font-mono tabular-nums ${readinessTone.color}`}>
                {todayReadiness ? `${todayReadiness.score}/100` : 'Registrar'}
              </p>
              <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                {todayReadiness
                  ? typeof todayReadiness.physicalRecoveryPct === 'number' &&
                    typeof todayReadiness.mentalRecoveryPct === 'number'
                    ? `Física ${todayReadiness.physicalRecoveryPct}% · Mental ${todayReadiness.mentalRecoveryPct}%`
                    : todayReadiness.restingBpm && todayReadiness.hrvRmssdMs
                      ? `${todayReadiness.restingBpm} BPM · HRV ${todayReadiness.hrvRmssdMs}ms`
                      : `${todayReadiness.sleepHours}h sueño · ${
                          todayReadiness.source === 'sueno' ? 'Auto sueño' : readinessTone.text
                        }`
                  : 'Toca para check-in'}
              </p>
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('nutricion')}
              className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3 text-left hover:border-[#D4FF33]/40 transition-colors"
            >
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>Macros restantes</span>
                <Utensils className="w-3.5 h-3.5 text-[#D4FF33]" />
              </div>
              <p className="mt-1 text-base font-extrabold font-mono tabular-nums text-white">
                {remainingCal.toLocaleString('es-ES')} kcal
              </p>
              <p className="text-[11px] font-mono text-zinc-400 truncate mt-0.5">
                Faltan {remainingProtein}g proteína
              </p>
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('nutricion')}
              className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3 text-left hover:border-sky-400/40 transition-colors"
            >
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>Hidratación</span>
                <Droplets className="w-3.5 h-3.5 text-sky-400" />
              </div>
              <p className="mt-1 text-base font-extrabold font-mono tabular-nums text-sky-300">
                {formatLiquidPrimary(waterMl, liquidUnit)}
              </p>
              <p className="text-[11px] font-mono text-zinc-400 truncate mt-0.5">
                Meta: {formatLiquidPrimary(hydGoal.totalTargetMl, liquidUnit)}
              </p>
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('nutricion')}
              className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3 text-left hover:border-emerald-400/40 transition-colors"
            >
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>Ayuno / Ventana</span>
                <Flame className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <p className="mt-1 text-base font-extrabold font-mono tabular-nums text-emerald-300 truncate">
                {fastLabel}
              </p>
              <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                {activeFast ? `Protocolo ${activeFast.protocol}` : 'Lista para comidas'}
              </p>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/5">
            <p className="text-xs text-zinc-300 truncate">
              Sugerencia hoy: <strong className="text-white">{recommendedTitle}</strong>
            </p>
            <button
              type="button"
              onClick={onStartRecommended}
              className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl bg-[#D4FF33] px-4 text-xs font-extrabold text-[#0A0B0D] active:scale-[0.98]"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Empezar rutina sugerida
            </button>
          </div>
        </>
      )}
    </section>
  );
};
