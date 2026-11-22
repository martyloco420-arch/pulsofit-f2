import React, { useMemo, useState } from 'react';
import { Activity, HeartPulse, Moon, Zap } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  type ReadinessTrendDayPoint,
  computeReadiness7DayCorrelation,
} from '../lib/readinessTrend';
import type { AppDatabase } from '../types/fitness';

interface ReadinessTrend7dCardProps {
  database: AppDatabase;
  onOpenSleep?: () => void;
  onOpenPulse?: () => void;
}

type MetricKey = 'readiness' | 'sleep' | 'pulse' | 'load';

interface MetricSeriesMeta {
  key: MetricKey;
  label: string;
  shortLabel: string;
  color: string;
  unitLabel: string;
}

const METRIC_SERIES: MetricSeriesMeta[] = [
  {
    key: 'readiness',
    label: 'Preparación (%)',
    shortLabel: 'Preparación',
    color: '#a3e635',
    unitLabel: '%',
  },
  {
    key: 'sleep',
    label: 'Sueño (Calidad / h)',
    shortLabel: 'Sueño',
    color: '#38bdf8',
    unitLabel: '%',
  },
  {
    key: 'pulse',
    label: 'Pulso medio (BPM)',
    shortLabel: 'Pulso',
    color: '#fb7185',
    unitLabel: 'BPM',
  },
  {
    key: 'load',
    label: 'Carga Entreno',
    shortLabel: 'Carga',
    color: '#fbbf24',
    unitLabel: 'pts',
  },
];

interface DarkCorrelationTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ReadinessTrendDayPoint }>;
  visibleMetrics: Record<MetricKey, boolean>;
}

