import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Dumbbell,
  Flame,
  Footprints,
  MapPin,
  Zap,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { shiftIsoDate } from '../lib/compareDates';
import { getLocalDateKey, getTodayIsoDate } from '../lib/storage';
import { formatDistance, getDistanceUnit } from '../lib/units';
import type { AppDatabase, CardioActivityType } from '../types/fitness';

interface WorkoutCalendarAnalyticsCardProps {
  database: AppDatabase;
}

type MainViewMode = 'grafica' | 'calendario';
type ChartRangeMode = 'dias' | 'semanas' | 'meses';

interface UnifiedSession {
  id: string;
  kind: 'fuerza' | 'cardio' | 'hiit';
  date: string; // YYYY-MM-DD
  sortKey: string;
  title: string;
  subtitle: string;
  durationMin: number;
  distanceKm: number;
  calories: number;
}

interface DurationChartPoint {
  id: string;
  label: string;
  sublabel: string;
  durationMin: number;
  sessionsCount: number;
  calories: number;
}

const CARDIO_TITLES: Record<CardioActivityType, string> = {
  correr: 'Carrera GPS',
  caminar: 'Caminata GPS',
  ciclismo: 'Ciclismo GPS',
  caminadora: 'Caminadora',
};

const WEEKDAY_HEADERS_SUN_FIRST = ['D', 'L', 'M', 'M', 'J', 'V', 'S'] as const;

function formatMinutesPretty(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  if (safe === 0) return '0 min';
  const hrs = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hrs > 0) return `${hrs}h ${String(mins).padStart(2, '0')}m`;
  return `${mins} min`;
}

function formatDateLongEs(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(dt.getTime())) return dateIso;
  return dt.toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

interface WorkoutDurationTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: DurationChartPoint }>;
}

