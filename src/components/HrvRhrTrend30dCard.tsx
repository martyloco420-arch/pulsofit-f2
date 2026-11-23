import React, { useEffect, useMemo, useState } from 'react';
import { Activity, HeartPulse, Sparkles } from 'lucide-react';
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  type HrvRhrDailyPoint,
  type HrvRhrRangeDays,
  type HrvRhrTrendSummary,
  computeHrvRhrTrend,
  loadActiveProfileHrvRhrTrend,
} from '../lib/storage/biometricsRepo';
import type { PulseHrvRecord } from '../types/fitness';

interface HrvRhrTrend30dCardProps {
  pulseRecords: PulseHrvRecord[];
  profileId?: string;
}

interface HrvRhrTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: HrvRhrDailyPoint }>;
}

const RANGE_OPTIONS: { days: HrvRhrRangeDays; label: string }[] = [
  { days: 7, label: '7D' },
  { days: 14, label: '14D' },
  { days: 30, label: '30D' },
  { days: 90, label: '90D' },
];

const DarkHrvRhrTooltip: React.FC<HrvRhrTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 shadow-2xl space-y-1.5 min-w-[200px]">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-1">
        <span className="text-xs font-bold text-white capitalize">
          {pt.fullDate}
        </span>
        {pt.sampleCount > 0 && (
          <span className="text-[10px] font-mono text-zinc-400">
            {pt.sampleCount} {pt.sampleCount === 1 ? 'toma' : 'tomas'}
          </span>
        )}
      </div>

      <div className="space-y-1 text-xs font-mono tabular-nums">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 font-sans text-zinc-300">
            <span className="w-2 h-2 rounded-full bg-[#a3e635]" />
            HRV (RMSSD)
          </span>
          <span className="font-extrabold text-[#a3e635]">
            {pt.avgHrvMs !== null ? `${pt.avgHrvMs} ms` : 'Sin datos'}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 font-sans text-zinc-300">
            <span className="w-2 h-2 rounded-full bg-[#38bdf8]" />
            FC en reposo
          </span>
          <span className="font-extrabold text-[#38bdf8]">
            {pt.avgRhrBpm !== null ? `${pt.avgRhrBpm} BPM` : 'Sin datos'}
          </span>
        </div>
      </div>
    </div>
  );
};

