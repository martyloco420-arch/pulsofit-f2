import { computeDailyExerciseBurn } from './crossModuleIntelligence';
import { getLocalDateKey } from './storage';
import { formatLiquid } from './units';
import type {
  BodyCompositionScan,
  BodyWeightEntry,
  CardioSession,
  HiitSession,
  HydrationContainerMl,
  HydrationSettings,
  LiquidUnit,
  UserProfile,
  WorkoutSession,
} from '../types/fitness';

export interface ContainerOption {
  ml: HydrationContainerMl;
  label: string;
  pluralNoun: string;
  singularNoun: string;
}

export const HYDRATION_CONTAINERS: ContainerOption[] = [
  { ml: 250, label: 'Vaso 250 ml', singularNoun: 'vaso', pluralNoun: 'vasos' },
  { ml: 500, label: 'Botella 500 ml', singularNoun: 'botella', pluralNoun: 'botellas' },
  { ml: 750, label: 'Termo 750 ml', singularNoun: 'termo', pluralNoun: 'termos' },
  { ml: 1000, label: 'Termo 1 L', singularNoun: 'termo de 1 L', pluralNoun: 'termos de 1 L' },
];

export function getContainerMeta(ml: HydrationContainerMl): ContainerOption {
  return HYDRATION_CONTAINERS.find((c) => c.ml === ml) ?? HYDRATION_CONTAINERS[1];
}

export function getLatestWeightForHydration(
  profile: UserProfile,
  bodyWeights: BodyWeightEntry[],
  bodyScans: BodyCompositionScan[],
): { weightKg: number; sourceLabel: string } {
  const latestScan = [...bodyScans].sort((a, b) =>
    b.recordedAt.localeCompare(a.recordedAt),
  )[0];
  const latestWeightEntry = [...bodyWeights].sort((a, b) =>
    b.date.localeCompare(a.date),
  )[0];

  if (latestScan && (!latestWeightEntry || latestScan.date >= latestWeightEntry.date)) {
    return {
      weightKg: latestScan.weightKg,
      sourceLabel: `Báscula (${latestScan.date})`,
    };
  }
  if (latestWeightEntry) {
    return {
      weightKg: latestWeightEntry.weightKg,
      sourceLabel: `Registro (${latestWeightEntry.date})`,
    };
  }
  return {
    weightKg: profile.weightKg,
    sourceLabel: 'Perfil',
  };
}

function toLocalIsoDate(isoTimestamp: string): string {
  return getLocalDateKey(isoTimestamp);
}

export function hasWorkoutOnDate(
  workouts: WorkoutSession[],
  isoDate: string,
): boolean {
  return workouts.some((w) => toLocalIsoDate(w.completedAt) === isoDate);
}

export interface HydrationGoalBreakdown {
  weightKg: number;
  weightSource: string;
  mlPerKg: number;
  baseMl: number;
  workoutBonusMl: number;
  hotDayBonusMl: number;
  totalTargetMl: number;
  trainedOnDate: boolean;
  cardioOnDate: boolean;
  exerciseKcalOnDate: number;
  exerciseMinutesOnDate: number;
  isHotDay: boolean;
}

