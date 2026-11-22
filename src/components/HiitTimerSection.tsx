import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bluetooth,
  Check,
  Flame,
  Heart,
  Pause,
  Play,
  RotateCcw,
  Square,
  Timer,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { InlineDeleteConfirmButton } from './InlineDeleteConfirmButton';
import {
  computeHeartRateZone,
  connectBluetoothHeartRateMonitor,
  isBluetoothHeartRateSupported,
  type HeartRateDeviceHandle,
} from '../lib/bluetoothHeartRate';
import { getTodayIsoDate } from '../lib/storage';
import { speakCoachCue } from '../lib/voiceCoach';
import type { HiitSession, UserProfile } from '../types/fitness';

interface HiitTimerSectionProps {
  profile: UserProfile;
  hiitSessions: HiitSession[];
  onSaveHiitSession: (session: HiitSession) => void;
  onDeleteHiitSession: (id: string) => void;
}

interface HiitPreset {
  id: string;
  name: string;
  workSec: number;
  restSec: number;
  rounds: number;
  cycles: number;
}

const HIIT_PRESETS: HiitPreset[] = [
  { id: 'tabata', name: 'Tabata 20/10', workSec: 20, restSec: 10, rounds: 8, cycles: 1 },
  { id: 'emom', name: 'EMOM 60s', workSec: 50, restSec: 10, rounds: 10, cycles: 1 },
  { id: 'classic30', name: 'HIIT 30/30', workSec: 30, restSec: 30, rounds: 8, cycles: 1 },
  { id: 'metabolic', name: 'Metabólico 40/20', workSec: 40, restSec: 20, rounds: 6, cycles: 2 },
];

type TimerStage = 'idle' | 'prep' | 'work' | 'rest' | 'done';

function playTone(freq: number, duration = 0.25) {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.16, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Ignore audio context blocks
  }
}

