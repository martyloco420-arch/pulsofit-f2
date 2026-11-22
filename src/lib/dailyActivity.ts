import { estimateCardioSteps } from './cardio';
import { shiftIsoDate } from './compareDates';
import { getLocalDateKey, getTodayIsoDate } from './storage';
import type { AppDatabase, ManualDailyActivity, Sex, UserProfile } from '../types/fitness';

export const DAILY_STEPS_GOAL = 10000;
export const DAILY_ACTIVE_MIN_GOAL = 90;
export const DAILY_ACTIVE_KCAL_GOAL = 500;

export interface ActivityGoals {
  stepsGoal: number;
  activeMinGoal: number;
  activeKcalGoal: number;
}

export function getActivityGoals(profile?: Partial<UserProfile>): ActivityGoals {
  const stepsGoal =
    typeof profile?.dailyStepsGoal === 'number' &&
    Number.isFinite(profile.dailyStepsGoal) &&
    profile.dailyStepsGoal >= 1000
      ? Math.round(profile.dailyStepsGoal)
      : DAILY_STEPS_GOAL;

  const activeMinGoal =
    typeof profile?.dailyActiveMinGoal === 'number' &&
    Number.isFinite(profile.dailyActiveMinGoal) &&
    profile.dailyActiveMinGoal >= 10
      ? Math.round(profile.dailyActiveMinGoal)
      : DAILY_ACTIVE_MIN_GOAL;

  const activeKcalGoal =
    typeof profile?.dailyActiveKcalGoal === 'number' &&
    Number.isFinite(profile.dailyActiveKcalGoal) &&
    profile.dailyActiveKcalGoal >= 100
      ? Math.round(profile.dailyActiveKcalGoal)
      : DAILY_ACTIVE_KCAL_GOAL;

  return { stepsGoal, activeMinGoal, activeKcalGoal };
}

export function computeDailyBmrKcal(profile: UserProfile): number {
  const weightKg = profile.weightKg > 0 ? profile.weightKg : 75;
  const heightCm = profile.heightCm > 0 ? profile.heightCm : 175;
  const age = profile.age > 0 ? profile.age : 28;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (profile.sex === 'mujer') return Math.max(1100, Math.round(base - 161));
  if (profile.sex === 'otro') return Math.max(1200, Math.round(base - 78));
  return Math.max(1200, Math.round(base + 5));
}

export interface HourlyActivityBucket {
  hour: number; // 0..23
  label: string; // "07h"
  steps: number;
  activeMin: number;
  activeKcal: number;
  intensityScore: number;
}

export interface DailyActivitySummary {
  date: string;
  steps: number;
  activeMin: number;
  activeKcal: number;
  totalCalories: number;
  activeDistanceKm: number;
  stepsGoal: number;
  activeMinGoal: number;
  activeKcalGoal: number;
  stepsPct: number;
  activeMinPct: number;
  activeKcalPct: number;
  closedRingsCount: number;
  hourly: HourlyActivityBucket[];
  peakHour: HourlyActivityBucket | null;
  bannerText: string;
}

export interface DayActivityPoint {
  date: string;
  shortLabel: string;
  steps: number;
  activeMin: number;
  activeKcal: number;
  activeDistanceKm: number;
  stepsPct: number;
  activeMinPct: number;
  activeKcalPct: number;
  closedRingsCount: number;
}

export interface CalendarWeekStripDay {
  date: string;
  letter: string; // D, L, M, M, J, V, S
  dayNumber: number;
  isToday: boolean;
  isFuture: boolean;
  summary: DayActivityPoint;
}

export interface MonthCalendarDay {
  date: string | null; // null for padding cells
  dayNumber: number | null;
  summary: DayActivityPoint | null;
}

export interface AggregatedStepsBucket {
  id: string;
  label: string;
  sublabel: string;
  avgDailySteps: number;
  totalSteps: number;
  activeDays: number;
}