const DarkCorrelationTooltip: React.FC<DarkCorrelationTooltipProps> = ({
  active,
  payload,
  visibleMetrics,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  return (
    <div className="rounded-2xl border border-[#2C3344] bg-[#0B0D12]/95 px-3.5 py-2.5 shadow-2xl backdrop-blur-sm space-y-1.5 min-w-[190px]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-1">
        <span className="text-xs font-bold text-white capitalize">
          {pt.fullDate}
        </span>
        {pt.readinessSource !== 'sin_datos' && (
          <span className="text-[10px] font-mono text-zinc-400">
            {pt.readinessSource === 'guardado' ? 'Check-in' : 'Auto'}
          </span>
        )}
      </div>

      <div className="space-y-1 text-xs font-mono tabular-nums">
        {visibleMetrics.readiness && (
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-zinc-300 font-sans">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: '#a3e635' }}
              />
              Preparación
            </span>
            <span className="font-extrabold text-[#a3e635]">
              {pt.readinessPct !== null ? `${pt.readinessPct}%` : '--'}
            </span>
          </div>
        )}

        {visibleMetrics.sleep && (
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-zinc-300 font-sans">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: '#38bdf8' }}
              />
              Sueño
            </span>
            <span className="font-extrabold text-[#38bdf8]">
              {pt.sleepQualityPct !== null
                ? `${pt.sleepQualityPct}%${pt.sleepHours !== null ? ` · ${pt.sleepHours}h` : ''}`
                : pt.sleepHours !== null
                  ? `${pt.sleepHours}h`
                  : '--'}
            </span>
          </div>
        )}

        {visibleMetrics.pulse && (
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-zinc-300 font-sans">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: '#fb7185' }}
              />
              Pulso medio
            </span>
            <span className="font-extrabold text-[#fb7185]">
              {pt.avgBpm !== null
                ? `${pt.avgBpm} BPM${pt.avgHrvMs !== null ? ` · HRV ${pt.avgHrvMs}` : ''}`
                : '--'}
            </span>
          </div>
        )}

        {visibleMetrics.load && (
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-zinc-300 font-sans">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: '#fbbf24' }}
              />
              Carga Entreno
            </span>
            <span className="font-extrabold text-[#fbbf24]">
              {pt.trainingLoadScore} pts
              {pt.exerciseKcal > 0 ? ` (${pt.exerciseKcal} kcal)` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export const ReadinessTrend7dCard: React.FC<ReadinessTrend7dCardProps> = ({
  database,
  onOpenSleep,
  onOpenPulse,
}) => {
  const [visibleMetrics, setVisibleMetrics] = useState<Record<MetricKey, boolean>>({
    readiness: true,
    sleep: true,
    pulse: true,
    load: true,
  });

  const summary = useMemo(
    () => computeReadiness7DayCorrelation(database),
    [database],
  );

  const toggleMetric = (key: MetricKey) => {
    setVisibleMetrics((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // Ensure at least one metric remains active
      const activeCount = Object.values(next).filter(Boolean).length;
      if (activeCount === 0) return prev;
      return next;
    });
  };

  const resetAllMetrics = () => {
    setVisibleMetrics({
      readiness: true,
      sleep: true,
      pulse: true,
      load: true,
    });
  };

  const activeCount = Object.values(visibleMetrics).filter(Boolean).length;
  const showScoreAxis =
    visibleMetrics.readiness || visibleMetrics.sleep || visibleMetrics.load;

  return (
    <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-3.5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-[#a3e635]">
            <Activity className="w-4 h-4" />
            <span>Tendencia y Correlación de Preparación (7 días)</span>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Cruce automático de Sueño, Pulso/HRV y Carga de Entrenamiento/Caminatas
          </p>
        </div>

        {/* Compact 7d Averages */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
          <span className="rounded-xl border border-[#242936] bg-[#0D0F14] px-2.5 py-1 text-zinc-300">
            Prep:{' '}
            <strong className="text-[#a3e635]">
              {summary.avgReadiness !== null ? `${summary.avgReadiness}%` : '--'}
            </strong>
          </span>
          <span className="rounded-xl border border-[#242936] bg-[#0D0F14] px-2.5 py-1 text-zinc-300">
            Sueño:{' '}
            <strong className="text-[#38bdf8]">
              {summary.avgSleepPct !== null ? `${summary.avgSleepPct}%` : '--'}
            </strong>
          </span>
          <span className="rounded-xl border border-[#242936] bg-[#0D0F14] px-2.5 py-1 text-zinc-300">
            Pulso:{' '}
            <strong className="text-[#fb7185]">
              {summary.avgBpm !== null ? `${summary.avgBpm} BPM` : '--'}
            </strong>
          </span>
        </div>
      </div>

      {/* Clickable Legend to Toggle/Filter Metrics */}
      <div className="flex flex-wrap items-center gap-2">
        {METRIC_SERIES.map((meta) => {
          const isOn = visibleMetrics[meta.key];
          return (
            <button
              key={meta.key}
              type="button"
              onClick={() => toggleMetric(meta.key)}
              aria-pressed={isOn}
              className={`min-h-[32px] inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-bold transition-all active:scale-[0.98] ${
                isOn
                  ? 'border-white/20 bg-[#181C26] text-white'
                  : 'border-[#202430] bg-[#0D0F14] text-zinc-500 opacity-60 hover:opacity-90'
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{
                  backgroundColor: isOn ? meta.color : '#52525B',
                }}
              />
              <span>{meta.label}</span>
            </button>
          );
        })}

        {activeCount < 4 && (
          <button
            type="button"
            onClick={resetAllMetrics}
            className="text-[11px] font-semibold text-[#a3e635] hover:underline ml-1"
          >
            Mostrar todas
          </button>
        )}
      </div>

      {/* Recharts Multi-Line Correlation Chart */}
      {summary.daysWithAnyData === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#272C38] bg-[#0D0F14] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-bold text-zinc-200">
              Aún no hay registros suficientes en los últimos 7 días.
            </p>
            <p className="text-[11px] text-zinc-400">
              Registra una noche de sueño, una toma de pulso o un entrenamiento para activar el análisis de correlación.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onOpenSleep && (
              <button
                type="button"
                onClick={onOpenSleep}
                className="min-h-[36px] inline-flex items-center gap-1.5 rounded-xl border border-sky-400/35 bg-sky-400/12 px-3 text-xs font-bold text-sky-300"
              >
                <Moon className="w-3.5 h-3.5" />
                Sueño
              </button>
            )}
            {onOpenPulse && (
              <button
                type="button"
                onClick={onOpenPulse}
                className="min-h-[36px] inline-flex items-center gap-1.5 rounded-xl border border-rose-400/35 bg-rose-400/12 px-3 text-xs font-bold text-rose-300"
              >
                <HeartPulse className="w-3.5 h-3.5" />
                Pulso
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#1E2330] bg-[#0D0F14] pt-3 pb-1 px-1.5 sm:px-2">
          <div className="w-full min-w-0" style={{ height: 208 }}>
            <ResponsiveContainer width="100%" height={208}>
              <LineChart
                data={summary.points}
                margin={{ top: 10, right: visibleMetrics.pulse ? 8 : 12, left: -16, bottom: 2 }}
              >
                <CartesianGrid
                  stroke="#1C212E"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="shortDate"
                  tick={{ fill: '#9CA3AF', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />

                <YAxis
                  yAxisId="score"
                  domain={[0, 100]}
                  hide={!showScoreAxis}
                  tick={{ fill: '#71717A', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={38}
                />

                <YAxis
                  yAxisId="bpm"
                  orientation="right"
                  domain={[40, 120]}
                  hide={!visibleMetrics.pulse}
                  tick={{ fill: '#fb7185', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={34}
                />

                <Tooltip
                  content={
                    <DarkCorrelationTooltip visibleMetrics={visibleMetrics} />
                  }
                  cursor={{ stroke: '#3F4659', strokeDasharray: '3 3' }}
                />

                {visibleMetrics.load && (
                  <Line
                    yAxisId="score"
                    type="monotone"
                    dataKey="trainingLoadScore"
                    name="Carga Entreno"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    dot={{ r: 3, fill: '#fbbf24', stroke: '#0D0F14', strokeWidth: 1.5 }}
                    activeDot={{ r: 5, fill: '#fbbf24', stroke: '#0D0F14', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                )}

                {visibleMetrics.sleep && (
                  <Line
                    yAxisId="score"
                    type="monotone"
                    dataKey="sleepQualityPct"
                    name="Sueño"
                    stroke="#38bdf8"
                    strokeWidth={2.2}
                    connectNulls
                    dot={{ r: 3.5, fill: '#38bdf8', stroke: '#0D0F14', strokeWidth: 1.5 }}
                    activeDot={{ r: 5.5, fill: '#38bdf8', stroke: '#0D0F14', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                )}

                {visibleMetrics.pulse && (
                  <Line
                    yAxisId="bpm"
                    type="monotone"
                    dataKey="avgBpm"
                    name="Pulso medio"
                    stroke="#fb7185"
                    strokeWidth={2.2}
                    connectNulls
                    dot={{ r: 3.5, fill: '#fb7185', stroke: '#0D0F14', strokeWidth: 1.5 }}
                    activeDot={{ r: 5.5, fill: '#fb7185', stroke: '#0D0F14', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                )}

                {visibleMetrics.readiness && (
                  <Line
                    yAxisId="score"
                    type="monotone"
                    dataKey="readinessPct"
                    name="Preparación"
                    stroke="#a3e635"
                    strokeWidth={2.8}
                    connectNulls
                    dot={{ r: 4, fill: '#a3e635', stroke: '#0D0F14', strokeWidth: 1.5 }}
                    activeDot={{ r: 6, fill: '#D4FF33', stroke: '#0D0F14', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Correlation Insight Footer */}
      <div className="flex items-center gap-2 rounded-2xl border border-[#202531] bg-[#0D0F14] px-3.5 py-2.5 text-xs text-zinc-300">
        <Zap className="w-4 h-4 text-[#a3e635] shrink-0" />
        <span>{summary.insightText}</span>
      </div>
    </section>
  );
};