export const HiitTimerSection: React.FC<HiitTimerSectionProps> = ({
  profile,
  hiitSessions,
  onSaveHiitSession,
  onDeleteHiitSession,
}) => {
  const [presetName, setPresetName] = useState('Tabata 20/10');
  const [workSec, setWorkSec] = useState(20);
  const [restSec, setRestSec] = useState(10);
  const [rounds, setRounds] = useState(8);
  const [cycles, setCycles] = useState(1);

  const [stage, setStage] = useState<TimerStage>('idle');
  const [isPaused, setIsPaused] = useState(false);
  const [currentRound, setCurrentRound] = useState(1);
  const [currentCycle, setCurrentCycle] = useState(1);
  const [remainingSec, setRemainingSec] = useState(20);
  const [elapsedTotalSec, setElapsedTotalSec] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(profile.voiceCoachEnabled ?? true);

  // Live BLE Heart Rate Monitor state
  const [hrBpm, setHrBpm] = useState<number | null>(null);
  const [hrDeviceName, setHrDeviceName] = useState<string | null>(null);
  const [hrError, setHrError] = useState<string | null>(null);
  const [isConnectingHr, setIsConnectingHr] = useState(false);
  const hrHandleRef = useRef<HeartRateDeviceHandle | null>(null);

  const stageRef = useRef<TimerStage>('idle');
  const roundRef = useRef(1);
  const cycleRef = useRef(1);
  const pausedRef = useRef(false);

  const totalPlannedSec = useMemo(
    () => (workSec + restSec) * rounds * cycles,
    [workSec, restSec, rounds, cycles],
  );

  const estimatedCalories = useMemo(() => {
    const mins = Math.max(1, Math.round(elapsedTotalSec / 60));
    return Math.round(mins * (profile.weightKg * 0.145));
  }, [elapsedTotalSec, profile.weightKg]);

  useEffect(() => {
    pausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    return () => {
      hrHandleRef.current?.disconnect();
    };
  }, []);

  const handleToggleHeartRate = async () => {
    if (hrHandleRef.current) {
      hrHandleRef.current.disconnect();
      hrHandleRef.current = null;
      setHrDeviceName(null);
      setHrBpm(null);
      return;
    }
    setHrError(null);
    setIsConnectingHr(true);
    try {
      const handle = await connectBluetoothHeartRateMonitor(
        (bpm) => setHrBpm(bpm),
        () => {
          hrHandleRef.current = null;
          setHrDeviceName(null);
          setHrBpm(null);
        },
      );
      hrHandleRef.current = handle;
      setHrDeviceName(handle.deviceName);
    } catch (err) {
      setHrError(
        err instanceof Error ? err.message : 'No se pudo conectar la banda de pulso BLE.',
      );
    } finally {
      setIsConnectingHr(false);
    }
  };

  useEffect(() => {
    if (stage === 'idle' || stage === 'done') return;

    const timer = window.setInterval(() => {
      if (pausedRef.current) return;

      setElapsedTotalSec((e) => e + 1);
      setRemainingSec((prev) => {
        if (prev > 1) {
          if (prev <= 4) playTone(560, 0.12);
          return prev - 1;
        }

        // Transition stage
        const s = stageRef.current;
        if (s === 'prep') {
          stageRef.current = 'work';
          setStage('work');
          playTone(960, 0.35);
          if (navigator.vibrate) navigator.vibrate([180]);
          if (voiceEnabled) {
            speakCoachCue(`Ronda 1 de ${rounds}. ¡Empieza el trabajo!`);
          }
          return workSec;
        }

        if (s === 'work') {
          if (restSec > 0 && !(roundRef.current === rounds && cycleRef.current === cycles)) {
            stageRef.current = 'rest';
            setStage('rest');
            playTone(440, 0.3);
            if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
            if (voiceEnabled) {
              speakCoachCue(`Descansa ${restSec} segundos.`);
            }
            return restSec;
          }
        }

        // Advance round / cycle
        if (roundRef.current < rounds) {
          roundRef.current += 1;
          setCurrentRound(roundRef.current);
          stageRef.current = 'work';
          setStage('work');
          playTone(960, 0.35);
          if (navigator.vibrate) navigator.vibrate([180]);
          if (voiceEnabled) {
            speakCoachCue(
              roundRef.current === rounds
                ? 'Última ronda. ¡Dale con todo!'
                : `Ronda ${roundRef.current}. ¡Vamos!`,
            );
          }
          return workSec;
        }

        if (cycleRef.current < cycles) {
          cycleRef.current += 1;
          roundRef.current = 1;
          setCurrentCycle(cycleRef.current);
          setCurrentRound(1);
          stageRef.current = 'work';
          setStage('work');
          playTone(960, 0.4);
          if (voiceEnabled) {
            speakCoachCue(`Bloque ${cycleRef.current} de ${cycles}. ¡Arranca!`);
          }
          return workSec;
        }

        // Completed all rounds & cycles
        stageRef.current = 'done';
        setStage('done');
        playTone(1080, 0.45);
        if (navigator.vibrate) navigator.vibrate([250, 100, 250]);
        if (voiceEnabled) {
          speakCoachCue('¡Entrenamiento HIIT completado! Excelente trabajo.');
        }
        return 0;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [stage, workSec, restSec, rounds, cycles, voiceEnabled]);

  const applyPreset = (p: HiitPreset) => {
    setPresetName(p.name);
    setWorkSec(p.workSec);
    setRestSec(p.restSec);
    setRounds(p.rounds);
    setCycles(p.cycles);
  };

  const handleStart = () => {
    roundRef.current = 1;
    cycleRef.current = 1;
    stageRef.current = 'prep';
    setCurrentRound(1);
    setCurrentCycle(1);
    setElapsedTotalSec(0);
    setRemainingSec(5);
    setIsPaused(false);
    setStage('prep');
    if (voiceEnabled) {
      speakCoachCue(`Preparado para ${presetName}. Comenzamos en 5 segundos.`);
    }
  };

  const handleFinishAndSave = () => {
    const duration = Math.max(10, elapsedTotalSec);
    const kcal = Math.max(15, Math.round((duration / 60) * (profile.weightKg * 0.145)));
    onSaveHiitSession({
      id: `hiit_${Date.now()}`,
      date: getTodayIsoDate(),
      name: presetName,
      workSec,
      restSec,
      rounds,
      cycles,
      totalDurationSec: duration,
      caloriesBurned: kcal,
      completedAt: new Date().toISOString(),
    });
    stageRef.current = 'idle';
    setStage('idle');
    setElapsedTotalSec(0);
  };

  const handleReset = () => {
    stageRef.current = 'idle';
    setStage('idle');
    setIsPaused(false);
    setElapsedTotalSec(0);
  };

  const hrZone = hrBpm ? computeHeartRateZone(hrBpm, profile.age) : null;

  const stageColor =
    stage === 'work'
      ? 'border-[#D4FF33] bg-[#D4FF33]/10 text-[#D4FF33]'
      : stage === 'rest'
        ? 'border-sky-400 bg-sky-500/10 text-sky-300'
        : stage === 'prep'
          ? 'border-amber-400 bg-amber-500/10 text-amber-300'
          : stage === 'done'
            ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300'
            : 'border-[#222631] bg-[#12141A] text-white';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold font-display tracking-tight text-white">
            HIIT y Tabata
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Intervalos de alta intensidad con avisos por voz, vibración y banda de pulso BLE
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setVoiceEnabled((v) => !v)}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-2xl border border-[#2B303C] bg-[#151820] px-3.5 text-xs font-bold text-white"
          >
            {voiceEnabled ? (
              <Volume2 className="w-4 h-4 text-[#D4FF33]" />
            ) : (
              <VolumeX className="w-4 h-4 text-zinc-500" />
            )}
            Voz
          </button>

          {isBluetoothHeartRateSupported() && (
            <button
              type="button"
              onClick={handleToggleHeartRate}
              disabled={isConnectingHr}
              className={`min-h-[44px] inline-flex items-center gap-1.5 rounded-2xl border px-3.5 text-xs font-bold transition-colors ${
                hrDeviceName
                  ? 'border-rose-400/50 bg-rose-500/15 text-rose-200'
                  : 'border-[#2B303C] bg-[#151820] text-white hover:border-[#D4FF33]'
              }`}
            >
              <Bluetooth className="w-4 h-4" />
              {isConnectingHr
                ? 'Buscando...'
                : hrDeviceName
                  ? `${hrBpm ?? '--'} BPM`
                  : 'Banda HR'}
            </button>
          )}
        </div>
      </div>

      {hrError && (
        <p className="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-200">
          {hrError}
        </p>
      )}

      {hrBpm && hrZone && (
        <div className={`rounded-2xl border px-4 py-3 flex items-center justify-between ${hrZone.bgClass}`}>
          <div className="flex items-center gap-2.5">
            <Heart className="w-5 h-5 text-rose-400 fill-rose-400" />
            <span className="text-sm font-bold text-white">{hrDeviceName}</span>
          </div>
          <div className="flex items-center gap-3 font-mono tabular-nums">
            <span className={`text-sm font-extrabold ${hrZone.colorClass}`}>
              {hrZone.label} ({hrZone.pctMax}%)
            </span>
            <span className="text-2xl font-extrabold text-white">{hrBpm} BPM</span>
          </div>
        </div>
      )}

      {stage === 'idle' ? (
        <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-5">
          <div>
            <p className="text-xs font-bold text-[#D4FF33] mb-2">Presets rápidos</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {HIIT_PRESETS.map((p) => {
                const active = presetName === p.name && workSec === p.workSec && restSec === p.restSec;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className={`min-h-[52px] rounded-2xl border px-3 py-2 text-left transition-colors ${
                      active
                        ? 'border-[#D4FF33] bg-[#D4FF33]/15 text-white'
                        : 'border-[#252A36] bg-[#0E1014] text-zinc-300 hover:border-zinc-500'
                    }`}
                  >
                    <p className="text-sm font-extrabold truncate">{p.name}</p>
                    <p className="text-[11px] font-mono text-zinc-400">
                      {p.workSec}s / {p.restSec}s · {p.rounds}×{p.cycles}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Trabajo (seg)', val: workSec, set: setWorkSec, min: 5, max: 180, step: 5 },
              { label: 'Descanso (seg)', val: restSec, set: setRestSec, min: 0, max: 180, step: 5 },
              { label: 'Rondas', val: rounds, set: setRounds, min: 1, max: 30, step: 1 },
              { label: 'Bloques', val: cycles, set: setCycles, min: 1, max: 6, step: 1 },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3 text-center space-y-2"
              >
                <span className="text-xs font-semibold text-zinc-400 block">{item.label}</span>
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => item.set(Math.max(item.min, item.val - item.step))}
                    className="min-h-[40px] min-w-[40px] rounded-xl bg-[#1A1D26] text-white font-bold"
                  >
                    -
                  </button>
                  <span className="font-mono tabular-nums text-xl font-extrabold text-white">
                    {item.val}
                  </span>
                  <button
                    type="button"
                    onClick={() => item.set(Math.min(item.max, item.val + item.step))}
                    className="min-h-[40px] min-w-[40px] rounded-xl bg-[#1A1D26] text-white font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="text-xs text-zinc-400 font-mono">
              Duración estimada: <strong className="text-white">{Math.floor(totalPlannedSec / 60)}m {totalPlannedSec % 60}s</strong>
            </div>
            <button
              type="button"
              onClick={handleStart}
              className="w-full sm:w-auto min-h-[54px] inline-flex items-center justify-center gap-2.5 rounded-2xl bg-[#D4FF33] px-8 text-base font-extrabold text-[#0A0B0D] active:scale-[0.98]"
            >
              <Play className="w-5 h-5 fill-current" />
              Iniciar {presetName}
            </button>
          </div>
        </section>
      ) : (
        <section className={`rounded-3xl border-2 p-6 sm:p-8 text-center space-y-6 ${stageColor}`}>
          <div className="flex items-center justify-between text-xs font-mono uppercase tracking-wider">
            <span>
              Ronda {currentRound}/{rounds} · Bloque {currentCycle}/{cycles}
            </span>
            <span>
              Total {Math.floor(elapsedTotalSec / 60)}:{String(elapsedTotalSec % 60).padStart(2, '0')}
            </span>
          </div>

          <div>
            <p className="text-sm font-extrabold uppercase tracking-widest">
              {stage === 'prep'
                ? 'Prepárate'
                : stage === 'work'
                  ? '¡TRABAJO INTENSO!'
                  : stage === 'rest'
                    ? 'DESCANSO / RECUPERA'
                    : '¡COMPLETADO!'}
            </p>
            <p className="mt-2 text-7xl sm:text-8xl font-extrabold font-mono tabular-nums text-white leading-none">
              {stage === 'done' ? '00' : String(remainingSec).padStart(2, '0')}
            </p>
          </div>

          {stage === 'done' ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-200">
                Gasto estimado: <strong className="font-mono text-[#D4FF33]">~{estimatedCalories} kcal</strong>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleReset}
                  className="min-h-[50px] rounded-2xl border border-[#2B303C] bg-[#151820] text-sm font-bold text-white"
                >
                  Descartar
                </button>
                <button
                  type="button"
                  onClick={handleFinishAndSave}
                  className="min-h-[50px] rounded-2xl bg-[#D4FF33] text-sm font-extrabold text-[#0A0B0D] flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  Guardar sesión
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2.5 max-w-md mx-auto">
              <button
                type="button"
                onClick={handleReset}
                className="min-h-[50px] rounded-2xl border border-[#2B303C] bg-[#151820] text-xs font-bold text-zinc-200 flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="w-4 h-4" />
                Reiniciar
              </button>
              <button
                type="button"
                onClick={() => setIsPaused((p) => !p)}
                className="min-h-[50px] rounded-2xl bg-white text-sm font-extrabold text-[#0A0B0D] flex items-center justify-center gap-1.5"
              >
                {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4" />}
                {isPaused ? 'Reanudar' : 'Pausar'}
              </button>
              <button
                type="button"
                onClick={handleFinishAndSave}
                className="min-h-[50px] rounded-2xl bg-[#D4FF33] text-xs font-extrabold text-[#0A0B0D] flex items-center justify-center gap-1.5"
              >
                <Square className="w-4 h-4 fill-current" />
                Finalizar
              </button>
            </div>
          )}
        </section>
      )}

      {/* HIIT History */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Timer className="w-4 h-4 text-[#D4FF33]" />
            <h2 className="text-xl font-bold font-display text-white">
              Historial HIIT reciente
            </h2>
          </div>
          <span className="text-xs font-mono text-zinc-400">
            {hiitSessions.length} sesiones
          </span>
        </div>

        {hiitSessions.length === 0 ? (
          <p className="text-xs text-zinc-500">
            Completa una rutina Tabata o EMOM para registrar tu gasto metabólico.
          </p>
        ) : (
          <div className="divide-y divide-white/5">
            {hiitSessions.slice(0, 6).map((s) => (
              <div
                key={s.id}
                className="py-2.5 flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{s.name}</p>
                  <p className="font-mono text-zinc-400">
                    {s.date} · {s.workSec}/{s.restSec}s · {s.rounds}×{s.cycles} ·{' '}
                    <span className="text-[#D4FF33]">~{s.caloriesBurned} kcal</span>
                  </p>
                </div>
                <InlineDeleteConfirmButton
                  onConfirm={() => onDeleteHiitSession(s.id)}
                  ariaLabel={`Eliminar ${s.name}`}
                  size="md"
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
