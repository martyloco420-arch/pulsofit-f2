import { shiftIsoDate } from './compareDates';
import { getLocalDateKey, getTodayIsoDate } from './storage';
import type { AppDatabase } from '../types/fitness';

export type StreakMilestoneDays = 7 | 30 | 100;

export interface StreakBadgeStatus {
  days: StreakMilestoneDays;
  title: string;
  subtitle: string;
  unlocked: boolean;
}

export interface Last7DayStatus {
  date: string;
  letter: string;
  status: 'trained' | 'shielded_rest' | 'pending_today' | 'missed';
}

export interface StreakSummary {
  streakDays: number;
  isTodayTrained: boolean;
  isTodayScheduledRest: boolean;
  isFrozenToday: boolean;
  isPendingToday: boolean;
  nextMilestone: StreakMilestoneDays;
  milestoneProgressPct: number;
  daysToNextMilestone: number;
  badges: StreakBadgeStatus[];
  shieldUsedInCurrent7d: number;
  shieldMaxPer7d: number;
  shieldRemainingIn7d: number;
  canActivateRestShieldToday: boolean;
  last7Days: Last7DayStatus[];
  daysSinceLastWorkout: number | null;
}

const WEEK_LETTERS_ES = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

function getDayLetterEs(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(dt.getTime())) return '•';
  return WEEK_LETTERS_ES[dt.getDay()] ?? '•';
}

