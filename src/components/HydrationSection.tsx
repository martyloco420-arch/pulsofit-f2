import React, { useMemo, useState } from 'react';
import {
  Bell,
  BellOff,
  Check,
  Clock,
  Droplets,
  Dumbbell,
  Plus,
  Sun,
  Undo2,
} from 'lucide-react';
import {
  HYDRATION_CONTAINERS,
  buildHydrationSchedule,
  computeHydrationGoal,
  dispatchLocalHydrationNotification,
  getContainerMeta,
  hourToTimeString,
  loadSmartHydrationReminderConfig,
  saveSmartHydrationReminderConfig,
  setNextHydrationReminderTimestamp,
} from '../lib/hydration';
import { notifyPushActivity } from '../lib/pushNotifications';
import {
  formatContainerLabel,
  formatLiquid,
  formatLiquidPrimary,
  formatWeight,
  getLiquidUnit,
  getWeightUnit,
  ozToMl,
} from '../lib/units';
import type {
  BodyCompositionScan,
  BodyWeightEntry,
  CardioSession,
  HiitSession,
  HydrationContainerMl,
  HydrationLogEntry,
  HydrationSettings,
  UserProfile,
  WorkoutSession,
} from '../types/fitness';

interface HydrationSectionProps {
  profile: UserProfile;
  bodyWeights: BodyWeightEntry[];
  bodyScans: BodyCompositionScan[];
  workouts: WorkoutSession[];
  cardioSessions?: CardioSession[];
  hiitSessions?: HiitSession[];
  selectedDate: string;
  waterMl: number;
  dayLogs: HydrationLogEntry[];
  settings: HydrationSettings;
  onAddWater: (date: string, deltaMl: number) => void;
  onUndoLastWater: (date: string) => void;
  onUpdateSettings: (next: HydrationSettings) => void;
}