export function computeHydrationGoal(
  profile: UserProfile,
  bodyWeights: BodyWeightEntry[],
  bodyScans: BodyCompositionScan[],
  workouts: WorkoutSession[],
  settings: HydrationSettings,
  selectedDate: string,
  cardioSessions: CardioSession[] = [],
  hiitSessions: HiitSession[] = [],
): HydrationGoalBreakdown {
  const { weightKg, sourceLabel } = getLatestWeightForHydration(
    profile,
    bodyWeights,
    bodyScans,
  );
  const mlPerKg = Math.max(30, Math.min(40, settings.mlPerKg || 35));
  const baseMl = Math.round(weightKg * mlPerKg);

  const burn = computeDailyExerciseBurn(
    profile,
    workouts,
    cardioSessions,
    hiitSessions,
    selectedDate,
  );
  const trainedOnDate =
    hasWorkoutOnDate(workouts, selectedDate) || burn.strengthCount > 0 || burn.hiitCount > 0;
  const cardioOnDate = burn.cardioCount > 0;

  let exerciseMinutesOnDate = 0;
  let totalSuggestedFromWorkoutsMl = 0;

  for (const w of workouts) {
    if (toLocalIsoDate(w.completedAt) === selectedDate) {
      const mins = Math.max(1, Math.round((w.durationSec || 0) / 60));
      exerciseMinutesOnDate += mins;
      // +350 ml (<30 min), +425 ml (30-50 min), +500 ml (>50 min)
      totalSuggestedFromWorkoutsMl += mins >= 50 ? 500 : mins >= 30 ? 425 : 350;
    }
  }
  for (const c of cardioSessions) {
    if (getLocalDateKey(c.date || c.completedAt) === selectedDate) {
      const mins = Math.max(1, Math.round((c.durationSec || 0) / 60));
      exerciseMinutesOnDate += mins;
      totalSuggestedFromWorkoutsMl += mins >= 45 ? 500 : mins >= 25 ? 425 : 350;
    }
  }
  for (const h of hiitSessions) {
    if (getLocalDateKey(h.date || h.completedAt) === selectedDate) {
      const mins = Math.max(1, Math.round((h.totalDurationSec || 0) / 60));
      exerciseMinutesOnDate += mins;
      totalSuggestedFromWorkoutsMl += mins >= 30 ? 500 : 400;
    }
  }

  let workoutBonusMl = 0;
  if (totalSuggestedFromWorkoutsMl > 0 || burn.totalExerciseKcal > 0) {
    const kcalScaled = Math.round(burn.totalExerciseKcal / 50) * 50;
    const minSessionBonus = Math.max(350, totalSuggestedFromWorkoutsMl);
    workoutBonusMl = Math.min(1250, Math.max(minSessionBonus, kcalScaled));
  }

  const isHotDay = Boolean(settings.hotDayByDate[selectedDate]);
  const hotDayBonusMl = isHotDay ? 500 : 0;

  return {
    weightKg,
    weightSource: sourceLabel,
    mlPerKg,
    baseMl,
    workoutBonusMl,
    hotDayBonusMl,
    totalTargetMl: baseMl + workoutBonusMl + hotDayBonusMl,
    trainedOnDate,
    cardioOnDate,
    exerciseKcalOnDate: burn.totalExerciseKcal,
    exerciseMinutesOnDate,
    isHotDay,
  };
}

export interface ScheduledIntakeItem {
  index: number;
  label: string;
  recommendedTime: string;
  minutesFromMidnight: number;
  amountMl: number;
  cumulativeTargetMl: number;
  completed: boolean;
}

export interface HydrationSchedulePlan {
  totalIntakes: number;
  completedIntakes: number;
  intervalHours: number;
  intervalMinutes: number;
  summaryText: string;
  items: ScheduledIntakeItem[];
}

export function buildHydrationSchedule(
  totalTargetMl: number,
  containerMl: HydrationContainerMl,
  wakeHour: number,
  sleepHour: number,
  currentWaterMl: number,
  liquidUnit: LiquidUnit = 'ml',
): HydrationSchedulePlan {
  const safeWake = Math.max(4, Math.min(12, wakeHour));
  const safeSleep = Math.max(safeWake + 6, Math.min(23, sleepHour));
  const totalIntakes = Math.max(1, Math.ceil(totalTargetMl / containerMl));

  const awakeMinutes = (safeSleep - safeWake) * 60;
  const intervalMinutes = Math.max(
    30,
    Math.round(awakeMinutes / Math.max(1, totalIntakes)),
  );
  const intervalHours = Math.round((intervalMinutes / 60) * 10) / 10;

  const meta = getContainerMeta(containerMl);
  const noun = totalIntakes === 1 ? meta.singularNoun : meta.pluralNoun;
  const containerPhrase =
    liquidUnit === 'oz'
      ? `${totalIntakes} ${noun} de ${formatLiquid(containerMl, 'oz')}`
      : containerMl === 1000
        ? `${totalIntakes} ${noun}`
        : `${totalIntakes} ${noun} de ${containerMl} ml`;

  const items: ScheduledIntakeItem[] = [];
  let completedIntakes = 0;

  for (let i = 0; i < totalIntakes; i += 1) {
    const startMin = safeWake * 60 + 15; // Start 15 min after waking
    const slotMin = Math.min(safeSleep * 60, startMin + i * intervalMinutes);
    const hh = Math.floor(slotMin / 60);
    const mm = slotMin % 60;
    const recommendedTime = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const cumulativeTargetMl = Math.min(totalTargetMl, (i + 1) * containerMl);
    const completed = currentWaterMl >= cumulativeTargetMl;
    if (completed) completedIntakes += 1;

    items.push({
      index: i + 1,
      label: `Toma ${i + 1}`,
      recommendedTime,
      minutesFromMidnight: slotMin,
      amountMl: containerMl,
      cumulativeTargetMl,
      completed,
    });
  }

  return {
    totalIntakes,
    completedIntakes,
    intervalHours,
    intervalMinutes,
    summaryText: `${containerPhrase} · cada ${intervalHours} h`,
    items,
  };
}

export const NEXT_HYDRATION_REMINDER_LS_KEY = 'nextHydrationReminder';
export const HYDRATION_REMINDER_CONFIG_LS_KEY = 'pulsofit_hydration_reminders_v1';

export interface SmartHydrationReminderConfig {
  wakeTime: string; // HH:MM e.g. "07:00"
  sleepTime: string; // HH:MM e.g. "23:00"
  enabled: boolean;
}