function diffDaysLocal(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map((n) => parseInt(n, 10));
  const [ty, tm, td] = toIso.split('-').map((n) => parseInt(n, 10));
  const a = new Date(fy, (fm || 1) - 1, fd || 1).getTime();
  const b = new Date(ty, (tm || 1) - 1, td || 1).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

export function collectTrainedDatesSet(db: AppDatabase): Set<string> {
  const set = new Set<string>();

  for (const w of db.workouts ?? []) {
    if (w.completedAt) set.add(getLocalDateKey(w.completedAt));
  }
  for (const c of db.cardioSessions ?? []) {
    const key = getLocalDateKey(c.date || c.completedAt);
    if (key) set.add(key);
  }
  for (const h of db.hiitSessions ?? []) {
    const key = getLocalDateKey(h.date || h.completedAt);
    if (key) set.add(key);
  }
  for (const [dateKey, entry] of Object.entries(db.manualActivityByDate ?? {})) {
    if (!entry) continue;
    if (
      (entry.steps ?? 0) >= 4000 ||
      (entry.activeMin ?? 0) >= 20 ||
      (entry.pausaActivaCount ?? 0) >= 1
    ) {
      set.add(getLocalDateKey(entry.date || dateKey));
    }
  }

  return set;
}

/**
 * Calcula la racha activa hacia hitos de 7, 30 y 100 días usando hora local
 * e implementando el Escudo de Descanso Flexible:
 * - Hasta 2 días libres dentro de cualquier ventana móvil de 7 días
 *   congelan la racha sin romperla.
 * - Si se acumulan >= 3 días sin entrenar dentro de una ventana de 7 días, la racha se corta.
 */
export function computeFlexibleStreakSummary(
  db: AppDatabase,
  todayIso = getTodayIsoDate(),
): StreakSummary {
  const trainedSet = collectTrainedDatesSet(db);
  const scheduledRestSet = new Set<string>(
    (db.scheduledRestDates ?? []).map((d) => getLocalDateKey(d)),
  );

  const isTodayTrained = trainedSet.has(todayIso);
  const isTodayScheduledRest = scheduledRestSet.has(todayIso);
  const isPendingToday = !isTodayTrained && !isTodayScheduledRest;

  // Determine daysSinceLastWorkout from trainedSet up to todayIso
  let daysSinceLastWorkout: number | null = null;
  const sortedTrained = Array.from(trainedSet)
    .filter((d) => d <= todayIso)
    .sort((a, b) => b.localeCompare(a));
  if (sortedTrained.length > 0) {
    daysSinceLastWorkout = Math.max(0, diffDaysLocal(sortedTrained[0], todayIso));
  }

  const startOffset = isPendingToday ? 1 : 0;
  const maxScanDays = 400;

  interface WalkStep {
    offset: number;
    date: string;
    trained: boolean;
  }

  const walked: WalkStep[] = [];
  const acceptedRestOffsets: number[] = [];

  for (let offset = startOffset; offset <= maxScanDays; offset += 1) {
    const dateIso = shiftIsoDate(todayIso, -offset);
    const trained = trainedSet.has(dateIso);

    if (trained) {
      walked.push({ offset, date: dateIso, trained: true });
      continue;
    }

    // Non-trained day: check flexible 2-in-7 rolling window rule
    const restsInLast7 = acceptedRestOffsets.filter((r) => offset - r <= 6).length;
    if (restsInLast7 >= 2) {
      break;
    }

    // Prevent infinite leading rests if no workout existed yet within the first 3 days
    const hasAnyTrainedCloser = walked.some((s) => s.trained);
    if (!hasAnyTrainedCloser && offset - startOffset >= 2) {
      break;
    }

    acceptedRestOffsets.push(offset);
    walked.push({ offset, date: dateIso, trained: false });
  }

  // Trim trailing rest days older than the oldest trained day in the sequence
  let lastTrainedIdx = -1;
  for (let i = walked.length - 1; i >= 0; i -= 1) {
    if (walked[i].trained) {
      lastTrainedIdx = i;
      break;
    }
  }

  const validSpan = lastTrainedIdx >= 0 ? walked.slice(0, lastTrainedIdx + 1) : [];
  const streakDays = validSpan.filter((s) => s.trained).length;

  const shieldedSet = new Set<string>(
    validSpan.filter((s) => !s.trained).map((s) => s.date),
  );
  if (isTodayScheduledRest) {
    shieldedSet.add(todayIso);
  }

  // Count shield days used inside the current rolling 7-day window [today-6 .. today]
  const current7WindowDates: string[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    current7WindowDates.push(shiftIsoDate(todayIso, -i));
  }

  let shieldUsedInCurrent7d = 0;
  for (const d of current7WindowDates) {
    if (trainedSet.has(d)) continue;
    if (scheduledRestSet.has(d) || shieldedSet.has(d)) {
      shieldUsedInCurrent7d += 1;
    }
  }
  const shieldMaxPer7d = 2;
  const clampedShieldUsed = Math.min(shieldMaxPer7d, shieldUsedInCurrent7d);
  const shieldRemainingIn7d = Math.max(0, shieldMaxPer7d - clampedShieldUsed);

  const canActivateRestShieldToday =
    !isTodayTrained && (isTodayScheduledRest || shieldRemainingIn7d > 0);

  const isFrozenToday =
    !isTodayTrained && (isTodayScheduledRest || shieldedSet.has(todayIso)) && streakDays > 0;

  const last7Days: Last7DayStatus[] = current7WindowDates.map((d) => {
    let status: Last7DayStatus['status'] = 'missed';
    if (trainedSet.has(d)) {
      status = 'trained';
    } else if (d === todayIso && isPendingToday) {
      status = 'pending_today';
    } else if (scheduledRestSet.has(d) || shieldedSet.has(d)) {
      status = 'shielded_rest';
    }
    return {
      date: d,
      letter: getDayLetterEs(d),
      status,
    };
  });

  const nextMilestone: StreakMilestoneDays =
    streakDays < 7 ? 7 : streakDays < 30 ? 30 : 100;

  const milestoneProgressPct =
    streakDays >= 100
      ? 100
      : Math.min(100, Math.round((streakDays / nextMilestone) * 100));

  const daysToNextMilestone =
    streakDays >= 100 ? 0 : Math.max(0, nextMilestone - streakDays);

  const badges: StreakBadgeStatus[] = [
    {
      days: 7,
      title: 'Semana de Acero',
      subtitle: '7 días activos',
      unlocked: streakDays >= 7,
    },
    {
      days: 30,
      title: 'Mes Imparable',
      subtitle: '30 días activos',
      unlocked: streakDays >= 30,
    },
    {
      days: 100,
      title: 'Centurión Fit',
      subtitle: '100 días activos',
      unlocked: streakDays >= 100,
    },
  ];

  return {
    streakDays,
    isTodayTrained,
    isTodayScheduledRest,
    isFrozenToday,
    isPendingToday,
    nextMilestone,
    milestoneProgressPct,
    daysToNextMilestone,
    badges,
    shieldUsedInCurrent7d: clampedShieldUsed,
    shieldMaxPer7d,
    shieldRemainingIn7d,
    canActivateRestShieldToday,
    last7Days,
    daysSinceLastWorkout,
  };
}