export interface AgeGroupStepBenchmark {
  ageGroupLabel: string;
  averageSteps: number;
}

function getLocalHourFromIso(isoStr: string | undefined, fallbackHour = 12): number {
  if (!isoStr) return fallbackHour;
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return fallbackHour;
  return dt.getHours();
}

function distributeAcrossHours(
  startedAt: string | undefined,
  completedAt: string | undefined,
  totalSteps: number,
  totalMin: number,
  totalKcal: number,
  hourly: HourlyActivityBucket[],
): void {
  const startMs = startedAt ? Date.parse(startedAt) : NaN;
  const endMs = completedAt ? Date.parse(completedAt) : NaN;

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    const hr = getLocalHourFromIso(completedAt || startedAt, 12);
    hourly[hr].steps += totalSteps;
    hourly[hr].activeMin += totalMin;
    hourly[hr].activeKcal += totalKcal;
    return;
  }

  const startDt = new Date(startMs);
  const startHr = startDt.getHours();
  const spanHours = Math.min(6, Math.max(1, Math.ceil((endMs - startMs) / (60 * 60 * 1000))));
  for (let i = 0; i < spanHours; i += 1) {
    const hr = (startHr + i) % 24;
    hourly[hr].steps += Math.round(totalSteps / spanHours);
    hourly[hr].activeMin += Math.round(totalMin / spanHours);
    hourly[hr].activeKcal += Math.round(totalKcal / spanHours);
  }
}

export function estimateDistanceKmFromSteps(steps: number, heightCm = 175): number {
  if (steps <= 0) return 0;
  const safeHeight = Math.max(130, Math.min(220, heightCm || 175));
  const strideMeters = (safeHeight * 0.415) / 100;
  return Math.round(((steps * strideMeters) / 1000) * 100) / 100;
}

