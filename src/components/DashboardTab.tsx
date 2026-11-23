import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Award,
  Bluetooth,
  Calendar,
  Droplets,
  Dumbbell,
  HeartPulse,
  LayoutGrid,
  Sparkles,
  Target,
  Users,
  Utensils,
} from 'lucide-react';
import type { PersonalCoachContext } from '../lib/aiClient';
import {
  buildDeterministicDailyBriefing,
  buildOmniscientCoachContext,
  computeRecoveryIndex0To100,
  computeSleepPulseIntensityAlert,
} from '../lib/crossModuleIntelligence';
import {
  computeDailyActivitySummary,
  getCalendarWeekSunToSat,
} from '../lib/dailyActivity';
import { triggerHaptic } from '../lib/haptics';
import { getTodayIsoDate } from '../lib/storage';
import { computeFlexibleStreakSummary } from '../lib/streakEngine';
import {
  getDistanceUnit,
  getLiquidUnit,
  getWeightUnit,
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

  // Consolidated Omniscient Context (Profile, Equipment, 7d/30d Biometrics, Workouts/PRs/RPE, Habits)
  const personalCoachContext = useMemo<PersonalCoachContext>(
    () => buildOmniscientCoachContext(database, activeProfileId),
    [database, activeProfileId],
  );

  const dailyBriefing = useMemo(
    () => buildDeterministicDailyBriefing(database, personalCoachContext),
    [database, personalCoachContext],
  );

  const handleSaveCustomGoal = useCallback(
    (nextCustomGoal: string) => {
      onUpdateProfile({
        ...profile,
        customGoal: nextCustomGoal.trim() || undefined,
      });
    },
    [onUpdateProfile, profile],
  );

  const ringRadius = 52;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const clampedScore = Math.max(0, Math.min(100, dailyBriefing.score));
  const ringDashOffset =
    ringCircumference - (clampedScore / 100) * ringCircumference;

  return (
    <div className="space-y-4 pb-8">
      {/* BLOQUE 1: Portada Hoy + Hero Readiness Ring SVG animado */}
      <header
        className="relative overflow-hidden rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-6 space-y-5"
        style={{
          backgroundImage: `radial-gradient(circle at 85% 20%, ${dailyBriefing.glowRgba.replace(/[\d.]+\)$/, '0.12)')}, transparent 52%)`,
        }}
      >
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
              Hola, {profile.name?.split(' ')[0] || 'Atleta'}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
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

        {/* Hero Readiness Ring + Biometric Readiness Telemetry */}
        <div className="rounded-2xl border border-white/10 bg-[#0B0D12]/85 p-4 sm:p-5 flex flex-col sm:flex-row items-center gap-5">
          <div className="relative flex items-center justify-center shrink-0">
            <div
              aria-hidden="true"
              className="absolute inset-2 rounded-full blur-xl opacity-75 transition-colors duration-500"
              style={{ backgroundColor: dailyBriefing.glowRgba }}
            />
            <svg
              width="132"
              height="132"
              viewBox="0 0 132 132"
              role="img"
              aria-label={`Readiness del día: ${clampedScore} de 100 (${dailyBriefing.tierLabel})`}
              className="relative -rotate-90"
            >
              <circle
                cx="66"
                cy="66"
                r={ringRadius}
                fill="none"
                stroke="#1E222E"
                strokeWidth="10"
              />
              <circle
                cx="66"
                cy="66"
                r={ringRadius}
                fill="none"
                stroke={dailyBriefing.accentHex}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringDashOffset}
                className="transition-[stroke-dashoffset,stroke] duration-700 ease-out"
                style={{
                  filter: `drop-shadow(0 0 8px ${dailyBriefing.glowRgba})`,
                }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-400">
                Readiness
              </span>
              <span
                className="text-3xl font-extrabold font-mono tabular-nums leading-none mt-0.5"
                style={{ color: dailyBriefing.accentHex }}
              >
                {clampedScore}
              </span>
              <span
                className="mt-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider border"
                style={{
                  color: dailyBriefing.accentHex,
                  borderColor: `${dailyBriefing.accentHex}55`,
                  backgroundColor: `${dailyBriefing.accentHex}18`,
                }}
              >
                {dailyBriefing.tierLabel}
              </span>
            </div>
          </div>

          <div className="flex-1 min-w-0 w-full space-y-3 text-center sm:text-left">
            <div>
              <p className="text-base sm:text-lg font-extrabold text-white leading-snug">
                {dailyBriefing.headline}
              </p>
              <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                {dailyBriefing.readinessSummary}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-[#222631] bg-[#12151E] px-2.5 py-2">
                <p className="text-[10px] text-zinc-400">Sueño</p>
                <p className="mt-0.5 text-xs sm:text-sm font-extrabold font-mono tabular-nums text-indigo-300">
                  {recoveryIndex.sleepQualityPct !== null
                    ? `${recoveryIndex.sleepQualityPct}%`
                    : '—'}
                </p>
              </div>
              <div className="rounded-xl border border-[#222631] bg-[#12151E] px-2.5 py-2">
                <p className="text-[10px] text-zinc-400">HRV / Estrés</p>
                <p className="mt-0.5 text-xs sm:text-sm font-extrabold font-mono tabular-nums text-emerald-300 truncate">
                  {recoveryIndex.hrvMs !== null
                    ? `${recoveryIndex.hrvMs} ms`
                    : recoveryIndex.stressLabel}
                </p>
              </div>
              <div className="rounded-xl border border-[#222631] bg-[#12151E] px-2.5 py-2">
                <p className="text-[10px] text-zinc-400">Pulso reposo</p>
                <p className="mt-0.5 text-xs sm:text-sm font-extrabold font-mono tabular-nums text-rose-300">
                  {recoveryIndex.bpm !== null ? `${recoveryIndex.bpm} BPM` : '—'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 pt-0.5">
              <button
                type="button"
                onClick={onOpenScale}
                className="min-h-[38px] rounded-xl border border-[#262B38] bg-[#141720] hover:border-[#D4FF33]/50 px-3 text-xs font-extrabold text-white inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Bluetooth className="w-3.5 h-3.5 text-[#D4FF33]" />
                <span>Báscula BLE</span>
              </button>
              <button
                type="button"
                onClick={() => (onOpenPulse ? onOpenPulse() : onNavigateTab('salud'))}
                className="min-h-[38px] rounded-xl border border-[#262B38] bg-[#141720] hover:border-rose-400/50 px-3 text-xs font-extrabold text-white inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <HeartPulse className="w-3.5 h-3.5 text-rose-400" />
                <span>Escáner PPG</span>
              </button>
              <button
                type="button"
                onClick={() => (onOpenSleep ? onOpenSleep() : onNavigateTab('sueno'))}
                className="col-span-2 sm:col-span-1 min-h-[38px] rounded-xl border border-[#262B38] bg-[#141720] hover:border-indigo-400/50 px-3 text-xs font-bold text-indigo-200 inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Activity className="w-3.5 h-3.5 text-indigo-300" />
                <span>Registrar Sueño</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* BLOQUE 2: Briefing del Día determinístico + Coach IA Personal lado a lado */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
        {/* Briefing del Día (100% determinístico con datos reales) */}
        <section
          aria-label="Briefing del Día"
          className="h-full flex flex-col justify-between rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-4"
        >
          <div className="space-y-3.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-[#D4FF33]">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Briefing del Día</span>
                </div>
                <h2 className="text-lg font-extrabold font-display text-white mt-0.5">
                  Plan operativo de hoy
                </h2>
              </div>
              <span
                className="rounded-xl border px-2.5 py-1 text-[11px] font-extrabold"
                style={{
                  color: dailyBriefing.accentHex,
                  borderColor: `${dailyBriefing.accentHex}44`,
                  backgroundColor: `${dailyBriefing.accentHex}14`,
                }}
              >
                {dailyBriefing.score}/100 · {dailyBriefing.tierLabel}
              </span>
            </div>

            <div className="rounded-2xl border border-[#242936] bg-[#0B0D12] p-3.5 space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Intensidad recomendada hoy
              </p>
              <p className="text-xs sm:text-sm font-semibold text-zinc-100 leading-relaxed">
                {dailyBriefing.trainingPrescription}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-400">
                  <Utensils className="w-3.5 h-3.5 text-lime-400" />
                  <span>Proteína restante</span>
                </div>
                <p className="text-lg font-extrabold font-mono tabular-nums text-white">
                  {dailyBriefing.proteinRemainingG} g
                </p>
                <p className="text-[10px] text-zinc-500 font-mono">
                  {dailyBriefing.caloriesRemaining} kcal por cubrir
                </p>
              </div>

              <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-400">
                  <Droplets className="w-3.5 h-3.5 text-sky-400" />
                  <span>Hidratación hoy</span>
                </div>
                <p className="text-lg font-extrabold font-mono tabular-nums text-sky-300">
                  {dailyBriefing.waterPct}%
                </p>
                <p className="text-[10px] text-zinc-500 font-mono truncate">
                  {dailyBriefing.waterStatusText}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="rounded-xl border border-[#222631] bg-[#0D0F14] px-3 py-2 flex items-center gap-2 text-xs">
                <Target className="w-3.5 h-3.5 text-[#D4FF33] shrink-0" />
                <span className="text-zinc-400 shrink-0">Objetivo:</span>
                <span className="font-bold text-white truncate">
                  {dailyBriefing.objectiveLabel}
                </span>
              </div>
              {dailyBriefing.latestPrLabel && (
                <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 flex items-center gap-2 text-xs">
                  <Award className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span className="text-amber-200 font-semibold truncate">
                    PR reciente: {dailyBriefing.latestPrLabel}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                triggerHaptic('light');
                onNavigateTab('entrenar');
              }}
              className="min-h-[42px] rounded-xl bg-[#D4FF33] text-[#0A0B0D] text-xs font-extrabold inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
            >
              <Dumbbell className="w-4 h-4" />
              <span>Ir a Entrenar</span>
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic('light');
                onNavigateTab('nutricion');
              }}
              className="min-h-[42px] rounded-xl border border-[#2A2F3D] bg-[#151821] hover:border-[#D4FF33]/50 text-xs font-bold text-white inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <Utensils className="w-4 h-4 text-[#D4FF33]" />
              <span>Nutrición</span>
            </button>
          </div>
        </section>

        <PersonalCoachCard
          profileKey={activeProfileId}
          personality={database.coachPersonality ?? 'sargento'}
          chatHistory={database.coachChatHistory ?? []}
          preferredVoiceUri={profile.preferredVoiceUri}
          context={personalCoachContext}
          onUpdateCoachState={(nextPersonality, nextHistory) =>
            onUpdateCoachState?.(nextPersonality, nextHistory)
          }
          onSaveCustomGoal={handleSaveCustomGoal}
        />
      </div>

      {/* BLOQUE 3: Actividad (Alerta Sueño/Pulso + Corazón 3 Anillos + Tira Semanal) */}
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
