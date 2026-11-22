import React, { useEffect, useState } from 'react';
import {
  BriefcaseMedical,
  CheckCircle2,
  Droplets,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Timer,
  Zap,
} from 'lucide-react';
import { formatLiquid } from '../lib/units';
import type { LiquidUnit } from '../types/fitness';

interface ShiftModePauseCardProps {
  todayIso: string;
  liquidUnit: LiquidUnit;
  todayWaterMl: number;
  electrolytesToday: number;
  pausaActivaCountToday: number;
  onAddElectrolytesAndWater: (dateIso: string) => void;
  onCompleteActivePause: (dateIso: string, minutesEarned: number) => void;
}

const PAUSE_TOTAL_SEC = 5 * 60; // 300s

const PAUSE_EXERCISES = [
  {
    step: 1,
    title: 'Sentadillas al aire',
    subtitle: 'Activa cuádriceps, glúteos y circulación general (ritmo cómodo)',
    startRemSec: 300,
    endRemSec: 200,
  },
  {
    step: 2,
    title: 'Movilidad torácica y espalda',
    subtitle: 'Rotaciones suaves de torso y aperturas de pecho sin equipo',
    startRemSec: 200,
    endRemSec: 100,
  },
  {
    step: 3,
    title: 'Elevación de talones',
    subtitle: 'Sube y baja controlado para activar pantorrillas y retorno venoso',
    startRemSec: 100,
    endRemSec: 0,
  },
] as const;

