import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  Flame,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Zap,
} from 'lucide-react';
import {
  FASTING_PHASES,
  FASTING_PROTOCOLS,
  computeFastingStats,
  formatDurationHms,
  formatWindowClock,
  fromLocalDatetimeInputValue,
  getFastingPhase,
  toLocalDatetimeInputValue,
} from '../lib/fasting';
import { getTodayIsoDate } from '../lib/storage';
import type {
  ActiveFastState,
  FastingHistoryEntry,
  FastingProtocol,
} from '../types/fitness';

interface FastingSectionProps {
  activeFast: ActiveFastState | null;
  fastingHistory: FastingHistoryEntry[];
  remainingCalories: number;
  remainingProteinG: number;
  calorieTarget: number;
  proteinTargetG: number;
  onStartFast: (fast: ActiveFastState) => void;
  onUpdateActiveFast: (fast: ActiveFastState | null) => void;
  onCompleteFast: (entry: FastingHistoryEntry) => void;
  onFeedingWindowOpened: (entry: FastingHistoryEntry) => void;
}

export const FastingSection: React.FC<FastingSectionProps> = ({
  activeFast,
  fastingHistory,
  remainingCalories,
  remainingProteinG,
  calorieTarget,
  proteinTargetG,
  onStartFast,
  onUpdateActiveFast,
  onCompleteFast,
  onFeedingWindowOpened,
}) => {
  const [selectedProtocol, setSelectedProtocol] = useState<FastingProtocol>(
    activeFast?.protocol ?? '16:8',
  );
  const [customHours, setCustomHours] = useState<number>(
    activeFast?.protocol === 'custom' ? activeFast.targetHours : 14,
  );
  const [draftStartIso, setDraftStartIso] = useState<string>(() =>
    new Date().toISOString(),
  );
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Sync draft selector if activeFast changes
  useEffect(() => {
    if (activeFast) {
      setSelectedProtocol(activeFast.protocol);
      if (activeFast.protocol === 'custom') {
        setCustomHours(activeFast.targetHours);
      }
    }
  }, [activeFast]);

  // Live 1s timer tick when fasting
  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const targetHours = useMemo(() => {
    if (activeFast) return activeFast.targetHours;
    if (selectedProtocol === 'custom') return customHours;
    return (
      FASTING_PROTOCOLS.find((p) => p.id === selectedProtocol)?.fastHours ?? 16
    );
  }, [activeFast, selectedProtocol, customHours]);

  const effectiveStartMs = useMemo(() => {
    const iso = activeFast ? activeFast.startedAt : draftStartIso;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? nowMs : ms;
  }, [activeFast, draftStartIso, nowMs]);

  const targetDurationSec = targetHours * 3600;
  const elapsedSec = activeFast
    ? Math.max(0, Math.floor((nowMs - effectiveStartMs) / 1000))
    : 0;
  const elapsedHours = elapsedSec / 3600;
  const remainingSec = Math.max(0, targetDurationSec - elapsedSec);
  const extraSec = Math.max(0, elapsedSec - targetDurationSec);
  const goalReached = activeFast ? elapsedSec >= targetDurationSec : false;

  const progressPct = activeFast
    ? Math.min(100, Math.round((elapsedSec / Math.max(1, targetDurationSec)) * 100))
    : 0;

  const windowOpenMs = effectiveStartMs + targetHours * 3600 * 1000;
  const feedDurationHours = Math.max(1, 24 - targetHours);
  const windowCloseMs = windowOpenMs + feedDurationHours * 3600 * 1000;

  const currentPhase = getFastingPhase(elapsedHours);
  const stats = useMemo(
    () => computeFastingStats(fastingHistory, getTodayIsoDate()),
    [fastingHistory],
  );

  // Circular gauge SVG geometry
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (progressPct / 100) * circumference;

  const handleSelectProtocol = (protocol: FastingProtocol) => {
    setSelectedProtocol(protocol);
    const hours =
      protocol === 'custom'
        ? customHours
        : FASTING_PROTOCOLS.find((p) => p.id === protocol)?.fastHours ?? 16;
    if (activeFast) {
      onUpdateActiveFast({
        ...activeFast,
        protocol,
        targetHours: hours,
      });
    }
  };

  const handleCustomHoursChange = (nextHours: number) => {
    const clamped = Math.max(12, Math.min(56, nextHours));
    setCustomHours(clamped);
    if (activeFast && activeFast.protocol === 'custom') {
      onUpdateActiveFast({
        ...activeFast,
        targetHours: clamped,
      });
    }
  };

  const handleStartTimeInput = (localStr: string) => {
    const iso = fromLocalDatetimeInputValue(localStr);
    if (!iso) return;
    // Prevent future start times
    const parsedMs = Date.parse(iso);
    const safeIso =
      parsedMs > Date.now() ? new Date().toISOString() : iso;
    if (activeFast) {
      onUpdateActiveFast({
        ...activeFast,
        startedAt: safeIso,
      });
    } else {
      setDraftStartIso(safeIso);
    }
  };

  const handleShiftStartHours = (deltaHours: number) => {
    const baseMs = activeFast ? Date.parse(activeFast.startedAt) : Date.parse(draftStartIso);
    const nextMs = Math.min(Date.now(), (Number.isNaN(baseMs) ? Date.now() : baseMs) + deltaHours * 3600 * 1000);
    const nextIso = new Date(nextMs).toISOString();
    if (activeFast) {
      onUpdateActiveFast({ ...activeFast, startedAt: nextIso });
    } else {
      setDraftStartIso(nextIso);
    }
  };

  const handleSetStartNow = () => {
    const nowIso = new Date().toISOString();
    if (activeFast) {
      onUpdateActiveFast({ ...activeFast, startedAt: nowIso });
    } else {
      setDraftStartIso(nowIso);
    }
  };

  const handleStartFast = () => {
    const safeStart =
      Date.parse(draftStartIso) > Date.now()
        ? new Date().toISOString()
        : draftStartIso;
    onStartFast({
      id: `fast_${Date.now()}`,
      protocol: selectedProtocol,
      targetHours,
      startedAt: safeStart,
      waterGlassesCount: 0,
      electrolytesCount: 0,
    });
    setConfirmDiscard(false);
  };

  const handleCompleteFast = () => {
    if (!activeFast) return;
    const endedIso = new Date().toISOString();
    const actualHours =
      Math.round(((Date.now() - Date.parse(activeFast.startedAt)) / 3600000) * 10) /
      10;

    const entry: FastingHistoryEntry = {
      id: activeFast.id,
      date: getTodayIsoDate(),
      protocol: activeFast.protocol,
      targetHours: activeFast.targetHours,
      startedAt: activeFast.startedAt,
      endedAt: endedIso,
      actualHours: Math.max(0.1, actualHours),
      completedGoal: actualHours >= activeFast.targetHours,
      waterGlassesCount: activeFast.waterGlassesCount,
      electrolytesCount: activeFast.electrolytesCount,
    };

    onCompleteFast(entry);
    onFeedingWindowOpened(entry);
    setDraftStartIso(endedIso);
  };

  const handleAddElectrolyte = () => {
    if (!activeFast) return;
    onUpdateActiveFast({
      ...activeFast,
      electrolytesCount: activeFast.electrolytesCount + 1,
    });
  };

  const latestCompleted = fastingHistory[0] ?? null;

  return (
    <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-5">
      {/* Header + Live Status */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-[#D4FF33]" />
            <h2 className="text-2xl font-bold font-display text-white">
              Ayuno Intermitente y OMAD
            </h2>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Control de ventana alimentaria, fases metabólicas, electrolitos y racha diaria
          </p>
        </div>

        <div className="flex items-center gap-4 text-right">
          <div>
            <span className="text-[11px] text-zinc-400 block">Racha</span>
            <span className="text-base font-extrabold font-mono tabular-nums text-[#D4FF33]">
              {stats.currentStreakDays} {stats.currentStreakDays === 1 ? 'día' : 'días'}
            </span>
          </div>
          <div>
            <span className="text-[11px] text-zinc-400 block">Prom. 7 días</span>
            <span className="text-base font-extrabold font-mono tabular-nums text-white">
              {stats.weeklyAvgHours} h
            </span>
          </div>
        </div>
      </div>

      {/* Protocol Selector */}
      <div className="space-y-2.5">
        <span className="block text-xs font-semibold text-zinc-300">
          Protocolo de ayuno
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {FASTING_PROTOCOLS.map((proto) => {
            const active = selectedProtocol === proto.id;
            return (
              <button
                key={proto.id}
                type="button"
                onClick={() => handleSelectProtocol(proto.id)}
                className={`min-h-[52px] rounded-2xl px-3 py-2 text-left border transition-colors active:scale-[0.98] ${
                  active
                    ? 'border-[#D4FF33] bg-[#D4FF33]/15 text-white'
                    : 'border-[#252A36] bg-[#0D0F13] text-zinc-300 hover:border-zinc-600'
                }`}
              >
                <p className="text-sm font-extrabold font-mono">{proto.shortLabel}</p>
                <p className="text-[11px] text-zinc-400 truncate">{proto.desc}</p>
              </button>
            );
          })}
        </div>

        {selectedProtocol === 'custom' && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#252A36] bg-[#0D0F13] px-4 py-2.5">
            <span className="text-xs font-semibold text-zinc-300">
              Duración personalizada (12–56 h)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCustomHoursChange(customHours - 1)}
                className="min-h-[40px] min-w-[40px] rounded-xl bg-[#1A1E27] text-base font-bold text-white"
              >
                −
              </button>
              <span className="w-14 text-center font-mono font-extrabold text-[#D4FF33]">
                {customHours} h
              </span>
              <button
                type="button"
                onClick={() => handleCustomHoursChange(customHours + 1)}
                className="min-h-[40px] min-w-[40px] rounded-xl bg-[#1A1E27] text-base font-bold text-white"
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Split: Circular Timer + Start Time & Feeding Window */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-center">
        {/* 1. Circular Timer */}
        <div className="rounded-3xl border border-[#222631] bg-[#0D0F13] p-5 flex flex-col items-center justify-center gap-4">
          <div className="relative w-44 h-44 flex items-center justify-center">
            <svg className="w-44 h-44 -rotate-90" viewBox="0 0 152 152">
              <circle
                cx="76"
                cy="76"
                r={radius}
                fill="none"
                stroke="#1C2029"
                strokeWidth="12"
              />
              <circle
                cx="76"
                cy="76"
                r={radius}
                fill="none"
                stroke={goalReached ? '#34D399' : '#D4FF33'}
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className="transition-all duration-500"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                {activeFast
                  ? goalReached
                    ? 'Meta cumplida'
                    : 'Tiempo ayunado'
                  : `Meta ${targetHours}h`}
              </span>
              <span className="text-2xl font-extrabold font-mono tabular-nums text-white mt-0.5">
                {activeFast ? formatDurationHms(elapsedSec) : `${targetHours}:00:00`}
              </span>
              <span
                className={`text-xs font-mono font-bold mt-1 ${
                  goalReached ? 'text-emerald-400' : 'text-[#D4FF33]'
                }`}
              >
                {activeFast
                  ? goalReached
                    ? `+${formatDurationHms(extraSec)} extra`
                    : `Falta ${formatDurationHms(remainingSec)}`
                  : `${progressPct}% · Listo`}
              </span>
            </div>
          </div>

          <div className="w-full grid grid-cols-2 gap-2.5 text-center border-t border-white/5 pt-3">
            <div>
              <span className="text-[11px] text-zinc-400 block">
                Abre ventana comida
              </span>
              <span className="text-xs font-bold font-mono text-[#D4FF33]">
                {formatWindowClock(windowOpenMs)}
              </span>
            </div>
            <div>
              <span className="text-[11px] text-zinc-400 block">
                Cierra ventana ({feedDurationHours}h)
              </span>
              <span className="text-xs font-bold font-mono text-zinc-200">
                {formatWindowClock(windowCloseMs)}
              </span>
            </div>
          </div>

          {/* Primary Start / Finish CTA */}
          {!activeFast ? (
            <button
              type="button"
              onClick={handleStartFast}
              className="w-full min-h-[52px] flex items-center justify-center gap-2 rounded-2xl bg-[#D4FF33] px-5 text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform"
            >
              <Play className="w-4 h-4 fill-current" />
              Empezar ayuno ({targetHours}h)
            </button>
          ) : (
            <div className="w-full space-y-2">
              <button
                type="button"
                onClick={handleCompleteFast}
                className={`w-full min-h-[52px] flex items-center justify-center gap-2 rounded-2xl px-5 text-sm font-extrabold active:scale-[0.98] transition-transform ${
                  goalReached
                    ? 'bg-emerald-400 text-[#0A0B0D]'
                    : 'bg-white text-[#0A0B0D]'
                }`}
              >
                <Square className="w-4 h-4 fill-current" />
                Terminar ayuno y abrir ventana
              </button>

              {!confirmDiscard ? (
                <button
                  type="button"
                  onClick={() => setConfirmDiscard(true)}
                  className="w-full min-h-[40px] text-xs font-semibold text-zinc-400 hover:text-rose-400"
                >
                  Descartar ayuno actual
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDiscard(false)}
                    className="flex-1 min-h-[40px] rounded-xl bg-[#1B1F29] text-xs font-semibold text-zinc-200"
                  >
                    Seguir ayunando
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateActiveFast(null);
                      setConfirmDiscard(false);
                    }}
                    className="flex-1 min-h-[40px] rounded-xl bg-rose-600 text-xs font-bold text-white"
                  >
                    Confirmar descarte
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Start Time Editor + Hydration/Electrolytes during fast */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#222631] bg-[#0D0F13] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-[#D4FF33]" />
                Hora real de inicio del ayuno
              </span>
              <button
                type="button"
                onClick={handleSetStartNow}
                className="text-xs font-bold text-[#D4FF33] hover:underline"
              >
                Poner ahora
              </button>
            </div>

            <input
              type="datetime-local"
              value={toLocalDatetimeInputValue(effectiveStartMs)}
              max={toLocalDatetimeInputValue(nowMs)}
              onChange={(e) => handleStartTimeInput(e.target.value)}
              aria-label="Fecha y hora de inicio del ayuno"
              className="w-full min-h-[46px] rounded-xl border border-[#2A2F3D] bg-[#12141A] px-3.5 text-sm font-mono text-white focus:border-[#D4FF33] focus:outline-none"
            />

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleShiftStartHours(-2)}
                className="min-h-[40px] rounded-xl border border-[#262B37] bg-[#151821] text-xs font-bold text-zinc-200 hover:border-[#D4FF33]/50"
              >
                −2 horas
              </button>
              <button
                type="button"
                onClick={() => handleShiftStartHours(-1)}
                className="min-h-[40px] rounded-xl border border-[#262B37] bg-[#151821] text-xs font-bold text-zinc-200 hover:border-[#D4FF33]/50"
              >
                −1 hora
              </button>
              <button
                type="button"
                onClick={() => handleShiftStartHours(1)}
                className="min-h-[40px] rounded-xl border border-[#262B37] bg-[#151821] text-xs font-bold text-zinc-200 hover:border-[#D4FF33]/50"
              >
                +1 hora
              </button>
            </div>
          </div>

          {/* Electrolytes Quick Counter */}
          <div className="rounded-2xl border border-[#222631] bg-[#0D0F13] p-4 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-white">
                Soporte durante el ayuno (0 kcal)
              </h3>
              <p className="text-xs text-zinc-400">
                Registra tomas de electrolitos sin romper el ayuno (registra tu agua en la pestaña Hidratación)
              </p>
            </div>

            <div className="rounded-2xl border border-[#222631] bg-[#12141A] p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5" />
                  Electrolitos
                </span>
                <span className="text-sm font-extrabold font-mono text-white">
                  {activeFast?.electrolytesCount ?? 0} tomas
                </span>
              </div>
              <button
                type="button"
                onClick={handleAddElectrolyte}
                disabled={!activeFast}
                className="min-h-[42px] px-4 rounded-xl bg-amber-400/15 hover:bg-amber-400/25 disabled:opacity-40 border border-amber-400/30 text-xs font-extrabold text-amber-300 active:scale-[0.98]"
              >
                +1 electrolito
              </button>
            </div>
          </div>

          {/* Feeding Window Macro Sync Reminder */}
          {!activeFast && (
            <div className="rounded-2xl border border-[#222631] bg-[#0D0F13] p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#D4FF33]">
                  Meta restante en tu ventana de hoy
                </p>
                <p className="text-xs font-mono text-zinc-300 mt-0.5">
                  {Math.max(0, remainingCalories)} / {calorieTarget} kcal · Proteína{' '}
                  {Math.max(0, remainingProteinG)} / {proteinTargetG} g
                </p>
              </div>
              <CheckCircle2 className="w-5 h-5 text-[#D4FF33] shrink-0" />
            </div>
          )}
        </div>
      </div>

      {/* 2. Indicador de Fases Metabólicas del Ayuno (0–56 h) */}
      <div className="space-y-3 pt-2 border-t border-white/5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#D4FF33]" />
            <h3 className="text-base font-bold text-white">
              Fases metabólicas del ayuno
            </h3>
          </div>
          <span
            className={`text-xs font-bold font-mono tabular-nums ${
              activeFast ? 'text-[#D4FF33]' : 'text-zinc-400'
            }`}
          >
            {activeFast
              ? `Fase activa: ${currentPhase.title} (${elapsedHours.toFixed(1)} h)`
              : 'Inicia el ayuno para seguir tu fase en vivo'}
          </span>
        </div>

        <div className="flex overflow-x-auto snap-x snap-mandatory gap-2.5 pb-2 scroll-smooth">
          {FASTING_PHASES.map((phase) => {
            const isCurrent = Boolean(activeFast && currentPhase.id === phase.id);
            const isPassed = Boolean(
              activeFast && !isCurrent && elapsedHours >= phase.maxHours,
            );
            return (
              <div
                key={phase.id}
                className={`shrink-0 w-[212px] sm:w-[224px] snap-start rounded-2xl border p-3.5 space-y-1.5 transition-colors ${
                  isCurrent
                    ? 'border-[#D4FF33] ring-1 ring-[#D4FF33]/40 bg-[#171B24] shadow-[0_0_16px_rgba(212,255,51,0.12)]'
                    : isPassed
                      ? 'border-emerald-500/30 bg-[#0E1312]'
                      : 'border-[#20242E] bg-[#0D0F13]'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`text-[11px] font-mono tabular-nums font-extrabold ${
                      isCurrent
                        ? 'text-[#D4FF33]'
                        : isPassed
                          ? 'text-emerald-400'
                          : 'text-zinc-400'
                    }`}
                  >
                    {phase.rangeLabel}
                  </span>
                  {isCurrent && (
                    <span className="text-[10px] font-extrabold uppercase text-[#D4FF33]">
                      En curso
                    </span>
                  )}
                  {isPassed && (
                    <span className="text-[10px] font-bold text-emerald-400">
                      Lista
                    </span>
                  )}
                </div>
                <p className="text-xs font-bold text-white">{phase.title}</p>
                <p className="text-[11px] text-zinc-400 leading-snug">
                  {phase.summary}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Calendario de Racha (14 días) y Historial Reciente */}
      <div className="space-y-3 pt-2 border-t border-white/5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#D4FF33]" />
            <h3 className="text-base font-bold text-white">
              Calendario de ayunos (últimos 14 días)
            </h3>
          </div>
          <span className="text-xs font-mono text-zinc-400">
            Cumplidos esta semana: {stats.weeklyCompletedCount} · Total metas:{' '}
            <strong className="text-white">{stats.totalCompletedGoals}</strong>
          </span>
        </div>

        <div className="grid grid-cols-7 gap-2">
          {stats.calendarDays.map((day) => {
            const boxStyle =
              day.status === 'goal_met'
                ? 'border-[#D4FF33]/70 bg-[#D4FF33]/18 text-[#D4FF33]'
                : day.status === 'partial'
                  ? 'border-amber-400/50 bg-amber-400/12 text-amber-300'
                  : 'border-[#20242E] bg-[#0D0F13] text-zinc-500';
            return (
              <div
                key={day.date}
                title={`${day.date}${day.hours > 0 ? `: ${day.hours}h` : ''}`}
                className={`rounded-xl border p-2 text-center ${boxStyle} ${
                  day.isToday ? 'ring-1 ring-white/50' : ''
                }`}
              >
                <span className="block text-[9px] font-bold opacity-80">
                  {day.weekdayShort}
                </span>
                <span className="block text-sm font-extrabold font-mono text-white mt-0.5">
                  {day.dayNumber}
                </span>
                <span className="block text-[10px] font-mono mt-0.5">
                  {day.hours > 0 ? `${day.hours}h` : '—'}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-[#D4FF33]">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#D4FF33] inline-block" />
              Meta cumplida
            </span>
            <span className="flex items-center gap-1.5 text-amber-300">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />
              Ayuno parcial
            </span>
          </div>
          {latestCompleted && (
            <span className="font-mono text-zinc-300 flex items-center gap-1">
              <RotateCcw className="w-3 h-3 text-[#D4FF33]" />
              Último: {latestCompleted.actualHours}h ({latestCompleted.date})
            </span>
          )}
        </div>
      </div>
    </section>
  );
};
