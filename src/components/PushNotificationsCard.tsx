import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  CheckCircle2,
  Clock,
  Droplets,
  Dumbbell,
  Info,
  Loader2,
  Moon,
  PauseCircle,
  Send,
  ShieldAlert,
  Smartphone,
  Sun,
  Volume2,
} from 'lucide-react';
import {
  HYDRATION_REMINDER_CONFIG_LS_KEY,
  NEXT_HYDRATION_REMINDER_LS_KEY,
  type SmartHydrationReminderConfig,
  computeNextWakeTimestampMs,
  computeSmartHydrationPlan,
  dispatchLocalHydrationNotification,
  getNextHydrationReminderTimestamp,
  loadSmartHydrationReminderConfig,
  saveSmartHydrationReminderConfig,
  setNextHydrationReminderTimestamp,
  timeStringToHour,
} from '../lib/hydration';
import {
  type PushReminderPreferences,
  getBrowserTimeZone,
  getExistingPushSubscription,
  getNotificationPermissionState,
  isPushSupported,
  isStandalonePwa,
  loadPushPreferences,
  savePushPreferences,
  sendTestWebPush,
  subscribeToWebPush,
  syncPushPreferences,
  unsubscribeFromWebPush,
} from '../lib/pushNotifications';
import { getActiveProfileId, getLocalDateKey, getTodayIsoDate } from '../lib/storage';
import { formatLiquid } from '../lib/units';
import type {
  CardioSession,
  HiitSession,
  HydrationSettings,
  LiquidUnit,
  WorkoutSession,
} from '../types/fitness';

interface PushNotificationsCardProps {
  profileId?: string;
  isHydrated?: boolean;
  workouts: WorkoutSession[];
  cardioSessions?: CardioSession[];
  hiitSessions?: HiitSession[];
  highlightSignal?: number;
  todayTargetMl?: number;
  todayConsumedMl?: number;
  liquidUnit?: LiquidUnit;
  hydrationSettings?: HydrationSettings;
  onUpdateHydrationSettings?: (next: HydrationSettings) => void;
}

const WEEKDAY_OPTIONS: { day: number; short: string; name: string }[] = [
  { day: 1, short: 'L', name: 'Lunes' },
  { day: 2, short: 'M', name: 'Martes' },
  { day: 3, short: 'X', name: 'Miércoles' },
  { day: 4, short: 'J', name: 'Jueves' },
  { day: 5, short: 'V', name: 'Viernes' },
  { day: 6, short: 'S', name: 'Sábado' },
  { day: 0, short: 'D', name: 'Domingo' },
];

const INTERVAL_OPTIONS: number[] = [45, 60, 90, 120, 150, 180];

