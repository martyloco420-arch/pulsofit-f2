import React, { useMemo, useState } from 'react';
import { Activity, ArrowUpRight, Scale, TrendingDown, TrendingUp } from 'lucide-react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { shiftIsoDate } from '../lib/compareDates';
import { getTodayIsoDate } from '../lib/storage';
import { KG_TO_LB } from '../lib/units';
import type {
  BodyCompositionScan,
  BodyWeightEntry,
  WeightUnit,
} from '../types/fitness';

export type WeightChartViewMode = 'scatter' | 'compact';
export type WeightScatterRange = '30D' | '90D' | 'Todo';
export type WeightCompactRange = '7D' | '30D' | '90D';

interface WeightTrendScatterCardProps {
  bodyWeights: BodyWeightEntry[];
  bodyScans: BodyCompositionScan[];
  weightUnit: WeightUnit;
  onOpenScale?: () => void;
}

interface RawDailyWeight {
  date: string;
  timestamp: number;
  weightKg: number;
  sourceOrder: number;
  recordedAtMs: number;
}

interface ScatterChartPoint {
  date: string;
  timestamp: number;
  fullDateLabel: string;
  shortDateLabel: string;
  weightKg: number;
  weightDisplay: number;
  movingAvg30d: number;
  trendLine?: number;
}

interface CompactChartPoint {
  date: string;
  shortDate: string;
  fullDate: string;
  weightKg: number;
  displayWeight: number;
}

function toPreciseDisplayWeight(kg: number, unit: WeightUnit): number {
  if (!Number.isFinite(kg)) return 0;
  const raw = unit === 'lb' ? kg * KG_TO_LB : kg;
  return Math.round(raw * 100) / 100;
}

function toCompactDisplayWeight(kg: number, unit: WeightUnit): number {
  if (!Number.isFinite(kg)) return 0;
  const raw = unit === 'lb' ? kg * KG_TO_LB : kg;
  return Math.round(raw * 10) / 10;
}

function parseLocalNoonTimestamp(isoDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return Number.NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(year, month - 1, day, 12, 0, 0, 0);
  return dt.getTime();
}

