import React, { useEffect, useMemo, useState } from 'react';
import {
  Footprints,
  Settings2,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  computeDailyActivitySummary,
  getActivityGoals,
  getAgeGroupStepBenchmark,
  getLast7DaysActivity,
  getMonthlyStepsSeries,
  getWeeklyStepsSeries,
} from '../lib/dailyActivity';
import { getTodayIsoDate } from '../lib/storage';
import { formatDistance, getDistanceUnit } from '../lib/units';
import type { AppDatabase, UserProfile } from '../types/fitness';

interface StepsAnalyticsModalProps {
  isOpen: boolean;
  initialDateIso?: string;
  database: AppDatabase;
  onClose: () => void;
  onUpdateProfile: (profile: UserProfile) => void;
}

type StepsTab = 'horas' | 'dias' | 'semanas' | 'meses';

interface StepsChartTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{
    value?: number;
    payload?: {
      label?: string;
      sublabel?: string;
      steps?: number;
      avgDailySteps?: number;
      activeMin?: number;
      activeKcal?: number;
    };
  }>;
}

const StepsChartTooltip: React.FC<StepsChartTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  const val =
    typeof item?.steps === 'number'
      ? item.steps
      : typeof item?.avgDailySteps === 'number'
        ? item.avgDailySteps
        : Number(payload[0]?.value ?? 0);

  return (
    <div className="rounded-xl border border-[#2C3344] bg-[#0B0D12]/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="text-[11px] font-semibold text-zinc-400">
        {item?.sublabel || item?.label || ''}
      </p>
      <p className="mt-0.5 text-sm font-extrabold font-mono tabular-nums text-[#a3e635]">
        {val.toLocaleString('es-MX')} pasos
      </p>
      {typeof item?.activeMin === 'number' && item.activeMin > 0 && (
        <p className="text-[11px] font-mono text-zinc-300">
          {item.activeMin} min · {item.activeKcal ?? 0} Cal
        </p>
      )}
    </div>
  );
};