function formatClockTime(tsMs: number): string {
  const dt = new Date(tsMs);
  if (Number.isNaN(dt.getTime())) return '--:--';
  return dt.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatActiveRemaining(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export const PushNotificationsCard: React.FC<PushNotificationsCardProps> = ({
  profileId,
  isHydrated = true,
  workouts,
  cardioSessions = [],
  hiitSessions = [],
  highlightSignal = 0,
  todayTargetMl = 2500,
  todayConsumedMl = 0,
  liquidUnit = 'ml',
  hydrationSettings,
  onUpdateHydrationSettings,
}) => {
  const activeProfileId = useMemo(
    () => (profileId || getActiveProfileId() || 'main').trim() || 'main',
    [profileId],
  );

  const [prefs, setPrefs] = useState<PushReminderPreferences>(() =>
    loadPushPreferences(),
  );
  const [smartConfig, setSmartConfig] = useState<SmartHydrationReminderConfig>(() =>
    loadSmartHydrationReminderConfig(hydrationSettings),
  );
  const [nextReminderTs, setNextReminderTs] = useState<number | null>(() =>
    getNextHydrationReminderTimestamp(),
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    getNotificationPermissionState(),
  );
  const [isBusy, setIsBusy] = useState(false);
  const [isTestingPush, setIsTestingPush] = useState(false);
  const [isTestingLocal, setIsTestingLocal] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'error';
    message: string;
  } | null>(null);
  const [isHighlighted, setIsHighlighted] = useState(false);

  const pushSupported = isPushSupported();
  const standalonePwa = isStandalonePwa();

  const smartPushOn = Boolean(prefs.smartRemindersEnabled || prefs.waterEnabled);

  const latestWorkoutDate = useMemo(() => {
    const dates: string[] = [];
    for (const w of workouts) {
      if (w.completedAt) dates.push(getLocalDateKey(w.completedAt));
    }
    for (const c of cardioSessions) {
      dates.push(getLocalDateKey(c.date || c.completedAt));
    }
    for (const h of hiitSessions) {
      dates.push(getLocalDateKey(h.date || h.completedAt));
    }
    if (dates.length === 0) return null;
    dates.sort((a, b) => b.localeCompare(a));
    return dates[0] ?? null;
  }, [workouts, cardioSessions, hiitSessions]);

  const trainedToday = latestWorkoutDate === getTodayIsoDate();

  const plan = useMemo(
    () =>
      computeSmartHydrationPlan({
        targetMl: todayTargetMl,
        consumedMl: todayConsumedMl,
        wakeTime: smartConfig.wakeTime,
        sleepTime: smartConfig.sleepTime,
        now: new Date(nowMs),
      }),
    [
      todayTargetMl,
      todayConsumedMl,
      smartConfig.wakeTime,
      smartConfig.sleepTime,
      nowMs,
    ],
  );

  useEffect(() => {
    let active = true;
    const refreshStatus = async () => {
      const sub = await getExistingPushSubscription();
      if (!active) return;
      setIsSubscribed(Boolean(sub));
      setPermission(getNotificationPermissionState());
    };
    void refreshStatus();
    return () => {
      active = false;
    };
  }, [activeProfileId]);

  useEffect(() => {
    const tick = () => {
      setNowMs(Date.now());
      setNextReminderTs(getNextHydrationReminderTimestamp());
      setPermission(getNotificationPermissionState());
    };
    const id = window.setInterval(tick, 15000);
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === NEXT_HYDRATION_REMINDER_LS_KEY ||
        e.key === HYDRATION_REMINDER_CONFIG_LS_KEY
      ) {
        setSmartConfig(loadSmartHydrationReminderConfig(hydrationSettings));
        setNextReminderTs(getNextHydrationReminderTimestamp());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('storage', onStorage);
    };
  }, [hydrationSettings]);

  // Keep valid future nextHydrationReminder persisted when smart reminders are enabled
  useEffect(() => {
    if (!smartConfig.enabled) return;
    const stored = getNextHydrationReminderTimestamp();
    const now = Date.now();
    if (!stored || stored < now - 60_000) {
      const nextTs =
        plan.isWithinActiveWindow && !plan.isGoalMet
          ? now + plan.intervalMinutes * 60 * 1000
          : computeNextWakeTimestampMs(
              smartConfig.wakeTime,
              smartConfig.sleepTime,
              new Date(now),
            );
      setNextHydrationReminderTimestamp(nextTs);
      setNextReminderTs(nextTs);
    } else if (
      plan.isWithinActiveWindow &&
      !plan.isGoalMet &&
      stored > now + plan.intervalMinutes * 60 * 1000 + 60_000
    ) {
      const tighterTs = now + plan.intervalMinutes * 60 * 1000;
      setNextHydrationReminderTimestamp(tighterTs);
      setNextReminderTs(tighterTs);
    }
  }, [
    smartConfig.enabled,
    smartConfig.wakeTime,
    smartConfig.sleepTime,
    plan.isWithinActiveWindow,
    plan.isGoalMet,
    plan.intervalMinutes,
  ]);

  useEffect(() => {
    if (highlightSignal <= 0) return;
    setIsHighlighted(true);
    const el = document.getElementById('push-reminders-card');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const timer = window.setTimeout(() => setIsHighlighted(false), 2600);
    return () => window.clearTimeout(timer);
  }, [highlightSignal]);

  const updateSmartConfig = (
    next: SmartHydrationReminderConfig,
    recomputeSchedule = true,
  ) => {
    setSmartConfig(next);
    if (isHydrated) {
      saveSmartHydrationReminderConfig(next);
    }

    if (hydrationSettings && onUpdateHydrationSettings) {
      const nextWakeHour = timeStringToHour(next.wakeTime, hydrationSettings.wakeHour);
      const nextSleepHour = Math.max(
        18,
        Math.min(23, timeStringToHour(next.sleepTime, hydrationSettings.sleepHour)),
      );
      onUpdateHydrationSettings({
        ...hydrationSettings,
        wakeHour: nextWakeHour,
        sleepHour: nextSleepHour,
        remindersEnabled: next.enabled,
      });
    }

    if (!next.enabled) {
      setNextHydrationReminderTimestamp(null);
      setNextReminderTs(null);
      return;
    }

    if (recomputeSchedule) {
      const updatedPlan = computeSmartHydrationPlan({
        targetMl: todayTargetMl,
        consumedMl: todayConsumedMl,
        wakeTime: next.wakeTime,
        sleepTime: next.sleepTime,
        now: new Date(),
      });
      const nextTs =
        updatedPlan.isWithinActiveWindow && !updatedPlan.isGoalMet
          ? Date.now() + updatedPlan.intervalMinutes * 60 * 1000
          : computeNextWakeTimestampMs(next.wakeTime, next.sleepTime, new Date());
      setNextHydrationReminderTimestamp(nextTs);
      setNextReminderTs(nextTs);
    }
  };

  const commitPreferences = async (nextRaw: PushReminderPreferences) => {
    const next: PushReminderPreferences = {
      ...nextRaw,
      waterEnabled: nextRaw.smartRemindersEnabled,
      timeZone: getBrowserTimeZone(),
    };
    setPrefs(next);
    if (isHydrated) {
      savePushPreferences(next, isHydrated);
    }

    setFeedback(null);
    if (next.smartRemindersEnabled || next.workoutEnabled) {
      setIsBusy(true);
      try {
        const res = await syncPushPreferences(next, latestWorkoutDate, activeProfileId);
        setPermission(getNotificationPermissionState());
        setIsSubscribed(res.subscribed);
        if (!res.ok && res.error) {
          setFeedback({ type: 'error', message: res.error });
        } else if (res.subscribed) {
          setFeedback({
            type: 'ok',
            message: 'Preferencias Push y horarios sincronizadas con el servidor.',
          });
        }
      } finally {
        setIsBusy(false);
      }
    } else if (isSubscribed) {
      setIsBusy(true);
      try {
        await syncPushPreferences(next, latestWorkoutDate, activeProfileId);
        setFeedback({
          type: 'ok',
          message: 'Recordatorios Push en segundo plano pausados.',
        });
      } finally {
        setIsBusy(false);
      }
    }
  };

  const handleToggleSmartRemindersSwitch = async () => {
    const nextEnabled = !smartPushOn;
    updateSmartConfig({ ...smartConfig, enabled: nextEnabled }, true);
    await commitPreferences({
      ...prefs,
      smartRemindersEnabled: nextEnabled,
      waterEnabled: nextEnabled,
      waterStartTime: smartConfig.wakeTime || prefs.waterStartTime,
      waterEndTime: smartConfig.sleepTime || prefs.waterEndTime,
    });
  };

  const handleToggleSmartInAppOnly = async () => {
    setFeedback(null);
    if (smartConfig.enabled) {
      updateSmartConfig({ ...smartConfig, enabled: false });
      setFeedback({ type: 'ok', message: 'Alertas locales en app pausadas.' });
      return;
    }

    let perm: NotificationPermission | 'unsupported' = getNotificationPermissionState();
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        try {
          perm = await Notification.requestPermission();
        } catch {
          perm = Notification.permission;
        }
      } else {
        perm = Notification.permission;
      }
      setPermission(perm);
    }

    updateSmartConfig({ ...smartConfig, enabled: true }, true);

    if (perm === 'granted') {
      setFeedback({
        type: 'ok',
        message: plan.isWithinActiveWindow
          ? `Alertas inteligentes activas cada ${plan.intervalMinutes} min (próximo aviso guardado).`
          : `Alertas inteligentes activas; pausadas hasta tu hora de despertar (${smartConfig.wakeTime}).`,
      });
    } else {
      setFeedback({
        type: 'ok',
        message:
          'Alertas inteligentes activas con aviso visual y sonoro dentro de la app.',
      });
    }
  };

  const handleWakeSleepTimeChange = (
    field: 'wakeTime' | 'sleepTime',
    value: string,
  ) => {
    if (!value) return;
    const nextSmart: SmartHydrationReminderConfig = {
      ...smartConfig,
      [field]: value,
    };
    updateSmartConfig(nextSmart, true);

    const nextPush: PushReminderPreferences = {
      ...prefs,
      waterStartTime: field === 'wakeTime' ? value : prefs.waterStartTime,
      waterEndTime: field === 'sleepTime' ? value : prefs.waterEndTime,
    };
    if (nextPush.smartRemindersEnabled || nextPush.workoutEnabled || isSubscribed) {
      void commitPreferences(nextPush);
    } else {
      const normalized = { ...nextPush, timeZone: getBrowserTimeZone() };
      setPrefs(normalized);
      if (isHydrated) savePushPreferences(normalized, isHydrated);
    }
  };

  const handleActivatePushSubscription = async () => {
    setIsBusy(true);
    setFeedback(null);
    try {
      const enableSmart = !smartPushOn && !prefs.workoutEnabled ? true : smartPushOn;
      if (enableSmart && !smartConfig.enabled) {
        updateSmartConfig({ ...smartConfig, enabled: true }, true);
      }

      const nextPrefs: PushReminderPreferences = {
        ...prefs,
        smartRemindersEnabled: enableSmart,
        waterEnabled: enableSmart,
        waterStartTime: smartConfig.wakeTime || prefs.waterStartTime,
        waterEndTime: smartConfig.sleepTime || prefs.waterEndTime,
        timeZone: getBrowserTimeZone(),
      };
      setPrefs(nextPrefs);
      if (isHydrated) savePushPreferences(nextPrefs, isHydrated);

      const res = await subscribeToWebPush(
        nextPrefs,
        latestWorkoutDate,
        activeProfileId,
      );
      setPermission(res.permission);
      setIsSubscribed(res.subscribed);
      if (res.ok) {
        setFeedback({
          type: 'ok',
          message:
            'Notificaciones Push activadas para este perfil. Recibirás alertas incluso con la app cerrada.',
        });
      } else {
        setFeedback({
          type: 'error',
          message: res.error || 'No se pudieron activar las notificaciones Push.',
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleUnsubscribe = async () => {
    setIsBusy(true);
    setFeedback(null);
    try {
      const nextPrefs: PushReminderPreferences = {
        ...prefs,
        smartRemindersEnabled: false,
        waterEnabled: false,
        workoutEnabled: false,
        timeZone: getBrowserTimeZone(),
      };
      setPrefs(nextPrefs);
      if (isHydrated) savePushPreferences(nextPrefs, isHydrated);

      const res = await unsubscribeFromWebPush(activeProfileId);
      setIsSubscribed(false);
      setPermission(getNotificationPermissionState());
      if (res.ok) {
        setFeedback({
          type: 'ok',
          message: 'Notificaciones Push desactivadas en este dispositivo.',
        });
      } else {
        setFeedback({
          type: 'error',
          message: res.error || 'No se pudieron desactivar las notificaciones Push.',
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleSendLocalTest = async () => {
    setIsTestingLocal(true);
    setFeedback(null);
    try {
      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'default'
      ) {
        try {
          const perm = await Notification.requestPermission();
          setPermission(perm);
        } catch {
          // Ignore
        }
      } else {
        setPermission(getNotificationPermissionState());
      }

      const glassText = formatLiquid(250, liquidUnit);
      const remainingText = formatLiquid(plan.remainingMl, liquidUnit);
      const body =
        plan.remainingMl > 0
          ? `Toma 1 vaso (${glassText}). Te faltan ${remainingText} · sugerido cada ${plan.intervalMinutes} min.`
          : '¡Meta de hidratación cumplida hoy! Sigue escuchando tu cuerpo.';

      const result = await dispatchLocalHydrationNotification(
        'PulsoFit · Recordatorio de Hidratación',
        body,
        { triggerInAppAlert: true },
      );

      if (result.channel === 'sw') {
        setFeedback({
          type: 'ok',
          message:
            'Alerta enviada mediante Service Worker y sonido/banner en pantalla.',
        });
      } else if (result.channel === 'notification') {
        setFeedback({
          type: 'ok',
          message: 'Notificación local enviada vía navegador y alerta en pantalla.',
        });
      } else {
        setFeedback({
          type: 'ok',
          message:
            'Alerta visual y sonora activada dentro de la app. Habilita permisos para verla fuera de pantalla.',
        });
      }
    } finally {
      setIsTestingLocal(false);
    }
  };

  const handleSendPushTest = async () => {
    setIsTestingPush(true);
    setFeedback(null);
    try {
      const nextPrefs: PushReminderPreferences = {
        ...prefs,
        timeZone: getBrowserTimeZone(),
      };
      const res = await sendTestWebPush('test', nextPrefs, activeProfileId);
      setPermission(getNotificationPermissionState());
      if (res.ok) {
        setIsSubscribed(true);
        setFeedback({
          type: 'ok',
          message:
            'Notificación Push de prueba enviada desde el servidor. Tócala para validar la apertura directa.',
        });
      } else {
        setFeedback({
          type: 'error',
          message:
            res.error || 'No se pudo enviar la notificación Push de prueba.',
        });
      }
    } finally {
      setIsTestingPush(false);
    }
  };

  const toggleWorkoutDay = (day: number) => {
    const exists = prefs.workoutDays.includes(day);
    if (exists && prefs.workoutDays.length === 1) return;
    const nextDays = exists
      ? prefs.workoutDays.filter((d) => d !== day)
      : [...prefs.workoutDays, day].sort((a, b) => a - b);
    void commitPreferences({ ...prefs, workoutDays: nextDays });
  };

  const minutesUntilNext =
    nextReminderTs !== null
      ? Math.max(0, Math.ceil((nextReminderTs - nowMs) / 60000))
      : null;

  const isPausedOutsideWindow = smartConfig.enabled && !plan.isWithinActiveWindow;

  const permissionBadge =
    permission === 'granted'
      ? {
          label: isSubscribed ? 'Push Activo' : 'Permiso Concedido',
          cls: 'border-emerald-400/40 bg-emerald-500/12 text-emerald-300',
        }
      : permission === 'denied'
        ? {
            label: 'Permiso Bloqueado',
            cls: 'border-rose-400/40 bg-rose-500/12 text-rose-300',
          }
        : permission === 'unsupported'
          ? {
              label: 'Push no soportado',
              cls: 'border-zinc-700 bg-zinc-900 text-zinc-400',
            }
          : {
              label: 'Permiso Pendiente',
              cls: 'border-amber-400/40 bg-amber-500/12 text-amber-300',
            };

  return (
    <section
      id="push-reminders-card"
      className={`rounded-3xl border bg-[#12141A] p-5 space-y-4 transition-all duration-300 ${
        isHighlighted
          ? 'border-[#D4FF33] ring-2 ring-[#D4FF33]/35'
          : 'border-[#222631]'
      }`}
    >
      {/* Cabecera unificada */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BellRing className="w-5 h-5 text-[#D4FF33]" />
            <h2 className="text-xl sm:text-2xl font-bold font-display text-white">
              Notificaciones Push y Recordatorios
            </h2>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Configura recordatorios inteligentes y alertas de entrenamiento con entrega VAPID en segundo plano para tu perfil activo.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-extrabold ${
              !smartConfig.enabled
                ? 'border-[#272C38] bg-[#0D0F14] text-zinc-400'
                : isPausedOutsideWindow
                  ? 'border-amber-400/40 bg-amber-500/12 text-amber-300'
                  : 'border-[#a3e635]/40 bg-[#a3e635]/12 text-[#a3e635]'
            }`}
          >
            {!smartConfig.enabled ? (
              <>
                <BellOff className="w-3.5 h-3.5" />
                En app: OFF
              </>
            ) : isPausedOutsideWindow ? (
              <>
                <PauseCircle className="w-3.5 h-3.5" />
                Silencio nocturno
              </>
            ) : (
              <>
                <Bell className="w-3.5 h-3.5" />
                En app: ON
              </>
            )}
          </span>

          <span
            className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-extrabold ${permissionBadge.cls}`}
          >
            {permission === 'granted' ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5" />
            )}
            {permissionBadge.label}
          </span>

          <span
            className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-bold ${
              standalonePwa
                ? 'border-[#D4FF33]/40 bg-[#D4FF33]/10 text-[#D4FF33]'
                : 'border-[#282D3B] bg-[#0D0F14] text-zinc-400'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            {standalonePwa ? 'PWA Instalada' : 'Modo Navegador'}
          </span>
        </div>
      </div>

      {/* Estado de soporte y permisos del navegador */}
      {!pushSupported ? (
        <div
          role="alert"
          className="rounded-2xl border border-amber-400/35 bg-amber-500/10 p-3.5 text-xs text-amber-200 space-y-1"
        >
          <p className="font-bold text-amber-300">
            Web Push no soportado en este navegador/contexto
          </p>
          <p>
            Tu navegador requiere soporte de Service Worker, PushManager y Notification API (en iOS 16.4+ instala primero PulsoFit en pantalla de inicio; en Android usa Chrome o Edge). Las alertas dentro de la app siguen activas.
          </p>
        </div>
      ) : permission === 'denied' ? (
        <div
          role="alert"
          className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3.5 text-xs text-rose-100 space-y-1.5"
        >
          <p className="font-bold text-rose-300 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            Notificaciones bloqueadas en el navegador
          </p>
          <p className="text-rose-200/90 leading-relaxed">
            Para volver a activarlas: abre el icono de candado o ajustes junto a la barra de direcciones → <strong className="text-white">Permisos / Configuración del sitio</strong> → <strong className="text-white">Notificaciones → Permitir</strong>. En Android PWA o iOS ve a <strong className="text-white">Ajustes del sistema → Aplicaciones → PulsoFit → Notificaciones</strong> y recarga la página.
          </p>
        </div>
      ) : permission === 'default' ? (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/8 p-3.5 flex items-start gap-2.5 text-xs text-amber-100">
          <Info className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-amber-200">
              Permiso de notificaciones pendiente
            </p>
            <p className="text-amber-200/85 mt-0.5">
              Activa alguno de los interruptores o pulsa &ldquo;Activar notificaciones Push&rdquo; para conceder permiso y registrar este dispositivo.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/8 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs text-emerald-200">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
            <span>
              {isSubscribed
                ? 'Permiso concedido y suscripción Push sincronizada con el servidor.'
                : 'Permiso concedido. Activa Push o un recordatorio para vincular este dispositivo.'}
            </span>
          </span>
          <span className="font-mono text-[10px] text-emerald-300/80 shrink-0">
            Perfil: {activeProfileId}
          </span>
        </div>
      )}

      {/* Switch 1: Recordatorios inteligentes */}
      <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl bg-sky-400/12 border border-sky-400/30 flex items-center justify-center shrink-0">
              <Droplets className="w-4 h-4 text-sky-300" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">
                Recordatorios inteligentes
              </p>
              <p className="text-[11px] text-zinc-400">
                Inactividad, hidratación dinámica o check-in diario dentro de tu ventana activa
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => void handleToggleSmartInAppOnly()}
              aria-pressed={smartConfig.enabled}
              className={`min-h-[34px] rounded-xl px-2.5 text-[11px] font-bold border transition-colors ${
                smartConfig.enabled
                  ? 'border-[#a3e635]/45 bg-[#a3e635]/12 text-[#a3e635]'
                  : 'border-[#2B303C] bg-[#161922] text-zinc-400 hover:text-white'
              }`}
            >
              Banner app: {smartConfig.enabled ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              role="switch"
              aria-checked={smartPushOn}
              aria-label="Recordatorios inteligentes"
              disabled={isBusy || !pushSupported}
              onClick={() => void handleToggleSmartRemindersSwitch()}
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border transition-colors disabled:opacity-45 ${
                smartPushOn
                  ? 'border-[#a3e635] bg-[#a3e635]'
                  : 'border-[#2E3444] bg-[#181B24]'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full transition-transform ${
                  smartPushOn
                    ? 'translate-x-6 bg-[#0A0B0D]'
                    : 'translate-x-1 bg-zinc-400'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Horario activo / silencio nocturno + Intervalo Push */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <label className="rounded-xl border border-[#1E2330] bg-[#12141A] px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Sun className="w-4 h-4 text-amber-300 shrink-0" />
              <div className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                  Despertar / Inicio
                </span>
                <span className="block text-[10px] text-zinc-500">Ventana activa</span>
              </div>
            </div>
            <input
              type="time"
              value={smartConfig.wakeTime}
              onChange={(e) => handleWakeSleepTimeChange('wakeTime', e.target.value)}
              aria-label="Hora de despertar e inicio"
              className="bg-transparent text-sm font-mono font-bold text-white [color-scheme:dark] focus:outline-none"
            />
          </label>

          <label className="rounded-xl border border-[#1E2330] bg-[#12141A] px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Moon className="w-4 h-4 text-indigo-300 shrink-0" />
              <div className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                  Dormir / Silencio
                </span>
                <span className="block text-[10px] text-zinc-500">Pausa nocturna</span>
              </div>
            </div>
            <input
              type="time"
              value={smartConfig.sleepTime}
              onChange={(e) => handleWakeSleepTimeChange('sleepTime', e.target.value)}
              aria-label="Hora de dormir y silencio"
              className="bg-transparent text-sm font-mono font-bold text-white [color-scheme:dark] focus:outline-none"
            />
          </label>

          <label className="rounded-xl border border-[#1E2330] bg-[#12141A] px-3 py-2 flex flex-col justify-center gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              Intervalo Push (cerrada)
            </span>
            <select
              value={prefs.waterIntervalMin}
              onChange={(e) =>
                void commitPreferences({
                  ...prefs,
                  waterIntervalMin: Number(e.target.value),
                })
              }
              className="bg-transparent text-sm font-mono font-bold text-white focus:outline-none"
            >
              {INTERVAL_OPTIONS.map((min) => (
                <option key={min} value={min} className="bg-[#12141A] text-white">
                  Cada {min} min
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Cálculo dinámico de hidratación */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-xl border border-[#1E2330] bg-[#12141A] px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              Agua restante
            </p>
            <p className="mt-0.5 text-sm sm:text-base font-extrabold font-mono tabular-nums text-sky-300">
              {plan.isGoalMet ? '0' : formatLiquid(plan.remainingMl, liquidUnit)}
            </p>
            <p className="text-[10px] text-zinc-500">
              {plan.isGoalMet
                ? 'Meta cubierta'
                : `~${plan.glassesRemaining} ${plan.glassesRemaining === 1 ? 'vaso' : 'vasos'}`}
            </p>
          </div>

          <div className="rounded-xl border border-[#1E2330] bg-[#12141A] px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              Tiempo activo
            </p>
            <p className="mt-0.5 text-sm sm:text-base font-extrabold font-mono tabular-nums text-white">
              {plan.isWithinActiveWindow
                ? formatActiveRemaining(plan.remainingActiveMinutes)
                : 'En pausa'}
            </p>
            <p className="text-[10px] text-zinc-500">Hasta {smartConfig.sleepTime}</p>
          </div>

          <div className="rounded-xl border border-[#1E2330] bg-[#12141A] px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              Siguiente vaso
            </p>
            <p className="mt-0.5 text-sm sm:text-base font-extrabold font-mono tabular-nums text-[#a3e635]">
              {plan.isGoalMet
                ? 'Listo'
                : !plan.isWithinActiveWindow
                  ? smartConfig.wakeTime
                  : `c/ ${plan.intervalMinutes} min`}
            </p>
            <p className="text-[10px] text-zinc-500">
              {plan.isGoalMet
                ? '100% hoy'
                : `${formatLiquid(plan.mlPerHourRequired, liquidUnit)}/h`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-2 border-t border-white/5">
          <span className="inline-flex items-center gap-1.5 text-zinc-300 font-medium">
            <Clock className="w-3.5 h-3.5 text-[#a3e635] shrink-0" />
            {plan.statusText}
          </span>

          {smartConfig.enabled && nextReminderTs !== null && (
            <span className="font-mono text-[11px] font-bold text-sky-300">
              Próximo aviso: {formatClockTime(nextReminderTs)}
              {minutesUntilNext !== null && minutesUntilNext > 0
                ? ` (en ${minutesUntilNext} min)`
                : ' (ahora)'}
            </span>
          )}
        </div>
      </div>

      {/* Switch 2: Alertas de sesiones de entrenamiento */}
      <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-4 space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#D4FF33]/12 border border-[#D4FF33]/30 flex items-center justify-center shrink-0">
              <Dumbbell className="w-4 h-4 text-[#D4FF33]" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">
                Alertas de sesiones de entrenamiento
              </p>
              <p className="text-[11px] text-zinc-400">
                {trainedToday
                  ? 'Ya entrenaste hoy: el aviso de hoy está silenciado automáticamente.'
                  : 'Recordatorio según tu horario y días activos del perfil si aún no entrenas.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={prefs.workoutEnabled}
            aria-label="Alertas de sesiones de entrenamiento"
            disabled={isBusy || !pushSupported}
            onClick={() =>
              void commitPreferences({ ...prefs, workoutEnabled: !prefs.workoutEnabled })
            }
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border transition-colors disabled:opacity-45 ${
              prefs.workoutEnabled
                ? 'border-[#D4FF33] bg-[#D4FF33]'
                : 'border-[#2E3444] bg-[#181B24]'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full transition-transform ${
                prefs.workoutEnabled
                  ? 'translate-x-6 bg-[#0A0B0D]'
                  : 'translate-x-1 bg-zinc-400'
              }`}
            />
          </button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <div className="space-y-1.5">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              Días activos
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {WEEKDAY_OPTIONS.map((opt) => {
                const active = prefs.workoutDays.includes(opt.day);
                return (
                  <button
                    key={opt.day}
                    type="button"
                    title={opt.name}
                    aria-label={opt.name}
                    aria-pressed={active}
                    onClick={() => toggleWorkoutDay(opt.day)}
                    className={`w-9 h-9 rounded-xl text-xs font-extrabold border transition-colors ${
                      active
                        ? 'border-[#D4FF33] bg-[#D4FF33]/18 text-[#D4FF33]'
                        : 'border-[#252A36] bg-[#12141A] text-zinc-400 hover:text-white'
                    }`}
                  >
                    {opt.short}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="rounded-xl border border-[#1E2330] bg-[#12141A] px-3 py-2 flex flex-col gap-1 sm:min-w-[140px]">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              Hora aviso
            </span>
            <input
              type="time"
              value={prefs.workoutTime}
              onChange={(e) => {
                if (!e.target.value) return;
                void commitPreferences({ ...prefs, workoutTime: e.target.value });
              }}
              className="bg-transparent text-sm font-mono font-bold text-white [color-scheme:dark] focus:outline-none"
            />
          </label>
        </div>
      </div>

      {/* Acciones: Activar Push, Probar Alerta Local, Enviar notificación de prueba, Desactivar notificaciones */}
      <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5">
        {!isSubscribed && (
          <button
            type="button"
            disabled={isBusy || !pushSupported}
            onClick={() => void handleActivatePushSubscription()}
            className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-[#D4FF33] disabled:opacity-50 px-4 text-xs sm:text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform"
          >
            {isBusy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Bell className="w-4 h-4" />
            )}
            Activar notificaciones Push
          </button>
        )}

        <button
          type="button"
          disabled={isTestingPush || isBusy || !pushSupported}
          onClick={() => void handleSendPushTest()}
          className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-2 rounded-2xl border border-sky-400/45 bg-sky-400/12 hover:bg-sky-400/20 disabled:opacity-50 px-4 text-xs sm:text-sm font-extrabold text-sky-300 active:scale-[0.98] transition-colors"
        >
          {isTestingPush ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          Enviar notificación de prueba
        </button>

        <button
          type="button"
          disabled={isTestingLocal}
          onClick={() => void handleSendLocalTest()}
          className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-2 rounded-2xl border border-[#2B3242] bg-[#161922] hover:border-[#a3e635]/50 disabled:opacity-50 px-4 text-xs sm:text-sm font-extrabold text-zinc-100 active:scale-[0.98] transition-colors"
        >
          {isTestingLocal ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Volume2 className="w-4 h-4 text-[#a3e635]" />
          )}
          Probar alerta local
        </button>

        {isSubscribed && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleUnsubscribe()}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-2xl border border-[#2B303C] bg-[#0D0F14] hover:border-rose-400/50 hover:text-rose-300 px-4 text-xs font-bold text-zinc-300 transition-colors shrink-0"
          >
            <BellOff className="w-4 h-4" />
            Desactivar notificaciones
          </button>
        )}
      </div>

      {feedback && (
        <p
          role="status"
          className={`rounded-2xl border px-3.5 py-2.5 text-xs font-semibold ${
            feedback.type === 'ok'
              ? 'border-[#D4FF33]/35 bg-[#D4FF33]/10 text-[#D4FF33]'
              : 'border-rose-400/35 bg-rose-500/10 text-rose-300'
          }`}
        >
          {feedback.message}
        </p>
      )}
    </section>
  );
};
