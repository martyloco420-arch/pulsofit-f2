import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Check,
  Download,
  Dumbbell,
  Footprints,
  GitCompareArrows,
  History,
  Image as ImageIcon,
  Loader2,
  Moon,
  Scale,
  Share2,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { calculateNutritionTargets } from '../data/foods';
import { shiftIsoDate } from '../lib/compareDates';
import { createInitialMuscleFatigue } from '../lib/recovery';
import { type RecordDeleteTarget, getLocalDateKey, getTodayIsoDate } from '../lib/storage';
import {
  formatDistance,
  formatVolume,
  getDistanceUnit,
  getWeightUnit,
  kmToDisplayDistance,
} from '../lib/units';
import {
  type WeeklySummarySnapshot,
  computeWeeklySummarySnapshot,
  renderWeeklyShareCardDataUrl,
  shareOrDownloadWeeklyCard,
} from '../lib/weeklyShareCard';
import type { AppDatabase, UserProfile, WeightUnit } from '../types/fitness';
import { HistorialTab } from './HistorialTab';
import { ReadinessTrend7dCard } from './ReadinessTrend7dCard';
import { WeightTrendScatterCard } from './WeightTrendScatterCard';
import { WorkoutCalendarAnalyticsCard } from './WorkoutCalendarAnalyticsCard';

const CompareDatesView = React.lazy(() =>
  import('./CompareDatesView').then((m) => ({ default: m.CompareDatesView })),
);

const DarkCompareSkeleton: React.FC = () => (
  <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Cargando comparativa">
    <div className="h-14 rounded-2xl bg-[#12141A] border border-[#222631]" />
    <div className="h-56 rounded-3xl bg-[#12141A] border border-[#222631]" />
  </div>
);

interface ProgresoTabProps {
  database?: AppDatabase;
  profile: UserProfile;
  onUpdateProfile?: (profile: UserProfile) => void;
  openHistorialSignal?: number;
  onOpenScale?: () => void;
  onOpenSleep?: () => void;
  onOpenPulse?: () => void;
  onDeleteWorkout?: (id: string) => void;
  onDeleteHiitSession?: (id: string) => void;
  onDeleteCardioSession?: (id: string) => void;
  onDeleteBodyScan?: (id: string) => void;
  onDeleteBodyWeight?: (id: string) => void;
  onDeleteFood?: (id: string) => void;
  onDeleteFastHistory?: (id: string) => void;
  onDeleteSleepSession?: (id: string) => void;
  onDeletePulseRecord?: (id: string) => void;
  onDeleteBloodPressureRecord?: (id: string) => void;
  onDeleteWaterLog?: (date: string, target: RecordDeleteTarget | string) => void;
  onClearDay?: (dateIso: string, includePhotos: boolean) => Promise<void> | void;
}

type ProgresoSubTab = 'stats' | 'comparar' | 'historial';

interface CompositionPoint {
  date: string;
  shortDate: string;
  fatPct: number;
  musclePct: number;
  waterPct: number;
}

function formatShortDateEs(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(dt.getTime())) return dateIso;
  return dt
    .toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
    .replace('.', '');
}

function getShortDayLabel(dateIso: string, todayIso: string): {
  weekday: string;
  dayNum: string;
  isToday: boolean;
} {
  const [y, m, d] = dateIso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const weekday = Number.isNaN(dt.getTime())
    ? dateIso.slice(5)
    : dt
        .toLocaleDateString('es-MX', { weekday: 'short' })
        .replace('.', '')
        .slice(0, 3);
  return {
    weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1),
    dayNum: String(d || '').padStart(2, '0'),
    isToday: dateIso === todayIso,
  };
}

const CompositionTooltip: React.FC<{
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: CompositionPoint }>;
}> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;
  return (
    <div className="rounded-xl border border-[#2C3344] bg-[#0B0D12]/95 px-3 py-2 shadow-xl space-y-0.5 text-xs font-mono">
      <p className="text-[11px] font-sans text-zinc-400">{pt.date}</p>
      <p className="text-amber-300 font-bold">Grasa: {pt.fatPct.toFixed(1)}%</p>
      <p className="text-[#D4FF33] font-bold">Músculo: {pt.musclePct.toFixed(1)}%</p>
      <p className="text-sky-300 font-bold">Agua: {pt.waterPct.toFixed(1)}%</p>
    </div>
  );
};