function formatShortDayMonth(ts: number): string {
  if (!Number.isFinite(ts)) return '';
  const dt = new Date(ts);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

function formatLocalFullDate(isoDate: string): string {
  const ts = parseLocalNoonTimestamp(isoDate);
  if (!Number.isFinite(ts)) return isoDate;
  return new Date(ts).toLocaleDateString('es-MX', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCompactShortDateEs(isoDate: string): string {
  const ts = parseLocalNoonTimestamp(isoDate);
  if (!Number.isFinite(ts)) return isoDate.slice(5);
  return new Date(ts)
    .toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
    .replace('.', '');
}

function formatCompactFullDateEs(isoDate: string): string {
  const ts = parseLocalNoonTimestamp(isoDate);
  if (!Number.isFinite(ts)) return isoDate;
  return new Date(ts).toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function normalizeToLocalDateKey(
  rawDate?: string,
  fallbackIsoTimestamp?: string,
): string | null {
  if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return rawDate;
  }
  if (fallbackIsoTimestamp) {
    const parsed = new Date(fallbackIsoTimestamp);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-CA');
    }
  }
  return null;
}

const DarkScatterTooltip: React.FC<{
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ScatterChartPoint }>;
  unit: WeightUnit;
}> = ({ active, payload, unit }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload.find((entry) => entry.payload)?.payload;
  if (!point) return null;

  const delta = Math.round((point.weightDisplay - point.movingAvg30d) * 100) / 100;
  const deltaSign = delta > 0 ? '+' : '';
  const deltaGrams =
    unit === 'kg' ? Math.round((point.weightDisplay - point.movingAvg30d) * 1000) : null;

  const deltaTone =
    delta < 0
      ? 'text-emerald-400'
      : delta > 0
        ? 'text-amber-300'
        : 'text-zinc-300';

  return (
    <div className="rounded-xl border border-[#2C3344] bg-[#0B0D12]/95 px-3.5 py-2.5 shadow-xl backdrop-blur-sm min-w-[205px]">
      <p className="text-[11px] font-semibold text-zinc-400 capitalize">
        {point.fullDateLabel} ({point.shortDateLabel})
      </p>

      <div className="mt-2 space-y-1.5 text-xs">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-[#C6F135]" />
            Peso del día
          </span>
          <span className="font-mono font-extrabold tabular-nums text-[#C6F135]">
            {point.weightDisplay.toFixed(2)} {unit}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-zinc-300">
            <span className="h-0.5 w-2.5 rounded bg-[#38BDF8]" />
            Media 30d
          </span>
          <span className="font-mono font-bold tabular-nums text-[#38BDF8]">
            {point.movingAvg30d.toFixed(2)} {unit}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-[#1E2330] pt-1.5">
          <span className="text-zinc-400">Diferencia vs 30d</span>
          <span className={`font-mono font-extrabold tabular-nums ${deltaTone}`}>
            {deltaSign}
            {delta.toFixed(2)} {unit}
            {deltaGrams !== null && (
              <span className="ml-1 text-[10px] font-semibold opacity-80">
                ({deltaGrams > 0 ? '+' : ''}
                {deltaGrams} g)
              </span>
            )}
          </span>
        </div>

        {typeof point.trendLine === 'number' && (
          <div className="flex items-center justify-between gap-4 text-[11px] text-zinc-400">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-2.5 border-t border-dashed border-[#94A3B8]" />
              Tendencia lineal
            </span>
            <span className="font-mono tabular-nums text-zinc-300">
              {point.trendLine.toFixed(2)} {unit}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

const DarkCompactTooltip: React.FC<{
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: CompactChartPoint }>;
  unit: WeightUnit;
}> = ({ active, payload, unit }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-xl border border-[#2C3344] bg-[#0B0D12]/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="text-[11px] font-medium text-zinc-400 capitalize">
        {point.fullDate}
      </p>
      <p className="mt-0.5 text-sm font-extrabold font-mono tabular-nums text-[#a3e635]">
        {point.displayWeight.toFixed(1)} {unit}
      </p>
    </div>
  );
};

export const WeightTrendScatterCard: React.FC<WeightTrendScatterCardProps> = ({
  bodyWeights,
  bodyScans,
  weightUnit,
  onOpenScale,
}) => {
  const [viewMode, setViewMode] = useState<WeightChartViewMode>('scatter');
  const [scatterRange, setScatterRange] = useState<WeightScatterRange>('30D');
  const [compactRange, setCompactRange] = useState<WeightCompactRange>('30D');
  const todayIso = getTodayIsoDate();

  const sortedDailyWeights = useMemo(() => {
    const byDate = new Map<string, RawDailyWeight>();

    const upsert = (
      dateKey: string,
      weightKg: number,
      sourceOrder: number,
      recordedAtMs: number,
    ) => {
      if (!Number.isFinite(weightKg) || weightKg <= 0) return;
      const ts = parseLocalNoonTimestamp(dateKey);
      if (!Number.isFinite(ts)) return;

      const existing = byDate.get(dateKey);
      if (
        !existing ||
        sourceOrder > existing.sourceOrder ||
        (sourceOrder === existing.sourceOrder && recordedAtMs >= existing.recordedAtMs)
      ) {
        byDate.set(dateKey, {
          date: dateKey,
          timestamp: ts,
          weightKg,
          sourceOrder,
          recordedAtMs,
        });
      }
    };

    for (const bw of bodyWeights) {
      const dateKey = normalizeToLocalDateKey(bw.date);
      if (!dateKey) continue;
      upsert(dateKey, bw.weightKg, 1, parseLocalNoonTimestamp(dateKey));
    }

    for (const sc of bodyScans) {
      const dateKey = normalizeToLocalDateKey(sc.date, sc.recordedAt);
      if (!dateKey) continue;
      const recordedMs = sc.recordedAt ? new Date(sc.recordedAt).getTime() : 0;
      upsert(
        dateKey,
        sc.weightKg,
        2,
        Number.isFinite(recordedMs) ? recordedMs : parseLocalNoonTimestamp(dateKey),
      );
    }

    return Array.from(byDate.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [bodyWeights, bodyScans]);

  const scatterModel = useMemo(() => {
    const allWithMovingAvg: ScatterChartPoint[] = sortedDailyWeights.map((item, idx) => {
      const windowStartIso = shiftIsoDate(item.date, -30);
      let sumKg = 0;
      let count = 0;

      for (let j = idx; j >= 0; j -= 1) {
        const candidate = sortedDailyWeights[j];
        if (candidate.date < windowStartIso) {
          break;
        }
        sumKg += candidate.weightKg;
        count += 1;
      }

      const avgKg = count > 0 ? sumKg / count : item.weightKg;

      return {
        date: item.date,
        timestamp: item.timestamp,
        fullDateLabel: formatLocalFullDate(item.date),
        shortDateLabel: formatShortDayMonth(item.timestamp),
        weightKg: item.weightKg,
        weightDisplay: toPreciseDisplayWeight(item.weightKg, weightUnit),
        movingAvg30d: toPreciseDisplayWeight(avgKg, weightUnit),
      };
    });

    const visible =
      scatterRange === 'Todo'
        ? allWithMovingAvg
        : (() => {
            const daysBack = scatterRange === '90D' ? 90 : 30;
            const cutoffIso = shiftIsoDate(todayIso, -daysBack);
            return allWithMovingAvg.filter(
              (point) => point.date >= cutoffIso && point.date <= todayIso,
            );
          })();

    let slopePerWeek: number | null = null;
    const withRegression: ScatterChartPoint[] = visible.map((p) => ({ ...p }));

    if (withRegression.length >= 2) {
      const t0 = withRegression[0].timestamp;
      const xs = withRegression.map((p) => (p.timestamp - t0) / 86_400_000);
      const ys = withRegression.map((p) => p.weightDisplay);
      const n = xs.length;
      const meanX = xs.reduce((acc, v) => acc + v, 0) / n;
      const meanY = ys.reduce((acc, v) => acc + v, 0) / n;

      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i += 1) {
        const dx = xs[i] - meanX;
        num += dx * (ys[i] - meanY);
        den += dx * dx;
      }

      const slopePerDay = den > 0 ? num / den : 0;
      const intercept = meanY - slopePerDay * meanX;
      slopePerWeek = Math.round(slopePerDay * 7 * 100) / 100;

      for (let i = 0; i < n; i += 1) {
        withRegression[i].trendLine =
          Math.round((slopePerDay * xs[i] + intercept) * 100) / 100;
      }
    }

    let computedYMin = 0;
    let computedYMax = 100;
    if (withRegression.length > 0) {
      const visibleValues: number[] = [];
      for (const p of withRegression) {
        visibleValues.push(p.weightDisplay, p.movingAvg30d);
        if (typeof p.trendLine === 'number') {
          visibleValues.push(p.trendLine);
        }
      }
      const minVal = Math.min(...visibleValues);
      const maxVal = Math.max(...visibleValues);
      computedYMin = Math.max(0, Math.floor((minVal - 1.0) * 10) / 10);
      computedYMax = Math.ceil((maxVal + 1.0) * 10) / 10;
    }

    return {
      allCount: allWithMovingAvg.length,
      chartData: withRegression,
      yMin: computedYMin,
      yMax: computedYMax,
      latestPoint: withRegression[withRegression.length - 1] ?? null,
      weeklySlopeRate: slopePerWeek,
    };
  }, [sortedDailyWeights, scatterRange, todayIso, weightUnit]);

  const compactModel = useMemo(() => {
    const daysBack = compactRange === '7D' ? 7 : compactRange === '90D' ? 90 : 30;
    const cutoffIso = shiftIsoDate(todayIso, -daysBack);
    const recent = sortedDailyWeights.filter(
      (item) => item.date >= cutoffIso && item.date <= todayIso,
    );

    const points: CompactChartPoint[] = recent.map((item) => ({
      date: item.date,
      shortDate: formatCompactShortDateEs(item.date),
      fullDate: formatCompactFullDateEs(item.date),
      weightKg: item.weightKg,
      displayWeight: toCompactDisplayWeight(item.weightKg, weightUnit),
    }));

    const first = points[0] ?? null;
    const last = points[points.length - 1] ?? null;
    const netDelta =
      first && last
        ? Math.round((last.displayWeight - first.displayWeight) * 10) / 10
        : null;

    let yMin = 0;
    let yMax = 100;
    if (points.length > 0) {
      const values = points.map((p) => p.displayWeight);
      const minV = Math.min(...values);
      const maxV = Math.max(...values);
      const span = maxV - minV;
      const pad = span < 0.5 ? 0.6 : Math.max(0.4, Math.round(span * 0.25 * 10) / 10);
      yMin = Math.max(0, Math.floor((minV - pad) * 10) / 10);
      yMax = Math.ceil((maxV + pad) * 10) / 10;
    }

    const latestOverall = sortedDailyWeights[sortedDailyWeights.length - 1] ?? null;
    const latestOverallDisplay = latestOverall
      ? toCompactDisplayWeight(latestOverall.weightKg, weightUnit)
      : null;

    return {
      daysBack,
      allCount: sortedDailyWeights.length,
      chartData: points,
      yMin,
      yMax,
      startPoint: first,
      currentPoint: last,
      netDelta,
      latestOverallDisplay,
    };
  }, [sortedDailyWeights, compactRange, todayIso, weightUnit]);

  const slopeToneClass =
    scatterModel.weeklySlopeRate === null
      ? 'border-[#282D3B] bg-[#0D0F14] text-zinc-400'
      : scatterModel.weeklySlopeRate < 0
        ? 'border-emerald-400/35 bg-emerald-400/12 text-emerald-400'
        : scatterModel.weeklySlopeRate > 0
          ? 'border-amber-400/35 bg-amber-400/12 text-amber-300'
          : 'border-[#282D3B] bg-[#0D0F14] text-zinc-300';

  const compactDeltaClass =
    compactModel.netDelta === null
      ? 'border-[#282D3B] bg-[#0D0F14] text-zinc-400'
      : compactModel.netDelta < 0
        ? 'border-emerald-400/35 bg-emerald-400/12 text-emerald-400'
        : compactModel.netDelta > 0
          ? 'border-amber-400/35 bg-amber-400/12 text-amber-300'
          : 'border-[#282D3B] bg-[#0D0F14] text-zinc-300';

  return (
    <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-3.5">
      {/* Cabecera unificada con selector segmentado */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-[#C6F135]">
            {viewMode === 'scatter' ? (
              <Activity className="w-4 h-4" />
            ) : (
              <Scale className="w-4 h-4 text-[#a3e635]" />
            )}
            <span>
              {viewMode === 'scatter'
                ? 'Dispersión de Peso y Media Móvil 30d'
                : `Tendencia de Peso (${compactRange})`}
            </span>
          </div>

          {/* Selector segmentado de vista */}
          <div
            role="tablist"
            aria-label="Modo de gráfica de peso"
            className="inline-flex rounded-xl border border-[#262B38] bg-[#0B0D12] p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'scatter'}
              onClick={() => setViewMode('scatter')}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold transition-colors ${
                viewMode === 'scatter'
                  ? 'bg-[#C6F135] text-[#0A0B0D]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Dispersión + Media 30d
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'compact'}
              onClick={() => setViewMode('compact')}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold transition-colors ${
                viewMode === 'compact'
                  ? 'bg-[#C6F135] text-[#0A0B0D]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Línea Compacta
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          {viewMode === 'scatter' ? (
            <div>
              <p className="text-[11px] text-zinc-400">
                Pesajes diarios individuales, promedio móvil de 30 días naturales y regresión lineal
              </p>

              {scatterModel.latestPoint && (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <div>
                    <span className="text-zinc-400 mr-1.5">Último:</span>
                    <strong className="font-mono tabular-nums text-[#C6F135]">
                      {scatterModel.latestPoint.weightDisplay.toFixed(2)} {weightUnit}
                    </strong>
                  </div>
                  <div>
                    <span className="text-zinc-400 mr-1.5">Media 30d:</span>
                    <strong className="font-mono tabular-nums text-[#38BDF8]">
                      {scatterModel.latestPoint.movingAvg30d.toFixed(2)} {weightUnit}
                    </strong>
                  </div>
                  <div>
                    <span className="text-zinc-400 mr-1.5">Registros:</span>
                    <strong className="font-mono tabular-nums text-zinc-200">
                      {scatterModel.chartData.length}
                    </strong>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              {compactModel.chartData.length >= 2 &&
              compactModel.currentPoint &&
              compactModel.startPoint ? (
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <div>
                    <span className="text-[11px] text-zinc-400 mr-1.5">Actual</span>
                    <span className="text-2xl font-extrabold font-mono tabular-nums text-white">
                      {compactModel.currentPoint.displayWeight.toFixed(1)}{' '}
                      <span className="text-sm font-bold text-zinc-400">
                        {weightUnit}
                      </span>
                    </span>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-zinc-400">
                    Inicio ({compactModel.startPoint.shortDate}):{' '}
                    <strong className="text-zinc-200">
                      {compactModel.startPoint.displayWeight.toFixed(1)} {weightUnit}
                    </strong>
                  </div>
                </div>
              ) : (
                <p className="text-sm font-bold text-white">
                  {compactModel.latestOverallDisplay !== null
                    ? `Último registro: ${compactModel.latestOverallDisplay.toFixed(1)} ${weightUnit}`
                    : `Seguimiento de los últimos ${compactModel.daysBack} días`}
                </p>
              )}
            </div>
          )}

          {/* Controles de rango, delta/ritmo semanal y botón de báscula */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {viewMode === 'scatter' ? (
              <>
                <div className="inline-flex rounded-xl border border-[#262B38] bg-[#0B0D12] p-0.5">
                  {(['30D', '90D', 'Todo'] as WeightScatterRange[]).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setScatterRange(opt)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition-colors ${
                        scatterRange === opt
                          ? 'bg-[#C6F135] text-[#0A0B0D]'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>

                {scatterModel.weeklySlopeRate !== null && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs font-extrabold font-mono tabular-nums ${slopeToneClass}`}
                  >
                    {scatterModel.weeklySlopeRate < 0 ? (
                      <TrendingDown className="w-3.5 h-3.5" />
                    ) : scatterModel.weeklySlopeRate > 0 ? (
                      <TrendingUp className="w-3.5 h-3.5" />
                    ) : null}
                    {scatterModel.weeklySlopeRate > 0 ? '+' : ''}
                    {scatterModel.weeklySlopeRate.toFixed(2)} {weightUnit}/sem
                  </span>
                )}
              </>
            ) : (
              <>
                <div className="inline-flex rounded-xl border border-[#262B38] bg-[#0B0D12] p-0.5">
                  {(['7D', '30D', '90D'] as WeightCompactRange[]).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setCompactRange(opt)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition-colors ${
                        compactRange === opt
                          ? 'bg-[#D4FF33] text-[#0A0B0D]'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>

                {compactModel.chartData.length >= 2 &&
                  compactModel.netDelta !== null && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs font-extrabold font-mono tabular-nums ${compactDeltaClass}`}
                    >
                      {compactModel.netDelta < 0 ? (
                        <TrendingDown className="w-3.5 h-3.5" />
                      ) : compactModel.netDelta > 0 ? (
                        <TrendingUp className="w-3.5 h-3.5" />
                      ) : null}
                      {compactModel.netDelta > 0 ? '+' : ''}
                      {compactModel.netDelta.toFixed(1)} {weightUnit}
                    </span>
                  )}
              </>
            )}

            {onOpenScale && (
              <button
                type="button"
                onClick={onOpenScale}
                className="min-h-[34px] inline-flex items-center gap-1 rounded-xl border border-[#262B38] bg-[#0D0F14] px-3 text-xs font-bold text-zinc-200 hover:border-[#C6F135]/50 transition-colors"
              >
                Báscula
                <ArrowUpRight className="w-3.5 h-3.5 text-[#C6F135]" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Renderizado condicional según el modo seleccionado */}
      {viewMode === 'scatter' ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-semibold text-zinc-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#C6F135]" />
              Pesaje diario
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded bg-[#38BDF8]" />
              Media móvil 30 días
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 border-t-2 border-dashed border-[#94A3B8]" />
              Tendencia lineal
            </span>
          </div>

          {scatterModel.chartData.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#272C38] bg-[#0D0F14] px-4 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#161922] border border-[#262B38] flex items-center justify-center text-[#C6F135] shrink-0">
                  <Scale className="w-4 h-4" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-zinc-200">
                    {scatterModel.allCount === 0
                      ? 'Aún no hay pesajes registrados.'
                      : `No hay pesajes en el rango ${scatterRange}.`}
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    {scatterModel.allCount === 0
                      ? `Registra un pesaje manual o con la báscula BLE para ver la dispersión y media móvil en ${weightUnit.toUpperCase()}.`
                      : 'Cambia a 90D o Todo para analizar tu historial completo.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {scatterModel.allCount > 0 && scatterRange !== 'Todo' && (
                  <button
                    type="button"
                    onClick={() => setScatterRange('Todo')}
                    className="min-h-[38px] rounded-xl border border-[#2C3344] bg-[#161922] px-3.5 text-xs font-bold text-zinc-200 hover:border-[#C6F135]/50"
                  >
                    Ver Todo
                  </button>
                )}
                {onOpenScale && (
                  <button
                    type="button"
                    onClick={onOpenScale}
                    className="min-h-[38px] rounded-xl bg-[#C6F135] px-3.5 text-xs font-extrabold text-[#0A0B0D] active:scale-[0.98]"
                  >
                    Registrar pesaje
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-[#1E2330] bg-[#0D0F14] pt-3 pb-2 px-2">
              <div className="w-full min-w-0" style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart
                    data={scatterModel.chartData}
                    margin={{ top: 10, right: 14, left: -4, bottom: 4 }}
                  >
                    <CartesianGrid
                      stroke="#1C212E"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="timestamp"
                      type="number"
                      scale="time"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={formatShortDayMonth}
                      tick={{ fill: '#94A3B8', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={26}
                    />
                    <YAxis
                      domain={[scatterModel.yMin, scatterModel.yMax]}
                      tick={{ fill: '#94A3B8', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                      tickFormatter={(v: number) => v.toFixed(1)}
                    />
                    <Tooltip
                      content={<DarkScatterTooltip unit={weightUnit} />}
                      cursor={{ stroke: '#3F4659', strokeDasharray: '3 3' }}
                    />
                    <Line
                      type="linear"
                      dataKey="trendLine"
                      stroke="#94A3B8"
                      strokeWidth={1.75}
                      strokeDasharray="4 4"
                      dot={false}
                      activeDot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="movingAvg30d"
                      stroke="#38BDF8"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{
                        r: 4.5,
                        fill: '#38BDF8',
                        stroke: '#0D0F14',
                        strokeWidth: 1.5,
                      }}
                      connectNulls
                      isAnimationActive={false}
                    />
                    <Scatter
                      dataKey="weightDisplay"
                      fill="#C6F135"
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      ) : compactModel.chartData.length < 2 ? (
        <div className="rounded-2xl border border-dashed border-[#272C38] bg-[#0D0F14] px-4 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-zinc-200">
              {compactModel.allCount < 2
                ? 'Necesitas al menos 2 pesajes para graficar tu tendencia.'
                : `Se requieren al menos 2 pesajes en los últimos ${compactModel.daysBack} días.`}
            </p>
            <p className="text-[11px] text-zinc-400">
              Registra tus pesajes para visualizar la evolución neta en{' '}
              {weightUnit.toUpperCase()}.
            </p>
          </div>
          {onOpenScale && (
            <button
              type="button"
              onClick={onOpenScale}
              className="min-h-[38px] shrink-0 rounded-xl bg-[#a3e635] px-3.5 text-xs font-extrabold text-[#0A0B0D] active:scale-[0.98]"
            >
              Registrar pesaje
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-[#1E2330] bg-[#0D0F14] pt-3 pb-1 px-2">
          <div className="w-full min-w-0" style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart
                data={compactModel.chartData}
                margin={{ top: 8, right: 12, left: -12, bottom: 2 }}
              >
                <CartesianGrid
                  stroke="#1C212E"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="shortDate"
                  tick={{ fill: '#71717A', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  domain={[compactModel.yMin, compactModel.yMax]}
                  tick={{ fill: '#71717A', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  tickFormatter={(v: number) => `${v}`}
                />
                <Tooltip
                  content={<DarkCompactTooltip unit={weightUnit} />}
                  cursor={{ stroke: '#3F4659', strokeDasharray: '3 3' }}
                />
                <Line
                  type="monotone"
                  dataKey="displayWeight"
                  stroke="#a3e635"
                  strokeWidth={2.5}
                  dot={{ r: 3.5, fill: '#a3e635', stroke: '#0D0F14', strokeWidth: 1.5 }}
                  activeDot={{
                    r: 5.5,
                    fill: '#D4FF33',
                    stroke: '#0D0F14',
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
};
