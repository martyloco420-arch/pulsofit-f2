import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Clock,
  Droplets,
  Minus,
  Plus,
  Sparkles,
  Zap,
} from 'lucide-react';
import { InlineDeleteConfirmButton } from './InlineDeleteConfirmButton';
import { shiftIsoDate } from '../lib/compareDates';
import { computeHydrationGoal } from '../lib/hydration';
import { getTodayIsoDate } from '../lib/storage';
import {
  formatLiquid,
  formatLiquidPrimary,
  getLiquidUnit,
} from '../lib/units';
import type {
  ActiveFastState,
  BodyCompositionScan,
  BodyWeightEntry,
  CardioSession,
  FastingHistoryEntry,
  HiitSession,
  HydrationLogEntry,
  HydrationSettings,
  LiquidUnit,
  UserProfile,
  WorkoutSession,
} from '../types/fitness';
import { HydrationSection } from './HydrationSection';
import { PushNotificationsCard } from './PushNotificationsCard';

interface HidratacionTabProps {
  profile: UserProfile;
  bodyWeights: BodyWeightEntry[];
  bodyScans: BodyCompositionScan[];
  workouts: WorkoutSession[];
  cardioSessions?: CardioSession[];
  hiitSessions?: HiitSession[];
  hydrationByDate: Record<string, number>;
  hydrationLogsByDate: Record<string, HydrationLogEntry[]>;
  hydrationSettings: HydrationSettings;
  electrolytesByDate?: Record<string, number>;
  activeFast?: ActiveFastState | null;
  fastingHistory?: FastingHistoryEntry[];
  onUpdateProfile: (profile: UserProfile) => void;
  onAddWater: (date: string, deltaMl: number) => void;
  onUndoLastWater: (date: string) => void;
  onDeleteWaterLog: (date: string, logId: string) => void;
  onUpdateHydrationSettings: (next: HydrationSettings) => void;
  onUpdateElectrolytes: (date: string, delta: number) => void;
  onOpenPushSettings?: () => void;
}

function formatDateLabel(isoDate: string): string {
  const today = getTodayIsoDate();
  if (isoDate === today) return 'Hoy';
  if (isoDate === shiftIsoDate(today, -1)) return 'Ayer';
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatShortWeekday(isoDate: string): { weekday: string; dayNum: string } {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const raw = Number.isNaN(dt.getTime())
    ? isoDate.slice(5)
    : dt.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '').slice(0, 3);
  return {
    weekday: raw.charAt(0).toUpperCase() + raw.slice(1),
    dayNum: String(d || '').padStart(2, '0'),
  };
}

