import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  CalendarRange,
  Dumbbell,
  Footprints,
  Minus,
  Scale,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  buildDateComparison,
  collectRecordedComparisonDates,
  convertMetricForDisplay,
  formatExerciseLoadDisplay,
  formatPaceDeltaDisplay,
  formatPaceDisplay,
  getComparisonPresetDates,
  type ComparisonPresetId,
  type ComparisonWindowMode,
} from '../lib/compareDates';
import { formatVolume, kgToDisplayWeight } from '../lib/units';
import type { AppDatabase } from '../types/fitness';

interface CompareDatesViewProps {
  database: AppDatabase;
}

type DeltaPolarity = 'positive' | 'negative' | 'neutral';

function DeltaBadge({
  text,
  polarity,
}: {
  text: string;
  polarity: DeltaPolarity;
}) {
  const toneClass =
    polarity === 'positive'
      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
      : polarity === 'negative'
        ? 'text-rose-400 bg-rose-500/10 border-rose-500/30'
        : 'text-zinc-300 bg-[#191D26] border-[#272C38]';

  const Icon =
    polarity === 'positive'
      ? TrendingUp
      : polarity === 'negative'
        ? TrendingDown
        : Minus;

  return (
    <span
      className={`inline-flex items-center justify-center gap-1 rounded-xl border px-2.5 py-1 text-xs font-mono font-extrabold tabular-nums whitespace-nowrap ${toneClass}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{text}</span>
    </span>
  );
}

export const CompareDatesView: React.FC<CompareDatesViewProps> = ({ database }) => {
  const initialPreset = useMemo(
    () => getComparisonPresetDates('week_vs_4w', database),
    // Initialize only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [activePreset, setActivePreset] = useState<ComparisonPresetId | null>('week_vs_4w');
  const [dateA, setDateA] = useState<string>(initialPreset.dateA);
  const [dateB, setDateB] = useState<string>(initialPreset.dateB);
  const [windowMode, setWindowMode] = useState<ComparisonWindowMode>(initialPreset.windowMode);

  const recordedDates = useMemo(
    () => collectRecordedComparisonDates(database),
    [database],
  );

  const comparison = useMemo(
    () => buildDateComparison(database, dateA, dateB, windowMode),
    [database, dateA, dateB, windowMode],
  );

  const applyPreset = (preset: ComparisonPresetId) => {
    const next = getComparisonPresetDates(preset, database);
    setActivePreset(preset);
    setDateA(next.dateA);
    setDateB(next.dateB);
    setWindowMode(next.windowMode);
  };

  const handleSwapDates = () => {
    setActivePreset(null);
    setDateA(dateB);
    setDateB(dateA);
  };

  const units = {
    weightUnit: comparison.weightUnit,
    waistUnit: comparison.waistUnit,
    distanceUnit: comparison.distanceUnit,
  };

  // --- Body Composition Metrics Rows ---
  const weightA = convertMetricForDisplay(comparison.bodyBefore.weightKg, 'weight', units);
  const weightB = convertMetricForDisplay(comparison.bodyAfter.weightKg, 'weight', units);
  const weightDelta =
    weightA !== null && weightB !== null ? Math.round((weightB - weightA) * 10) / 10 : null;
  const weightPolarity: DeltaPolarity = (() => {
    if (weightDelta === null || Math.abs(weightDelta) < 0.05) return 'neutral';
    if (comparison.goal === 'ganar_musculo') {
      return weightDelta > 0 ? 'positive' : 'negative';
    }
    if (comparison.goal === 'perder_grasa') {
      return weightDelta < 0 ? 'positive' : 'negative';
    }
    return Math.abs(weightDelta) <= 0.5 ? 'positive' : 'negative';
  })();

  const fatA = comparison.bodyBefore.bodyFatPct;
  const fatB = comparison.bodyAfter.bodyFatPct;
  const fatDelta =
    fatA !== null && fatB !== null ? Math.round((fatB - fatA) * 10) / 10 : null;
  const fatPolarity: DeltaPolarity =
    fatDelta === null || Math.abs(fatDelta) < 0.05
      ? 'neutral'
      : fatDelta < 0
        ? 'positive'
        : 'negative';

  const muscleKgA = convertMetricForDisplay(
    comparison.bodyBefore.muscleMassKg,
    'weight',
    units,
  );
  const muscleKgB = convertMetricForDisplay(
    comparison.bodyAfter.muscleMassKg,
    'weight',
    units,
  );
  const muscleDeltaKg =
    muscleKgA !== null && muscleKgB !== null
      ? Math.round((muscleKgB - muscleKgA) * 10) / 10
      : null;
  const musclePctA = comparison.bodyBefore.musclePct;
  const musclePctB = comparison.bodyAfter.musclePct;
  const muscleDeltaPct =
    musclePctA !== null && musclePctB !== null
      ? Math.round((musclePctB - musclePctA) * 10) / 10
      : null;
  const musclePolarity: DeltaPolarity = (() => {
    if (muscleDeltaKg !== null && Math.abs(muscleDeltaKg) >= 0.05) {
      return muscleDeltaKg > 0 ? 'positive' : 'negative';
    }
    if (muscleDeltaPct !== null && Math.abs(muscleDeltaPct) >= 0.05) {
      return muscleDeltaPct > 0 ? 'positive' : 'negative';
    }
    return 'neutral';
  })();

  const waistA = convertMetricForDisplay(comparison.bodyBefore.waistCm, 'waist', units);
  const waistB = convertMetricForDisplay(comparison.bodyAfter.waistCm, 'waist', units);
  const waistDelta =
    waistA !== null && waistB !== null ? Math.round((waistB - waistA) * 10) / 10 : null;
  const waistPolarity: DeltaPolarity =
    waistDelta === null || Math.abs(waistDelta) < 0.05
      ? 'neutral'
      : waistDelta < 0
        ? 'positive'
        : 'negative';

  // --- Cardio Metrics ---
  const distA = convertMetricForDisplay(comparison.cardioA.totalDistanceKm, 'distance', units) ?? 0;
  const distB = convertMetricForDisplay(comparison.cardioB.totalDistanceKm, 'distance', units) ?? 0;
  const distDelta = Math.round((distB - distA) * 100) / 100;
  const distPolarity: DeltaPolarity =
    Math.abs(distDelta) < 0.01 ? 'neutral' : distDelta > 0 ? 'positive' : 'negative';

  const paceA = comparison.cardioA.avgPaceSecPerKm;
  const paceB = comparison.cardioB.avgPaceSecPerKm;
  const hasBothPaces = paceA > 0 && paceB > 0;
  const paceDeltaSecPerKm = hasBothPaces ? paceB - paceA : null;
  // Lower pace (fewer seconds per km/mi) means faster = positive!
  const pacePolarity: DeltaPolarity =
    paceDeltaSecPerKm === null || Math.abs(paceDeltaSecPerKm) < 1
      ? 'neutral'
      : paceDeltaSecPerKm < 0
        ? 'positive'
        : 'negative';

  const calA = comparison.cardioA.totalCaloriesBurned;
  const calB = comparison.cardioB.totalCaloriesBurned;
  const calDelta = calB - calA;
  const calPolarity: DeltaPolarity =
    calDelta === 0 ? 'neutral' : calDelta > 0 ? 'positive' : 'negative';

  // --- Strength Volume Summary ---
  const volDeltaKg = comparison.totalVolumeKgB - comparison.totalVolumeKgA;
  const volPolarity: DeltaPolarity =
    Math.abs(volDeltaKg) < 1 ? 'neutral' : volDeltaKg > 0 ? 'positive' : 'negative';

  return (
    <div className="space-y-5">
      {/* Header & Shortcuts */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CalendarRange className="w-5 h-5 text-[#D4FF33]" />
              <h2 className="text-xl sm:text-2xl font-extrabold font-display text-white">
                Comparar Fechas (Antes vs. Después)
              </h2>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Analiza lado a lado tu evolución corporal, cargas de fuerza o ligas y rendimiento cardiovascular
            </p>
          </div>
        </div>

        {/* Preset Shortcuts */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-zinc-400">Atajos rápidos</p>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: 'week_vs_4w', label: 'Esta semana vs. Hace 4 semanas' },
                { id: 'last7_vs_prev7', label: 'Últimos 7 días vs. Semana previa' },
                { id: 'month_vs_prev_month', label: 'Este mes vs. Mes pasado' },
                { id: 'first_vs_latest', label: 'Primer registro vs. Más reciente' },
              ] as { id: ComparisonPresetId; label: string }[]
            ).map((p) => {
              const active = activePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={`min-h-[40px] rounded-xl px-3.5 text-xs font-bold transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#D4FF33] text-[#0A0B0D]'
                      : 'border border-[#272C38] bg-[#0D0F14] text-zinc-300 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Date Pickers A vs B + Grouping Window */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end pt-1">
          {/* Fecha A (Antes) */}
          <div className="rounded-2xl border border-[#242936] bg-[#0D0F14] p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="compare-date-a"
                className="text-xs font-bold text-zinc-300"
              >
                Fecha A (Antes)
              </label>
              {recordedDates.length > 0 && (
                <select
                  aria-label="Elegir fecha con registros para Fecha A"
                  value={recordedDates.includes(dateA) ? dateA : ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      setActivePreset(null);
                      setDateA(e.target.value);
                    }
                  }}
                  className="max-w-[140px] rounded-lg border border-[#272C38] bg-[#161922] px-2 py-1 text-[11px] font-mono text-zinc-300 focus:border-[#D4FF33] focus:outline-none"
                >
                  <option value="">Con registros…</option>
                  {recordedDates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <input
              id="compare-date-a"
              type="date"
              value={dateA}
              onChange={(e) => {
                if (e.target.value) {
                  setActivePreset(null);
                  setDateA(e.target.value);
                }
              }}
              className="w-full min-h-[44px] rounded-xl border border-[#2B303C] bg-[#161922] px-3 text-sm font-mono font-bold text-white focus:border-[#D4FF33] focus:outline-none"
            />
            <p className="text-[11px] font-mono text-zinc-400">
              {windowMode === 'day'
                ? `Día ${comparison.rangeA.endDate}`
                : `Periodo: ${comparison.rangeA.startDate} → ${comparison.rangeA.endDate}`}
            </p>
          </div>

          {/* Swap button */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleSwapDates}
              aria-label="Intercambiar Fecha A y Fecha B"
              title="Intercambiar fechas"
              className="min-h-[44px] min-w-[44px] rounded-xl border border-[#2B303C] bg-[#161922] hover:border-[#D4FF33] flex items-center justify-center text-zinc-300 hover:text-[#D4FF33] transition-colors"
            >
              <ArrowLeftRight className="w-4 h-4" />
            </button>
          </div>

          {/* Fecha B (Después) */}
          <div className="rounded-2xl border border-[#D4FF33]/35 bg-[#0D0F14] p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="compare-date-b"
                className="text-xs font-bold text-[#D4FF33]"
              >
                Fecha B (Después)
              </label>
              {recordedDates.length > 0 && (
                <select
                  aria-label="Elegir fecha con registros para Fecha B"
                  value={recordedDates.includes(dateB) ? dateB : ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      setActivePreset(null);
                      setDateB(e.target.value);
                    }
                  }}
                  className="max-w-[140px] rounded-lg border border-[#272C38] bg-[#161922] px-2 py-1 text-[11px] font-mono text-zinc-300 focus:border-[#D4FF33] focus:outline-none"
                >
                  <option value="">Con registros…</option>
                  {recordedDates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <input
              id="compare-date-b"
              type="date"
              value={dateB}
              onChange={(e) => {
                if (e.target.value) {
                  setActivePreset(null);
                  setDateB(e.target.value);
                }
              }}
              className="w-full min-h-[44px] rounded-xl border border-[#2B303C] bg-[#161922] px-3 text-sm font-mono font-bold text-white focus:border-[#D4FF33] focus:outline-none"
            />
            <p className="text-[11px] font-mono text-zinc-400">
              {windowMode === 'day'
                ? `Día ${comparison.rangeB.endDate}`
                : `Periodo: ${comparison.rangeB.startDate} → ${comparison.rangeB.endDate}`}
            </p>
          </div>
        </div>

        {/* Grouping Window Selector */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/5">
          <span className="text-xs text-zinc-400">
            Rango de comparación alrededor de cada fecha:
          </span>
          <div className="inline-flex items-center gap-1 rounded-xl bg-[#0B0C0F] p-1 border border-[#222631]">
            {(
              [
                { id: 'day', label: 'Día exacto' },
                { id: '7d', label: 'Semana (7d)' },
                { id: '30d', label: 'Mes (30d)' },
              ] as { id: ComparisonWindowMode; label: string }[]
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => {
                  setActivePreset(null);
                  setWindowMode(mode.id);
                }}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                  windowMode === mode.id
                    ? 'bg-[#D4FF33] text-[#0A0B0D]'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 1. COMPOSICIÓN CORPORAL */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-[#D4FF33]" />
            <h3 className="text-lg sm:text-xl font-bold font-display text-white">
              1. Composición corporal
            </h3>
          </div>
          <span className="text-xs text-zinc-400">
            Meta:{' '}
            <strong className="text-zinc-200">
              {comparison.goal === 'perder_grasa'
                ? 'Perder grasa'
                : comparison.goal === 'ganar_musculo'
                  ? 'Ganar músculo'
                  : 'Mantener peso'}
            </strong>
          </span>
        </div>

        <div className="divide-y divide-white/5">
          {/* Column headers */}
          <div className="grid grid-cols-[1.2fr_1fr_auto_1fr] gap-2 pb-2 text-[11px] font-semibold text-zinc-400">
            <span>Métrica</span>
            <span className="text-right">Antes (A)</span>
            <span className="text-center px-2">Cambio</span>
            <span className="text-right text-[#D4FF33]">Después (B)</span>
          </div>

          {/* Peso */}
          <div className="py-3 grid grid-cols-[1.2fr_1fr_auto_1fr] gap-2 items-center">
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">Peso corporal</p>
              <p className="text-[11px] text-zinc-500 truncate">
                {comparison.bodyBefore.weightDate && comparison.bodyAfter.weightDate
                  ? `${comparison.bodyBefore.weightDate} vs ${comparison.bodyAfter.weightDate}`
                  : 'Sin pesajes suficientes'}
              </p>
            </div>
            <div className="text-right font-mono tabular-nums">
              <p className="text-sm font-bold text-zinc-200">
                {weightA !== null ? `${weightA} ${comparison.weightUnit}` : '—'}
              </p>
            </div>
            <div className="flex justify-center">
              <DeltaBadge
                text={
                  weightDelta !== null
                    ? `${weightDelta > 0 ? '+' : ''}${weightDelta} ${comparison.weightUnit}`
                    : '—'
                }
                polarity={weightPolarity}
              />
            </div>
            <div className="text-right font-mono tabular-nums">
              <p className="text-sm font-extrabold text-white">
                {weightB !== null ? `${weightB} ${comparison.weightUnit}` : '—'}
              </p>
            </div>
          </div>

          {/* % Grasa corporal */}
          <div className="py-3 grid grid-cols-[1.2fr_1fr_auto_1fr] gap-2 items-center">
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">% de grasa</p>
              <p className="text-[11px] text-zinc-500 truncate">
                {comparison.bodyBefore.scanDate && comparison.bodyAfter.scanDate
                  ? `${comparison.bodyBefore.scanDate} vs ${comparison.bodyAfter.scanDate}`
                  : 'Requiere escaneo de báscula'}
              </p>
            </div>
            <div className="text-right font-mono tabular-nums">
              <p className="text-sm font-bold text-zinc-200">
                {fatA !== null ? `${fatA.toFixed(1)}%` : '—'}
              </p>
            </div>
            <div className="flex justify-center">
              <DeltaBadge
                text={
                  fatDelta !== null
                    ? `${fatDelta > 0 ? '+' : ''}${fatDelta.toFixed(1)}%`
                    : '—'
                }
                polarity={fatPolarity}
              />
            </div>
            <div className="text-right font-mono tabular-nums">
              <p className="text-sm font-extrabold text-white">
                {fatB !== null ? `${fatB.toFixed(1)}%` : '—'}
              </p>
            </div>
          </div>

          {/* Masa muscular */}
          <div className="py-3 grid grid-cols-[1.2fr_1fr_auto_1fr] gap-2 items-center">
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">Masa muscular</p>
              <p className="text-[11px] text-zinc-500 truncate">
                {musclePctA !== null && musclePctB !== null
                  ? `${musclePctA.toFixed(1)}% → ${musclePctB.toFixed(1)}%`
                  : 'Músculo total'}
              </p>
            </div>
            <div className="text-right font-mono tabular-nums">
              <p className="text-sm font-bold text-zinc-200">
                {muscleKgA !== null ? `${muscleKgA} ${comparison.weightUnit}` : '—'}
              </p>
            </div>
            <div className="flex justify-center">
              <DeltaBadge
                text={
                  muscleDeltaKg !== null
                    ? `${muscleDeltaKg > 0 ? '+' : ''}${muscleDeltaKg} ${comparison.weightUnit}`
                    : '—'
                }
                polarity={musclePolarity}
              />
            </div>
            <div className="text-right font-mono tabular-nums">
              <p className="text-sm font-extrabold text-white">
                {muscleKgB !== null ? `${muscleKgB} ${comparison.weightUnit}` : '—'}
              </p>
            </div>
          </div>

          {/* Cintura */}
          <div className="py-3 grid grid-cols-[1.2fr_1fr_auto_1fr] gap-2 items-center">
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">Medida de cintura</p>
              <p className="text-[11px] text-zinc-500 truncate">
                {comparison.bodyBefore.waistDate && comparison.bodyAfter.waistDate
                  ? `${comparison.bodyBefore.waistDate} vs ${comparison.bodyAfter.waistDate}`
                  : 'Regístrala en Báscula o Progreso'}
              </p>
            </div>
            <div className="text-right font-mono tabular-nums">
              <p className="text-sm font-bold text-zinc-200">
                {waistA !== null ? `${waistA} ${comparison.waistUnit}` : '—'}
              </p>
            </div>
            <div className="flex justify-center">
              <DeltaBadge
                text={
                  waistDelta !== null
                    ? `${waistDelta > 0 ? '+' : ''}${waistDelta} ${comparison.waistUnit}`
                    : '—'
                }
                polarity={waistPolarity}
              />
            </div>
            <div className="text-right font-mono tabular-nums">
              <p className="text-sm font-extrabold text-white">
                {waistB !== null ? `${waistB} ${comparison.waistUnit}` : '—'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. FUERZA Y LIGAS */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Dumbbell className="w-5 h-5 text-[#D4FF33]" />
            <h3 className="text-lg sm:text-xl font-bold font-display text-white">
              2. Fuerza y ligas (mismos ejercicios)
            </h3>
          </div>
          <span className="text-xs font-mono text-zinc-400">
            {comparison.workoutsCountA} ses. vs {comparison.workoutsCountB} ses.
          </span>
        </div>

        {/* Volume overview */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center rounded-2xl border border-[#222631] bg-[#0D0F14] p-3.5">
          <div>
            <p className="text-[11px] text-zinc-400">Volumen total (A)</p>
            <p className="text-base font-extrabold font-mono tabular-nums text-white">
              {formatVolume(comparison.totalVolumeKgA, comparison.weightUnit)}
            </p>
          </div>
          <div className="flex justify-center">
            <DeltaBadge
              text={
                comparison.totalVolumeKgA === 0 && comparison.totalVolumeKgB === 0
                  ? '—'
                  : `${volDeltaKg > 0 ? '+' : ''}${kgToDisplayWeight(
                      volDeltaKg,
                      comparison.weightUnit,
                    )} ${comparison.weightUnit}`
              }
              polarity={volPolarity}
            />
          </div>
          <div className="text-right">
            <p className="text-[11px] text-[#D4FF33]">Volumen total (B)</p>
            <p className="text-base font-extrabold font-mono tabular-nums text-white">
              {formatVolume(comparison.totalVolumeKgB, comparison.weightUnit)}
            </p>
          </div>
        </div>

        {comparison.matchedExercises.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#262B38] bg-[#0D0F14] p-5 text-center space-y-2.5">
            <p className="text-sm font-semibold text-zinc-300">
              No hay ejercicios repetidos exactamente entre ambos periodos seleccionados.
            </p>
            <p className="text-xs text-zinc-500">
              Asegúrate de haber entrenado el mismo ejercicio en Fecha A y Fecha B, o amplía el rango de comparación.
            </p>
            {windowMode !== '30d' && (
              <button
                type="button"
                onClick={() => {
                  setActivePreset(null);
                  setWindowMode(windowMode === 'day' ? '7d' : '30d');
                }}
                className="min-h-[42px] inline-flex items-center justify-center rounded-xl bg-[#D4FF33] px-4 text-xs font-extrabold text-[#0A0B0D]"
              >
                Ampliar a {windowMode === 'day' ? 'ventana de 7 días' : 'ventana de 30 días'}
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            <div className="grid grid-cols-[1.2fr_1fr_auto_1fr] gap-2 pb-2 text-[11px] font-semibold text-zinc-400">
              <span>Ejercicio</span>
              <span className="text-right">Antes (A)</span>
              <span className="text-center px-2">Diferencia</span>
              <span className="text-right text-[#D4FF33]">Después (B)</span>
            </div>

            {comparison.matchedExercises.map((item) => {
              const dispA = formatExerciseLoadDisplay(item.before, comparison.weightUnit);
              const dispB = formatExerciseLoadDisplay(item.after, comparison.weightUnit);

              const deltaDisplayWeight =
                Math.round(
                  (kgToDisplayWeight(item.after.bestWeightKg, comparison.weightUnit) -
                    kgToDisplayWeight(item.before.bestWeightKg, comparison.weightUnit)) *
                    10,
                ) / 10;

              const deltaText =
                Math.abs(item.deltaWeightKg) >= 0.05
                  ? `${deltaDisplayWeight > 0 ? '+' : ''}${deltaDisplayWeight} ${comparison.weightUnit}`
                  : item.deltaReps !== 0
                    ? `${item.deltaReps > 0 ? '+' : ''}${item.deltaReps} reps`
                    : 'Igual';

              return (
                <div
                  key={item.key}
                  className="py-3 grid grid-cols-[1.2fr_1fr_auto_1fr] gap-2 items-center"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">{item.name}</p>
                    <p className="text-[11px] text-zinc-500">
                      {item.after.loadMode === 'bands' || item.before.loadMode === 'bands'
                        ? 'Ligas de resistencia'
                        : 'Peso / carga'}
                    </p>
                  </div>

                  <div className="text-right font-mono tabular-nums min-w-0">
                    <p className="text-xs sm:text-sm font-bold text-zinc-200 truncate">
                      {dispA.primary}
                    </p>
                    <p className="text-[11px] text-zinc-500 truncate">{dispA.secondary}</p>
                  </div>

                  <div className="flex justify-center">
                    <DeltaBadge text={deltaText} polarity={item.trend} />
                  </div>

                  <div className="text-right font-mono tabular-nums min-w-0">
                    <p className="text-xs sm:text-sm font-extrabold text-white truncate">
                      {dispB.primary}
                    </p>
                    <p className="text-[11px] text-zinc-400 truncate">{dispB.secondary}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. CARDIO */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Footprints className="w-5 h-5 text-sky-400" />
            <h3 className="text-lg sm:text-xl font-bold font-display text-white">
              3. Cardio y resistencia
            </h3>
          </div>
          <span className="text-xs font-mono text-zinc-400">
            {comparison.cardioA.sessionsCount} ses. vs {comparison.cardioB.sessionsCount} ses.
          </span>
        </div>

        <div className="divide-y divide-white/5">
          <div className="grid grid-cols-[1.2fr_1fr_auto_1fr] gap-2 pb-2 text-[11px] font-semibold text-zinc-400">
            <span>Métrica</span>
            <span className="text-right">Antes (A)</span>
            <span className="text-center px-2">Cambio</span>
            <span className="text-right text-[#D4FF33]">Después (B)</span>
          </div>

          {/* Distancia acumulada */}
          <div className="py-3 grid grid-cols-[1.2fr_1fr_auto_1fr] gap-2 items-center">
            <div>
              <p className="text-sm font-bold text-white">Distancia acumulada</p>
              <p className="text-[11px] text-zinc-500">Suma del periodo</p>
            </div>
            <div className="text-right font-mono tabular-nums">
              <p className="text-sm font-bold text-zinc-200">
                {distA.toFixed(2)} {comparison.distanceUnit}
              </p>
            </div>
            <div className="flex justify-center">
              <DeltaBadge
                text={`${distDelta > 0 ? '+' : ''}${distDelta.toFixed(2)} ${comparison.distanceUnit}`}
                polarity={distPolarity}
              />
            </div>
            <div className="text-right font-mono tabular-nums">
              <p className="text-sm font-extrabold text-white">
                {distB.toFixed(2)} {comparison.distanceUnit}
              </p>
            </div>
          </div>

          {/* Ritmo promedio */}
          <div className="py-3 grid grid-cols-[1.2fr_1fr_auto_1fr] gap-2 items-center">
            <div>
              <p className="text-sm font-bold text-white">Ritmo promedio</p>
              <p className="text-[11px] text-zinc-500">Menor tiempo = más rápido</p>
            </div>
            <div className="text-right font-mono tabular-nums">
              <p className="text-sm font-bold text-zinc-200">
                {formatPaceDisplay(paceA, comparison.distanceUnit)}
              </p>
            </div>
            <div className="flex justify-center">
              <DeltaBadge
                text={
                  paceDeltaSecPerKm !== null
                    ? formatPaceDeltaDisplay(paceDeltaSecPerKm, comparison.distanceUnit)
                    : '—'
                }
                polarity={pacePolarity}
              />
            </div>
            <div className="text-right font-mono tabular-nums">
              <p className="text-sm font-extrabold text-white">
                {formatPaceDisplay(paceB, comparison.distanceUnit)}
              </p>
            </div>
          </div>

          {/* Calorías quemadas */}
          <div className="py-3 grid grid-cols-[1.2fr_1fr_auto_1fr] gap-2 items-center">
            <div>
              <p className="text-sm font-bold text-white">Calorías quemadas</p>
              <p className="text-[11px] text-zinc-500">Gasto cardiovascular</p>
            </div>
            <div className="text-right font-mono tabular-nums">
              <p className="text-sm font-bold text-zinc-200">
                {calA.toLocaleString('es-ES')} kcal
              </p>
            </div>
            <div className="flex justify-center">
              <DeltaBadge
                text={`${calDelta > 0 ? '+' : ''}${calDelta.toLocaleString('es-ES')} kcal`}
                polarity={calPolarity}
              />
            </div>
            <div className="text-right font-mono tabular-nums">
              <p className="text-sm font-extrabold text-white">
                {calB.toLocaleString('es-ES')} kcal
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
