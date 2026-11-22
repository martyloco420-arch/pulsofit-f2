import React, { useMemo, useState } from 'react';
import {
  Activity,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  Footprints,
  Plus,
  Sparkles,
} from 'lucide-react';
import {
  DAILY_ACTIVE_KCAL_GOAL,
  DAILY_ACTIVE_MIN_GOAL,
  DAILY_STEPS_GOAL,
  computeDailyActivitySummary,
  getLast7DaysActivity,
  getMonthCalendarActivity,
} from '../lib/dailyActivity';
import { getTodayIsoDate } from '../lib/storage';
import type { AppDatabase } from '../types/fitness';

interface DailyActivityRingsCardProps {
  database: AppDatabase;
  onAddManualSteps?: (date: string, deltaSteps: number) => void;
  onNavigateToCardio?: () => void;
}

type ActivityChartTab = 'hourly' | 'week' | 'calendar';
type WeekMetric = 'steps' | 'activeMin' | 'activeKcal';

interface RingSvgProps {
  stepsPct: number;
  activeMinPct: number;
  activeKcalPct: number;
  closedCount: number;
}

const ConcentricActivityRings: React.FC<RingSvgProps> = ({
  stepsPct,
  activeMinPct,
  activeKcalPct,
  closedCount,
}) => {
  const rings = [
    { r: 74, stroke: 13, pct: stepsPct, color: '#D4FF33', track: '#232818' },
    { r: 56, stroke: 13, pct: activeMinPct, color: '#38BDF8', track: '#152532' },
    { r: 38, stroke: 13, pct: activeKcalPct, color: '#FB923C', track: '#2D1E14' },
  ];

  return (
    <div className="relative w-[176px] h-[176px] shrink-0 mx-auto sm:mx-0">
      <svg viewBox="0 0 180 180" className="w-full h-full -rotate-90" role="img" aria-label="Anillos de actividad diaria">
        {rings.map((ring) => {
          const circumference = 2 * Math.PI * ring.r;
          const clamped = Math.max(0, Math.min(100, ring.pct));
          const offset = circumference - (clamped / 100) * circumference;
          return (
            <g key={ring.r}>
              <circle
                cx="90"
                cy="90"
                r={ring.r}
                fill="none"
                stroke={ring.track}
                strokeWidth={ring.stroke}
              />
              <circle
                cx="90"
                cy="90"
                r={ring.r}
                fill="none"
                stroke={ring.color}
                strokeWidth={ring.stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={clamped === 0 ? circumference : offset}
                className="transition-all duration-500"
              />
            </g>
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
        <span className="text-xl font-extrabold font-mono tabular-nums text-white leading-none">
          {closedCount}/3
        </span>
        <span className="text-[10px] font-semibold text-zinc-400 mt-1">
          metas
        </span>
      </div>
    </div>
  );
};

const MiniCalendarRings: React.FC<{
  stepsPct: number;
  activeMinPct: number;
  activeKcalPct: number;
}> = ({ stepsPct, activeMinPct, activeKcalPct }) => {
  const rings = [
    { r: 11, stroke: 2.4, pct: stepsPct, color: '#D4FF33' },
    { r: 7.8, stroke: 2.4, pct: activeMinPct, color: '#38BDF8' },
    { r: 4.6, stroke: 2.4, pct: activeKcalPct, color: '#FB923C' },
  ];
  return (
    <svg viewBox="0 0 28 28" className="w-7 h-7 -rotate-90" aria-hidden="true">
      {rings.map((ring) => {
        const c = 2 * Math.PI * ring.r;
        const clamped = Math.max(0, Math.min(100, ring.pct));
        const offset = c - (clamped / 100) * c;
        return (
          <g key={ring.r}>
            <circle
              cx="14"
              cy="14"
              r={ring.r}
              fill="none"
              stroke="#202531"
              strokeWidth={ring.stroke}
            />
            {clamped > 0 && (
              <circle
                cx="14"
                cy="14"
                r={ring.r}
                fill="none"
                stroke={ring.color}
                strokeWidth={ring.stroke}
                strokeLinecap="round"
                strokeDasharray={c}
                strokeDashoffset={offset}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
};

export const DailyActivityRingsCard: React.FC<DailyActivityRingsCardProps> = ({
  database,
  onAddManualSteps,
  onNavigateToCardio,
}) => {
  const todayIso = getTodayIsoDate();
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);
  const [chartTab, setChartTab] = useState<ActivityChartTab>('hourly');
  const [weekMetric, setWeekMetric] = useState<WeekMetric>('steps');
  const [showQuickSteps, setShowQuickSteps] = useState(false);
  const [customStepsInput, setCustomStepsInput] = useState('');

  const [calYear, setCalYear] = useState<number>(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState<number>(() => new Date().getMonth());

  const summary = useMemo(
    () => computeDailyActivitySummary(database, selectedDate),
    [database, selectedDate],
  );

  const last7Days = useMemo(
    () => getLast7DaysActivity(database, todayIso),
    [database, todayIso],
  );

  const calendarCells = useMemo(
    () => getMonthCalendarActivity(database, calYear, calMonth),
    [database, calYear, calMonth],
  );

  const monthTitle = useMemo(() => {
    const dt = new Date(calYear, calMonth, 1);
    return dt.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  }, [calYear, calMonth]);

  const handlePrevMonth = () => {
    if (calMonth === 0) {
      setCalYear((y) => y - 1);
      setCalMonth(11);
    } else {
      setCalMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (calMonth === 11) {
      setCalYear((y) => y + 1);
      setCalMonth(0);
    } else {
      setCalMonth((m) => m + 1);
    }
  };

  const handleCustomStepsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddManualSteps) return;
    const val = parseInt(customStepsInput.replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(val) || val <= 0) return;
    onAddManualSteps(selectedDate, Math.min(50000, val));
    setCustomStepsInput('');
    setShowQuickSteps(false);
  };

  const maxHourlyScore = Math.max(
    10,
    ...summary.hourly.map((h) => h.intensityScore),
  );

  const weekGoal =
    weekMetric === 'steps'
      ? DAILY_STEPS_GOAL
      : weekMetric === 'activeMin'
        ? DAILY_ACTIVE_MIN_GOAL
        : DAILY_ACTIVE_KCAL_GOAL;

  const maxWeekVal = Math.max(
    weekGoal,
    ...last7Days.map((d) => d[weekMetric]),
  );

  const weekAvg = Math.round(
    last7Days.reduce((acc, d) => acc + d[weekMetric], 0) / Math.max(1, last7Days.length),
  );

  return (
    <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-[#D4FF33]">
            Actividad diaria · {selectedDate === todayIso ? 'Hoy' : selectedDate}
          </p>
          <h2 className="text-xl sm:text-2xl font-extrabold font-display text-white">
            Anillos de movimiento diario
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedDate !== todayIso && (
            <button
              type="button"
              onClick={() => setSelectedDate(todayIso)}
              className="min-h-[38px] rounded-xl border border-[#2B303C] bg-[#171A23] px-3 text-xs font-bold text-zinc-200 hover:text-white"
            >
              Volver a hoy
            </button>
          )}
          {onAddManualSteps && (
            <button
              type="button"
              onClick={() => setShowQuickSteps((v) => !v)}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[#D4FF33]/40 bg-[#181C25] px-3 text-xs font-bold text-[#D4FF33] hover:bg-[#202634]"
            >
              <Plus className="w-3.5 h-3.5" />
              Sumar pasos
            </button>
          )}
        </div>
      </div>

      {/* Optional Quick Steps Logger */}
      {showQuickSteps && onAddManualSteps && (
        <div className="rounded-2xl border border-[#2B303C] bg-[#0D0F14] p-3.5 space-y-2.5">
          <p className="text-xs font-semibold text-zinc-300">
            Agregar pasos registrados por tu reloj o teléfono ({selectedDate})
          </p>
          <div className="flex flex-wrap gap-2">
            {[1000, 2500, 5000].map((qty) => (
              <button
                key={qty}
                type="button"
                onClick={() => {
                  onAddManualSteps(selectedDate, qty);
                  setShowQuickSteps(false);
                }}
                className="min-h-[40px] rounded-xl border border-[#2A2F3D] bg-[#161922] hover:border-[#D4FF33] px-3 text-xs font-mono font-bold text-[#D4FF33]"
              >
                +{qty.toLocaleString('es-ES')} pasos
              </button>
            ))}
          </div>
          <form onSubmit={handleCustomStepsSubmit} className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={customStepsInput}
              onChange={(e) => setCustomStepsInput(e.target.value)}
              placeholder="Cantidad exacta (ej. 3200)"
              className="flex-1 min-h-[42px] rounded-xl border border-[#2A2F3D] bg-[#14171F] px-3 text-xs font-mono text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
            />
            <button
              type="submit"
              disabled={!customStepsInput.trim()}
              className="min-h-[42px] rounded-xl bg-[#D4FF33] disabled:opacity-40 px-4 text-xs font-extrabold text-[#0A0B0D]"
            >
              Agregar
            </button>
          </form>
        </div>
      )}

      {/* 3 Concentric Rings + Metrics Legend */}
      <div className="flex flex-col sm:flex-row items-center gap-5">
        <ConcentricActivityRings
          stepsPct={summary.stepsPct}
          activeMinPct={summary.activeMinPct}
          activeKcalPct={summary.activeKcalPct}
          closedCount={summary.closedRingsCount}
        />

        <div className="flex-1 w-full grid grid-cols-1 gap-2.5">
          {/* Ring 1: Steps */}
          <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Footprints className="w-4 h-4 text-[#D4FF33] shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-white">Pasos</p>
                <p className="text-[11px] text-zinc-400">
                  Meta {DAILY_STEPS_GOAL.toLocaleString('es-ES')}
                </p>
              </div>
            </div>
            <div className="text-right font-mono tabular-nums shrink-0">
              <p className="text-base font-extrabold text-[#D4FF33]">
                {summary.steps.toLocaleString('es-ES')}
              </p>
              <p className="text-[11px] text-zinc-400">{summary.stepsPct}%</p>
            </div>
          </div>

          {/* Ring 2: Active Minutes */}
          <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Clock className="w-4 h-4 text-sky-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-white">Tiempo activo</p>
                <p className="text-[11px] text-zinc-400">Meta {DAILY_ACTIVE_MIN_GOAL} min</p>
              </div>
            </div>
            <div className="text-right font-mono tabular-nums shrink-0">
              <p className="text-base font-extrabold text-sky-300">
                {summary.activeMin} min
              </p>
              <p className="text-[11px] text-zinc-400">{summary.activeMinPct}%</p>
            </div>
          </div>

          {/* Ring 3: Active Calories */}
          <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Flame className="w-4 h-4 text-orange-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-white">Calorías activas</p>
                <p className="text-[11px] text-zinc-400">Meta {DAILY_ACTIVE_KCAL_GOAL} kcal</p>
              </div>
            </div>
            <div className="text-right font-mono tabular-nums shrink-0">
              <p className="text-base font-extrabold text-orange-300">
                {summary.activeKcal} kcal
              </p>
              <p className="text-[11px] text-zinc-400">{summary.activeKcalPct}%</p>
            </div>
          </div>
        </div>
      </div>

      {/* Dynamic Remaining Goal Banner */}
      <div
        className={`rounded-2xl border px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${
          summary.closedRingsCount === 3
            ? 'border-emerald-500/40 bg-emerald-950/25 text-emerald-200'
            : 'border-[#2B3140] bg-[#161922] text-zinc-200'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <Sparkles
            className={`w-4 h-4 shrink-0 ${
              summary.closedRingsCount === 3 ? 'text-emerald-400' : 'text-[#D4FF33]'
            }`}
          />
          <p className="text-xs sm:text-sm font-semibold">{summary.bannerText}</p>
        </div>

        {onNavigateToCardio && summary.closedRingsCount < 3 && (
          <button
            type="button"
            onClick={onNavigateToCardio}
            className="min-h-[38px] rounded-xl bg-[#D4FF33] px-3.5 text-xs font-extrabold text-[#0A0B0D] whitespace-nowrap shrink-0"
          >
            Iniciar caminata
          </button>
        )}
      </div>

      {/* Visualizations Switcher: Hourly / 7 Days / Monthly Calendar */}
      <div className="space-y-4 pt-1 border-t border-white/5">
        <div className="grid grid-cols-3 gap-1 rounded-2xl bg-[#0B0C0F] p-1 border border-[#222631]">
          {(
            [
              { id: 'hourly', label: 'Por hora', Icon: Activity },
              { id: 'week', label: 'Últimos 7 días', Icon: Clock },
              { id: 'calendar', label: 'Mensual', Icon: Calendar },
            ] as {
              id: ActivityChartTab;
              label: string;
              Icon: React.ComponentType<{ className?: string }>;
            }[]
          ).map(({ id, label, Icon }) => {
            const active = chartTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setChartTab(id)}
                className={`min-h-[40px] rounded-xl px-2 text-xs font-extrabold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-[#D4FF33] text-[#0A0B0D]'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>

        {/* VIEW 1: HOURLY ACTIVITY + PEAK WINDOW */}
        {chartTab === 'hourly' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-zinc-400">
                Distribución horaria (00h – 23h)
              </span>
              {summary.peakHour ? (
                <span className="font-mono font-bold text-[#D4FF33]">
                  Franja más activa: {String(summary.peakHour.hour).padStart(2, '0')}:00 –{' '}
                  {String(summary.peakHour.hour).padStart(2, '0')}:59 (
                  {summary.peakHour.steps.toLocaleString('es-ES')} pasos ·{' '}
                  {summary.peakHour.activeMin} min)
                </span>
              ) : (
                <span className="text-zinc-500">Sin actividad registrada en esta fecha</span>
              )}
            </div>

            <div className="h-28 rounded-2xl border border-[#222631] bg-[#0D0F14] px-3 pt-4 pb-2 flex items-end gap-1">
              {summary.hourly.map((bucket) => {
                const isPeak = summary.peakHour?.hour === bucket.hour;
                const heightPct =
                  bucket.intensityScore > 0
                    ? Math.max(12, Math.round((bucket.intensityScore / maxHourlyScore) * 100))
                    : 4;
                return (
                  <div
                    key={bucket.hour}
                    title={`${bucket.label}: ${bucket.steps} pasos · ${bucket.activeMin} min · ${bucket.activeKcal} kcal`}
                    className="flex-1 h-full flex flex-col justify-end items-center gap-1"
                  >
                    <div
                      className={`w-full rounded-t-sm transition-all ${
                        bucket.intensityScore === 0
                          ? 'bg-[#1D222D]'
                          : isPeak
                            ? 'bg-[#D4FF33]'
                            : 'bg-sky-400/80'
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] font-mono text-zinc-500 px-1">
              <span>00h</span>
              <span>06h</span>
              <span>12h</span>
              <span>18h</span>
              <span>23h</span>
            </div>
          </div>
        )}

        {/* VIEW 2: LAST 7 DAYS */}
        {chartTab === 'week' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {(
                  [
                    { id: 'steps', label: 'Pasos' },
                    { id: 'activeMin', label: 'Minutos' },
                    { id: 'activeKcal', label: 'Calorías' },
                  ] as { id: WeekMetric; label: string }[]
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setWeekMetric(m.id)}
                    className={`min-h-[34px] rounded-lg px-2.5 text-xs font-bold ${
                      weekMetric === m.id
                        ? 'bg-[#222836] text-[#D4FF33] border border-[#D4FF33]/40'
                        : 'bg-[#0D0F14] text-zinc-400 border border-[#222631]'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <span className="text-xs font-mono text-zinc-400">
                Promedio 7d:{' '}
                <strong className="text-white">
                  {weekAvg.toLocaleString('es-ES')}{' '}
                  {weekMetric === 'steps' ? 'pasos' : weekMetric === 'activeMin' ? 'min' : 'kcal'}
                </strong>
              </span>
            </div>

            <div className="h-36 rounded-2xl border border-[#222631] bg-[#0D0F14] p-3 flex items-end gap-2">
              {last7Days.map((day) => {
                const val = day[weekMetric];
                const pct = val > 0 ? Math.max(10, Math.round((val / maxWeekVal) * 100)) : 4;
                const hitGoal = val >= weekGoal;
                const isSelected = day.date === selectedDate;
                return (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => setSelectedDate(day.date)}
                    className="flex-1 h-full flex flex-col items-center justify-end gap-1 group"
                  >
                    <span className="text-[10px] font-mono tabular-nums text-zinc-300">
                      {val > 0
                        ? weekMetric === 'steps' && val >= 1000
                          ? `${(val / 1000).toFixed(1)}k`
                          : val
                        : '0'}
                    </span>
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className={`w-full rounded-t-lg transition-all ${
                          val === 0
                            ? 'bg-[#1D222D]'
                            : hitGoal
                              ? 'bg-[#D4FF33]'
                              : weekMetric === 'steps'
                                ? 'bg-[#D4FF33]/55'
                                : weekMetric === 'activeMin'
                                  ? 'bg-sky-400/75'
                                  : 'bg-orange-400/75'
                        } ${isSelected ? 'ring-2 ring-white/80' : ''}`}
                        style={{ height: `${pct}%` }}
                      />
                    </div>
                    <span
                      className={`text-[10px] font-mono ${
                        isSelected ? 'text-[#D4FF33] font-bold' : 'text-zinc-400'
                      }`}
                    >
                      {day.shortLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* VIEW 3: MONTHLY CALENDAR WITH MINI RINGS */}
        {chartTab === 'calendar' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handlePrevMonth}
                aria-label="Mes anterior"
                className="min-h-[40px] min-w-[40px] rounded-xl border border-[#242936] bg-[#0D0F14] flex items-center justify-center text-zinc-300 hover:text-white"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-bold capitalize text-white">{monthTitle}</span>
              <button
                type="button"
                onClick={handleNextMonth}
                aria-label="Mes siguiente"
                className="min-h-[40px] min-w-[40px] rounded-xl border border-[#242936] bg-[#0D0F14] flex items-center justify-center text-zinc-300 hover:text-white"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3 space-y-2">
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-zinc-500">
                {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarCells.map((cell, idx) => {
                  if (!cell.date || !cell.summary) {
                    return <div key={`empty_${idx}`} className="h-12" />;
                  }
                  const isSelected = cell.date === selectedDate;
                  const isToday = cell.date === todayIso;
                  return (
                    <button
                      key={cell.date}
                      type="button"
                      onClick={() => setSelectedDate(cell.date!)}
                      className={`min-h-[50px] rounded-xl flex flex-col items-center justify-center gap-0.5 p-1 transition-colors ${
                        isSelected
                          ? 'bg-[#D4FF33]/15 border border-[#D4FF33]'
                          : isToday
                            ? 'bg-[#181C26] border border-zinc-600'
                            : 'hover:bg-[#171B24] border border-transparent'
                      }`}
                    >
                      <MiniCalendarRings
                        stepsPct={cell.summary.stepsPct}
                        activeMinPct={cell.summary.activeMinPct}
                        activeKcalPct={cell.summary.activeKcalPct}
                      />
                      <span
                        className={`text-[10px] font-mono tabular-nums leading-none ${
                          isSelected
                            ? 'text-[#D4FF33] font-extrabold'
                            : isToday
                              ? 'text-white font-bold'
                              : 'text-zinc-400'
                        }`}
                      >
                        {cell.dayNumber}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