export interface SmartHydrationReminderPlan {
  remainingMl: number;
  glassesRemaining: number;
  isWithinActiveWindow: boolean;
  isGoalMet: boolean;
  remainingActiveMinutes: number;
  intervalMinutes: number;
  mlPerHourRequired: number;
  wakeMinutes: number;
  sleepMinutes: number;
  statusText: string;
}

export function hourToTimeString(hour: number, fallback = '07:00'): string {
  if (!Number.isFinite(hour)) return fallback;
  const clamped = Math.max(0, Math.min(23, Math.round(hour)));
  return `${String(clamped).padStart(2, '0')}:00`;
}

export function parseTimeStringToMinutes(timeStr: string, fallbackMinutes: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec((timeStr || '').trim());
  if (!match) return fallbackMinutes;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (
    Number.isNaN(hh) ||
    Number.isNaN(mm) ||
    hh < 0 ||
    hh > 23 ||
    mm < 0 ||
    mm > 59
  ) {
    return fallbackMinutes;
  }
  return hh * 60 + mm;
}

export function timeStringToHour(timeStr: string, fallbackHour: number): number {
  const mins = parseTimeStringToMinutes(timeStr, fallbackHour * 60);
  return Math.max(0, Math.min(23, Math.floor(mins / 60)));
}

export function loadSmartHydrationReminderConfig(
  fallbackSettings?: Partial<HydrationSettings>,
): SmartHydrationReminderConfig {
  const defaultWake = hourToTimeString(fallbackSettings?.wakeHour ?? 7, '07:00');
  const defaultSleep = hourToTimeString(fallbackSettings?.sleepHour ?? 23, '23:00');
  const defaultConfig: SmartHydrationReminderConfig = {
    wakeTime: defaultWake,
    sleepTime: defaultSleep,
    enabled: Boolean(fallbackSettings?.remindersEnabled),
  };

  if (typeof window === 'undefined') return defaultConfig;
  try {
    const raw = window.localStorage.getItem(HYDRATION_REMINDER_CONFIG_LS_KEY);
    if (!raw) return defaultConfig;
    const parsed = JSON.parse(raw) as Partial<SmartHydrationReminderConfig>;
    return {
      wakeTime:
        typeof parsed.wakeTime === 'string' && /^\d{2}:\d{2}$/.test(parsed.wakeTime)
          ? parsed.wakeTime
          : defaultWake,
      sleepTime:
        typeof parsed.sleepTime === 'string' && /^\d{2}:\d{2}$/.test(parsed.sleepTime)
          ? parsed.sleepTime
          : defaultSleep,
      enabled:
        typeof parsed.enabled === 'boolean' ? parsed.enabled : defaultConfig.enabled,
    };
  } catch {
    return defaultConfig;
  }
}

export function saveSmartHydrationReminderConfig(
  config: SmartHydrationReminderConfig,
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      HYDRATION_REMINDER_CONFIG_LS_KEY,
      JSON.stringify(config),
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function getNextHydrationReminderTimestamp(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(NEXT_HYDRATION_REMINDER_LS_KEY);
    if (!raw) return null;
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num : null;
  } catch {
    return null;
  }
}