function formatMmSs(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const ShiftModePauseCard: React.FC<ShiftModePauseCardProps> = ({
  todayIso,
  liquidUnit,
  todayWaterMl,
  electrolytesToday,
  pausaActivaCountToday,
  onAddElectrolytesAndWater,
  onCompleteActivePause,
}) => {
  const [timerOpen, setTimerOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [remainingSec, setRemainingSec] = useState(PAUSE_TOTAL_SEC);
  const [waterFlash, setWaterFlash] = useState(false);
  const [pauseCompletedBanner, setPauseCompletedBanner] = useState(false);

  useEffect(() => {
    if (!isRunning) return undefined;
    const id = window.setInterval(() => {
      setRemainingSec((prev) => {
        if (prev <= 1) {
          window.clearInterval(id);
          setIsRunning(false);
          onCompleteActivePause(todayIso, 5);
          setPauseCompletedBanner(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [isRunning, onCompleteActivePause, todayIso]);

  const currentExercise =
    PAUSE_EXERCISES.find(
      (ex) => remainingSec <= ex.startRemSec && remainingSec > ex.endRemSec,
    ) ?? PAUSE_EXERCISES[PAUSE_EXERCISES.length - 1];

  const elapsedSec = PAUSE_TOTAL_SEC - remainingSec;
  const progressPct = Math.min(100, Math.round((elapsedSec / PAUSE_TOTAL_SEC) * 100));

  const handleElectrolytesTap = () => {
    onAddElectrolytesAndWater(todayIso);
    setWaterFlash(true);
    window.setTimeout(() => setWaterFlash(false), 1800);
  };

  const handleStartPauseTimer = () => {
    setTimerOpen(true);
    setPauseCompletedBanner(false);
    if (remainingSec === 0) {
      setRemainingSec(PAUSE_TOTAL_SEC);
    }
    setIsRunning(true);
  };

  const handleResetTimer = () => {
    setIsRunning(false);
    setRemainingSec(PAUSE_TOTAL_SEC);
    setPauseCompletedBanner(false);
  };

  const handleFinishEarly = () => {
    setIsRunning(false);
    setRemainingSec(0);
    onCompleteActivePause(todayIso, 5);
    setPauseCompletedBanner(true);
  };

  return (
    <section
      aria-label="Modo Turno y Pausa Activa"
      className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-2xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-300 shrink-0">
            <BriefcaseMedical className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-extrabold font-display text-white">
              Modo Turno / Pausa Activa
            </h2>
            <p className="text-[11px] text-zinc-400">
              Acciones de 1 toque para jornadas pesadas: hidrata con electrolitos y blinda tu racha
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono">
          {electrolytesToday > 0 && (
            <span className="rounded-lg border border-sky-400/35 bg-sky-400/12 px-2 py-1 text-sky-300 font-bold">
              ⚡ {electrolytesToday} elect.
            </span>
          )}
          {pausaActivaCountToday > 0 && (
            <span className="rounded-lg border border-emerald-400/35 bg-emerald-400/12 px-2 py-1 text-emerald-300 font-bold inline-flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              Racha protegida
            </span>
          )}
        </div>
      </div>

      {/* 2 One-Tap Action Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={handleElectrolytesTap}
          className={`min-h-[58px] rounded-2xl border p-3.5 text-left flex items-center justify-between gap-3 transition-all active:scale-[0.98] ${
            waterFlash
              ? 'border-sky-400 bg-sky-400/20'
              : 'border-sky-400/35 bg-[#0D131D] hover:border-sky-400/60'
          }`}
        >
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-extrabold text-sky-300 flex items-center gap-1.5">
              <Zap className="w-4 h-4 shrink-0" />
              Electrolitos + Hidratación (+{formatLiquid(500, liquidUnit)})
            </p>
            <p className="text-[11px] text-zinc-400 mt-0.5 font-mono">
              Hoy: {formatLiquid(todayWaterMl, liquidUnit)} · {electrolytesToday} tomas elect.
            </p>
          </div>
          <Droplets className="w-5 h-5 text-sky-400 shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => {
            if (!timerOpen) handleStartPauseTimer();
            else setIsRunning((r) => !r);
          }}
          className={`min-h-[58px] rounded-2xl border p-3.5 text-left flex items-center justify-between gap-3 transition-all active:scale-[0.98] ${
            pausaActivaCountToday > 0
              ? 'border-emerald-400/45 bg-emerald-500/10'
              : 'border-[#D4FF33]/40 bg-[#141910] hover:border-[#D4FF33]'
          }`}
        >
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-extrabold text-[#D4FF33] flex items-center gap-1.5">
              <Timer className="w-4 h-4 shrink-0" />
              Pausa Activa (5 min)
            </p>
            <p className="text-[11px] text-zinc-300 mt-0.5">
              {timerOpen
                ? `En curso: ${formatMmSs(remainingSec)} · Paso ${currentExercise.step}/3`
                : pausaActivaCountToday > 0
                  ? `${pausaActivaCountToday} completada hoy (+5 min activos)`
                  : '3 ejercicios sin equipo · Suma +5 min y protege racha'}
            </p>
          </div>
          {isRunning ? (
            <Pause className="w-5 h-5 text-[#D4FF33] shrink-0" />
          ) : (
            <Play className="w-5 h-5 text-[#D4FF33] shrink-0" />
          )}
        </button>
      </div>

      {/* Expandable Interactive 5:00 Guided Countdown Panel */}
      {timerOpen && (
        <div className="rounded-2xl border border-[#262B38] bg-[#0B0D12] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#D4FF33]">
                Rutina de pausa sin equipo · {currentExercise.step} de 3
              </span>
              <h3 className="text-base font-extrabold text-white mt-0.5">
                {currentExercise.title}
              </h3>
              <p className="text-xs text-zinc-400">{currentExercise.subtitle}</p>
            </div>
            <div className="text-right">
              <span className="text-3xl font-extrabold font-mono tabular-nums text-[#D4FF33]">
                {formatMmSs(remainingSec)}
              </span>
            </div>
          </div>

          <div className="h-2 w-full rounded-full bg-[#181C26] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#D4FF33] transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* 3 Guided Exercise Steps */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {PAUSE_EXERCISES.map((ex) => {
              const isCurrent = ex.step === currentExercise.step && remainingSec > 0;
              const isDone = remainingSec <= ex.endRemSec;
              return (
                <div
                  key={ex.step}
                  className={`rounded-xl border px-3 py-2 text-xs transition-colors ${
                    isDone
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                      : isCurrent
                        ? 'border-[#D4FF33]/60 bg-[#D4FF33]/10 text-white'
                        : 'border-[#202532] bg-[#12151C] text-zinc-400'
                  }`}
                >
                  <p className="font-bold">
                    {ex.step}. {ex.title}
                  </p>
                  <p className="text-[10px] opacity-80">1 min 40 seg</p>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsRunning((r) => !r)}
                disabled={remainingSec === 0}
                className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-[#D4FF33] disabled:opacity-40 px-3.5 text-xs font-extrabold text-[#0A0B0D]"
              >
                {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {isRunning ? 'Pausar' : 'Reanudar'}
              </button>
              <button
                type="button"
                onClick={handleResetTimer}
                className="min-h-[38px] inline-flex items-center gap-1 rounded-xl border border-[#2A2F3D] bg-[#141720] px-3 text-xs font-bold text-zinc-300 hover:text-white"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reiniciar
              </button>
            </div>

            {remainingSec > 0 && elapsedSec >= 10 && (
              <button
                type="button"
                onClick={handleFinishEarly}
                className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-3 text-xs font-extrabold text-emerald-300"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Registrar pausa (+5 min)
              </button>
            )}
          </div>
        </div>
      )}

      {pauseCompletedBanner && (
        <div
          role="status"
          className="rounded-2xl border border-emerald-500/35 bg-emerald-500/12 px-4 py-2.5 flex items-center gap-2 text-xs font-bold text-emerald-200"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>
            ¡Pausa Activa completada! Se sumaron +5 minutos activos y tu racha de hoy quedó protegida.
          </span>
        </div>
      )}
    </section>
  );
};