function formatLogTime(isoTimestamp: string): string {
  const dt = new Date(isoTimestamp);
  if (Number.isNaN(dt.getTime())) return '--:--';
  return dt.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function describeIntakeKind(ml: number): string {
  if (ml === 250) return 'Vaso estándar';
  if (ml === 500) return 'Botella';
  if (ml === 750) return 'Termo mediano';
  if (ml === 1000) return 'Termo 1000 ml';
  return 'Registro personalizado';
}

export const HidratacionTab: React.FC<HidratacionTabProps> = ({
  profile,
  bodyWeights,
  bodyScans,
  workouts,
  cardioSessions = [],
  hiitSessions = [],
  hydrationByDate,
  hydrationLogsByDate,
  hydrationSettings,
  electrolytesByDate = {},
  activeFast = null,
  fastingHistory = [],
  onUpdateProfile,
  onAddWater,
  onUndoLastWater,
  onDeleteWaterLog,
  onUpdateHydrationSettings,
  onUpdateElectrolytes,
}) => {
  const todayIso = getTodayIsoDate();
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const liquidUnit = getLiquidUnit(profile.liquidUnit);

  useEffect(() => {
    if (!activeFast) return undefined;
    const id = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [activeFast]);

  const handleToggleLiquidUnit = (unit: LiquidUnit) => {
    if (unit === liquidUnit) return;
    onUpdateProfile({
      ...profile,
      liquidUnit: unit,
    });
  };

  const waterMl = hydrationByDate[selectedDate] ?? 0;
  const todayWaterMl = hydrationByDate[todayIso] ?? 0;
  const todayHydrationGoal = useMemo(
    () =>
      computeHydrationGoal(
        profile,
        bodyWeights,
        bodyScans,
        workouts,
        hydrationSettings,
        todayIso,
        cardioSessions,
        hiitSessions,
      ),
    [
      profile,
      bodyWeights,
      bodyScans,
      workouts,
      hydrationSettings,
      todayIso,
      cardioSessions,
      hiitSessions,
    ],
  );
  const dayLogs = useMemo(() => {
    const list = hydrationLogsByDate[selectedDate] ?? [];
    return [...list].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  }, [hydrationLogsByDate, selectedDate]);

  // Active fast elapsed hours & >16h electrolyte alert check
  const fastElapsedHours = useMemo(() => {
    if (!activeFast) return 0;
    const startMs = Date.parse(activeFast.startedAt);
    if (Number.isNaN(startMs)) return 0;
    return Math.max(0, (nowMs - startMs) / 3600000);
  }, [activeFast, nowMs]);

  const isExtendedFastActive = Boolean(activeFast && fastElapsedHours >= 16);
  const longFastCompletedOnDate = useMemo(
    () =>
      fastingHistory.find(
        (f) => f.date === selectedDate && f.actualHours >= 16,
      ) ?? null,
    [fastingHistory, selectedDate],
  );

  const electrolytesCount = useMemo(() => {
    const storedCount = electrolytesByDate[selectedDate] ?? 0;
    if (selectedDate === todayIso && activeFast) {
      return Math.max(storedCount, activeFast.electrolytesCount ?? 0);
    }
    return storedCount;
  }, [electrolytesByDate, selectedDate, todayIso, activeFast]);

  // Weekly 7-day hydration chart ending on selectedDate
  const weeklySeries = useMemo(() => {
    const days: {
      date: string;
      weekday: string;
      dayNum: string;
      waterMl: number;
      targetMl: number;
      pct: number;
      metGoal: boolean;
      isSelected: boolean;
    }[] = [];

    for (let offset = -6; offset <= 0; offset += 1) {
      const date = shiftIsoDate(selectedDate, offset);
      const consumed = hydrationByDate[date] ?? 0;
      const goal = computeHydrationGoal(
        profile,
        bodyWeights,
        bodyScans,
        workouts,
        hydrationSettings,
        date,
        cardioSessions,
        hiitSessions,
      );
      const target = Math.max(500, goal.totalTargetMl);
      const pct = Math.round((consumed / target) * 100);
      const { weekday, dayNum } = formatShortWeekday(date);
      days.push({
        date,
        weekday,
        dayNum,
        waterMl: consumed,
        targetMl: target,
        pct,
        metGoal: consumed >= target,
        isSelected: date === selectedDate,
      });
    }

    const maxScaleMl = Math.max(
      1000,
      ...days.map((d) => Math.max(d.waterMl, d.targetMl)),
    );
    const totalWeekMl = days.reduce((s, d) => s + d.waterMl, 0);
    const avgDailyMl = Math.round(totalWeekMl / 7);
    const daysMet = days.filter((d) => d.metGoal).length;

    return {
      days,
      maxScaleMl,
      avgDailyMl,
      daysMet,
    };
  }, [
    selectedDate,
    hydrationByDate,
    profile,
    bodyWeights,
    bodyScans,
    workouts,
    hydrationSettings,
    cardioSessions,
    hiitSessions,
  ]);

  return (
    <div className="space-y-6">
      {/* Header + Top ML | OZ Switch + Date Scroller */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Droplets className="w-6 h-6 text-sky-400" />
              <h1 className="text-3xl sm:text-4xl font-extrabold font-display tracking-tight text-white">
                Hidratación
              </h1>
            </div>
            <p className="mt-1 text-sm text-zinc-400">
              Meta adaptada a tu peso, entrenamiento y caminatas · Electrolitos y control semanal
            </p>
          </div>

          {/* Switch ML | OZ arriba */}
          <div
            role="group"
            aria-label="Unidad de líquidos"
            className="inline-flex items-center rounded-2xl border border-[#252A36] bg-[#12141A] p-1 shrink-0"
          >
            {(['ml', 'oz'] as LiquidUnit[]).map((u) => {
              const active = liquidUnit === u;
              return (
                <button
                  key={u}
                  type="button"
                  onClick={() => handleToggleLiquidUnit(u)}
                  aria-pressed={active}
                  className={`min-h-[38px] px-3.5 rounded-xl text-xs font-extrabold uppercase tracking-wide transition-colors ${
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

        {/* Date Selector */}
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#222631] bg-[#12141A] p-1.5">
          <button
            type="button"
            aria-label="Día anterior"
            onClick={() => setSelectedDate((d) => shiftIsoDate(d, -1))}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-300 hover:bg-[#1C2029]"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="px-3 text-sm font-bold text-white text-center">
            {formatDateLabel(selectedDate)}{' '}
            <span className="text-xs font-mono text-zinc-400">({selectedDate})</span>
          </span>
          <button
            type="button"
            aria-label="Día siguiente"
            onClick={() => setSelectedDate((d) => shiftIsoDate(d, 1))}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-300 hover:bg-[#1C2029]"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Daily Target Gauge + 1-Tap (+250/+500/+750/+1000) + Manual + Schedule */}
      <HydrationSection
        profile={profile}
        bodyWeights={bodyWeights}
        bodyScans={bodyScans}
        workouts={workouts}
        cardioSessions={cardioSessions}
        hiitSessions={hiitSessions}
        selectedDate={selectedDate}
        waterMl={waterMl}
        dayLogs={hydrationLogsByDate[selectedDate] ?? []}
        settings={hydrationSettings}
        onAddWater={onAddWater}
        onUndoLastWater={onUndoLastWater}
        onUpdateSettings={onUpdateHydrationSettings}
      />

      {/* Recordatorios Inteligentes de Hidratación y Push */}
      <PushNotificationsCard
        workouts={workouts}
        cardioSessions={cardioSessions}
        hiitSessions={hiitSessions}
        todayTargetMl={todayHydrationGoal.totalTargetMl}
        todayConsumedMl={todayWaterMl}
        liquidUnit={liquidUnit}
        hydrationSettings={hydrationSettings}
        onUpdateHydrationSettings={onUpdateHydrationSettings}
      />

      {/* Electrolytes / Mineral Salts Counter + >16h Fasting Alert */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-300" />
              <h2 className="text-xl font-bold font-display text-white">
                Electrolitos y Sales Minerales
              </h2>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Control de sodio, potasio y magnesio sin calorías para hidratación celular y ayuno prolongado
            </p>
          </div>

          <div className="rounded-2xl border border-[#262C3A] bg-[#0D0F14] px-3.5 py-2 text-right">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              Tomas ({formatDateLabel(selectedDate)})
            </span>
            <span className="text-2xl font-extrabold font-mono tabular-nums text-amber-300">
              {electrolytesCount}
            </span>
          </div>
        </div>

        {/* Alert when active fast exceeds 16h (or completed 16h+ fast today with 0 electrolytes) */}
        {isExtendedFastActive ? (
          <div
            role="alert"
            className="rounded-2xl border border-amber-400/50 bg-amber-500/12 p-3.5 flex items-start gap-3"
          >
            <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <p className="font-extrabold text-amber-200">
                Ayuno prolongado en curso ({fastElapsedHours.toFixed(1)} h · supera 16 h)
              </p>
              <p className="text-amber-100/90 leading-relaxed">
                A partir de las 16 h la insulina baja y eliminas más sodio y agua. Agrega una pizca de sal de mar, potasio y magnesio (sin azúcar) para evitar mareos, fatiga o calambres.
              </p>
            </div>
          </div>
        ) : longFastCompletedOnDate && electrolytesCount === 0 ? (
          <div
            role="status"
            className="rounded-2xl border border-amber-400/35 bg-amber-500/10 p-3.5 flex items-start gap-3"
          >
            <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-100 leading-relaxed">
              Completaste un ayuno de <strong className="font-mono">{longFastCompletedOnDate.actualHours}h</strong> ({'>'} 16 h) hoy sin registrar electrolitos todavía. Considera sumar sales minerales para optimizar tu recuperación.
            </p>
          </div>
        ) : activeFast ? (
          <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
            <span className="text-emerald-200 font-semibold flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-emerald-300 shrink-0" />
              Ayuno activo: <strong className="font-mono">{fastElapsedHours.toFixed(1)}h</strong> (alerta automática de electrolitos al pasar 16 h)
            </span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onUpdateElectrolytes(selectedDate, -1)}
            disabled={electrolytesCount <= 0}
            aria-label="Restar toma de electrolitos"
            className="min-h-[48px] min-w-[56px] rounded-2xl border border-[#2B303C] bg-[#171A23] disabled:opacity-40 flex items-center justify-center text-zinc-200 hover:text-white active:scale-[0.98]"
          >
            <Minus className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => onUpdateElectrolytes(selectedDate, 1)}
            className="flex-1 min-h-[48px] rounded-2xl bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/40 px-4 text-sm font-extrabold text-amber-200 inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          >
            <Plus className="w-4 h-4" />
            +1 Toma de electrolitos / sales minerales
          </button>
        </div>
      </section>

      {/* Today's Intakes History + 7-Day Weekly Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Historial de tomas del día */}
        <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-400" />
                <h2 className="text-lg font-bold font-display text-white">
                  Historial de tomas ({formatDateLabel(selectedDate)})
                </h2>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                {dayLogs.length} {dayLogs.length === 1 ? 'registro guardado' : 'registros guardados'} · Total{' '}
                <span className="font-mono text-sky-300 font-semibold">
                  {formatLiquid(waterMl, liquidUnit)}
                </span>
              </p>
            </div>
          </div>

          {dayLogs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#272C38] bg-[#0D0F14] p-6 text-center space-y-1.5">
              <Droplets className="w-6 h-6 text-zinc-500 mx-auto" />
              <p className="text-xs font-semibold text-zinc-300">
                Sin tomas registradas para {formatDateLabel(selectedDate)}
              </p>
              <p className="text-[11px] text-zinc-500">
                Usa los botones rápidos (+250 / +500 / +750 / +1000 ml) o cantidad manual arriba.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/5 max-h-72 overflow-y-auto pr-1">
              {dayLogs.map((entry) => (
                <div
                  key={entry.id}
                  className="py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-sky-400/12 border border-sky-400/30 flex items-center justify-center shrink-0">
                      <Droplets className="w-4 h-4 text-sky-300" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold font-mono tabular-nums text-white">
                        +{formatLiquid(entry.amountMl, liquidUnit)}
                      </p>
                      <p className="text-[11px] text-zinc-400 truncate">
                        {formatLogTime(entry.recordedAt)} · {describeIntakeKind(entry.amountMl)}
                      </p>
                    </div>
                  </div>

                  <InlineDeleteConfirmButton
                    onConfirm={() => onDeleteWaterLog(selectedDate, entry.id)}
                    ariaLabel={`Eliminar toma de ${formatLiquid(entry.amountMl, liquidUnit)}`}
                    size="md"
                  />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Gráfica semanal de 7 días */}
        <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#D4FF33]" />
                <h2 className="text-lg font-bold font-display text-white">
                  Gráfica semanal (7 días)
                </h2>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Promedio diario:{' '}
                <strong className="font-mono text-white">
                  {formatLiquidPrimary(weeklySeries.avgDailyMl, liquidUnit)}
                </strong>{' '}
                · Metas cumplidas:{' '}
                <strong className="font-mono text-[#D4FF33]">
                  {weeklySeries.daysMet}/7 días
                </strong>
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-[#202531] bg-[#0D0F14] p-4">
            <div className="grid grid-cols-7 gap-2 items-end h-44 pt-4">
              {weeklySeries.days.map((d) => {
                const heightPct =
                  d.waterMl > 0
                    ? Math.max(8, Math.round((d.waterMl / weeklySeries.maxScaleMl) * 100))
                    : 4;
                const goalLinePct = Math.min(
                  96,
                  Math.max(10, Math.round((d.targetMl / weeklySeries.maxScaleMl) * 100)),
                );
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => setSelectedDate(d.date)}
                    title={`${d.date}: ${formatLiquid(d.waterMl, liquidUnit)} / Meta ${formatLiquid(d.targetMl, liquidUnit)} (${d.pct}%)`}
                    className="h-full flex flex-col items-center justify-end gap-1.5 group focus:outline-none"
                  >
                    <span
                      className={`text-[9px] font-mono tabular-nums leading-none ${
                        d.metGoal
                          ? 'text-[#D4FF33] font-bold'
                          : d.waterMl > 0
                            ? 'text-sky-300'
                            : 'text-zinc-600'
                      }`}
                    >
                      {d.waterMl > 0 ? `${d.pct}%` : '—'}
                    </span>

                    <div className="relative w-full flex-1 flex items-end justify-center">
                      {/* Per-day target marker */}
                      <div
                        aria-hidden="true"
                        style={{ bottom: `${goalLinePct}%` }}
                        className="absolute left-0 right-0 border-t border-dashed border-white/20 pointer-events-none"
                      />
                      <div
                        className={`w-full max-w-[28px] rounded-t-lg transition-all duration-300 ${
                          d.metGoal
                            ? 'bg-[#D4FF33]'
                            : d.waterMl > 0
                              ? 'bg-sky-400'
                              : 'bg-[#1D222D]'
                        } ${d.isSelected ? 'ring-2 ring-white/80' : ''}`}
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>

                    <div className="text-center leading-tight">
                      <span
                        className={`block text-[10px] font-bold ${
                          d.isSelected ? 'text-[#D4FF33]' : 'text-zinc-300'
                        }`}
                      >
                        {d.weekday}
                      </span>
                      <span className="block text-[9px] font-mono text-zinc-500">
                        {d.dayNum}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-3 border-t border-white/5 text-[11px] text-zinc-400">
              <div className="flex items-center gap-4">
                <span className="inline-flex items-center gap-1.5 text-[#D4FF33]">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#D4FF33]" />
                  Meta 100%+
                </span>
                <span className="inline-flex items-center gap-1.5 text-sky-300">
                  <span className="w-2.5 h-2.5 rounded-sm bg-sky-400" />
                  En progreso
                </span>
              </div>
              <span>Toca cualquier día para ver su detalle</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
