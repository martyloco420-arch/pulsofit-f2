import React, { useEffect, useState } from 'react';
import { Pause, Play, RotateCcw, SkipForward, Timer } from 'lucide-react';

export function computeRemainingSeconds(
  targetEndTime: number,
  nowMs: number = Date.now(),
): number {
  return Math.max(0, Math.ceil((targetEndTime - nowMs) / 1000));
}

export function formatSeconds(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function playRestBeep(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.14, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Ignore audio context restrictions
  }
}

export function triggerRestCompletionVibration(): void {
  try {
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.vibrate === 'function'
    ) {
      navigator.vibrate([220, 100, 220]);
    }
  } catch {
    // Ignore vibration errors
  }
}

export interface RestTimerBarProps {
  restRemaining: number;
  restTotal: number;
  targetEndTime?: number | null;
  isPaused?: boolean;
  nextExerciseLabel?: string | null;
  onAdjust: (deltaSec: number) => void;
  onRestart: () => void;
  onSkip: () => void;
  onTogglePause?: () => void;
}

export const RestTimerBar: React.FC<RestTimerBarProps> = ({
  restRemaining,
  restTotal,
  targetEndTime = null,
  isPaused = false,
  nextExerciseLabel,
  onAdjust,
  onRestart,
  onSkip,
  onTogglePause,
}) => {
  const [syncedRemaining, setSyncedRemaining] = useState<number>(() =>
    targetEndTime !== null && !isPaused
      ? computeRemainingSeconds(targetEndTime)
      : restRemaining,
  );

  useEffect(() => {
    if (isPaused || targetEndTime === null) {
      setSyncedRemaining(restRemaining);
      return undefined;
    }

    const syncFromTimestamp = () => {
      setSyncedRemaining(computeRemainingSeconds(targetEndTime));
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncFromTimestamp();
      }
    };

    syncFromTimestamp();
    const id = window.setInterval(syncFromTimestamp, 250);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [targetEndTime, isPaused, restRemaining]);

  const displayRemaining =
    !isPaused && targetEndTime !== null ? syncedRemaining : restRemaining;

  const progressPct = Math.min(
    100,
    Math.round((displayRemaining / Math.max(1, restTotal)) * 100),
  );

  return (
    <div
      role="region"
      aria-label="Temporizador flotante de descanso"
      className="fixed bottom-[126px] left-3 right-3 sm:left-auto sm:right-6 sm:w-96 z-30 rounded-2xl border border-[#D4FF33]/60 bg-[#12141A]/95 backdrop-blur-md px-4 py-3 shadow-2xl space-y-2"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Timer className="w-4 h-4 text-[#D4FF33] shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-[#D4FF33] uppercase">
              {isPaused ? 'Descanso en pausa' : 'Descanso activo'}
            </p>
            <p className="text-xs text-zinc-300 truncate">
              {nextExerciseLabel
                ? `Próx: ${nextExerciseLabel}`
                : 'Prepárate para la siguiente serie'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onTogglePause && (
            <button
              type="button"
              onClick={onTogglePause}
              aria-label={isPaused ? 'Reanudar descanso' : 'Pausar descanso'}
              className="min-h-[38px] min-w-[38px] rounded-xl border border-[#2A2F3D] bg-[#1C2029] text-white flex items-center justify-center active:scale-95"
            >
              {isPaused ? (
                <Play className="w-4 h-4 fill-current text-[#D4FF33]" />
              ) : (
                <Pause className="w-4 h-4 text-zinc-200" />
              )}
            </button>
          )}
          <span className="text-2xl font-extrabold font-mono tabular-nums text-white shrink-0">
            {formatSeconds(displayRemaining)}
          </span>
        </div>
      </div>

      <div className="h-1.5 w-full rounded-full bg-[#1F2430] overflow-hidden">
        <div
          className="h-full bg-[#D4FF33] transition-all duration-200"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <button
          type="button"
          onClick={() => onAdjust(-15)}
          aria-label="Restar 15 segundos al descanso"
          className="min-h-[38px] rounded-xl bg-[#1C2029] text-xs font-bold text-zinc-200 active:scale-95"
        >
          -15s
        </button>
        <button
          type="button"
          onClick={() => onAdjust(15)}
          aria-label="Sumar 15 segundos al descanso"
          className="min-h-[38px] rounded-xl bg-[#1C2029] text-xs font-bold text-zinc-200 active:scale-95"
        >
          +15s
        </button>
        <button
          type="button"
          onClick={onRestart}
          aria-label="Reiniciar temporizador de descanso"
          className="min-h-[38px] rounded-xl bg-[#1C2029] text-xs font-bold text-zinc-200 inline-flex items-center justify-center gap-1 active:scale-95"
        >
          <RotateCcw className="w-3.5 h-3.5 text-[#D4FF33]" />
          Reiniciar
        </button>
        <button
          type="button"
          onClick={onSkip}
          aria-label="Saltar descanso"
          className="min-h-[38px] rounded-xl bg-[#D4FF33] text-xs font-extrabold text-[#0A0B0D] inline-flex items-center justify-center gap-1 active:scale-95"
        >
          <SkipForward className="w-3.5 h-3.5" />
          Saltar
        </button>
      </div>
    </div>
  );
};