export const StepsAnalyticsModal: React.FC<StepsAnalyticsModalProps> = ({
  isOpen,
  initialDateIso,
  database,
  onClose,
  onUpdateProfile,
}) => {
  const todayIso = getTodayIsoDate();
  const distanceUnit = getDistanceUnit(database.profile.distanceUnit);
  const goals = getActivityGoals(database.profile);

  const [activeTab, setActiveTab] = useState<StepsTab>('horas');
  const [selectedDate, setSelectedDate] = useState<string>(initialDateIso || todayIso);
  const [showGoalEditor, setShowGoalEditor] = useState(false);
  const [stepsGoalInput, setStepsGoalInput] = useState(String(goals.stepsGoal));
  const [minGoalInput, setMinGoalInput] = useState(String(goals.activeMinGoal));
  const [kcalGoalInput, setKcalGoalInput] = useState(String(goals.activeKcalGoal));

  useEffect(() => {
    if (isOpen) {
      setSelectedDate(initialDateIso || todayIso);
      setStepsGoalInput(String(goals.stepsGoal));
      setMinGoalInput(String(goals.activeMinGoal));
      setKcalGoalInput(String(goals.activeKcalGoal));
      setShowGoalEditor(false);
    }
  }, [isOpen, initialDateIso, todayIso, goals.stepsGoal, goals.activeMinGoal, goals.activeKcalGoal]);

  const summary = useMemo(
    () => computeDailyActivitySummary(database, selectedDate),
    [database, selectedDate],
  );

  const last7Days = useMemo(
    () => getLast7DaysActivity(database, todayIso),
    [database, todayIso],
  );

  const weeklySeries = useMemo(
    () => getWeeklyStepsSeries(database, todayIso, 8),
    [database, todayIso],
  );

  const monthlySeries = useMemo(
    () => getMonthlyStepsSeries(database, todayIso, 6),
    [database, todayIso],
  );

  const weeklyAvgSteps = useMemo(() => {
    const sum = last7Days.reduce((acc, d) => acc + d.steps, 0);
    return Math.round(sum / Math.max(1, last7Days.length));
  }, [last7Days]);

  const weeklySeriesAvg = useMemo(() => {
    const sum = weeklySeries.reduce((acc, w) => acc + w.avgDailySteps, 0);
    return Math.round(sum / Math.max(1, weeklySeries.length));
  }, [weeklySeries]);

  const monthlySeriesAvg = useMemo(() => {
    const sum = monthlySeries.reduce((acc, m) => acc + m.avgDailySteps, 0);
    return Math.round(sum / Math.max(1, monthlySeries.length));
  }, [monthlySeries]);

  const hourlyChartData = useMemo(
    () =>
      summary.hourly.map((h) => ({
        label: h.label,
        sublabel: `${String(h.hour).padStart(2, '0')}:00 – ${String(h.hour).padStart(2, '0')}:59`,
        steps: h.steps,
        activeMin: h.activeMin,
        activeKcal: h.activeKcal,
        isPeak: summary.peakHour?.hour === h.hour && h.steps > 0,
      })),
    [summary],
  );

  const daysChartData = useMemo(
    () =>
      last7Days.map((d) => ({
        label: d.shortLabel,
        sublabel: d.date,
        steps: d.steps,
        activeMin: d.activeMin,
        activeKcal: d.activeKcal,
      })),
    [last7Days],
  );

  const benchmark = useMemo(
    () => getAgeGroupStepBenchmark(database.profile.age, database.profile.sex),
    [database.profile.age, database.profile.sex],
  );

  // Use 7-day average if there are logged days, else today's steps
  const userCompareSteps = weeklyAvgSteps > 0 ? weeklyAvgSteps : summary.steps;
  const maxCompareSteps = Math.max(
    benchmark.averageSteps,
    userCompareSteps,
    goals.stepsGoal,
    1000,
  );
  const userComparePct = Math.min(100, Math.round((userCompareSteps / maxCompareSteps) * 100));
  const peerComparePct = Math.min(100, Math.round((benchmark.averageSteps / maxCompareSteps) * 100));
  const compareDeltaPct =
    benchmark.averageSteps > 0
      ? Math.round(((userCompareSteps - benchmark.averageSteps) / benchmark.averageSteps) * 100)
      : 0;

  const handleSaveGoals = (e: React.FormEvent) => {
    e.preventDefault();
    const s = Math.max(1000, Math.min(50000, parseInt(stepsGoalInput, 10) || 10000));
    const m = Math.max(10, Math.min(360, parseInt(minGoalInput, 10) || 90));
    const k = Math.max(100, Math.min(4000, parseInt(kcalGoalInput, 10) || 500));
    onUpdateProfile({
      ...database.profile,
      dailyStepsGoal: s,
      dailyActiveMinGoal: m,
      dailyActiveKcalGoal: k,
    });
    setShowGoalEditor(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-t-3xl sm:rounded-3xl border border-[#262B36] bg-[#0E1014] max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="w-10 h-1.5 bg-zinc-700 rounded-full mx-auto mt-3 sm:hidden shrink-0" />

        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between gap-3 shrink-0 bg-[#12141A]">
          <div>
            <p className="text-xs font-bold text-[#a3e635]">
              Analítica de Pasos · {selectedDate === todayIso ? 'Hoy' : selectedDate}
            </p>
            <h2 className="text-xl sm:text-2xl font-extrabold font-display text-white">
              Desglose de Actividad y Pasos
            </h2>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowGoalEditor((v) => !v)}
              aria-label="Configurar metas diarias"
              className={`min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors ${
                showGoalEditor
                  ? 'border-[#a3e635] bg-[#a3e635]/15 text-[#a3e635]'
                  : 'border-[#2B3140] bg-[#161922] text-zinc-200 hover:text-white'
              }`}
            >
              <Settings2 className="w-4 h-4" />
              <span className="hidden sm:inline">Metas</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar desglose de pasos"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 max-h-[84vh] overflow-y-auto p-5 space-y-5">
          {/* Configurable Daily Goals Editor */}
          {showGoalEditor && (
            <form
              onSubmit={handleSaveGoals}
              className="rounded-2xl border border-[#2C3428] bg-[#121611] p-4 space-y-3"
            >
              <div className="flex items-center gap-2 text-xs font-bold text-[#a3e635]">
                <SlidersHorizontal className="w-4 h-4" />
                <span>Configurar metas de los 3 anillos diarios</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-300 mb-1">
                    Meta de pasos
                  </label>
                  <input
                    type="number"
                    min={1000}
                    max={50000}
                    step={500}
                    value={stepsGoalInput}
                    onChange={(e) => setStepsGoalInput(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-[#2A303E] bg-[#0B0D12] px-3 text-sm font-mono text-white focus:border-[#a3e635] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-300 mb-1">
                    Tiempo activo (min)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={360}
                    step={5}
                    value={minGoalInput}
                    onChange={(e) => setMinGoalInput(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-[#2A303E] bg-[#0B0D12] px-3 text-sm font-mono text-white focus:border-[#38BDF8] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-300 mb-1">
                    Calorías activas (Cal)
                  </label>
                  <input
                    type="number"
                    min={100}
                    max={4000}
                    step={50}
                    value={kcalGoalInput}
                    onChange={(e) => setKcalGoalInput(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-[#2A303E] bg-[#0B0D12] px-3 text-sm font-mono text-white focus:border-[#EC4899] focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowGoalEditor(false)}
                  className="min-h-[38px] rounded-xl border border-[#2B3140] px-3.5 text-xs font-bold text-zinc-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-[38px] rounded-xl bg-[#a3e635] px-4 text-xs font-extrabold text-[#0A0B0D]"
                >
                  Guardar metas
                </button>
              </div>
            </form>
          )}

          {/* Horizontal Daily Goal Progress Bar */}
          <section className="rounded-3xl border border-[#222631] bg-[#13151A] p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-center gap-2">
                <Footprints className="w-4 h-4 text-[#22C55E]" />
                <span className="text-xs font-bold text-zinc-300">
                  Meta diaria ({summary.stepsGoal.toLocaleString('es-MX')} pasos)
                </span>
              </div>
              <span className="text-sm font-extrabold font-mono tabular-nums text-[#a3e635]">
                {summary.steps.toLocaleString('es-MX')} /{' '}
                {summary.stepsGoal.toLocaleString('es-MX')} ({summary.stepsPct}%)
              </span>
            </div>

            <div className="h-3.5 w-full rounded-full bg-[#1C2029] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#22C55E] to-[#a3e635] transition-all duration-500"
                style={{ width: `${summary.stepsPct}%` }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-zinc-400">
              <span>
                {summary.steps >= summary.stepsGoal
                  ? `Meta superada por +${(summary.steps - summary.stepsGoal).toLocaleString('es-MX')} pasos`
                  : `Faltan ${(summary.stepsGoal - summary.steps).toLocaleString('es-MX')} pasos para tu meta`}
              </span>
              <span>
                {formatDistance(summary.activeDistanceKm, distanceUnit)} · {summary.activeMin} min ·{' '}
                {summary.activeKcal} Cal
              </span>
            </div>
          </section>

          {/* Main Tabs: Horas | Días | Semanas | Meses */}
          <section className="rounded-3xl border border-[#222631] bg-[#13151A] p-4 sm:p-5 space-y-4">
            <div
              role="tablist"
              aria-label="Intervalo de analítica de pasos"
              className="grid grid-cols-4 gap-1 rounded-2xl border border-[#232834] bg-[#0B0D12] p-1"
            >
              {(
                [
                  { id: 'horas', label: 'Horas' },
                  { id: 'dias', label: 'Días' },
                  { id: 'semanas', label: 'Semanas' },
                  { id: 'meses', label: 'Meses' },
                ] as { id: StepsTab; label: string }[]
              ).map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveTab(tab.id)}
                    className={`min-h-[38px] rounded-xl px-2 text-xs font-extrabold transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#a3e635] text-[#0A0B0D]'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Tab 1: Horas */}
            {activeTab === 'horas' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-zinc-300">
                    Pasos por hora ({selectedDate === todayIso ? 'Hoy' : selectedDate})
                  </span>
                  {summary.peakHour && summary.peakHour.steps > 0 ? (
                    <span className="font-mono font-bold text-[#a3e635]">
                      Franja más activa: {String(summary.peakHour.hour).padStart(2, '0')}:00 –{' '}
                      {String(summary.peakHour.hour).padStart(2, '0')}:59 (
                      {summary.peakHour.steps.toLocaleString('es-MX')} pasos)
                    </span>
                  ) : (
                    <span className="text-zinc-500">Sin pasos registrados por hora</span>
                  )}
                </div>

                <div className="rounded-2xl border border-[#1E2330] bg-[#0D0F14] pt-3 pb-1 px-2">
                  <ResponsiveContainer width="100%" height={190}>
                    <BarChart
                      data={hourlyChartData}
                      margin={{ top: 8, right: 8, left: -16, bottom: 2 }}
                    >
                      <CartesianGrid
                        stroke="#1C212E"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: '#71717A', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        interval={3}
                      />
                      <YAxis
                        tick={{ fill: '#71717A', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={42}
                        tickFormatter={(v: number) =>
                          v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`
                        }
                      />
                      <Tooltip
                        content={<StepsChartTooltip />}
                        cursor={{ fill: 'rgba(163, 230, 53, 0.08)' }}
                      />
                      <Bar dataKey="steps" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                        {hourlyChartData.map((entry, idx) => (
                          <Cell
                            key={`hr_${idx}`}
                            fill={
                              entry.steps === 0
                                ? '#1C222D'
                                : entry.isPeak
                                  ? '#a3e635'
                                  : '#22C55E'
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Tab 2: Días (Last 7 days + ReferenceLine weekly average) */}
            {activeTab === 'dias' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-zinc-300">
                    Últimos 7 días
                  </span>
                  <span className="font-mono font-bold text-[#a3e635]">
                    Promedio semanal: {weeklyAvgSteps.toLocaleString('es-MX')} pasos/día
                  </span>
                </div>

                <div className="rounded-2xl border border-[#1E2330] bg-[#0D0F14] pt-3 pb-1 px-2">
                  <ResponsiveContainer width="100%" height={190}>
                    <BarChart
                      data={daysChartData}
                      margin={{ top: 12, right: 10, left: -12, bottom: 2 }}
                    >
                      <CartesianGrid
                        stroke="#1C212E"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: '#9CA3AF', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: '#71717A', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={44}
                        tickFormatter={(v: number) =>
                          v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`
                        }
                      />
                      <Tooltip
                        content={<StepsChartTooltip />}
                        cursor={{ fill: 'rgba(163, 230, 53, 0.08)' }}
                      />
                      <ReferenceLine
                        y={weeklyAvgSteps}
                        stroke="#a3e635"
                        strokeDasharray="4 4"
                        strokeWidth={1.5}
                      />
                      <Bar dataKey="steps" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                        {daysChartData.map((entry, idx) => (
                          <Cell
                            key={`day_${idx}`}
                            fill={
                              entry.steps >= summary.stepsGoal
                                ? '#a3e635'
                                : entry.steps > 0
                                  ? '#22C55E'
                                  : '#1C222D'
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Tab 3: Semanas */}
            {activeTab === 'semanas' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-zinc-300">
                    Promedio diario por semana (8 semanas)
                  </span>
                  <span className="font-mono font-bold text-[#a3e635]">
                    Media: {weeklySeriesAvg.toLocaleString('es-MX')} pasos/día
                  </span>
                </div>

                <div className="rounded-2xl border border-[#1E2330] bg-[#0D0F14] pt-3 pb-1 px-2">
                  <ResponsiveContainer width="100%" height={190}>
                    <BarChart
                      data={weeklySeries}
                      margin={{ top: 12, right: 10, left: -12, bottom: 2 }}
                    >
                      <CartesianGrid
                        stroke="#1C212E"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: '#9CA3AF', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={16}
                      />
                      <YAxis
                        tick={{ fill: '#71717A', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={44}
                        tickFormatter={(v: number) =>
                          v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`
                        }
                      />
                      <Tooltip
                        content={<StepsChartTooltip />}
                        cursor={{ fill: 'rgba(163, 230, 53, 0.08)' }}
                      />
                      <ReferenceLine
                        y={weeklySeriesAvg}
                        stroke="#a3e635"
                        strokeDasharray="4 4"
                        strokeWidth={1.5}
                      />
                      <Bar
                        dataKey="avgDailySteps"
                        fill="#22C55E"
                        radius={[6, 6, 0, 0]}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Tab 4: Meses */}
            {activeTab === 'meses' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-zinc-300">
                    Promedio diario por mes (6 meses)
                  </span>
                  <span className="font-mono font-bold text-[#a3e635]">
                    Media: {monthlySeriesAvg.toLocaleString('es-MX')} pasos/día
                  </span>
                </div>

                <div className="rounded-2xl border border-[#1E2330] bg-[#0D0F14] pt-3 pb-1 px-2">
                  <ResponsiveContainer width="100%" height={190}>
                    <BarChart
                      data={monthlySeries}
                      margin={{ top: 12, right: 10, left: -12, bottom: 2 }}
                    >
                      <CartesianGrid
                        stroke="#1C212E"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: '#9CA3AF', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: '#71717A', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={44}
                        tickFormatter={(v: number) =>
                          v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`
                        }
                      />
                      <Tooltip
                        content={<StepsChartTooltip />}
                        cursor={{ fill: 'rgba(163, 230, 53, 0.08)' }}
                      />
                      <ReferenceLine
                        y={monthlySeriesAvg}
                        stroke="#a3e635"
                        strokeDasharray="4 4"
                        strokeWidth={1.5}
                      />
                      <Bar
                        dataKey="avgDailySteps"
                        fill="#38BDF8"
                        radius={[6, 6, 0, 0]}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </section>

          {/* Comparative Card: Tú vs Promedio de tu grupo de edad */}
          <section className="rounded-3xl border border-[#222631] bg-[#13151A] p-4 sm:p-5 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#a3e635]" />
                <h3 className="text-sm sm:text-base font-extrabold font-display text-white">
                  Comparativa por grupo de edad ({benchmark.ageGroupLabel})
                </h3>
              </div>
              <span
                className={`text-xs font-extrabold font-mono tabular-nums ${
                  compareDeltaPct >= 0 ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                {compareDeltaPct >= 0 ? `+${compareDeltaPct}%` : `${compareDeltaPct}%`} vs promedio
              </span>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white">
                    Tú ({weeklyAvgSteps > 0 ? 'promedio 7d' : 'hoy'})
                  </span>
                  <span className="font-mono tabular-nums font-extrabold text-[#a3e635]">
                    {userCompareSteps.toLocaleString('es-MX')} pasos
                  </span>
                </div>
                <div className="h-3 w-full rounded-full bg-[#1C2029] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#a3e635] transition-all duration-500"
                    style={{ width: `${Math.max(userCompareSteps > 0 ? 4 : 0, userComparePct)}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-300">
                    Promedio de tu grupo de edad
                  </span>
                  <span className="font-mono tabular-nums font-bold text-zinc-200">
                    {benchmark.averageSteps.toLocaleString('es-MX')} pasos
                  </span>
                </div>
                <div className="h-3 w-full rounded-full bg-[#1C2029] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-zinc-500 transition-all duration-500"
                    style={{ width: `${peerComparePct}%` }}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