export function setNextHydrationReminderTimestamp(tsMs: number | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (tsMs === null || !Number.isFinite(tsMs) || tsMs <= 0) {
      window.localStorage.removeItem(NEXT_HYDRATION_REMINDER_LS_KEY);
    } else {
      window.localStorage.setItem(
        NEXT_HYDRATION_REMINDER_LS_KEY,
        String(Math.round(tsMs)),
      );
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function computeNextWakeTimestampMs(
  wakeTime: string,
  sleepTime: string,
  now = new Date(),
): number {
  const wakeMin = parseTimeStringToMinutes(wakeTime, 7 * 60);
  const sleepMin = parseTimeStringToMinutes(sleepTime, 23 * 60);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const target = new Date(now);
  target.setSeconds(0, 0);
  const wakeH = Math.floor(wakeMin / 60);
  const wakeM = wakeMin % 60;
  target.setHours(wakeH, wakeM, 0, 0);

  if (sleepMin > wakeMin) {
    // Daytime window e.g. 07:00 -> 23:00
    if (nowMin >= wakeMin) {
      target.setDate(target.getDate() + 1);
    }
  } else if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime();
}

/**
 * Calculates how often (in minutes) to suggest the next 250 ml glass of water
 * by dividing remaining daily water across remaining active hours before sleepTime.
 * Automatically pauses outside the [wakeTime, sleepTime) active window.
 */
export function computeSmartHydrationPlan(params: {
  targetMl: number;
  consumedMl: number;
  wakeTime: string;
  sleepTime: string;
  now?: Date;
}): SmartHydrationReminderPlan {
  const now = params.now ?? new Date();
  const wakeMin = parseTimeStringToMinutes(params.wakeTime, 7 * 60);
  const rawSleepMin = parseTimeStringToMinutes(params.sleepTime, 23 * 60);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const wrapsMidnight = rawSleepMin <= wakeMin;
  let isWithinActiveWindow = false;
  let remainingActiveMinutes = 0;

  if (!wrapsMidnight) {
    isWithinActiveWindow = nowMin >= wakeMin && nowMin < rawSleepMin;
    remainingActiveMinutes = isWithinActiveWindow
      ? Math.max(1, rawSleepMin - nowMin)
      : Math.max(60, rawSleepMin - wakeMin);
  } else {
    isWithinActiveWindow = nowMin >= wakeMin || nowMin < rawSleepMin;
    if (isWithinActiveWindow) {
      remainingActiveMinutes =
        nowMin >= wakeMin
          ? Math.max(1, 24 * 60 - nowMin + rawSleepMin)
          : Math.max(1, rawSleepMin - nowMin);
    } else {
      remainingActiveMinutes = Math.max(60, 24 * 60 - wakeMin + rawSleepMin);
    }
  }

  const remainingMl = Math.max(0, Math.round(params.targetMl - params.consumedMl));
  const isGoalMet = remainingMl <= 0;
  const glassesRemaining = isGoalMet ? 0 : Math.max(1, Math.ceil(remainingMl / 250));

  const remainingHours = Math.max(0.25, remainingActiveMinutes / 60);
  const mlPerHourRequired = isGoalMet
    ? 0
    : Math.round(remainingMl / remainingHours);

  // Minutes until next 250 ml glass: remainingActiveMinutes / (remainingMl / 250)
  const rawIntervalMin = isGoalMet
    ? 120
    : Math.round((250 / Math.max(250, remainingMl)) * remainingActiveMinutes);
  const intervalMinutes = Math.max(15, Math.min(180, rawIntervalMin));

  let statusText = '';
  if (isGoalMet) {
    statusText = 'Meta del día completada · avisos en pausa hasta mañana';
  } else if (!isWithinActiveWindow) {
    statusText = `Pausado fuera de horario activo (reanuda a las ${params.wakeTime})`;
  } else {
    statusText = `Sugerir 1 vaso (250 ml) cada ${intervalMinutes} min`;
  }

  return {
    remainingMl,
    glassesRemaining,
    isWithinActiveWindow,
    isGoalMet,
    remainingActiveMinutes,
    intervalMinutes,
    mlPerHourRequired,
    wakeMinutes: wakeMin,
    sleepMinutes: rawSleepMin,
    statusText,
  };
}

export function playHydrationChime(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playNote = (freq: number, startOffset: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.09, now + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.02);
    };

    playNote(587.33, 0, 0.16); // D5
    playNote(880.0, 0.12, 0.24); // A5
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 650);
  } catch {
    // Ignore autoplay restrictions
  }
}

export const HYDRATION_IN_APP_ALERT_EVENT = 'pulsofit:hydration-alert';

export interface HydrationInAppAlertPayload {
  title: string;
  body: string;
  triggeredAt: number;
}

export function emitInAppHydrationAlert(title: string, body: string): void {
  if (typeof window === 'undefined') return;
  playHydrationChime();
  window.dispatchEvent(
    new CustomEvent<HydrationInAppAlertPayload>(HYDRATION_IN_APP_ALERT_EVENT, {
      detail: { title, body, triggeredAt: Date.now() },
    }),
  );
}

export async function dispatchLocalHydrationNotification(
  title: string,
  body: string,
  options?: { triggerInAppAlert?: boolean },
): Promise<{ ok: boolean; channel: 'sw' | 'notification' | 'in_app' }> {
  const triggerInApp = options?.triggerInAppAlert !== false;
  if (triggerInApp) {
    emitInAppHydrationAlert(title, body);
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { ok: triggerInApp, channel: 'in_app' };
  }
  if (Notification.permission !== 'granted') {
    return { ok: triggerInApp, channel: 'in_app' };
  }

  try {
    if ('serviceWorker' in navigator) {
      const readyReg = await Promise.race([
        navigator.serviceWorker.ready.catch(() => null),
        new Promise<null>((resolve) =>
          window.setTimeout(() => resolve(null), 1200),
        ),
      ]);
      const reg =
        readyReg ?? (await navigator.serviceWorker.getRegistration().catch(() => null));
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, {
          body,
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
          tag: 'pulsofit-hydration-reminder',
        });
        return { ok: true, channel: 'sw' };
      }
    }
    new Notification(title, {
      body,
      icon: '/pwa-192x192.png',
    });
    return { ok: true, channel: 'notification' };
  } catch {
    return { ok: triggerInApp, channel: 'in_app' };
  }
}