export const HrvRhrTrend30dCard: React.FC<HrvRhrTrend30dCardProps> = ({
  pulseRecords,
  profileId,
}) => {
  const [rangeDays, setRangeDays] = useState<HrvRhrRangeDays>(30);

  const liveSummary = useMemo(
    () => computeHrvRhrTrend(pulseRecords, rangeDays, profileId ?? 'main'),
    [pulseRecords, rangeDays, profileId],
  );

  const [storedSummary, setStoredSummary] = useState<HrvRhrTrendSummary | null>(null);

  useEffect(() => {
    let active = true;
    const syncFromRepo = async () => {
      try {
        const res = await loadActiveProfileHrvRhrTrend(rangeDays, profileId);
        if (active) {
          setStoredSummary(res);
        }
      } catch {
        // Fallback to liveSummary derived from active database props
      }
    };
    void syncFromRepo();
    return () => {
      active = false;
    };
  }, [rangeDays, profileId, pulseRecords]);

  // Prefer liveSummary when pulseRecords in memory has more recent updates or matches,
  // and use storedSummary from biometricsRepo when hydrated directly from IndexedDB.
  const summary = useMemo(() => {
    if (!storedSummary || storedSummary.rangeDays !== rangeDays) return liveSummary;
    if (liveSummary.totalMeasurements >= storedSummary.totalMeasurements) {
      return liveSummary;
    }
    return storedSummary;
  }, [liveSummary, storedSummary, rangeDays]);

  const hasData = summary.daysWithData > 0;
  const xTickGap =
    rangeDays === 7 ? 8 : rangeDays === 14 ? 14 : rangeDays === 30 ? 22 : 34;

  return (
    <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-4">
      {/* Header + Selector Multi-Rango + Promedios */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-[#a3e635]/12 border border-[#a3e635]/30 flex items-center justify-center text-[#a3e635] shrink-0">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">
                Tendencia {rangeDays} días: HRV y FC en Reposo
              </h2>
              <p className="text-xs text-zinc-400">
                Evolución autonómica y cardiovascular ({summary.startDate} al {summary.endDate})
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Interactive Range Selector: 7D | 14D | 30D | 90D */}
          <div
            role="tablist"
            aria-label="Rango de días para HRV y FC en reposo"
            className="inline-flex rounded-xl border border-[#262B38] bg-[#0B0D12] p-0.5"
          >
            {RANGE_OPTIONS.map((opt) => {
              const active = rangeDays === opt.days;
              return (
                <button
                  key={opt.days}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setRangeDays(opt.days)}
                  className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-extrabold font-mono transition-colors ${
                    active
                      ? 'bg-[#a3e635] text-[#0A0B0D]'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
            <div className="rounded-2xl border border-[#a3e635]/30 bg-[#0D0F14] px-3 py-1.5">
              <span className="block text-[10px] font-sans font-semibold text-zinc-400">
                HRV promedio ({rangeDays}d)
              </span>
              <span className="text-sm font-extrabold text-[#a3e635]">
                {summary.avgHrvMs !== null ? `${summary.avgHrvMs} ms` : '-- ms'}
              </span>
            </div>

            <div className="rounded-2xl border border-[#38bdf8]/30 bg-[#0D0F14] px-3 py-1.5">
              <span className="block text-[10px] font-sans font-semibold text-zinc-400">
                FC reposo promedio ({rangeDays}d)
              </span>
              <span className="text-sm font-extrabold text-[#38bdf8]">
                {summary.avgRhrBpm !== null ? `${summary.avgRhrBpm} BPM` : '-- BPM'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Gráfica Recharts o Empty State */}
      {!hasData ? (
        <div className="rounded-2xl border border-dashed border-[#272C38] bg-[#0D0F14] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
              <HeartPulse className="w-5 h-5 text-zinc-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-bold text-white">
                Sin mediciones de HRV ni pulso en los últimos {rangeDays} días
              </p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Realiza una medición con cámara PPG o registra manualmente tu pulso y HRV (RMSSD) en el módulo superior para visualizar tu tendencia de {rangeDays} días con doble eje.
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#2B3140] bg-[#141720] px-3 py-1.5 text-[11px] font-semibold text-zinc-300 shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-[#a3e635]" />
            Ventana: {rangeDays} días locales
          </span>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#1E2330] bg-[#0D0F14] pt-3 pb-2 px-1.5 sm:px-3 space-y-2">
          <div className="w-full min-w-0" style={{ height: 245 }}>
            <ResponsiveContainer width="100%" height={245}>
              <ComposedChart
                data={summary.points}
                margin={{ top: 10, right: 6, left: -10, bottom: 4 }}
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
                  interval={rangeDays === 7 ? 0 : 'preserveStartEnd'}
                  minTickGap={xTickGap}
                />

                <YAxis
                  yAxisId="hrv"
                  orientation="left"
                  domain={['dataMin - 8', 'dataMax + 8']}
                  tick={{ fill: '#a3e635', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={42}
                  tickFormatter={(v) => `${v}`}
                  label={{
                    value: 'ms',
                    position: 'insideTopLeft',
                    fill: '#a3e635',
                    fontSize: 10,
                    offset: 4,
                  }}
                />

                <YAxis
                  yAxisId="rhr"
                  orientation="right"
                  domain={['dataMin - 5', 'dataMax + 5']}
                  tick={{ fill: '#38bdf8', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={42}
                  tickFormatter={(v) => `${v}`}
                  label={{
                    value: 'BPM',
                    position: 'insideTopRight',
                    fill: '#38bdf8',
                    fontSize: 10,
                    offset: 4,
                  }}
                />

                <Tooltip
                  content={<DarkHrvRhrTooltip />}
                  cursor={{ stroke: '#3F4659', strokeDasharray: '3 3' }}
                />

                <Legend
                  wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }}
                  iconType="circle"
                />

                <Line
                  yAxisId="hrv"
                  type="monotone"
                  dataKey="avgHrvMs"
                  name="HRV (RMSSD ms)"
                  stroke="#a3e635"
                  strokeWidth={2.5}
                  connectNulls={true}
                  dot={
                    rangeDays <= 30
                      ? { r: 3, fill: '#a3e635', stroke: '#0D0F14', strokeWidth: 1.5 }
                      : false
                  }
                  activeDot={{ r: 5.5, fill: '#D4FF33', stroke: '#0D0F14', strokeWidth: 2 }}
                  isAnimationActive={false}
                />

                <Line
                  yAxisId="rhr"
                  type="monotone"
                  dataKey="avgRhrBpm"
                  name="FC reposo (BPM)"
                  stroke="#38bdf8"
                  strokeWidth={2.5}
                  connectNulls={true}
                  dot={
                    rangeDays <= 30
                      ? { r: 3, fill: '#38bdf8', stroke: '#0D0F14', strokeWidth: 1.5 }
                      : false
                  }
                  activeDot={{ r: 5.5, fill: '#38bdf8', stroke: '#0D0F14', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-1 border-t border-white/5 text-[11px] text-zinc-400">
            <span>
              {summary.totalMeasurements}{' '}
              {summary.totalMeasurements === 1 ? 'medición' : 'mediciones'} en{' '}
              {summary.daysWithData}{' '}
              {summary.daysWithData === 1 ? 'día' : 'días'} de los últimos {rangeDays} días
            </span>
            {summary.minHrvMs !== null &&
              summary.maxHrvMs !== null &&
              summary.minRhrBpm !== null &&
              summary.maxRhrBpm !== null && (
                <span className="font-mono text-zinc-400">
                  Rango HRV: {summary.minHrvMs}–{summary.maxHrvMs} ms · FC: {summary.minRhrBpm}–{summary.maxRhrBpm} BPM
                </span>
              )}
          </div>
        </div>
      )}
    </section>
  );
};
