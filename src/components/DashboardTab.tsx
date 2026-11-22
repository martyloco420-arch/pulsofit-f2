import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bluetooth,
  Calendar,
  HeartPulse,
  LayoutGrid,
  Users,
} from 'lucide-react';
import { calculateNutritionTargets } from '../data/foods';
import { shiftIsoDate } from '../lib/compareDates';
import type { PersonalCoachContext } from '../lib/aiClient';
import {
  computeDailyExerciseBurn,
  computeRecoveryIndex0To100,
  computeSleepPulseIntensityAlert,
} from '../lib/crossModuleIntelligence';
import {
  computeDailyActivitySummary,
  getCalendarWeekSunToSat,
} from '../lib/dailyActivity';
import { computeHydrationGoal } from '../lib/hydration';
import { getLocalDateKey, getTodayIsoDate } from '../lib/storage';
import { computeFlexibleStreakSummary } from '../lib/streakEngine';
import {
  formatLiquid,
  formatWeight,
  getDistanceUnit,
  getLiquidUnit,
  getWeightUnit,
  kgToDisplayWeight,
} from '../lib/units';
import type {
  AppDatabase,
  CoachChatMessage,
  CoachPersonality,
  ManualDailyActivity,
  ProfileSlot,
  TabId,
  UserProfile,
  WeightUnit,
} from '../types/fitness';
import { DailyActivityWidget } from './DailyActivityWidget';
import { PersonalCoachCard } from './PersonalCoachCard';
import { ShiftModePauseCard } from './ShiftModePauseCard';
import { StreakShieldWidget } from './StreakShieldWidget';

const StepsAnalyticsModal = React.lazy(() =>
  import('./StepsAnalyticsModal').then((m) => ({
    default: m.StepsAnalyticsModal,
  })),
);

interface DashboardTabProps {
  database: AppDatabase;
  profileSlots: ProfileSlot[];
  activeProfileId: string;
  onSelectProfile: (slotId: string) => void;
  onUpdateProfile: (profile: UserProfile) => void;
  onNavigateTab: (tab: TabId) => void;
  onOpenScale: () => void;
  onOpenSleep?: () => void;
  onOpenPulse?: () => void;
  onAddManualSteps?: (date: string, deltaSteps: number) => void;
  onImportManualActivity?: (entries: ManualDailyActivity[]) => void;
  onUpdateCoachState?: (
    personality: CoachPersonality,
    nextHistory: CoachChatMessage[],
  ) => void;
  onToggleScheduledRestToday?: (dateIso: string) => void;
  onAddElectrolytesAndWater?: (dateIso: string) => void;
  onCompleteActivePause?: (dateIso: string, minutesEarned: number) => void;
}