const WorkoutDurationTooltip: React.FC<WorkoutDurationTooltipProps> = ({
  active,
  payload,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  return (
    <div className="rounded-xl border border-[#2C3344] bg-[#0B0D12]/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="text-[11px] font-semibold text-zinc-400">{pt.sublabel}</p>
      <p className="mt-0.5 text-sm font-extrabold font-mono tabular-nums text-[#a3e635]">
        {formatMinutesPretty(pt.durationMin)}
      </p>
      <p className="text-[11px] font-mono text-zinc-300">
        {pt.sessionsCount} {pt.sessionsCount === 1 ? 'sesión' : 'sesiones'} · {pt.calories} kcal
      </p>
    </div>
  );
};

export const WorkoutCalendarAnalyticsCard: React.FC<WorkoutCalendarAnalyticsCardProps> = ({
  database,
}) => {
  const todayIso = getTodayIsoDate();
  const distanceUnit = getDistanceUnit(database.profile.distanceUnit);
  const weightKg = database.profile.weightKg > 0 ? database.profile.weightKg : 75;

  const [viewMode, setViewMode] = useState<MainViewMode>('grafica');
  const [chartRange, setChartRange] = useState<ChartRangeMode>('dias');

  const [calYear, setCalYear] = useState<number>(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState<number>(() => new Date().getMonth());
  const [selectedDayIso, setSelectedDayIso] = useState<string>(todayIso);

  const allSessions = useMemo<UnifiedSession[]>(() => {
    const items: UnifiedSession[] = [];

    for (const w of database.workouts) {
      const date = getLocalDateKey(w.completedAt);
      const mins = Math.max(1, Math.round((w.durationSec || 0) / 60));
      const kcal = Math.max(10, Math.round(mins * (weightKg * 0.085)));
      const timeStr = new Date(w.completedAt).toLocaleTimeString('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      items.push({
        id: `w_${w.id}`,
        kind: 'fuerza',
        date,
        sortKey: w.completedAt,
        title: w.title || 'Rutina de fuerza',
        subtitle: `${timeStr} · ${w.completedSets} series · Fuerza`,
        durationMin: mins,
        distanceKm: 0,
        calories: kcal,
      });
    }

    for (const c of database.cardioSessions ?? []) {
      const mins = Math.max(1, Math.round((c.durationSec || 0) / 60));
      const timeStr = new Date(c.completedAt || c.startedAt).toLocaleTimeString('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      items.push({
        id: `c_${c.id}`,
        kind: 'cardio',
        date: c.date,
        sortKey: c.completedAt || c.startedAt || `${c.date}T12:00:00.000Z`,
        title: CARDIO_TITLES[c.activityType] ?? 'Cardio',
        subtitle: `${timeStr} · ${formatDistance(c.distanceKm || 0, distanceUnit)}`,
        durationMin: mins,
        distanceKm: Math.max(0, c.distanceKm || 0),
        calories: Math.max(0, Math.round(c.caloriesBurned || 0)),
      });
    }

    for (const h of database.hiitSessions ?? []) {
      const mins = Math.max(1, Math.round((h.totalDurationSec || 0) / 60));
      const timeStr = new Date(h.completedAt).toLocaleTimeString('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      items.push({
        id: `h_${h.id}`,
        kind: 'hiit',
        date: h.date,
        sortKey: h.completedAt || `${h.date}T12:00:00.000Z`,
        title: h.name || 'HIIT / Tabata',
        subtitle: `${timeStr} · ${h.rounds}x${h.cycles} rondas`,
        durationMin: mins,
        distanceKm: 0,
        calories: Math.max(0, Math.round(h.caloriesBurned || 0)),
      });
    }

    return items.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  }, [database.workouts, database.cardioSessions, database.hiitSessions, weightKg, distanceUnit]);

  const sessionsByDate = useMemo(() => {
    const map = new Map<string, UnifiedSession[]>();
    for (const s of allSessions) {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    }
    return map;
  }, [allSessions]);

  // --- Gráfica view data (Días | Semanas | Meses) ---
  const graphBundle = useMemo(() => {
    const points: DurationChartPoint[] = [];
    let windowStartIso = todayIso;

    if (chartRange === 'dias') {
      // Last 14 days
      windowStartIso = shiftIsoDate(todayIso, -13);
      for (let i = 13; i >= 0; i -= 1) {
        const iso = shiftIsoDate(todayIso, -i);
        const daySessions = sessionsByDate.get(iso) ?? [];
        const durationMin = daySessions.reduce((sum, s) => sum + s.durationMin, 0);
        const calories = daySessions.reduce((sum, s) => sum + s.calories, 0);
        const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
        const dt = new Date(y, (m || 1) - 1, d || 1);
        const shortLabel =
          i === 0
            ? 'Hoy'
            : dt
                .toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
                .replace('.', '');
        points.push({
          id: iso,
          label: `${d}`,
          sublabel: shortLabel,
          durationMin,
          sessionsCount: daySessions.length,
          calories,
        });
      }
    } else if (chartRange === 'semanas') {
      // Last 8 Sunday-Saturday weeks
      const [y, m, d] = todayIso.split('-').map((n) => parseInt(n, 10));
      const dt = new Date(y, (m || 1) - 1, d || 1);
      const sunOffset = -dt.getDay();
      windowStartIso = shiftIsoDate(todayIso, sunOffset - 7 * 7);

      for (let w = 7; w >= 0; w -= 1) {
        const sunIso = shiftIsoDate(todayIso, sunOffset - w * 7);
        const satIso = shiftIsoDate(sunIso, 6);
        const weekSessions = allSessions.filter(
          (s) => s.date >= sunIso && s.date <= satIso && s.date <= todayIso,
        );
        const durationMin = weekSessions.reduce((sum, s) => sum + s.durationMin, 0);
        const calories = weekSessions.reduce((sum, s) => sum + s.calories, 0);
        const [sy, sm, sd] = sunIso.split('-').map((n) => parseInt(n, 10));
        const sDt = new Date(sy, (sm || 1) - 1, sd || 1);
        const lbl = sDt
          .toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
          .replace('.', '');
        points.push({
          id: sunIso,
          label: w === 0 ? 'Actual' : lbl,
          sublabel: `Semana del ${lbl}`,
          durationMin,
          sessionsCount: weekSessions.length,
          calories,
        });
      }
    } else {
      // Last 6 months
      const [y, m] = todayIso.split('-').map((n) => parseInt(n, 10));
      const curMonthZero = (m || 1) - 1;
      const firstTarget = new Date(y, curMonthZero - 5, 1);
      windowStartIso = `${firstTarget.getFullYear()}-${String(firstTarget.getMonth() + 1).padStart(2, '0')}-01`;

      for (let idx = 5; idx >= 0; idx -= 1) {
        const tDt = new Date(y, curMonthZero - idx, 1);
        const ym = `${tDt.getFullYear()}-${String(tDt.getMonth() + 1).padStart(2, '0')}`;
        const monthSessions = allSessions.filter(
          (s) => s.date.startsWith(ym) && s.date <= todayIso,
        );
        const durationMin = monthSessions.reduce((sum, s) => sum + s.durationMin, 0);
        const calories = monthSessions.reduce((sum, s) => sum + s.calories, 0);
        const shortM = tDt
          .toLocaleDateString('es-MX', { month: 'short' })
          .replace('.', '');
        const fullM = tDt.toLocaleDateString('es-MX', {
          month: 'long',
          year: 'numeric',
        });
        points.push({
          id: ym,
          label: shortM.charAt(0).toUpperCase() + shortM.slice(1),
          sublabel: fullM,
          durationMin,
          sessionsCount: monthSessions.length,
          calories,
        });
      }
    }

    const sessionsInRange = allSessions.filter(
      (s) => s.date >= windowStartIso && s.date <= todayIso,
    );
    const totalMin = sessionsInRange.reduce((sum, s) => sum + s.durationMin, 0);
    const totalDistKm =
      Math.round(sessionsInRange.reduce((sum, s) => sum + s.distanceKm, 0) * 100) / 100;
    const totalCal = sessionsInRange.reduce((sum, s) => sum + s.calories, 0);

    const activeBuckets = points.filter((p) => p.durationMin > 0);
    const avgBucketMin =
      activeBuckets.length > 0
        ? Math.round(
            activeBuckets.reduce((sum, p) => sum + p.durationMin, 0) / activeBuckets.length,
          )
        : 0;

    return {
      points,
      sessionsInRange,
      totalMin,
      totalDistKm,
      totalCal,
      sessionsCount: sessionsInRange.length,
      avgBucketMin,
    };
  }, [chartRange, todayIso, sessionsByDate, allSessions]);

  // --- Calendario Mensual data (D L M M J V S) ---
  const calendarBundle = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1);
    const startOffset = firstDay.getDay(); // 0=Sunday ... 6=Saturday
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const ymPrefix = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;

    const cells: {
      date: string | null;
      dayNumber: number | null;
      sessions: UnifiedSession[];
    }[] = [];

    for (let p = 0; p < startOffset; p += 1) {
      cells.push({ date: null, dayNumber: null, sessions: [] });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${ymPrefix}-${String(day).padStart(2, '0')}`;
      cells.push({
        date,
        dayNumber: day,
        sessions: sessionsByDate.get(date) ?? [],
      });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ date: null, dayNumber: null, sessions: [] });
    }

    const monthSessions = allSessions.filter((s) => s.date.startsWith(ymPrefix));
    const totalMin = monthSessions.reduce((sum, s) => sum + s.durationMin, 0);
    const totalDistKm =
      Math.round(monthSessions.reduce((sum, s) => sum + s.distanceKm, 0) * 100) / 100;
    const totalCal = monthSessions.reduce((sum, s) => sum + s.calories, 0);
    const activeDaysCount = new Set(monthSessions.map((s) => s.date)).size;

    const monthTitle = firstDay.toLocaleDateString('es-MX', {
      month: 'long',
      year: 'numeric',
    });

    return {
      cells,
      monthTitle,
      sessionsCount: monthSessions.length,
      activeDaysCount,
      totalMin,
      totalDistKm,
      totalCal,
    };
  }, [calYear, calMonth, sessionsByDate, allSessions]);

  const selectedDaySessions = useMemo(
    () => sessionsByDate.get(selectedDayIso) ?? [],
    [sessionsByDate, selectedDayIso],
  );

  const handlePrevMonth = () => {
    const nextYear = calMonth === 0 ? calYear - 1 : calYear;
    const nextMonth = calMonth === 0 ? 11 : calMonth - 1;
    setCalYear(nextYear);
    setCalMonth(nextMonth);
    setSelectedDayIso(`${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-01`);
  };

  const handleNextMonth = () => {
    const nextYear = calMonth === 11 ? calYear + 1 : calYear;
    const nextMonth = calMonth === 11 ? 0 : calMonth + 1;
    setCalYear(nextYear);
    setCalMonth(nextMonth);
    setSelectedDayIso(`${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-01`);
  };

  const renderSessionRow = (session: UnifiedSession) => {
    const Icon =
      session.kind === 'cardio'
        ? MapPin
        : session.kind === 'hiit'
          ? Zap
          : Dumbbell;
    const accentBg =
      session.kind === 'cardio'
        ? 'bg-emerald-500/15 text-emerald-400'
        : session.kind === 'hiit'
          ? 'bg-amber-500/15 text-amber-300'
          : 'bg-[#a3e635]/15 text-[#a3e635]';

    return (
      <li
        key={session.id}
        className="py-2.5 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${accentBg}`}
          >
            <Icon className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-bold text-white truncate">
              {session.title}
            </p>
            <p className="text-[11px] text-zinc-400 truncate">
              {formatDateLongEs(session.date)} · {session.subtitle}
            </p>
          </div>
        </div>

        <div className="text-right font-mono tabular-nums shrink-0">
          <p className="text-xs sm:text-sm font-extrabold text-white">
            {formatMinutesPretty(session.durationMin)}
          </p>
          <p className="text-[11px] text-zinc-400">
            {session.calories} kcal
          </p>
        </div>
      </li>
    );
  };

  return (
    <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-4">
      {/* Header + Main View Toggle (Gráfica | Calendario Mensual) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-[#a3e635]">
            Entrenamientos y Cardio
          </p>
          <h2 className="text-lg sm:text-xl font-extrabold font-display text-white">
            Analítica y Calendario Mensual
          </h2>
        </div>

        <div
          role="tablist"
          aria-label="Modo de visualización de entrenamientos"
          className="grid grid-cols-2 gap-1 rounded-2xl border border-[#232834] bg-[#0B0D12] p-1 shrink-0"
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'grafica'}
            onClick={() => setViewMode('grafica')}
            className={`min-h-[38px] rounded-xl px-3 text-xs font-extrabold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
              viewMode === 'grafica'
                ? 'bg-[#a3e635] text-[#0A0B0D]'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 shrink-0" />
            Gráfica
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'calendario'}
            onClick={() => setViewMode('calendario')}
            className={`min-h-[38px] rounded-xl px-3 text-xs font-extrabold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
              viewMode === 'calendario'
                ? 'bg-[#a3e635] text-[#0A0B0D]'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            Calendario
          </button>
        </div>
      </div>

      {viewMode === 'grafica' ? (
        <div className="space-y-4">
          {/* Sub-selector: Días | Semanas | Meses */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              role="group"
              aria-label="Rango temporal de entrenamientos"
              className="inline-flex items-center gap-1 rounded-xl border border-[#232834] bg-[#0B0D12] p-1"
            >
              {(
                [
                  { id: 'dias', label: 'Días' },
                  { id: 'semanas', label: 'Semanas' },
                  { id: 'meses', label: 'Meses' },
                ] as { id: ChartRangeMode; label: string }[]
              ).map((r) => {
                const active = chartRange === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setChartRange(r.id)}
                    className={`min-h-[32px] rounded-lg px-3 text-xs font-extrabold transition-colors ${
                      active
                        ? 'bg-[#202634] text-[#a3e635] border border-[#a3e635]/40'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>

            <span className="text-xs font-mono text-zinc-400">
              Promedio activo:{' '}
              <strong className="text-[#a3e635]">
                {formatMinutesPretty(graphBundle.avgBucketMin)}
              </strong>
            </span>
          </div>

          {/* 4 Summary Metrics: Tiempo total, Distancia, Calorías, Sesiones */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <Clock className="w-3.5 h-3.5 text-sky-400" />
                <span>Tiempo total</span>
              </div>
              <p className="mt-1 text-base font-extrabold font-mono tabular-nums text-white">
                {formatMinutesPretty(graphBundle.totalMin)}
              </p>
            </div>
            <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <Footprints className="w-3.5 h-3.5 text-emerald-400" />
                <span>Distancia</span>
              </div>
              <p className="mt-1 text-base font-extrabold font-mono tabular-nums text-emerald-400">
                {formatDistance(graphBundle.totalDistKm, distanceUnit)}
              </p>
            </div>
            <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <Flame className="w-3.5 h-3.5 text-pink-400" />
                <span>Calorías</span>
              </div>
              <p className="mt-1 text-base font-extrabold font-mono tabular-nums text-white">
                {graphBundle.totalCal.toLocaleString('es-MX')} kcal
              </p>
            </div>
            <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <Dumbbell className="w-3.5 h-3.5 text-[#a3e635]" />
                <span>Sesiones</span>
              </div>
              <p className="mt-1 text-base font-extrabold font-mono tabular-nums text-[#a3e635]">
                {graphBundle.sessionsCount}
              </p>
            </div>
          </div>

          {/* Duration Bar Chart with Dotted Average ReferenceLine */}
          <div className="rounded-2xl border border-[#1E2330] bg-[#0D0F14] pt-3 pb-1 px-2">
            <ResponsiveContainer width="100%" height={190}>
              <BarChart
                data={graphBundle.points}
                margin={{ top: 10, right: 10, left: -14, bottom: 2 }}
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
                  minTickGap={12}
                />
                <YAxis
                  tick={{ fill: '#71717A', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={38}
                  tickFormatter={(v: number) => `${v}m`}
                />
                <Tooltip
                  content={<WorkoutDurationTooltip />}
                  cursor={{ fill: 'rgba(163, 230, 53, 0.08)' }}
                />
                {graphBundle.avgBucketMin > 0 && (
                  <ReferenceLine
                    y={graphBundle.avgBucketMin}
                    stroke="#a3e635"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                  />
                )}
                <Bar
                  dataKey="durationMin"
                  fill="#a3e635"
                  radius={[5, 5, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Chronological Sessions List */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                Sesiones del periodo ({graphBundle.sessionsInRange.length})
              </h3>
            </div>
            {graphBundle.sessionsInRange.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#262B38] bg-[#0D0F14] px-4 py-4 text-center text-xs text-zinc-400">
                Sin entrenamientos registrados en este intervalo. Inicia una rutina o caminata GPS para ver tu historial.
              </p>
            ) : (
              <ul className="divide-y divide-white/5 rounded-2xl border border-[#202531] bg-[#0D0F14] px-3.5 max-h-64 overflow-y-auto">
                {graphBundle.sessionsInRange.slice(0, 20).map(renderSessionRow)}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Month Accumulator Strip + Month Nav */}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label="Mes anterior"
              className="min-h-[40px] min-w-[40px] rounded-xl border border-[#242936] bg-[#0D0F14] flex items-center justify-center text-zinc-300 hover:text-white"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="text-center">
              <p className="text-sm sm:text-base font-extrabold capitalize text-white">
                {calendarBundle.monthTitle}
              </p>
              <p className="text-[11px] font-mono text-zinc-400">
                {calendarBundle.activeDaysCount} días activos · {calendarBundle.sessionsCount}{' '}
                {calendarBundle.sessionsCount === 1 ? 'sesión' : 'sesiones'}
              </p>
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              aria-label="Mes siguiente"
              className="min-h-[40px] min-w-[40px] rounded-xl border border-[#242936] bg-[#0D0F14] flex items-center justify-center text-zinc-300 hover:text-white"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Monthly Totals Above Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] px-3 py-2">
              <p className="text-[11px] text-zinc-400">Tiempo del mes</p>
              <p className="mt-0.5 text-sm font-extrabold font-mono tabular-nums text-white">
                {formatMinutesPretty(calendarBundle.totalMin)}
              </p>
            </div>
            <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] px-3 py-2">
              <p className="text-[11px] text-zinc-400">Distancia</p>
              <p className="mt-0.5 text-sm font-extrabold font-mono tabular-nums text-emerald-400">
                {formatDistance(calendarBundle.totalDistKm, distanceUnit)}
              </p>
            </div>
            <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] px-3 py-2">
              <p className="text-[11px] text-zinc-400">Calorías</p>
              <p className="mt-0.5 text-sm font-extrabold font-mono tabular-nums text-white">
                {calendarBundle.totalCal.toLocaleString('es-MX')} kcal
              </p>
            </div>
            <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] px-3 py-2">
              <p className="text-[11px] text-zinc-400">Sesiones</p>
              <p className="mt-0.5 text-sm font-extrabold font-mono tabular-nums text-[#a3e635]">
                {calendarBundle.sessionsCount}
              </p>
            </div>
          </div>

          {/* Monthly Grid: D L M M J V S */}
          <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3 space-y-2">
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-zinc-500">
              {WEEKDAY_HEADERS_SUN_FIRST.map((hdr, idx) => (
                <span key={`${hdr}_${idx}`}>{hdr}</span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {calendarBundle.cells.map((cell, idx) => {
                if (!cell.date || cell.dayNumber === null) {
                  return <div key={`blank_${idx}`} className="h-11" />;
                }

                const hasWorkout = cell.sessions.length > 0;
                const isSelected = cell.date === selectedDayIso;
                const isToday = cell.date === todayIso;

                return (
                  <button
                    key={cell.date}
                    type="button"
                    onClick={() => setSelectedDayIso(cell.date!)}
                    aria-label={`${cell.date}: ${cell.sessions.length} entrenamientos`}
                    aria-pressed={isSelected}
                    className={`min-h-[44px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${
                      isSelected
                        ? 'bg-white/10 ring-2 ring-[#a3e635]'
                        : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <span
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono tabular-nums transition-colors ${
                        hasWorkout
                          ? 'bg-[#a3e635] text-[#0A0B0D] font-extrabold'
                          : isToday
                            ? 'border border-white/40 text-white font-bold'
                            : 'text-zinc-300'
                      }`}
                    >
                      {cell.dayNumber}
                    </span>
                    {cell.sessions.length > 1 && (
                      <span className="text-[9px] font-mono leading-none text-[#a3e635]">
                        {cell.sessions.length}x
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Day Sessions Drawer */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                Sesiones del {formatDateLongEs(selectedDayIso)}
              </h3>
              <span className="text-xs font-mono text-zinc-400">
                {selectedDaySessions.length}{' '}
                {selectedDaySessions.length === 1 ? 'sesión' : 'sesiones'}
              </span>
            </div>

            {selectedDaySessions.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#262B38] bg-[#0D0F14] px-4 py-4 text-center text-xs text-zinc-400">
                Sin entrenamientos registrados en esta fecha.
              </p>
            ) : (
              <ul className="divide-y divide-white/5 rounded-2xl border border-[#202531] bg-[#0D0F14] px-3.5">
                {selectedDaySessions.map(renderSessionRow)}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