export const ProgresoTab: React.FC<ProgresoTabProps> = ({
  database,
  profile,
  onUpdateProfile,
  openHistorialSignal = 0,
  onOpenScale,
  onOpenSleep,
  onOpenPulse,
  onDeleteWorkout = () => {},
  onDeleteHiitSession = () => {},
  onDeleteCardioSession = () => {},
  onDeleteBodyScan = () => {},
  onDeleteBodyWeight = () => {},
  onDeleteFood = () => {},
  onDeleteFastHistory = () => {},
  onDeleteSleepSession = () => {},
  onDeletePulseRecord = () => {},
  onDeleteBloodPressureRecord = () => {},
  onDeleteWaterLog,
  onClearDay,
}) => {
  const [subTab, setSubTab] = useState<ProgresoSubTab>(
    openHistorialSignal > 0 ? 'historial' : 'stats',
  );
  const [weeklyModalData, setWeeklyModalData] = useState<{
    snapshot: WeeklySummarySnapshot;
    dataUrl: string;
    fileName: string;
    summaryText: string;
  } | null>(null);
  const [isGeneratingCard, setIsGeneratingCard] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (openHistorialSignal > 0) setSubTab('historial');
  }, [openHistorialSignal]);

  const effectiveDatabase = useMemo<AppDatabase>(
    () =>
      database ?? {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        profile,
        muscleFatigue: createInitialMuscleFatigue(),
        activeWorkout: null,
        workouts: [],
        bodyWeights: [],
        bodyScans: [],
        foodLogs: [],
        hydrationByDate: {},
      },
    [database, profile],
  );

  const weightUnit = getWeightUnit(profile.weightUnit);
  const distanceUnit = getDistanceUnit(profile.distanceUnit);
  const todayIso = getTodayIsoDate();

  const handleToggleWeightUnit = (unit: WeightUnit) => {
    if (!onUpdateProfile || unit === weightUnit) return;
    onUpdateProfile({
      ...profile,
      weightUnit: unit,
    });
  };

  const baseTargets = useMemo(() => {
    const t = calculateNutritionTargets(profile);
    return {
      calories: effectiveDatabase.adaptiveNutrition?.calorieTarget ?? t.calories,
      proteinG: effectiveDatabase.adaptiveNutrition?.proteinG ?? t.proteinG,
    };
  }, [profile, effectiveDatabase.adaptiveNutrition]);

  const weekDates = useMemo(() => {
    const arr: string[] = [];
    for (let offset = -6; offset <= 0; offset += 1) {
      arr.push(shiftIsoDate(todayIso, offset));
    }
    return arr;
  }, [todayIso]);

  const weeklyDayRows = useMemo(() => {
    return weekDates.map((dateIso) => {
      const hasStrength =
        effectiveDatabase.workouts.some(
          (w) => getLocalDateKey(w.completedAt) === dateIso,
        ) ||
        (effectiveDatabase.hiitSessions ?? []).some(
          (h) => getLocalDateKey(h.date || h.completedAt) === dateIso,
        );

      const dayCardio = (effectiveDatabase.cardioSessions ?? []).filter(
        (c) => getLocalDateKey(c.date || c.completedAt) === dateIso,
      );
      const walkKm = dayCardio.reduce((sum, c) => sum + (c.distanceKm || 0), 0);
      const hasWalkOrCardio = dayCardio.length > 0;

      const dayFoods = effectiveDatabase.foodLogs.filter((f) => f.date === dateIso);
      const calories = dayFoods.reduce((sum, f) => sum + (f.calories || 0), 0);
      const proteinG = dayFoods.reduce((sum, f) => sum + (f.proteinG || 0), 0);
      const metProtein = proteinG >= baseTargets.proteinG * 0.85 && baseTargets.proteinG > 0;

      const sleepMatch = (effectiveDatabase.sleepSessions ?? []).find(
        (s) => getLocalDateKey(s.date || s.wakeUpAt) === dateIso,
      );
      const readinessSleep = effectiveDatabase.readinessByDate?.[dateIso]?.sleepHours ?? null;
      const sleepHours = sleepMatch
        ? Math.round((sleepMatch.durationMinutes / 60) * 10) / 10
        : readinessSleep !== null && readinessSleep > 0
          ? Math.round(readinessSleep * 10) / 10
          : null;

      return {
        dateIso,
        dayMeta: getShortDayLabel(dateIso, todayIso),
        hasStrength,
        hasWalkOrCardio,
        metProtein,
        walkKm: Math.round(walkKm * 100) / 100,
        calories,
        proteinG,
        sleepHours,
      };
    });
  }, [
    weekDates,
    todayIso,
    effectiveDatabase.workouts,
    effectiveDatabase.hiitSessions,
    effectiveDatabase.cardioSessions,
    effectiveDatabase.foodLogs,
    effectiveDatabase.sleepSessions,
    effectiveDatabase.readinessByDate,
    baseTargets.proteinG,
  ]);

  const weeklyTotals = useMemo(() => {
    const startIso = weekDates[0];
    const endIso = weekDates[weekDates.length - 1];

    const weekWorkouts = effectiveDatabase.workouts.filter((w) => {
      const d = getLocalDateKey(w.completedAt);
      return d >= startIso && d <= endIso;
    });
    const weekHiit = (effectiveDatabase.hiitSessions ?? []).filter((h) => {
      const d = getLocalDateKey(h.date || h.completedAt);
      return d >= startIso && d <= endIso;
    });
    const strengthCount = weekWorkouts.length + weekHiit.length;
    const strengthVolumeKg = weekWorkouts.reduce((sum, w) => sum + (w.totalVolumeKg || 0), 0);

    const weekCardio = (effectiveDatabase.cardioSessions ?? []).filter((c) => {
      const d = getLocalDateKey(c.date || c.completedAt);
      return d >= startIso && d <= endIso;
    });
    const totalCardioKm =
      Math.round(weekCardio.reduce((sum, c) => sum + (c.distanceKm || 0), 0) * 100) / 100;

    const calorieDays = weeklyDayRows.filter((d) => d.calories > 0);
    const avgCalories =
      calorieDays.length > 0
        ? Math.round(
            calorieDays.reduce((sum, d) => sum + d.calories, 0) / calorieDays.length,
          )
        : 0;

    const sleepDays = weeklyDayRows.filter((d) => d.sleepHours !== null);
    const avgSleepHours =
      sleepDays.length > 0
        ? Math.round(
            (sleepDays.reduce((sum, d) => sum + (d.sleepHours ?? 0), 0) / sleepDays.length) *
              10,
          ) / 10
        : null;

    return {
      strengthCount,
      strengthVolumeKg,
      cardioCount: weekCardio.length,
      totalCardioKm,
      avgCalories,
      calorieDaysLogged: calorieDays.length,
      avgSleepHours,
      sleepNightsLogged: sleepDays.length,
      strengthDaysCount: weeklyDayRows.filter((d) => d.hasStrength).length,
      cardioDaysCount: weeklyDayRows.filter((d) => d.hasWalkOrCardio).length,
      proteinDaysCount: weeklyDayRows.filter((d) => d.metProtein).length,
    };
  }, [
    weekDates,
    effectiveDatabase.workouts,
    effectiveDatabase.hiitSessions,
    effectiveDatabase.cardioSessions,
    weeklyDayRows,
  ]);

  // Body Composition Evolution Recharts Series (% Fat, % Muscle, % Water)
  const compositionSeries = useMemo<CompositionPoint[]>(() => {
    const byDate = new Map<string, CompositionPoint>();
    const asc = [...effectiveDatabase.bodyScans].sort((a, b) =>
      a.recordedAt.localeCompare(b.recordedAt),
    );
    for (const sc of asc) {
      const d = getLocalDateKey(sc.date || sc.recordedAt);
      if (!d) continue;
      byDate.set(d, {
        date: d,
        shortDate: formatShortDateEs(d),
        fatPct: Math.round(sc.bodyFatPct * 10) / 10,
        musclePct: Math.round(sc.totalMusclePct * 10) / 10,
        waterPct: Math.round(sc.bodyWaterPct * 10) / 10,
      });
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [effectiveDatabase.bodyScans]);

  const maxWeekDistance = Math.max(
    distanceUnit === 'mi' ? 3 : 5,
    ...weeklyDayRows.map((d) => kmToDisplayDistance(d.walkKm, distanceUnit)),
  );

  const sleepChartPoints = useMemo(
    () =>
      weeklyDayRows.map((row) => ({
        dateIso: row.dateIso,
        label: row.dayMeta.weekday,
        hours: row.sleepHours,
      })),
    [weeklyDayRows],
  );
  const recordedSleepPoints = sleepChartPoints.filter((p) => p.hours !== null);

  const handleOpenWeeklyShareCard = async () => {
    setIsGeneratingCard(true);
    setShareFeedback(null);
    try {
      const snapshot = computeWeeklySummarySnapshot(effectiveDatabase, todayIso);
      const rendered = await renderWeeklyShareCardDataUrl(snapshot, profile);
      setWeeklyModalData({
        snapshot,
        dataUrl: rendered.dataUrl,
        fileName: rendered.fileName,
        summaryText: rendered.summaryText,
      });
    } finally {
      setIsGeneratingCard(false);
    }
  };

  const handleExportWeeklyCard = async (mode: 'share' | 'download') => {
    if (!weeklyModalData) return;
    const outcome = await shareOrDownloadWeeklyCard(
      weeklyModalData.dataUrl,
      weeklyModalData.fileName,
      weeklyModalData.summaryText,
      mode,
    );
    setShareFeedback(
      outcome === 'shared'
        ? 'Tarjeta Semanal compartida correctamente.'
        : 'Imagen PNG (1080×1350) descargada.',
    );
  };

  return (
    <div className="space-y-5 pb-8">
      {/* Header + Generate Weekly Card CTA + KG|LB Switch */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[#D4FF33] text-xs font-bold">
              <TrendingUp className="w-4 h-4" />
              <span>Evolución Histórica y Comparativas</span>
            </div>
            <h1 className="mt-1 text-3xl sm:text-4xl font-extrabold font-display tracking-tight text-white">
              Progreso
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-zinc-400">
              Tendencias de peso, composición corporal, recuperación semanal, comparativas e historial completo.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleOpenWeeklyShareCard()}
              disabled={isGeneratingCard}
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-[#D4FF33] hover:bg-[#c5f022] px-3.5 text-xs font-extrabold text-[#0A0B0D] active:scale-[0.98] disabled:opacity-60"
            >
              {isGeneratingCard ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Generar Tarjeta Semanal
            </button>

            <div
              role="group"
              aria-label="Unidad de peso"
              className="inline-flex rounded-xl border border-[#242936] bg-[#12141A] p-1"
            >
              {(['kg', 'lb'] as WeightUnit[]).map((u) => {
                const active = weightUnit === u;
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => handleToggleWeightUnit(u)}
                    disabled={!onUpdateProfile}
                    className={`min-h-[30px] min-w-[38px] px-2.5 rounded-lg text-xs font-extrabold uppercase tracking-wider transition-colors ${
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

        {/* 3 Clean Sub-tabs: Evolución | Comparar | Historial */}
        <div
          role="tablist"
          aria-label="Vistas de Progreso"
          className="grid grid-cols-3 gap-1.5 rounded-2xl border border-[#222631] bg-[#12141A] p-1.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'stats'}
            onClick={() => setSubTab('stats')}
            className={`min-h-[42px] rounded-xl px-3 text-xs sm:text-sm font-extrabold inline-flex items-center justify-center gap-1.5 transition-colors ${
              subTab === 'stats'
                ? 'bg-[#D4FF33] text-[#0A0B0D]'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            <BarChart3 className="w-4 h-4 shrink-0" />
            <span>Evolución</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'comparar'}
            onClick={() => setSubTab('comparar')}
            className={`min-h-[42px] rounded-xl px-3 text-xs sm:text-sm font-extrabold inline-flex items-center justify-center gap-1.5 transition-colors ${
              subTab === 'comparar'
                ? 'bg-[#D4FF33] text-[#0A0B0D]'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            <GitCompareArrows className="w-4 h-4 shrink-0" />
            <span>Comparar</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'historial'}
            onClick={() => setSubTab('historial')}
            className={`min-h-[42px] rounded-xl px-3 text-xs sm:text-sm font-extrabold inline-flex items-center justify-center gap-1.5 transition-colors ${
              subTab === 'historial'
                ? 'bg-[#D4FF33] text-[#0A0B0D]'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            <History className="w-4 h-4 shrink-0" />
            <span>Historial</span>
          </button>
        </div>
      </header>

      {/* SUBTAB 1: EVOLUCIÓN HISTÓRICA */}
      {subTab === 'stats' && (
        <div className="space-y-4">
          {/* Resumen Semanal 7D KPI Strip (Sin duplicar anillos de Hoy) */}
          <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-extrabold uppercase tracking-wider text-zinc-400">
                Consolidado Últimos 7 Días
              </p>
              <span className="text-[11px] font-mono text-zinc-400">
                {weekDates[0]} → {weekDates[weekDates.length - 1]}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="rounded-2xl border border-[#222733] bg-[#0D0F14] p-3">
                <p className="text-[11px] text-zinc-400">Sesiones (7d)</p>
                <p className="mt-1 text-xl font-extrabold font-mono tabular-nums text-[#D4FF33]">
                  {weeklyTotals.strengthCount + weeklyTotals.cardioCount}
                </p>
                <p className="text-[10px] text-zinc-400">
                  {weeklyTotals.strengthCount} fuerza/HIIT · {weeklyTotals.cardioCount} cardio
                </p>
              </div>

              <div className="rounded-2xl border border-[#222733] bg-[#0D0F14] p-3">
                <p className="text-[11px] text-zinc-400">Volumen Fuerza</p>
                <p className="mt-1 text-xl font-extrabold font-mono tabular-nums text-white truncate">
                  {formatVolume(weeklyTotals.strengthVolumeKg, weightUnit)}
                </p>
                <p className="text-[10px] text-zinc-400">Carga acumulada 7d</p>
              </div>

              <div className="rounded-2xl border border-[#222733] bg-[#0D0F14] p-3">
                <p className="text-[11px] text-zinc-400">Distancia GPS</p>
                <p className="mt-1 text-xl font-extrabold font-mono tabular-nums text-sky-300">
                  {formatDistance(weeklyTotals.totalCardioKm, distanceUnit, 2)}
                </p>
                <p className="text-[10px] text-zinc-400">
                  {weeklyTotals.cardioDaysCount} días con cardio
                </p>
              </div>

              <div className="rounded-2xl border border-[#222733] bg-[#0D0F14] p-3">
                <p className="text-[11px] text-zinc-400">Sueño Medio</p>
                <p className="mt-1 text-xl font-extrabold font-mono tabular-nums text-indigo-300">
                  {weeklyTotals.avgSleepHours !== null
                    ? `${weeklyTotals.avgSleepHours} h`
                    : '--'}
                </p>
                <p className="text-[10px] text-zinc-400">
                  {weeklyTotals.avgCalories > 0
                    ? `Prom. ${weeklyTotals.avgCalories} kcal/d`
                    : `${weeklyTotals.sleepNightsLogged} noches reg.`}
                </p>
              </div>
            </div>
          </section>

          {/* Dispersión de Peso, Media Móvil 30d y Línea Compacta */}
          <WeightTrendScatterCard
            bodyWeights={effectiveDatabase.bodyWeights}
            bodyScans={effectiveDatabase.bodyScans}
            weightUnit={weightUnit}
            onOpenScale={onOpenScale}
          />

          {/* Evolución de Composición Corporal (% Grasa, % Músculo, % Agua) */}
          <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                  <Scale className="w-4 h-4" />
                  <span>Evolución de Composición Corporal (%)</span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Cambios históricos de grasa corporal, masa muscular y agua registrados en tu báscula
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-bold">
                <span className="text-amber-300">● Grasa %</span>
                <span className="text-[#D4FF33]">● Músculo %</span>
                <span className="text-sky-300">● Agua %</span>
              </div>
            </div>

            {compositionSeries.length >= 2 ? (
              <div className="rounded-2xl border border-[#1E2330] bg-[#0D0F14] pt-3 pb-1 px-2">
                <div className="w-full min-w-0" style={{ height: 190 }}>
                  <ResponsiveContainer width="100%" height={190}>
                    <LineChart
                      data={compositionSeries}
                      margin={{ top: 8, right: 12, left: -16, bottom: 2 }}
                    >
                      <CartesianGrid stroke="#1C212E" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="shortDate"
                        tick={{ fill: '#71717A', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={22}
                      />
                      <YAxis
                        domain={['dataMin - 4', 'dataMax + 4']}
                        tick={{ fill: '#71717A', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={40}
                        tickFormatter={(v: number) => `${v}%`}
                      />
                      <Tooltip content={<CompositionTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="fatPct"
                        stroke="#FCD34D"
                        strokeWidth={2.2}
                        dot={{ r: 3, fill: '#FCD34D' }}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="musclePct"
                        stroke="#D4FF33"
                        strokeWidth={2.4}
                        dot={{ r: 3, fill: '#D4FF33' }}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="waterPct"
                        stroke="#38BDF8"
                        strokeWidth={2.2}
                        dot={{ r: 3, fill: '#38BDF8' }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[#272C38] bg-[#0D0F14] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-zinc-400">
                  Registra al menos 2 escaneos en báscula para graficar la evolución de % Grasa, % Músculo y % Agua.
                </p>
                {onOpenScale && (
                  <button
                    type="button"
                    onClick={onOpenScale}
                    className="min-h-[36px] shrink-0 rounded-xl border border-[#2C3240] bg-[#161922] px-3 text-xs font-bold text-[#D4FF33]"
                  >
                    Abrir Báscula
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Tendencia 7 días: Sueño, Pulso y Carga */}
          <ReadinessTrend7dCard
            database={effectiveDatabase}
            onOpenSleep={onOpenSleep}
            onOpenPulse={onOpenPulse}
          />

          {/* Consistencia 7 Días + Distancia + Sueño */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Consistencia Semanal */}
            <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-3.5">
              <h2 className="text-base font-extrabold text-white">
                Consistencia Semanal (7 días)
              </h2>

              <div className="grid grid-cols-7 gap-1.5">
                {weeklyDayRows.map((row) => (
                  <div
                    key={row.dateIso}
                    className={`rounded-2xl border p-2 flex flex-col items-center gap-1.5 ${
                      row.dayMeta.isToday
                        ? 'border-[#D4FF33]/50 bg-[#171B14]'
                        : 'border-[#1E222E] bg-[#0D0F14]'
                    }`}
                  >
                    <span className="text-[10px] font-bold text-zinc-400">
                      {row.dayMeta.weekday}
                    </span>
                    <span className="text-xs font-mono font-bold text-white">
                      {row.dayMeta.dayNum}
                    </span>
                    <span
                      title={row.hasStrength ? 'Fuerza/HIIT completado' : 'Sin rutina'}
                      className={`w-5 h-5 rounded-md flex items-center justify-center ${
                        row.hasStrength
                          ? 'bg-[#D4FF33] text-[#0A0B0D]'
                          : 'bg-[#191D27] text-zinc-600'
                      }`}
                    >
                      {row.hasStrength ? (
                        <Check className="w-3 h-3 stroke-[3]" />
                      ) : (
                        <Dumbbell className="w-2.5 h-2.5" />
                      )}
                    </span>
                    <span
                      title={row.hasWalkOrCardio ? 'Cardio/Caminata' : 'Sin cardio'}
                      className={`w-5 h-5 rounded-md flex items-center justify-center ${
                        row.hasWalkOrCardio
                          ? 'bg-sky-400 text-[#0A0B0D]'
                          : 'bg-[#191D27] text-zinc-600'
                      }`}
                    >
                      <Footprints className="w-3 h-3" />
                    </span>
                  </div>
                ))}
              </div>

              {/* Distancia diaria 7d */}
              <div className="pt-2 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-zinc-300">Distancia diaria ({distanceUnit})</span>
                  <span className="font-mono text-sky-300">
                    Total {formatDistance(weeklyTotals.totalCardioKm, distanceUnit, 2)}
                  </span>
                </div>
                <div className="h-24 flex items-end gap-2 pt-2">
                  {weeklyDayRows.map((row) => {
                    const dispDist = kmToDisplayDistance(row.walkKm, distanceUnit);
                    const pctH = Math.max(8, Math.round((dispDist / maxWeekDistance) * 100));
                    return (
                      <div key={row.dateIso} className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full h-16 flex items-end">
                          <div
                            className={`w-full rounded-t-md ${
                              dispDist > 0 ? 'bg-sky-400' : 'bg-[#1A1E29]'
                            }`}
                            style={{ height: `${dispDist > 0 ? pctH : 10}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-zinc-500">
                          {row.dayMeta.weekday}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Tendencia de Horas de Sueño */}
            <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Moon className="w-4 h-4 text-indigo-300" />
                  <h2 className="text-base font-extrabold text-white">
                    Tendencia Semanal de Sueño
                  </h2>
                </div>
                <span className="text-xs font-mono text-indigo-300 font-bold">
                  {weeklyTotals.avgSleepHours !== null
                    ? `${weeklyTotals.avgSleepHours} h prom.`
                    : 'Meta 8h'}
                </span>
              </div>

              {recordedSleepPoints.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#272C38] bg-[#0D0F14] p-5 text-center text-xs text-zinc-400">
                  Registra tus noches en la pestaña Sueño para visualizar tu gráfica semanal.
                </div>
              ) : (
                (() => {
                  const hoursVals = recordedSleepPoints.map((p) => p.hours ?? 7);
                  const minSleep = Math.min(4, Math.floor(Math.min(...hoursVals) - 0.5));
                  const maxSleep = Math.max(9.5, Math.ceil(Math.max(...hoursVals) + 0.5));
                  const spanSleep = Math.max(2, maxSleep - minSleep);
                  const goalY = 88 - ((8 - minSleep) / spanSleep) * 66;
                  const validLinePts = sleepChartPoints
                    .map((pt, idx) => ({
                      x: 18 + (idx / 6) * 284,
                      y:
                        pt.hours !== null
                          ? 88 - ((pt.hours - minSleep) / spanSleep) * 66
                          : null,
                    }))
                    .filter((p): p is { x: number; y: number } => p.y !== null);

                  return (
                    <svg
                      viewBox="0 0 320 112"
                      className="w-full h-36 overflow-visible"
                      role="img"
                      aria-label="Tendencia semanal de horas de sueño"
                    >
                      <line
                        x1="12"
                        y1={goalY}
                        x2="308"
                        y2={goalY}
                        stroke="#323846"
                        strokeDasharray="4 4"
                        strokeWidth="1.2"
                      />
                      <text x="14" y={goalY - 4} fill="#818CF8" fontSize="9" fontFamily="monospace">
                        8h ideal
                      </text>
                      {validLinePts.length > 1 && (
                        <polyline
                          fill="none"
                          stroke="#818CF8"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={validLinePts.map((p) => `${p.x},${p.y}`).join(' ')}
                        />
                      )}
                      {sleepChartPoints.map((pt, idx) => {
                        const x = 18 + (idx / 6) * 284;
                        if (pt.hours === null) {
                          return (
                            <text
                              key={pt.dateIso}
                              x={x}
                              y="108"
                              textAnchor="middle"
                              fill="#71717A"
                              fontSize="9"
                              fontFamily="monospace"
                            >
                              {pt.label}
                            </text>
                          );
                        }
                        const y = 88 - ((pt.hours - minSleep) / spanSleep) * 66;
                        return (
                          <g key={pt.dateIso}>
                            <circle
                              cx={x}
                              cy={y}
                              r="4"
                              fill="#818CF8"
                              stroke="#0A0B0D"
                              strokeWidth="2"
                            />
                            <text
                              x={x}
                              y={y - 9}
                              textAnchor="middle"
                              fill="#F4F5F7"
                              fontSize="10"
                              fontFamily="monospace"
                            >
                              {pt.hours}h
                            </text>
                            <text
                              x={x}
                              y="108"
                              textAnchor="middle"
                              fill="#9CA3AF"
                              fontSize="9"
                              fontFamily="monospace"
                            >
                              {pt.label}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  );
                })()
              )}
            </section>
          </div>

          {/* Calendario Mensual de Entrenamientos */}
          <WorkoutCalendarAnalyticsCard database={effectiveDatabase} />
        </div>
      )}

      {/* SUBTAB 2: COMPARAR FECHAS (ANTES VS DESPUÉS) */}
      {subTab === 'comparar' && (
        <React.Suspense fallback={<DarkCompareSkeleton />}>
          <CompareDatesView database={effectiveDatabase} />
        </React.Suspense>
      )}

      {/* SUBTAB 3: HISTORIAL CRONOLÓGICO */}
      {subTab === 'historial' && (
        <HistorialTab
          database={effectiveDatabase}
          onDeleteWorkout={onDeleteWorkout}
          onDeleteHiitSession={onDeleteHiitSession}
          onDeleteCardioSession={onDeleteCardioSession}
          onDeleteBodyScan={onDeleteBodyScan}
          onDeleteBodyWeight={onDeleteBodyWeight}
          onDeleteFood={onDeleteFood}
          onDeleteFastHistory={onDeleteFastHistory}
          onDeleteSleepSession={onDeleteSleepSession}
          onDeletePulseRecord={onDeletePulseRecord}
          onDeleteBloodPressureRecord={onDeleteBloodPressureRecord}
          onDeleteWaterLog={onDeleteWaterLog}
          onClearDay={onClearDay}
        />
      )}

      {/* MODAL PREVIEW: TARJETA SEMANAL 1080x1350 PNG */}
      {weeklyModalData && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Vista previa de Tarjeta Semanal PulsoFit"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="w-full max-w-md rounded-3xl border border-[#262B38] bg-[#12141A] p-4 sm:p-5 space-y-4 shadow-2xl my-auto">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-[#D4FF33]" />
                <h2 className="text-base font-extrabold text-white">
                  Tarjeta Semanal (1080×1350)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setWeeklyModalData(null)}
                aria-label="Cerrar vista previa"
                className="w-9 h-9 rounded-xl border border-[#2A2F3D] bg-[#0D0F14] flex items-center justify-center text-zinc-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-2xl overflow-hidden border border-white/10 bg-[#090B0E]">
              <img
                src={weeklyModalData.dataUrl}
                alt="Resumen Semanal PulsoFit 1080x1350"
                className="w-full h-auto block"
              />
            </div>

            {shareFeedback && (
              <p role="status" className="text-xs font-bold text-emerald-300 text-center">
                {shareFeedback}
              </p>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => void handleExportWeeklyCard('download')}
                className="min-h-[46px] rounded-2xl border border-[#2D3343] bg-[#0D0F14] hover:border-[#D4FF33]/50 text-xs font-extrabold text-white inline-flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4 text-[#D4FF33]" />
                Descargar PNG
              </button>
              <button
                type="button"
                onClick={() => void handleExportWeeklyCard('share')}
                className="min-h-[46px] rounded-2xl bg-[#D4FF33] hover:bg-[#c5f022] text-xs font-extrabold text-[#0A0B0D] inline-flex items-center justify-center gap-2"
              >
                <Share2 className="w-4 h-4" />
                Compartir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
