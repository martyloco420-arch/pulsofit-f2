import type { AppDatabase } from '../types/fitness';
import { getLocalDateKey, getTodayIsoDate } from './storage';

export const PUSH_PREFS_LS_KEY = 'pulsofit_push_prefs_v1';
export const PUSH_ENDPOINT_LS_KEY = 'pulsofit_push_endpoint_v1';

export interface PushReminderPreferences {
  waterEnabled: boolean;
  waterIntervalMin: number;
  waterStartTime: string;
  waterEndTime: string;
  workoutEnabled: boolean;
  workoutDays: number[]; // 0=Dom .. 6=Sab
  workoutTime: string;
  timeZone: string;
}

export function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Mexico_City';
  } catch {
    return 'America/Mexico_City';
  }
}

export function getDefaultPushPreferences(): PushReminderPreferences {
  return {
    waterEnabled: false,
    waterIntervalMin: 90,
    waterStartTime: '08:00',
    waterEndTime: '22:00',
    workoutEnabled: false,
    workoutDays: [1, 2, 3, 4, 5],
    workoutTime: '18:00',
    timeZone: getBrowserTimeZone(),
  };
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function getNotificationPermissionState(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export function loadPushPreferences(): PushReminderPreferences {
  const defaults = getDefaultPushPreferences();
  try {
    const raw = localStorage.getItem(PUSH_PREFS_LS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PushReminderPreferences>;
    return {
      waterEnabled: Boolean(parsed.waterEnabled),
      waterIntervalMin:
        typeof parsed.waterIntervalMin === 'number' && Number.isFinite(parsed.waterIntervalMin)
          ? Math.max(15, Math.min(360, Math.round(parsed.waterIntervalMin)))
          : defaults.waterIntervalMin,
      waterStartTime:
        typeof parsed.waterStartTime === 'string' && /^\d{2}:\d{2}$/.test(parsed.waterStartTime)
          ? parsed.waterStartTime
          : defaults.waterStartTime,
      waterEndTime:
        typeof parsed.waterEndTime === 'string' && /^\d{2}:\d{2}$/.test(parsed.waterEndTime)
          ? parsed.waterEndTime
          : defaults.waterEndTime,
      workoutEnabled: Boolean(parsed.workoutEnabled),
      workoutDays:
        Array.isArray(parsed.workoutDays) && parsed.workoutDays.length > 0
          ? Array.from(
              new Set(
                parsed.workoutDays.filter(
                  (d): d is number => Number.isInteger(d) && d >= 0 && d <= 6,
                ),
              ),
            ).sort((a, b) => a - b)
          : defaults.workoutDays,
      workoutTime:
        typeof parsed.workoutTime === 'string' && /^\d{2}:\d{2}$/.test(parsed.workoutTime)
          ? parsed.workoutTime
          : defaults.workoutTime,
      timeZone:
        typeof parsed.timeZone === 'string' && parsed.timeZone.trim()
          ? parsed.timeZone.trim()
          : defaults.timeZone,
    };
  } catch {
    return defaults;
  }
}

export function savePushPreferences(
  prefs: PushReminderPreferences,
  isHydrated = true,
): void {
  if (!isHydrated) return;
  try {
    localStorage.setItem(PUSH_PREFS_LS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function ensurePushServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Tu navegador no soporta Service Workers.');
  }

  let registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    registration = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
  }

  const readyReg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<ServiceWorkerRegistration>((resolve) =>
      window.setTimeout(() => resolve(registration!), 4000),
    ),
  ]);

  return readyReg;
}

export async function requestPushPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    const sub = await reg.pushManager.getSubscription();
    if (sub?.endpoint) {
      try {
        localStorage.setItem(PUSH_ENDPOINT_LS_KEY, sub.endpoint);
      } catch {
        // Ignore
      }
    }
    return sub;
  } catch {
    return null;
  }
}

export async function subscribeToWebPush(
  prefs: PushReminderPreferences,
  lastWorkoutDate?: string | null,
): Promise<{ ok: boolean; subscribed: boolean; permission: NotificationPermission | 'unsupported'; error?: string }> {
  if (!isPushSupported()) {
    return {
      ok: false,
      subscribed: false,
      permission: 'unsupported',
      error: 'Este navegador no soporta notificaciones Web Push (instala la PWA en pantalla de inicio en iOS 16.4+ o usa Android Chrome).',
    };
  }

  const permission = await requestPushPermission();
  if (permission !== 'granted') {
    return {
      ok: false,
      subscribed: false,
      permission,
      error:
        permission === 'denied'
          ? 'Permiso de notificaciones bloqueado en el navegador. Habilítalo en la configuración del sitio.'
          : 'No se concedió el permiso de notificaciones.',
    };
  }

  try {
    const keyResp = await fetch('/api/push/vapid-public-key');
    if (!keyResp.ok) {
      throw new Error('No se pudo obtener la llave pública VAPID del servidor.');
    }
    const { publicKey } = (await keyResp.json()) as { publicKey?: string };
    if (!publicKey) {
      throw new Error('Llave VAPID inválida.');
    }

    const registration = await ensurePushServiceWorkerRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const subJson = subscription.toJSON();
    try {
      localStorage.setItem(PUSH_ENDPOINT_LS_KEY, subscription.endpoint);
    } catch {
      // Ignore
    }

    const saveResp = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: subJson,
        preferences: prefs,
        lastWorkoutDate: lastWorkoutDate ?? undefined,
      }),
    });

    if (!saveResp.ok) {
      const errData = (await saveResp.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || 'No se pudo guardar la suscripción en el servidor.');
    }

    return { ok: true, subscribed: true, permission };
  } catch (err) {
    return {
      ok: false,
      subscribed: false,
      permission,
      error:
        err instanceof Error
          ? err.message
          : 'No se pudo activar la suscripción Web Push.',
    };
  }
}