export const HydrationSection: React.FC<HydrationSectionProps> = ({
  profile,
  bodyWeights,
  bodyScans,
  workouts,
  cardioSessions = [],
  hiitSessions = [],
  selectedDate,
  waterMl,
  dayLogs,
  settings,
  onAddWater,
  onUndoLastWater,
  onUpdateSettings,
}) => {
  const liquidUnit = getLiquidUnit(profile.liquidUnit);
  const weightUnit = getWeightUnit(profile.weightUnit);
  const [manualAmountInput, setManualAmountInput] = useState('');
  const [notifFeedback, setNotifFeedback] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'default',
  );

  const goal = useMemo(
    () =>
      computeHydrationGoal(
        profile,
        bodyWeights,
        bodyScans,
        workouts,
        settings,
        selectedDate,
        cardioSessions,
        hiitSessions,
      ),
    [profile, bodyWeights, bodyScans, workouts, cardioSessions, hiitSessions, settings, selectedDate],
  );

  const schedule = useMemo(
    () =>
      buildHydrationSchedule(
        goal.totalTargetMl,
        settings.containerMl,
        settings.wakeHour,
        settings.sleepHour,
        waterMl,
        liquidUnit,
      ),
    [
      goal.totalTargetMl,
      settings.containerMl,
      settings.wakeHour,
      settings.sleepHour,
      waterMl,
      liquidUnit,
    ],
  );

  const pct = Math.min(
    100,
    Math.round((waterMl / Math.max(1, goal.totalTargetMl)) * 100),
  );
  const remainingMl = Math.max(0, goal.totalTargetMl - waterMl);
  const lastLog = dayLogs[dayLogs.length - 1] ?? null;

  const handleToggleHotDay = () => {
    const nextHot = !goal.isHotDay;
    onUpdateSettings({
      ...settings,
      hotDayByDate: {
        ...settings.hotDayByDate,
        [selectedDate]: nextHot,
      },
    });
  };

  const handleToggleReminders = async () => {
    setNotifFeedback(null);
    const currentSmart = loadSmartHydrationReminderConfig(settings);
    if (settings.remindersEnabled) {
      saveSmartHydrationReminderConfig({ ...currentSmart, enabled: false });
      setNextHydrationReminderTimestamp(null);
      onUpdateSettings({ ...settings, remindersEnabled: false });
      return;
    }

    let perm: NotificationPermission = 'default';
    if (typeof window !== 'undefined' && 'Notification' in window) {
      perm = Notification.permission;
      if (perm === 'default') {
        perm = await Notification.requestPermission();
      }
      setPermissionState(perm);
    }

    saveSmartHydrationReminderConfig({ ...currentSmart, enabled: true });
    onUpdateSettings({ ...settings, remindersEnabled: true });
    if (perm === 'granted') {
      setNotifFeedback(
        `Recordatorios activos cada ${schedule.intervalHours} h (${schedule.totalIntakes} tomas/día).`,
      );
    } else {
      setNotifFeedback(
        'Recordatorios activos con alerta visual y sonora en la app.',
      );
    }
  };

  const handleTestNotification = async () => {
    const meta = getContainerMeta(settings.containerMl);
    const res = await dispatchLocalHydrationNotification(
      'PulsoFit · Recordatorio de agua',
      `Toma programada: 1 ${meta.singularNoun} (${settings.containerMl} ml). ¡Sigue con tu meta!`,
    );
    if (res.ok) {
      setNotifFeedback('Notificación de prueba enviada al dispositivo.');
    } else {
      setNotifFeedback('No se pudo mostrar la notificación; revisa permisos.');
    }
  };

  const handleLogWater = (deltaMl: number) => {
    onAddWater(selectedDate, deltaMl);
    if (deltaMl > 0) {
      void notifyPushActivity('water', selectedDate);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(manualAmountInput.replace(',', '.').trim());
    if (Number.isNaN(parsed) || parsed <= 0) return;
    const mlToAdd = liquidUnit === 'oz' ? ozToMl(parsed) : Math.round(parsed);
    if (mlToAdd <= 0 || mlToAdd > 5000) return;
    handleLogWater(mlToAdd);
    setManualAmountInput('');
  };

  // Liquid ring geometry
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (pct / 100) * circumference;

  return (
    <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-5">
      {/* Header + Progress Ring */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="relative w-32 h-32 shrink-0 flex items-center justify-center">
            <svg className="w-32 h-32 -rotate-90" viewBox="0 0 124 124">
              <circle
                cx="62"
                cy="62"
                r={radius}
                fill="none"
                stroke="#1A222E"
                strokeWidth="11"
              />
              <circle
                cx="62"
                cy="62"
                r={radius}
                fill="none"
                stroke={pct >= 100 ? '#D4FF33' : '#38BDF8'}
                strokeWidth="11"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className="transition-all duration-300"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-xl font-extrabold font-mono tabular-nums text-white">
                {pct}%
              </span>
              <span className="text-[11px] font-mono text-sky-300">
                {formatLiquidPrimary(waterMl, liquidUnit)}
              </span>
            </div>
          </div>

          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <Droplets className="w-5 h-5 text-sky-400 shrink-0" />
              <h2 className="text-2xl font-bold font-display text-white">
                Calculadora y Tracker de Hidratación
              </h2>
            </div>
            <p className="text-sm font-mono tabular-nums text-zinc-200">
              <strong className="text-sky-300">{formatLiquid(waterMl, liquidUnit)}</strong>{' '}
              / {formatLiquid(goal.totalTargetMl, liquidUnit)} ·{' '}
              <span className="text-zinc-400">
                {remainingMl > 0
                  ? `Faltan ${formatLiquid(remainingMl, liquidUnit)}`
                  : '¡Meta hidratada!'}
              </span>
            </p>
            <p className="text-xs font-bold text-[#D4FF33]">
              Tomas completadas hoy: {schedule.completedIntakes} de {schedule.totalIntakes} tomas
            </p>
          </div>
        </div>

        {/* Reminders Toggle */}
        <div className="flex flex-col sm:items-end gap-2 shrink-0">
          <button
            type="button"
            onClick={handleToggleReminders}
            aria-pressed={settings.remindersEnabled}
            className={`min-h-[46px] inline-flex items-center justify-center gap-2 rounded-2xl px-4 text-xs font-extrabold border transition-colors ${
              settings.remindersEnabled
                ? 'border-sky-400 bg-sky-400/15 text-sky-300'
                : 'border-[#2B303C] bg-[#0D0F13] text-zinc-300 hover:text-white'
            }`}
          >
            {settings.remindersEnabled ? (
              <Bell className="w-4 h-4 text-sky-300" />
            ) : (
              <BellOff className="w-4 h-4 text-zinc-400" />
            )}
            Recordatorios de agua: {settings.remindersEnabled ? 'ON' : 'OFF'}
          </button>

          {settings.remindersEnabled && permissionState === 'granted' && (
            <button
              type="button"
              onClick={handleTestNotification}
              className="text-[11px] font-bold text-sky-300 hover:underline"
            >
              Probar alerta ahora
            </button>
          )}
        </div>
      </div>

      {notifFeedback && (
        <p role="status" className="text-xs font-semibold text-sky-300">
          {notifFeedback}
        </p>
      )}

      {/* 1. Automatic Daily Target Breakdown */}
      <div className="rounded-2xl border border-[#222631] bg-[#0D0F13] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold text-white">
              Meta diaria automática:{' '}
              <span className="font-mono text-sky-300">
                {formatLiquidPrimary(goal.totalTargetMl, liquidUnit)} ({formatLiquid(goal.totalTargetMl, liquidUnit)})
              </span>
            </p>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              {formatWeight(goal.weightKg, weightUnit)} ({goal.weightSource}) × {goal.mlPerKg} ml/kg = {formatLiquid(goal.baseMl, liquidUnit)}
              {goal.workoutBonusMl > 0
                ? ` + ${formatLiquid(goal.workoutBonusMl, liquidUnit)} actividad (${[
                    goal.exerciseMinutesOnDate > 0 ? `${goal.exerciseMinutesOnDate} min` : null,
                    goal.exerciseKcalOnDate > 0 ? `${goal.exerciseKcalOnDate} kcal` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')})`
                : ''}
              {goal.hotDayBonusMl > 0 ? ` + ${formatLiquid(goal.hotDayBonusMl, liquidUnit)} calor` : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={handleToggleHotDay}
            aria-pressed={goal.isHotDay}
            className={`min-h-[42px] inline-flex items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold border transition-colors ${
              goal.isHotDay
                ? 'border-amber-400 bg-amber-400/15 text-amber-300'
                : 'border-[#2A2F3D] bg-[#141720] text-zinc-300 hover:text-white'
            }`}
          >
            <Sun className="w-4 h-4" />
            Día caluroso (+{formatLiquid(500, liquidUnit)})
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {/* ml/kg Adjuster (30 - 40 ml/kg) */}
          <div className="rounded-xl border border-[#1E222C] bg-[#12141A] p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-300 font-semibold">Factor por actividad</span>
              <span className="font-mono font-bold text-[#D4FF33]">
                {settings.mlPerKg} ml/kg
              </span>
            </div>
            <input
              type="range"
              min={30}
              max={40}
              step={1}
              value={settings.mlPerKg}
              onChange={(e) =>
                onUpdateSettings({ ...settings, mlPerKg: Number(e.target.value) })
              }
              aria-label="Factor de hidratación en ml por kg"
              className="w-full accent-[#D4FF33]"
            />
            <div className="flex justify-between text-[10px] font-mono text-zinc-500">
              <span>30 ml/kg (ligero)</span>
              <span>35 (estándar)</span>
              <span>40 (intenso)</span>
            </div>
          </div>

          {/* Automatic Workout & GPS Walk Bonus Indicator */}
          <div className="rounded-xl border border-[#1E222C] bg-[#12141A] p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Dumbbell
                className={`w-4 h-4 shrink-0 ${
                  goal.workoutBonusMl > 0 ? 'text-[#D4FF33]' : 'text-zinc-500'
                }`}
              />
              <div>
                <p className="text-xs font-bold text-white">Bono por rutina y caminata</p>
                <p className="text-[11px] text-zinc-400">
                  {goal.workoutBonusMl > 0
                    ? `Actividad hoy (${[
                        goal.exerciseMinutesOnDate > 0 ? `${goal.exerciseMinutesOnDate} min` : null,
                        goal.exerciseKcalOnDate > 0 ? `${goal.exerciseKcalOnDate} kcal` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}): +${formatLiquid(goal.workoutBonusMl, liquidUnit)} añadidos`
                    : `Suma agua automática al registrar rutinas o caminatas GPS hoy`}
                </p>
              </div>
            </div>
            <span
              className={`text-xs font-mono font-extrabold ${
                goal.workoutBonusMl > 0 ? 'text-[#D4FF33]' : 'text-zinc-500'
              }`}
            >
              +{formatLiquid(goal.workoutBonusMl, liquidUnit)}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Quick One-Tap Register Buttons + Undo */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-zinc-300">
            Registro rápido de un toque
          </span>
          <button
            type="button"
            onClick={() => onUndoLastWater(selectedDate)}
            disabled={waterMl <= 0}
            className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-[#2B303C] bg-[#171A23] disabled:opacity-40 px-3 text-xs font-bold text-zinc-200 hover:text-white active:scale-[0.98]"
          >
            <Undo2 className="w-3.5 h-3.5 text-sky-300" />
            Deshacer último{lastLog ? ` (−${formatLiquid(lastLog.amountMl, liquidUnit)})` : ''}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            { ml: 250, sub: '1 vaso' },
            { ml: 500, sub: '1 botella' },
            { ml: 750, sub: '1 termo M' },
            { ml: 1000, sub: '1 termo G' },
          ].map((btn) => (
            <button
              key={btn.ml}
              type="button"
              onClick={() => handleLogWater(btn.ml)}
              className="min-h-[54px] rounded-2xl bg-[#192230] hover:bg-[#222E40] border border-sky-400/30 px-3 py-2 text-center active:scale-[0.98] transition-transform"
            >
              <span className="block text-sm font-extrabold font-mono text-sky-300">
                +{formatLiquid(btn.ml, liquidUnit)}
              </span>
              <span className="block text-[10px] text-zinc-400">{btn.sub}</span>
            </button>
          ))}
        </div>

        {/* Manual Quantity Entry */}
        <form onSubmit={handleManualSubmit} className="flex items-center gap-2 pt-0.5">
          <input
            type="text"
            inputMode="decimal"
            value={manualAmountInput}
            onChange={(e) => setManualAmountInput(e.target.value)}
            placeholder={
              liquidUnit === 'oz'
                ? 'Cantidad manual (ej. 12 oz)'
                : 'Cantidad manual (ej. 350 ml)'
            }
            aria-label={`Cantidad manual de agua en ${liquidUnit}`}
            className="flex-1 min-h-[44px] rounded-2xl border border-[#262C3A] bg-[#0B0D12] px-3.5 text-xs sm:text-sm font-mono text-white placeholder:text-zinc-500 focus:border-sky-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!manualAmountInput.trim()}
            className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-2xl bg-sky-400 hover:bg-sky-300 disabled:opacity-40 px-4 text-xs sm:text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform shrink-0"
          >
            <Plus className="w-4 h-4" />
            Agregar {liquidUnit}
          </button>
        </form>
      </div>

      {/* 2. Intake Planner ("Cuántas veces y cada cuánto") */}
      <div className="rounded-2xl border border-[#222631] bg-[#0D0F13] p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white">
              Planificador de tomas («cuántas veces y cada cuánto»)
            </h3>
            <p className="text-xs font-bold text-sky-300 mt-0.5">
              Plan diario: {schedule.summaryText}
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <Clock className="w-3.5 h-3.5 text-zinc-400" />
            <label className="text-zinc-400">
              Despierto:
              <select
                value={settings.wakeHour}
                onChange={(e) => {
                  const wakeHour = Number(e.target.value);
                  const cur = loadSmartHydrationReminderConfig(settings);
                  saveSmartHydrationReminderConfig({
                    ...cur,
                    wakeTime: hourToTimeString(wakeHour, cur.wakeTime),
                  });
                  onUpdateSettings({ ...settings, wakeHour });
                }}
                className="ml-1 rounded-lg bg-[#161922] border border-[#2A2F3D] px-1.5 py-1 text-white font-mono"
              >
                {[5, 6, 7, 8, 9, 10].map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="text-zinc-400">
              Dormir:
              <select
                value={settings.sleepHour}
                onChange={(e) => {
                  const sleepHour = Number(e.target.value);
                  const cur = loadSmartHydrationReminderConfig(settings);
                  saveSmartHydrationReminderConfig({
                    ...cur,
                    sleepTime: hourToTimeString(sleepHour, cur.sleepTime),
                  });
                  onUpdateSettings({ ...settings, sleepHour });
                }}
                className="ml-1 rounded-lg bg-[#161922] border border-[#2A2F3D] px-1.5 py-1 text-white font-mono"
              >
                {[20, 21, 22, 23].map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* Container Selector */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {HYDRATION_CONTAINERS.map((c) => {
            const active = settings.containerMl === c.ml;
            return (
              <button
                key={c.ml}
                type="button"
                onClick={() =>
                  onUpdateSettings({
                    ...settings,
                    containerMl: c.ml as HydrationContainerMl,
                  })
                }
                className={`min-h-[44px] rounded-xl px-3 text-xs font-bold border transition-colors ${
                  active
                    ? 'border-[#D4FF33] bg-[#D4FF33]/15 text-[#D4FF33]'
                    : 'border-[#252A36] bg-[#12141A] text-zinc-300 hover:text-white'
                }`}
              >
                {formatContainerLabel(c.ml, liquidUnit)}
              </button>
            );
          })}
        </div>

        {/* Visual Checklist of Scheduled Intakes */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {schedule.items.map((item) => (
            <button
              key={item.index}
              type="button"
              onClick={() => {
                if (!item.completed) {
                  handleLogWater(item.amountMl);
                }
              }}
              className={`min-h-[58px] rounded-2xl border p-3 text-left flex items-center justify-between gap-2 transition-colors ${
                item.completed
                  ? 'border-sky-400/50 bg-sky-400/12 text-white'
                  : 'border-[#222631] bg-[#12141A] hover:border-sky-400/40 text-zinc-300 active:scale-[0.98]'
              }`}
            >
              <div className="min-w-0">
                <p className="text-xs font-extrabold truncate">{item.label}</p>
                <p className="text-[11px] font-mono text-zinc-400">
                  {item.recommendedTime} · {formatLiquid(item.amountMl, liquidUnit)}
                </p>
              </div>
              <div
                className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                  item.completed
                    ? 'bg-sky-400 text-[#0A0B0D]'
                    : 'border border-zinc-600'
                }`}
              >
                {item.completed && <Check className="w-3.5 h-3.5 stroke-[3]" />}
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