function formatHeaderLocalDateEs(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(dt.getTime())) return dateIso;
  return dt.toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  database,
  profileSlots,
  activeProfileId,
  onSelectProfile,
  onUpdateProfile,
  onNavigateTab,
  onOpenScale,
  onOpenSleep,
  onOpenPulse,
  onAddManualSteps,
  onImportManualActivity,
  onUpdateCoachState,
  onToggleScheduledRestToday,
  onAddElectrolytesAndWater,
  onCompleteActivePause,
}) => {
  const [stepsModalDate, setStepsModalDate] = useState<string | null>(null);

  const profile = database.profile;
  const weightUnit = getWeightUnit(profile.weightUnit);
  const distanceUnit = getDistanceUnit(profile.distanceUnit);
  const liquidUnit = getLiquidUnit(profile.liquidUnit);
  const todayIso = getTodayIsoDate();

  const [selectedDayKey, setSelectedDayKey] = useState<string>(todayIso);
  const selectedDayRef = useRef(selectedDayKey);
  selectedDayRef.current = selectedDayKey;

  const addManualStepsRef = useRef(onAddManualSteps);
  addManualStepsRef.current = onAddManualSteps;

  const importManualActivityRef = useRef(onImportManualActivity);
  importManualActivityRef.current = onImportManualActivity;

  const onOpenStepsDetail = useCallback(() => {
    setStepsModalDate(selectedDayRef.current);
  }, []);

  const onSelectDay = useCallback((dateIso: string) => {
    setSelectedDayKey(dateIso);
  }, []);

  const onQuickAddSteps = useCallback((dateIso: string, deltaSteps: number) => {
    addManualStepsRef.current?.(dateIso, deltaSteps);
  }, []);

  const onImportActivityStable = useCallback((entries: ManualDailyActivity[]) => {
    importManualActivityRef.current?.(entries);
  }, []);

  const handleToggleWeightUnit = (unit: WeightUnit) => {
    if (unit === weightUnit) return;
    onUpdateProfile({
      ...profile,
      weightUnit: unit,
    });
  };

  // Activity Widget Summary (memoized cleanly with primitive dependencies)
  const activityWidgetSummary = useMemo(() => {
    const scopedDb: AppDatabase = { ...database, profile };
    return computeDailyActivitySummary(scopedDb, selectedDayKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedDayKey,
    profile.dailyStepsGoal,
    profile.dailyActiveMinGoal,
    profile.dailyActiveKcalGoal,
    profile.weightKg,
    profile.heightCm,
    profile.age,
    profile.sex,
    database.workouts,
    database.cardioSessions,
    database.hiitSessions,
    database.manualActivityByDate,
  ]);

  const weekDaysSerialized = useMemo(() => {
    const scopedDb: AppDatabase = { ...database, profile };
    return getCalendarWeekSunToSat(scopedDb, todayIso)
      .map((d) =>
        [
          d.date,
          d.letter,
          d.dayNumber,
          d.isToday ? '1' : '0',
          d.isFuture ? '1' : '0',
          d.summary.stepsPct,
          d.summary.activeMinPct,
          d.summary.activeKcalPct,
        ].join('|'),
      )
      .join(';');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    todayIso,
    profile.dailyStepsGoal,
    profile.dailyActiveMinGoal,
    profile.dailyActiveKcalGoal,
    profile.weightKg,
    profile.heightCm,
    profile.age,
    profile.sex,
    database.workouts,
    database.cardioSessions,
    database.hiitSessions,
    database.manualActivityByDate,
  ]);

  const recoveryIndex = useMemo(
    () => computeRecoveryIndex0To100(database),
    [database],
  );

  const sleepPulseAlert = useMemo(
    () => computeSleepPulseIntensityAlert(database),
    [database],
  );

  const streakSummary = useMemo(
    () => computeFlexibleStreakSummary(database, todayIso),
    [database, todayIso],
  );

  const todayWaterMl = Math.max(0, database.hydrationByDate?.[todayIso] ?? 0);
  const todayElectrolytes = Math.max(0, database.electrolytesByDate?.[todayIso] ?? 0);
  const todayPausaCount = Math.max(
    0,
    database.manualActivityByDate?.[todayIso]?.pausaActivaCount ?? 0,
  );

  // Consolidated Multi-Tab Context (all 8 tabs) for Personal AI Assistant
  const personalCoachContext = useMemo<PersonalCoachContext>(() => {
    const todayAct = computeDailyActivitySummary(database, todayIso);
    const todayBurn = computeDailyExerciseBurn(
      profile,
      database.workouts,
      database.cardioSessions ?? [],
      database.hiitSessions ?? [],
      todayIso,
    );
    const fallbackTargets = calculateNutritionTargets(profile);
    const baseCalTarget = database.adaptiveNutrition?.calorieTarget ?? fallbackTargets.calories;
    const proteinTargetG = database.adaptiveNutrition?.proteinG ?? fallbackTargets.proteinG;
    const caloriesTarget = baseCalTarget + todayBurn.totalExerciseKcal;

    const todayFoods = database.foodLogs.filter((f) => f.date === todayIso);
    const caloriesConsumed = Math.round(
      todayFoods.reduce((s, f) => s + (f.calories || 0), 0),
    );
    const proteinConsumedG = Math.round(
      todayFoods.reduce((s, f) => s + (f.proteinG || 0), 0),
    );

    const waterGoalToday = computeHydrationGoal(
      profile,
      database.bodyWeights,
      database.bodyScans,
      database.workouts,
      database.hydrationSettings ?? {
        mlPerKg: 35,
        containerMl: 500,
        wakeHour: 7,
        sleepHour: 22,
        hotDayByDate: {},
        remindersEnabled: false,
      },
      todayIso,
      database.cardioSessions ?? [],
      database.hiitSessions ?? [],
    ).totalTargetMl;
    const waterPct =
      waterGoalToday > 0 ? Math.min(100, Math.round((todayWaterMl / waterGoalToday) * 100)) : 0;

    // Weight 7d & 30d + latest composition
    const weightMap = new Map<string, number>();
    for (const bw of database.bodyWeights) {
      if (bw.date && Number.isFinite(bw.weightKg) && bw.weightKg > 0) {
        weightMap.set(bw.date, bw.weightKg);
      }
    }
    for (const sc of database.bodyScans) {
      if (sc.date && Number.isFinite(sc.weightKg) && sc.weightKg > 0) {
        weightMap.set(sc.date, sc.weightKg);
      }
    }
    const weightPoints = Array.from(weightMap.entries())
      .map(([date, kg]) => ({ date, kg }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const latestW = weightPoints[weightPoints.length - 1] ?? null;
    const sevenDaysAgoIso = shiftIsoDate(todayIso, -7);
    const thirtyDaysAgoIso = shiftIsoDate(todayIso, -30);

    const findBaseline = (cutoffIso: string) => {
      const candidates = weightPoints.filter((w) => w.date >= cutoffIso);
      if (candidates.length >= 2) return candidates[0];
      return weightPoints.length >= 2 ? weightPoints[0] : null;
    };

    const formatDelta = (baseKg: number | null | undefined) => {
      if (!latestW || !baseKg) return null;
      const diffDisplay =
        Math.round(
          (kgToDisplayWeight(latestW.kg, weightUnit) -
            kgToDisplayWeight(baseKg, weightUnit)) *
            10,
        ) / 10;
      const sign = diffDisplay > 0 ? '+' : '';
      return `${sign}${diffDisplay} ${weightUnit}`;
    };

    const base7 = findBaseline(sevenDaysAgoIso);
    const base30 = findBaseline(thirtyDaysAgoIso);
    const weekStartIso = shiftIsoDate(todayIso, -6);

    const workoutsLast7Days =
      database.workouts.filter((w) => {
        const d = getLocalDateKey(w.completedAt);
        return d >= weekStartIso && d <= todayIso;
      }).length +
      (database.cardioSessions ?? []).filter((c) => {
        const d = getLocalDateKey(c.date || c.completedAt);
        return d >= weekStartIso && d <= todayIso;
      }).length +
      (database.hiitSessions ?? []).filter((h) => {
        const d = getLocalDateKey(h.date || h.completedAt);
        return d >= weekStartIso && d <= todayIso;
      }).length;

    const latestWorkout = [...database.workouts].sort((a, b) =>
      b.completedAt.localeCompare(a.completedAt),
    )[0];
    let lastWorkoutSummary: string | null = null;
    if (latestWorkout) {
      const rpes = latestWorkout.exercises
        .flatMap((ex) => ex.sets)
        .map((s) => s.rpe)
        .filter((r): r is number => typeof r === 'number' && r > 0);
      const avgRpe =
        rpes.length > 0
          ? (rpes.reduce((a, b) => a + b, 0) / rpes.length).toFixed(1)
          : null;
      lastWorkoutSummary = avgRpe
        ? `${latestWorkout.title} · RPE ${avgRpe}`
        : latestWorkout.title;
    }

    const latestScan = [...database.bodyScans].sort((a, b) =>
      b.recordedAt.localeCompare(a.recordedAt),
    )[0];
    const latestBp = [...(database.bloodPressureRecords ?? [])].sort((a, b) =>
      b.recordedAt.localeCompare(a.recordedAt),
    )[0];

    return {
      profileName: profile.name || 'Atleta',
      goal: profile.goal,
      weightUnit,
      liquidUnit,
      personality: database.coachPersonality ?? 'sargento',
      daysSinceLastWorkout: streakSummary.daysSinceLastWorkout,
      workoutsLast7Days,
      trainedToday: streakSummary.isTodayTrained,
      lastWorkoutSummary,
      latestWeightDisplay: latestW ? formatWeight(latestW.kg, weightUnit) : null,
      weightDelta7dDisplay: base7 && base7.date !== latestW?.date ? formatDelta(base7.kg) : null,
      weightDelta30dDisplay: base30 && base30.date !== latestW?.date ? formatDelta(base30.kg) : null,
      bodyFatPct: latestScan ? latestScan.bodyFatPct : null,
      muscleMassPct: latestScan ? latestScan.totalMusclePct : null,
      todaySteps: todayAct.steps,
      stepsGoal: todayAct.stepsGoal,
      activeMinutesToday: todayAct.activeMin,
      activeMinutesGoal: todayAct.activeMinGoal,
      activeKcalToday: todayAct.activeKcal,
      activeKcalGoal: todayAct.activeKcalGoal,
      waterConsumedDisplay: formatLiquid(todayWaterMl, liquidUnit),
      waterTargetDisplay: formatLiquid(waterGoalToday, liquidUnit),
      waterPct,
      electrolytesToday: todayElectrolytes,
      pausaActivaDoneToday: todayPausaCount > 0,
      caloriesConsumed,
      caloriesTarget,
      proteinConsumedG,
      proteinTargetG,
      sleepQualityPct: recoveryIndex.sleepQualityPct,
      sleepHours:
        recoveryIndex.sleepDurationMin !== null
          ? Math.round((recoveryIndex.sleepDurationMin / 60) * 10) / 10
          : null,
      pulseBpm: recoveryIndex.bpm,
      hrvMs: recoveryIndex.hrvMs,
      stressLabel: recoveryIndex.stressLabel,
      lastBpDisplay: latestBp
        ? `${latestBp.systolic}/${latestBp.diastolic} mmHg (${latestBp.category})`
        : null,
      recoveryIndexScore: recoveryIndex.score,
      recoveryStatusLabel: recoveryIndex.statusLabel,
      streakDays: streakSummary.streakDays,
      shieldUsedInCurrent7d: streakSummary.shieldUsedInCurrent7d,
      isTodayRestShield: streakSummary.isTodayScheduledRest,
    };
  }, [
    database,
    profile,
    todayIso,
    weightUnit,
    liquidUnit,
    todayWaterMl,
    todayElectrolytes,
    todayPausaCount,
    recoveryIndex,
    streakSummary,
  ]);

  return (
    <div className="space-y-4 pb-8">
      {/* BLOQUE 1: Encabezado de Hoy (Perfil, Fecha local, KG|LB y accesos rápidos Báscula / Salud PPG) */}
      <header className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[#D4FF33] text-xs font-bold">
              <LayoutGrid className="w-4 h-4" />
              <span>PulsoFit · Hoy</span>
              <span className="text-zinc-500">·</span>
              <span className="inline-flex items-center gap-1 text-zinc-300 capitalize">
                <Calendar className="w-3.5 h-3.5 text-zinc-400" />
                {formatHeaderLocalDateEs(todayIso)}
              </span>
            </div>
            <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold font-display tracking-tight text-white">
              Dashboard
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Active Profile Selector */}
            <label className="sr-only" htmlFor="dashboard-profile-select">
              Perfil activo
            </label>
            <div className="relative flex items-center">
              <Users className="w-3.5 h-3.5 text-[#D4FF33] absolute left-3 pointer-events-none" />
              <select
                id="dashboard-profile-select"
                value={activeProfileId}
                onChange={(e) => onSelectProfile(e.target.value)}
                aria-label="Cambiar perfil activo en Dashboard"
                className="min-h-[38px] rounded-xl border border-[#262B38] bg-[#0B0C0F] pl-8 pr-7 text-xs font-bold text-white focus:border-[#D4FF33] focus:outline-none"
              >
                {profileSlots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.label}
                  </option>
                ))}
              </select>
            </div>

            {/* KG | LB Switch */}
            <div
              role="group"
              aria-label="Unidad de peso"
              className="inline-flex rounded-xl border border-[#242936] bg-[#0B0C0F] p-1"
            >
              {(['kg', 'lb'] as WeightUnit[]).map((u) => {
                const active = weightUnit === u;
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => handleToggleWeightUnit(u)}
                    className={`min-h-[30px] min-w-[36px] px-2 rounded-lg text-[11px] font-extrabold uppercase tracking-wider transition-colors ${
                      active
                        ? 'bg-[#D4FF33] text-[#0A0B0D]'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {u}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Quick Actions: Báscula BLE & Escáner PPG / Salud */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onOpenScale}
            className="min-h-[42px] rounded-2xl border border-[#262B38] bg-[#0B0D12] hover:border-[#D4FF33]/50 px-3.5 text-xs font-extrabold text-white flex items-center justify-center gap-2 transition-colors"
          >
            <Bluetooth className="w-4 h-4 text-[#D4FF33]" />
            <span>Báscula BLE</span>
          </button>
          <button
            type="button"
            onClick={() => (onOpenPulse ? onOpenPulse() : onNavigateTab('salud'))}
            className="min-h-[42px] rounded-2xl border border-[#262B38] bg-[#0B0D12] hover:border-rose-400/50 px-3.5 text-xs font-extrabold text-white flex items-center justify-center gap-2 transition-colors"
          >
            <HeartPulse className="w-4 h-4 text-rose-400" />
            <span>Escáner PPG / Salud</span>
          </button>
        </div>
      </header>

      {/* BLOQUE 2: Resumen AI Assistant (Multi-Tab: Qué va bien / Qué va flojo / Siguiente acción) */}
      <PersonalCoachCard
        profileKey={activeProfileId}
        personality={database.coachPersonality ?? 'sargento'}
        chatHistory={database.coachChatHistory ?? []}
        preferredVoiceUri={profile.preferredVoiceUri}
        context={personalCoachContext}
        onUpdateCoachState={(nextPersonality, nextHistory) =>
          onUpdateCoachState?.(nextPersonality, nextHistory)
        }
      />

      {/* BLOQUE 3: Actividad y Recuperación (Corazón 3 Anillos + Tira Semanal + Índice Recuperación 0–100) */}
      <div className="space-y-4">
        {sleepPulseAlert && (
          <section
            role="status"
            className="rounded-3xl border border-amber-400/40 bg-amber-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-9 h-9 rounded-2xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center shrink-0 mt-0.5">
                <AlertTriangle className="w-4 h-4 text-amber-300" />
              </div>
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs sm:text-sm font-extrabold text-amber-200">
                  {sleepPulseAlert.title}
                </p>
                <p className="text-xs text-zinc-200 leading-relaxed">
                  {sleepPulseAlert.message} {sleepPulseAlert.suggestion}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onNavigateTab('entrenar')}
                className="min-h-[36px] rounded-xl bg-[#D4FF33] px-3 text-xs font-extrabold text-[#0A0B0D]"
              >
                Ajustar en Entrenar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (sleepPulseAlert.lowSleepQuality && onOpenSleep) {
                    onOpenSleep();
                  } else if (onOpenPulse) {
                    onOpenPulse();
                  } else {
                    onNavigateTab('salud');
                  }
                }}
                className="min-h-[36px] rounded-xl border border-amber-400/40 bg-[#12141A] px-3 text-xs font-bold text-amber-200 hover:text-white"
              >
                Ver Salud / Sueño
              </button>
            </div>
          </section>
        )}

        <DailyActivityWidget
          steps={activityWidgetSummary.steps}
          stepsGoal={activityWidgetSummary.stepsGoal}
          activeMinutes={activityWidgetSummary.activeMin}
          activeMinutesGoal={activityWidgetSummary.activeMinGoal}
          activeCalories={activityWidgetSummary.activeKcal}
          activeCaloriesGoal={activityWidgetSummary.activeKcalGoal}
          totalCalories={activityWidgetSummary.totalCalories}
          distanceKm={activityWidgetSummary.activeDistanceKm}
          selectedDayKey={selectedDayKey}
          todayKey={todayIso}
          distanceUnit={distanceUnit}
          profileHeightCm={profile.heightCm || 175}
          weekDaysSerialized={weekDaysSerialized}
          canQuickAddSteps={Boolean(onAddManualSteps)}
          canImportCsv={Boolean(onImportManualActivity)}
          onOpenStepsDetail={onOpenStepsDetail}
          onSelectDay={onSelectDay}
          onQuickAddSteps={onQuickAddSteps}
          onImportManualActivity={onImportManualActivity ? onImportActivityStable : undefined}
        />

        {/* Índice de Recuperación (0–100) */}
        <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="w-14 h-14 rounded-2xl border border-white/10 bg-[#0B0D12] flex flex-col items-center justify-center shrink-0"
                style={{ borderColor: `${recoveryIndex.accentHex}55` }}
              >
                <span
                  className="text-xl font-extrabold font-mono tabular-nums leading-none"
                  style={{ color: recoveryIndex.accentHex }}
                >
                  {recoveryIndex.score}
                </span>
                <span className="text-[9px] font-bold text-zinc-500 mt-0.5">/ 100</span>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-300">
                  <Activity className="w-4 h-4" />
                  <span>Índice de Recuperación</span>
                </div>
                <p className="text-base font-extrabold text-white">
                  {recoveryIndex.statusLabel}
                </p>
                <p className="text-xs text-zinc-400">{recoveryIndex.recommendation}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => (onOpenSleep ? onOpenSleep() : onNavigateTab('sueno'))}
                className="min-h-[36px] rounded-xl border border-[#262B38] bg-[#0D0F14] px-3 text-xs font-bold text-zinc-200 hover:border-indigo-400/50"
              >
                Sueño
              </button>
              <button
                type="button"
                onClick={() => (onOpenPulse ? onOpenPulse() : onNavigateTab('salud'))}
                className="min-h-[36px] rounded-xl border border-[#262B38] bg-[#0D0F14] px-3 text-xs font-bold text-zinc-200 hover:border-rose-400/50"
              >
                Salud / PPG
              </button>
            </div>
          </div>

          <div className="h-2 w-full rounded-full bg-[#1C2029] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${recoveryIndex.score}%`,
                backgroundColor: recoveryIndex.accentHex,
              }}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] px-3 py-2">
              <p className="text-[11px] text-zinc-400">Calidad sueño</p>
              <p className="mt-0.5 text-sm font-extrabold font-mono tabular-nums text-indigo-300">
                {recoveryIndex.sleepQualityPct !== null
                  ? `${recoveryIndex.sleepQualityPct}%`
                  : '—'}
              </p>
            </div>
            <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] px-3 py-2">
              <p className="text-[11px] text-zinc-400">Estrés / HRV</p>
              <p className="mt-0.5 text-sm font-extrabold font-mono tabular-nums text-emerald-300 truncate">
                {recoveryIndex.hrvMs !== null
                  ? `${recoveryIndex.hrvMs} ms`
                  : recoveryIndex.stressLabel}
              </p>
            </div>
            <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] px-3 py-2">
              <p className="text-[11px] text-zinc-400">Pulso reposo</p>
              <p className="mt-0.5 text-sm font-extrabold font-mono tabular-nums text-rose-300">
                {recoveryIndex.bpm !== null ? `${recoveryIndex.bpm} BPM` : '—'}
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* BLOQUE 4: Modo Turno / Pausa Activa (1 toque electrolitos +500ml y Pausa 5 min) */}
      <ShiftModePauseCard
        todayIso={todayIso}
        liquidUnit={liquidUnit}
        todayWaterMl={todayWaterMl}
        electrolytesToday={todayElectrolytes}
        pausaActivaCountToday={todayPausaCount}
        onAddElectrolytesAndWater={(d) => onAddElectrolytesAndWater?.(d)}
        onCompleteActivePause={(d, mins) => onCompleteActivePause?.(d, mins)}
      />

      {/* BLOQUE 5: Racha Activa (7, 30, 100 días + Escudo de Descanso) */}
      <StreakShieldWidget
        streak={streakSummary}
        onToggleScheduledRestToday={() => onToggleScheduledRestToday?.(todayIso)}
      />

      {stepsModalDate !== null && (
        <React.Suspense
          fallback={
            <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="w-full max-w-md h-64 rounded-3xl border border-[#222631] bg-[#12141A] animate-pulse" />
            </div>
          }
        >
          <StepsAnalyticsModal
            isOpen={stepsModalDate !== null}
            initialDateIso={stepsModalDate ?? undefined}
            database={database}
            onClose={() => setStepsModalDate(null)}
            onUpdateProfile={onUpdateProfile}
          />
        </React.Suspense>
      )}
    </div>
  );
};