export async function syncPushPreferences(
  prefs: PushReminderPreferences,
  lastWorkoutDate?: string | null,
): Promise<{ ok: boolean; subscribed: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { ok: false, subscribed: false };
  }

  try {
    const existing = await getExistingPushSubscription();
    if (!existing) {
      if (prefs.waterEnabled || prefs.workoutEnabled) {
        const res = await subscribeToWebPush(prefs, lastWorkoutDate);
        return { ok: res.ok, subscribed: res.subscribed, error: res.error };
      }
      return { ok: true, subscribed: false };
    }

    const resp = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: existing.toJSON(),
        preferences: prefs,
        lastWorkoutDate: lastWorkoutDate ?? undefined,
      }),
    });

    if (!resp.ok) {
      return { ok: false, subscribed: true, error: 'Error al sincronizar preferencias push.' };
    }

    return { ok: true, subscribed: true };
  } catch {
    return { ok: false, subscribed: false };
  }
}

export async function unsubscribeFromWebPush(): Promise<{ ok: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { ok: true };
  }
  try {
    const existing = await getExistingPushSubscription();
    const cachedEndpoint = (() => {
      try {
        return localStorage.getItem(PUSH_ENDPOINT_LS_KEY);
      } catch {
        return null;
      }
    })();
    const endpoint = existing?.endpoint ?? cachedEndpoint;

    if (existing) {
      await existing.unsubscribe();
    }
    try {
      localStorage.removeItem(PUSH_ENDPOINT_LS_KEY);
    } catch {
      // Ignore
    }

    if (endpoint && navigator.onLine !== false) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      }).catch(() => undefined);
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'No se pudo cancelar la suscripción Push.',
    };
  }
}

export async function sendTestWebPush(
  kind: 'water' | 'workout' | 'test' = 'test',
  prefs?: PushReminderPreferences,
): Promise<{ ok: boolean; error?: string }> {
  try {
    let sub = await getExistingPushSubscription();
    if (!sub && prefs) {
      const subRes = await subscribeToWebPush(prefs);
      if (!subRes.ok) {
        return { ok: false, error: subRes.error };
      }
      sub = await getExistingPushSubscription();
    }

    const resp = await fetch('/api/push/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: sub?.endpoint,
        kind,
      }),
    });

    const data = (await resp.json().catch(() => ({}))) as { error?: string };
    if (!resp.ok) {
      return {
        ok: false,
        error: data.error || 'No se pudo enviar la notificación de prueba.',
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Sin conexión para enviar notificación push de prueba.',
    };
  }
}

const lastActivityPingAt: Record<'water' | 'workout', number> = {
  water: 0,
  workout: 0,
};

/**
 * Silent, offline-tolerant server activity ping so background Web Push reminders
 * stay coordinated when the user drinks water or finishes a workout.
 */
export async function notifyPushActivity(
  type: 'water' | 'workout',
  date?: string,
): Promise<void> {
  if (typeof window === 'undefined') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  const now = Date.now();
  if (now - lastActivityPingAt[type] < 1000) return;
  lastActivityPingAt[type] = now;

  const localDate =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getTodayIsoDate();

  try {
    let endpoint: string | null = null;
    try {
      endpoint = localStorage.getItem(PUSH_ENDPOINT_LS_KEY);
    } catch {
      endpoint = null;
    }

    await fetch('/api/push/activity-ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        date: localDate,
        endpoint: endpoint ?? undefined,
      }),
      keepalive: true,
    });
  } catch {
    // Offline-tolerant: never throw on network errors
  }
}

/**
 * Reconciles server push reminder state with remaining records in database
 * after any single, daily, or category deletion.
 */
export async function reconcilePushActivityState(db: AppDatabase): Promise<void> {
  if (typeof window === 'undefined') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  try {
    let endpoint: string | null = null;
    try {
      endpoint = localStorage.getItem(PUSH_ENDPOINT_LS_KEY);
    } catch {
      endpoint = null;
    }
    if (!endpoint) return;

    const todayIso = getTodayIsoDate();
    const todayLogs = db.hydrationLogsByDate?.[todayIso] ?? [];
    const todayHydrationTotal = db.hydrationByDate?.[todayIso] ?? 0;

    let lastWaterTimestamp: number | null = null;
    if (todayLogs.length > 0) {
      let maxTs = 0;
      for (const item of todayLogs) {
        const ms = Date.parse(item.recordedAt);
        if (Number.isFinite(ms) && ms > maxTs) {
          maxTs = ms;
        }
      }
      lastWaterTimestamp = maxTs > 0 ? maxTs : Date.now();
    } else if (todayHydrationTotal > 0) {
      lastWaterTimestamp = Date.now();
    }

    const workoutDates: string[] = [];
    for (const w of db.workouts) {
      const d = getLocalDateKey(w.completedAt);
      if (d) workoutDates.push(d);
    }
    for (const c of db.cardioSessions ?? []) {
      const d = getLocalDateKey(c.date || c.completedAt);
      if (d) workoutDates.push(d);
    }
    for (const h of db.hiitSessions ?? []) {
      const d = getLocalDateKey(h.date || h.completedAt);
      if (d) workoutDates.push(d);
    }
    workoutDates.sort();
    const lastWorkoutDate =
      workoutDates.length > 0 ? workoutDates[workoutDates.length - 1] : null;

    await fetch('/api/push/activity-ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reconcile',
        endpoint,
        lastWaterTimestamp,
        lastWorkoutDate,
      }),
      keepalive: true,
    });
  } catch {
    // Offline-tolerant
  }
}