export function computeDailyActivitySummary(
  db: AppDatabase,
  dateIso = getTodayIsoDate(),
): DailyActivitySummary {
  const goals = getActivityGoals(db.profile);
  const hourly: HourlyActivityBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}h`,
    steps: 0,
    activeMin: 0,
    activeKcal: 0,
    intensityScore: 0,
  }));

  let totalSteps = 0;
  let totalMin = 0;
  let totalKcal = 0;
  let totalDistanceKm = 0;

  const weightKg = db.profile.weightKg || 75;
  const heightCm = db.profile.heightCm || 175;

  // 1. Cardio & Walks (reconciled by session id)
  const seenCardioIds = new Set<string>();
  for (const c of db.cardioSessions ?? []) {
    if (c.id) {
      if (seenCardioIds.has(c.id)) continue;
      seenCardioIds.add(c.id);
    }
    const cDate = getLocalDateKey(c.date || c.completedAt);
    if (cDate !== dateIso) continue;
    const activeSec = c.durationSec ?? 0;
    const mins = Math.max(1, Math.round(activeSec / 60));
    const steps =
      typeof c.estimatedSteps === 'number' && c.estimatedSteps > 0
        ? c.estimatedSteps
        : estimateCardioSteps(c.activityType, c.distanceKm, activeSec, heightCm);
    const kcal = Math.max(0, Math.round(c.caloriesBurned || 0));
    const distKm = Math.max(0, c.distanceKm || 0);

    totalSteps += steps;
    totalMin += mins;
    totalKcal += kcal;
    totalDistanceKm += distKm > 0 ? distKm : estimateDistanceKmFromSteps(steps, heightCm);
    distributeAcrossHours(c.startedAt, c.completedAt, steps, mins, kcal, hourly);
  }

  // 2. Strength & Bands Workouts (reconciled by workoutId)
  const seenWorkoutIds = new Set<string>();
  for (const w of db.workouts) {
    if (w.id) {
      if (seenWorkoutIds.has(w.id)) continue;
      seenWorkoutIds.add(w.id);
    }
    const wDate = getLocalDateKey(w.completedAt);
    if (wDate !== dateIso) continue;
    const mins = Math.max(1, Math.round((w.durationSec || 0) / 60));
    const kcal = Math.max(10, Math.round(mins * (weightKg * 0.085)));
    const steps = Math.round(mins * 18);

    totalSteps += steps;
    totalMin += mins;
    totalKcal += kcal;
    totalDistanceKm += estimateDistanceKmFromSteps(steps, heightCm);
    distributeAcrossHours(w.startedAt, w.completedAt, steps, mins, kcal, hourly);
  }

  // 3. HIIT Sessions (reconciled by id)
  const seenHiitIds = new Set<string>();
  for (const h of db.hiitSessions ?? []) {
    if (h.id) {
      if (seenHiitIds.has(h.id)) continue;
      seenHiitIds.add(h.id);
    }
    const hDate = getLocalDateKey(h.date || h.completedAt);
    if (hDate !== dateIso) continue;
    const mins = Math.max(1, Math.round((h.totalDurationSec || 0) / 60));
    const kcal = Math.max(0, Math.round(h.caloriesBurned || 0));
    const steps = Math.round(mins * 85);

    totalSteps += steps;
    totalMin += mins;
    totalKcal += kcal;
    totalDistanceKm += estimateDistanceKmFromSteps(steps, heightCm);
    distributeAcrossHours(undefined, h.completedAt, steps, mins, kcal, hourly);
  }

  // 4. Manual daily steps / Samsung Health CSV imported activity
  const manual = db.manualActivityByDate?.[dateIso];
  if (manual) {
    const mSteps = Math.max(0, Math.round(manual.steps || 0));
    const mMin = Math.max(0, Math.round(manual.activeMin || 0));
    const mKcal = Math.max(0, Math.round(manual.activeKcal || 0));
    totalSteps += mSteps;
    totalMin += mMin;
    totalKcal += mKcal;
    totalDistanceKm +=
      typeof manual.distanceKm === 'number' && manual.distanceKm > 0
        ? manual.distanceKm
        : estimateDistanceKmFromSteps(mSteps, heightCm);

    if (manual.hourlySteps && Object.keys(manual.hourlySteps).length > 0) {
      const entries = Object.entries(manual.hourlySteps);
      const sumLogged = entries.reduce((acc, [, v]) => acc + Math.max(0, v), 0) || 1;
      for (const [hrStr, hSteps] of entries) {
        const hr = Math.max(0, Math.min(23, parseInt(hrStr, 10) || 0));
        const share = Math.max(0, hSteps) / sumLogged;
        hourly[hr].steps += Math.round(hSteps);
        hourly[hr].activeMin += Math.round(mMin * share);
        hourly[hr].activeKcal += Math.round(mKcal * share);
      }
    } else if (mSteps > 0 || mMin > 0 || mKcal > 0) {
      const hr = getLocalHourFromIso(manual.updatedAt, 12);
      hourly[hr].steps += mSteps;
      hourly[hr].activeMin += mMin;
      hourly[hr].activeKcal += mKcal;
    }
  }

  let peakHour: HourlyActivityBucket | null = null;
  for (const b of hourly) {
    b.intensityScore = Math.round(b.steps / 40 + b.activeMin * 2.5 + b.activeKcal * 0.4);
    if (b.intensityScore > 0 && (!peakHour || b.intensityScore > peakHour.intensityScore)) {
      peakHour = b;
    }
  }

  const stepsPct = Math.min(100, Math.round((totalSteps / goals.stepsGoal) * 100));
  const activeMinPct = Math.min(100, Math.round((totalMin / goals.activeMinGoal) * 100));
  const activeKcalPct = Math.min(100, Math.round((totalKcal / goals.activeKcalGoal) * 100));

  const closedRingsCount =
    (totalSteps >= goals.stepsGoal ? 1 : 0) +
    (totalMin >= goals.activeMinGoal ? 1 : 0) +
    (totalKcal >= goals.activeKcalGoal ? 1 : 0);

  const remSteps = Math.max(0, goals.stepsGoal - totalSteps);
  const remMin = Math.max(0, goals.activeMinGoal - totalMin);
  const remKcal = Math.max(0, goals.activeKcalGoal - totalKcal);

  let bannerText = '';
  if (closedRingsCount === 3) {
    bannerText = `¡Corazón completo! Cumpliste ${goals.stepsGoal.toLocaleString('es-MX')} pasos, ${goals.activeMinGoal} min y ${goals.activeKcalGoal} Cal.`;
  } else {
    const missingParts: string[] = [];
    if (remSteps > 0) missingParts.push(`${remSteps.toLocaleString('es-MX')} pasos`);
    if (remMin > 0) missingParts.push(`${remMin} min`);
    if (remKcal > 0) missingParts.push(`${remKcal} Cal`);
    bannerText = `Faltan ${missingParts.join(' · ')} para cerrar los 3 anillos.`;
  }

  const bmr = computeDailyBmrKcal(db.profile);

  return {
    date: dateIso,
    steps: totalSteps,
    activeMin: totalMin,
    activeKcal: totalKcal,
    totalCalories: bmr + totalKcal,
    activeDistanceKm: Math.round(totalDistanceKm * 100) / 100,
    stepsGoal: goals.stepsGoal,
    activeMinGoal: goals.activeMinGoal,
    activeKcalGoal: goals.activeKcalGoal,
    stepsPct,
    activeMinPct,
    activeKcalPct,
    closedRingsCount,
    hourly,
    peakHour,
    bannerText,
  };
}

export function getLast7DaysActivity(
  db: AppDatabase,
  endDateIso = getTodayIsoDate(),
): DayActivityPoint[] {
  const days: DayActivityPoint[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = shiftIsoDate(endDateIso, -i);
    const s = computeDailyActivitySummary(db, date);
    const [y, m, d] = date.split('-').map((n) => parseInt(n, 10));
    const dt = new Date(y, (m || 1) - 1, d || 1);
    const shortLabel =
      i === 0
        ? 'Hoy'
        : dt
            .toLocaleDateString('es-MX', { weekday: 'short' })
            .replace('.', '')
            .slice(0, 3);
    days.push({
      date,
      shortLabel,
      steps: s.steps,
      activeMin: s.activeMin,
      activeKcal: s.activeKcal,
      activeDistanceKm: s.activeDistanceKm,
      stepsPct: s.stepsPct,
      activeMinPct: s.activeMinPct,
      activeKcalPct: s.activeKcalPct,
      closedRingsCount: s.closedRingsCount,
    });
  }
  return days;
}

const SUN_TO_SAT_LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'] as const;

export function getCalendarWeekSunToSat(
  db: AppDatabase,
  referenceDateIso = getTodayIsoDate(),
): CalendarWeekStripDay[] {
  const todayIso = getTodayIsoDate();
  const [y, m, d] = referenceDateIso.split('-').map((n) => parseInt(n, 10));
  const refDate = new Date(y, (m || 1) - 1, d || 1);
  const sundayOffset = -refDate.getDay();

  const days: CalendarWeekStripDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = shiftIsoDate(referenceDateIso, sundayOffset + i);
    const s = computeDailyActivitySummary(db, date);
    const dayNum = parseInt(date.slice(8, 10), 10) || 1;
    days.push({
      date,
      letter: SUN_TO_SAT_LETTERS[i],
      dayNumber: dayNum,
      isToday: date === todayIso,
      isFuture: date > todayIso,
      summary: {
        date,
        shortLabel: SUN_TO_SAT_LETTERS[i],
        steps: s.steps,
        activeMin: s.activeMin,
        activeKcal: s.activeKcal,
        activeDistanceKm: s.activeDistanceKm,
        stepsPct: s.stepsPct,
        activeMinPct: s.activeMinPct,
        activeKcalPct: s.activeKcalPct,
        closedRingsCount: s.closedRingsCount,
      },
    });
  }
  return days;
}

export function getWeeklyStepsSeries(
  db: AppDatabase,
  endDateIso = getTodayIsoDate(),
  weeksCount = 8,
): AggregatedStepsBucket[] {
  const [y, m, d] = endDateIso.split('-').map((n) => parseInt(n, 10));
  const endDt = new Date(y, (m || 1) - 1, d || 1);
  // Start of current Sunday-Saturday week
  const currentSunOffset = -endDt.getDay();
  const buckets: AggregatedStepsBucket[] = [];

  for (let w = weeksCount - 1; w >= 0; w -= 1) {
    const sunIso = shiftIsoDate(endDateIso, currentSunOffset - w * 7);
    let totalSteps = 0;
    let activeDays = 0;
    let countedDays = 0;

    for (let dayIdx = 0; dayIdx < 7; dayIdx += 1) {
      const iso = shiftIsoDate(sunIso, dayIdx);
      if (iso > endDateIso) continue;
      countedDays += 1;
      const summary = computeDailyActivitySummary(db, iso);
      totalSteps += summary.steps;
      if (summary.steps > 0) activeDays += 1;
    }

    const avgDailySteps = countedDays > 0 ? Math.round(totalSteps / countedDays) : 0;
    const [sy, sm, sd] = sunIso.split('-').map((n) => parseInt(n, 10));
    const sDt = new Date(sy, (sm || 1) - 1, sd || 1);
    const label = sDt
      .toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
      .replace('.', '');

    buckets.push({
      id: sunIso,
      label: w === 0 ? 'Esta sem.' : label,
      sublabel: `Semana del ${label}`,
      avgDailySteps,
      totalSteps,
      activeDays,
    });
  }

  return buckets;
}

export function getMonthlyStepsSeries(
  db: AppDatabase,
  endDateIso = getTodayIsoDate(),
  monthsCount = 6,
): AggregatedStepsBucket[] {
  const [y, m] = endDateIso.split('-').map((n) => parseInt(n, 10));
  const endMonthZero = (m || 1) - 1;
  const buckets: AggregatedStepsBucket[] = [];

  for (let idx = monthsCount - 1; idx >= 0; idx -= 1) {
    const targetDt = new Date(y, endMonthZero - idx, 1);
    const targetYear = targetDt.getFullYear();
    const targetMonth = targetDt.getMonth();
    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

    let totalSteps = 0;
    let activeDays = 0;
    let countedDays = 0;

    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (iso > endDateIso) continue;
      countedDays += 1;
      const summary = computeDailyActivitySummary(db, iso);
      totalSteps += summary.steps;
      if (summary.steps > 0) activeDays += 1;
    }

    const avgDailySteps = countedDays > 0 ? Math.round(totalSteps / countedDays) : 0;
    const monthShort = targetDt
      .toLocaleDateString('es-MX', { month: 'short' })
      .replace('.', '');
    const monthFull = targetDt.toLocaleDateString('es-MX', {
      month: 'long',
      year: 'numeric',
    });

    buckets.push({
      id: `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`,
      label: monthShort.charAt(0).toUpperCase() + monthShort.slice(1),
      sublabel: monthFull,
      avgDailySteps,
      totalSteps,
      activeDays,
    });
  }

  return buckets;
}

export function getAgeGroupStepBenchmark(age: number, sex?: Sex): AgeGroupStepBenchmark {
  const safeAge = Number.isFinite(age) && age > 0 ? age : 28;
  const sexAdj = sex === 'mujer' ? -250 : 0;

  if (safeAge < 18) {
    return { ageGroupLabel: 'Menores de 18 años', averageSteps: Math.max(4000, 7500 + sexAdj) };
  }
  if (safeAge <= 29) {
    return { ageGroupLabel: '18–29 años', averageSteps: Math.max(4000, 6800 + sexAdj) };
  }
  if (safeAge <= 39) {
    return { ageGroupLabel: '30–39 años', averageSteps: Math.max(4000, 6500 + sexAdj) };
  }
  if (safeAge <= 49) {
    return { ageGroupLabel: '40–49 años', averageSteps: Math.max(4000, 6200 + sexAdj) };
  }
  if (safeAge <= 59) {
    return { ageGroupLabel: '50–59 años', averageSteps: Math.max(4000, 5700 + sexAdj) };
  }
  return { ageGroupLabel: '60+ años', averageSteps: Math.max(3500, 4900 + sexAdj) };
}

export function getMonthCalendarActivity(
  db: AppDatabase,
  year: number,
  monthZeroBased: number,
): MonthCalendarDay[] {
  const firstDay = new Date(year, monthZeroBased, 1);
  // Convert Sunday=0..Saturday=6 into Monday=0..Sunday=6
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthZeroBased + 1, 0).getDate();

  const cells: MonthCalendarDay[] = [];
  for (let p = 0; p < startOffset; p += 1) {
    cells.push({ date: null, dayNumber: null, summary: null });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const mm = String(monthZeroBased + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const date = `${year}-${mm}-${dd}`;
    const s = computeDailyActivitySummary(db, date);
    cells.push({
      date,
      dayNumber: day,
      summary: {
        date,
        shortLabel: String(day),
        steps: s.steps,
        activeMin: s.activeMin,
        activeKcal: s.activeKcal,
        activeDistanceKm: s.activeDistanceKm,
        stepsPct: s.stepsPct,
        activeMinPct: s.activeMinPct,
        activeKcalPct: s.activeKcalPct,
        closedRingsCount: s.closedRingsCount,
      },
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ date: null, dayNumber: null, summary: null });
  }

  return cells;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseSamsungDateToken(raw: string): string | null {
  const val = raw.trim();
  if (!val) return null;

  // 1. Numeric epoch ms or seconds
  if (/^\d{10,13}$/.test(val)) {
    const num = Number(val);
    const ms = val.length === 10 ? num * 1000 : num;
    const dt = new Date(ms);
    if (!Number.isNaN(dt.getTime())) {
      return getLocalDateKey(dt);
    }
  }

  // 2. YYYY-MM-DD or YYYY-MM-DD HH:mm:ss or YYYY/MM/DD
  const isoMatch = val.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = isoMatch[2].padStart(2, '0');
    const d = isoMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 3. DD/MM/YYYY
  const dmyMatch = val.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0');
    const m = dmyMatch[2].padStart(2, '0');
    const y = dmyMatch[3];
    return `${y}-${m}-${d}`;
  }

  return null;
}

export interface SamsungCsvParseResult {
  entries: ManualDailyActivity[];
  importedCount: number;
  skippedRows: number;
}

/**
 * Parses Samsung Health CSV exports (specifically `com.samsung.shealth.tracker.pedometer_day_summary`
 * as well as simplified step CSVs). Deduplicates multiple sensor rows per day by preferring
 * aggregated rows (`source_type === -2`) or the highest step_count for each date.
 */
export function parseSamsungHealthPedometerCsv(
  csvText: string,
  heightCm = 175,
): SamsungCsvParseResult {
  const rawLines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (rawLines.length < 2) {
    return { entries: [], importedCount: 0, skippedRows: 0 };
  }

  // Samsung Health CSVs often begin with a metadata line like:
  // com.samsung.shealth.tracker.pedometer_day_summary,1,0,...
  let headerIdx = 0;
  if (
    rawLines[0].toLowerCase().startsWith('com.samsung.shealth') &&
    rawLines.length >= 3
  ) {
    headerIdx = 1;
  }

  const headers = splitCsvLine(rawLines[headerIdx]).map((h) => h.toLowerCase());
  const findCol = (candidates: string[]) => {
    for (const c of candidates) {
      const idx = headers.findIndex((h) => h === c || h.endsWith(`.${c}`));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const stepsIdx = findCol(['step_count', 'steps', 'pasos']);
  const dateIdx = findCol(['day_time', 'create_time', 'date', 'fecha', 'update_time']);
  const activeTimeIdx = findCol(['active_time', 'active_minutes', 'active_min', 'minutos']);
  const calorieIdx = findCol(['calorie', 'calories', 'calorias', 'kcal']);
  const distanceIdx = findCol(['distance', 'distancia', 'distance_km']);
  const sourceTypeIdx = findCol(['source_type']);

  if (stepsIdx === -1 || dateIdx === -1) {
    return { entries: [], importedCount: 0, skippedRows: rawLines.length - headerIdx - 1 };
  }

  const bestByDate = new Map<
    string,
    { entry: ManualDailyActivity; isAggregatedSource: boolean }
  >();
  let skippedRows = 0;

  for (let i = headerIdx + 1; i < rawLines.length; i += 1) {
    const cols = splitCsvLine(rawLines[i]);
    if (cols.length <= Math.max(stepsIdx, dateIdx)) {
      skippedRows += 1;
      continue;
    }

    const dateIso = parseSamsungDateToken(cols[dateIdx] ?? '');
    const stepsNum = parseFloat((cols[stepsIdx] ?? '').replace(',', '.'));
    if (!dateIso || !Number.isFinite(stepsNum) || stepsNum < 0) {
      skippedRows += 1;
      continue;
    }

    const steps = Math.round(stepsNum);
    let activeMin = Math.round(steps / 110);
    if (activeTimeIdx !== -1 && cols[activeTimeIdx]) {
      const rawTime = parseFloat(cols[activeTimeIdx].replace(',', '.'));
      if (Number.isFinite(rawTime) && rawTime > 0) {
        // Samsung Health active_time is stored in milliseconds
        activeMin =
          rawTime >= 10000
            ? Math.round(rawTime / 60000)
            : rawTime >= 300
              ? Math.round(rawTime / 60)
              : Math.round(rawTime);
      }
    }

    let activeKcal = Math.round(steps * 0.04);
    if (calorieIdx !== -1 && cols[calorieIdx]) {
      const rawKcal = parseFloat(cols[calorieIdx].replace(',', '.'));
      if (Number.isFinite(rawKcal) && rawKcal >= 0) {
        activeKcal = Math.round(rawKcal);
      }
    }

    let distanceKm = estimateDistanceKmFromSteps(steps, heightCm);
    if (distanceIdx !== -1 && cols[distanceIdx]) {
      const rawDist = parseFloat(cols[distanceIdx].replace(',', '.'));
      if (Number.isFinite(rawDist) && rawDist > 0) {
        // Samsung Health distance is stored in meters (unless column is distance_km)
        const headerName = headers[distanceIdx] ?? '';
        distanceKm =
          headerName.includes('km') || rawDist < 80
            ? Math.round(rawDist * 100) / 100
            : Math.round((rawDist / 1000) * 100) / 100;
      }
    }

    const isAggregatedSource =
      sourceTypeIdx !== -1 && (cols[sourceTypeIdx] ?? '').trim() === '-2';

    const entry: ManualDailyActivity = {
      date: dateIso,
      steps,
      activeMin: Math.max(0, activeMin),
      activeKcal: Math.max(0, activeKcal),
      distanceKm,
      source: 'samsung_health',
      updatedAt: new Date().toISOString(),
    };

    const existing = bestByDate.get(dateIso);
    if (!existing) {
      bestByDate.set(dateIso, { entry, isAggregatedSource });
    } else if (
      (isAggregatedSource && !existing.isAggregatedSource) ||
      (isAggregatedSource === existing.isAggregatedSource &&
        entry.steps > existing.entry.steps)
    ) {
      bestByDate.set(dateIso, { entry, isAggregatedSource });
    }
  }

  const entries = Array.from(bestByDate.values())
    .map((v) => v.entry)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    entries,
    importedCount: entries.length,
    skippedRows,
  };
}
