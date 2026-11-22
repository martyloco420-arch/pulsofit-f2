import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlarmClock,
  BatteryCharging,
  BellRing,
  Brain,
  CheckCircle2,
  CloudRain,
  Clock,
  Dumbbell,
  Mic,
  MicOff,
  Moon,
  Pause,
  Play,
  Radio,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Volume2,
  Waves,
} from 'lucide-react';
import { InlineDeleteConfirmButton } from './InlineDeleteConfirmButton';
import {
  LiveSleepEpochSample,
  ProgressiveAlarmEngine,
  SleepSoundscapeEngine,
  buildDemoSleepSession,
  buildSleepSessionFromSamples,
  computeSleepCycleRecommendations,
  computeSleepSessionAnalytics,
  computeTargetWakeWindow,
  formatMinutesAsHoursMin,
} from '../lib/sleepEngine';
import { isLowPowerActiveNow } from '../lib/lowPowerMode';
import { useHardwareManager } from '../hooks/useHardwareManager';
import type {
  DailyReadinessEntry,
  SleepNoiseEvent,
  SleepPhase,
  SleepSession,
  SleepSmartWindowMin,
  SleepSoundscapeType,
} from '../types/fitness';

interface SleepRecoverySectionProps {
  sleepSessions: SleepSession[];
  todayReadiness: DailyReadinessEntry | null;
  onSaveSleepSession: (session: SleepSession) => void;
  onDeleteSleepSession: (id: string) => void;
}

const SOUNDSCAPES: {
  id: SleepSoundscapeType;
  label: string;
  subtitle: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'lluvia',
    label: 'Lluvia suave',
    subtitle: 'Brisa y gotas filtradas',
    Icon: CloudRain,
  },
  {
    id: 'ruido_marron',
    label: 'Ruido marrón',
    subtitle: 'Grave cálido continuo',
    Icon: Waves,
  },
  {
    id: 'frecuencia_432',
    label: 'Frecuencia 432 Hz',
    subtitle: 'Armónico relajante theta',
    Icon: Radio,
  },
  {
    id: 'ninguno',
    label: 'En silencio',
    subtitle: 'Solo monitoreo nocturno',
    Icon: Moon,
  },
];

const TIMER_OPTIONS: { value: 15 | 30 | 60 | 0; label: string }[] = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '60 min' },
  { value: 0, label: 'Continuo' },
];

const WINDOW_OPTIONS: SleepSmartWindowMin[] = [15, 30, 45];

function formatClockTime(dateOrIso: Date | string): string {
  const d = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
  if (Number.isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatCountdownSec(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function phaseToY(phase: SleepPhase): number {
  switch (phase) {
    case 'despierto':
      return 26;
    case 'rem':
      return 68;
    case 'ligero':
      return 110;
    case 'profundo':
      return 152;
  }
}

function phaseColorHex(phase: SleepPhase): string {
  switch (phase) {
    case 'despierto':
      return '#FB923C';
    case 'rem':
      return '#22D3EE';
    case 'ligero':
      return '#60A5FA';
    case 'profundo':
      return '#34D399';
  }
}

export const SleepRecoverySection: React.FC<SleepRecoverySectionProps> = ({
  sleepSessions,
  todayReadiness,
  onSaveSleepSession,
  onDeleteSleepSession,
}) => {
  // Alarm & monitor preferences
  const [targetWakeTime, setTargetWakeTime] = useState('07:00');
  const [smartWindowMin, setSmartWindowMin] = useState<SleepSmartWindowMin>(30);
  const [calcMode, setCalcMode] = useState<'bedtime' | 'waketime'>('bedtime');
  const [calcBaseTime, setCalcBaseTime] = useState('23:00');
  const [useMicMonitor, setUseMicMonitor] = useState(true);
  const [useMotionMonitor, setUseMotionMonitor] = useState(true);

  // Sleep soundscape player state
  const [soundscape, setSoundscape] = useState<SleepSoundscapeType>('lluvia');
  const [soundTimerMin, setSoundTimerMin] = useState<15 | 30 | 60 | 0>(30);
  const [soundVolume, setSoundVolume] = useState(0.55);
  const [isSoundPlaying, setIsSoundPlaying] = useState(false);
  const [soundRemainingSec, setSoundRemainingSec] = useState<number | null>(null);

  // Night monitoring state
  const [isSleeping, setIsSleeping] = useState(false);
  const [isAlarmRinging, setIsAlarmRinging] = useState(false);
  const [alarmTriggeredSmart, setAlarmTriggeredSmart] = useState(false);
  const [isTestingAlarm, setIsTestingAlarm] = useState(false);
  const [bedtimeIso, setBedtimeIso] = useState<string>('');
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());
  const [liveAudioLevel, setLiveAudioLevel] = useState(0);
  const [liveMotionLevel, setLiveMotionLevel] = useState(0);
  const [micActive, setMicActive] = useState(false);
  const [motionActive, setMotionActive] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [sensorNotice, setSensorNotice] = useState<string | null>(null);
  const [liveEventsCount, setLiveEventsCount] = useState(0);

  // Selected session for analytics inspection
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [justSavedMsg, setJustSavedMsg] = useState<string | null>(null);

  // Engines & live sensor refs
  const soundEngineRef = useRef<SleepSoundscapeEngine | null>(null);
  const alarmEngineRef = useRef<ProgressiveAlarmEngine | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const motionHandlerRef = useRef<((ev: DeviceMotionEvent) => void) | null>(null);

  const liveMotionPeakRef = useRef(0);
  const liveAudioPeakRef = useRef(0);
  const audioWindowSamplesRef = useRef<number[]>([]);
  const lastAudioSampleRef = useRef(0);
  const lastMotionSampleRef = useRef(0);
  const lastNoiseEventMsRef = useRef(0);
  const samplesRef = useRef<LiveSleepEpochSample[]>([]);
  const noiseEventsRef = useRef<SleepNoiseEvent[]>([]);
  const targetWindowRef = useRef<{ targetMs: number; windowStartMs: number }>({
    targetMs: 0,
    windowStartMs: 0,
  });
  const alarmTriggeredRef = useRef(false);
  const sleepStartMsRef = useRef(0);

  const hardware = useHardwareManager();
  const hardwareRef = useRef(hardware);
  hardwareRef.current = hardware;

  if (!soundEngineRef.current) {
    soundEngineRef.current = new SleepSoundscapeEngine();
  }
  if (!alarmEngineRef.current) {
    alarmEngineRef.current = new ProgressiveAlarmEngine();
  }

  const sortedSessions = useMemo(
    () => [...sleepSessions].sort((a, b) => b.wakeUpAt.localeCompare(a.wakeUpAt)),
    [sleepSessions],
  );

  const activeSession = useMemo(() => {
    if (sortedSessions.length === 0) return null;
    return (
      sortedSessions.find((s) => s.id === selectedSessionId) ?? sortedSessions[0]
    );
  }, [sortedSessions, selectedSessionId]);

  const previewWindow = useMemo(
    () => computeTargetWakeWindow(targetWakeTime, smartWindowMin, nowTickMs),
    [targetWakeTime, smartWindowMin, nowTickMs],
  );

  // Clock ticker: refreshes OLED night clock only every 60s when sleeping (or 1s when alarm rings / sound countdown runs)
  useEffect(() => {
    const intervalMs = isAlarmRinging
      ? 1000
      : isSleeping
        ? 60_000
        : isSoundPlaying
          ? 1000
          : 15_000;
    const id = window.setInterval(() => {
      setNowTickMs(Date.now());
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [isSleeping, isAlarmRinging, isSoundPlaying]);

  // Soundscape auto-off countdown
  useEffect(() => {
    if (!isSoundPlaying || soundRemainingSec === null) return undefined;
    if (soundRemainingSec <= 0) {
      soundEngineRef.current?.fadeOutAndStop(4);
      setIsSoundPlaying(false);
      setSoundRemainingSec(null);
      return undefined;
    }
    const id = window.setTimeout(() => {
      setSoundRemainingSec((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => window.clearTimeout(id);
  }, [isSoundPlaying, soundRemainingSec]);

  // Cleanup everything on unmount
  useEffect(() => {
    return () => {
      soundEngineRef.current?.stopImmediate();
      alarmEngineRef.current?.stop();
      void releaseWakeLock();
      stopSensors();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acquireWakeLock = async () => {
    const ok = await hardwareRef.current.acquireWakeLock('sleep');
    setWakeLockActive(ok);
  };

  const releaseWakeLock = async () => {
    await hardwareRef.current.releaseWakeLock('sleep');
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch {
        // Ignore
      }
      wakeLockRef.current = null;
    }
    setWakeLockActive(false);
  };

  // Sync OLED wakeLock indicator with hardware manager
  useEffect(() => {
    if (isSleeping) {
      setWakeLockActive(hardware.wakeLockActive);
    }
  }, [isSleeping, hardware.wakeLockActive]);

  const stopSensors = () => {
    if (motionHandlerRef.current && typeof window !== 'undefined') {
      window.removeEventListener('devicemotion', motionHandlerRef.current);
      motionHandlerRef.current = null;
    }
    hardwareRef.current.releaseMediaStream('sleep_mic');
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (micCtxRef.current) {
      try {
        void micCtxRef.current.close();
      } catch {
        // Ignore
      }
      micCtxRef.current = null;
    }
    analyserRef.current = null;
    setMicActive(false);
    setMotionActive(false);
  };

  const startSoundscape = (type: SleepSoundscapeType = soundscape) => {
    if (type === 'ninguno') {
      soundEngineRef.current?.fadeOutAndStop(1.2);
      setIsSoundPlaying(false);
      setSoundRemainingSec(null);
      return;
    }
    // Audio Focus: stop any active music player track before playing Sleep Aid
    hardwareRef.current.requestAudioFocus('sleep_aid');
    soundEngineRef.current?.start(type, soundVolume);
    setIsSoundPlaying(true);
    setSoundRemainingSec(soundTimerMin > 0 ? soundTimerMin * 60 : null);
  };

  const stopSoundscape = () => {
    soundEngineRef.current?.fadeOutAndStop(1.2);
    setIsSoundPlaying(false);
    setSoundRemainingSec(null);
  };

  const handleToggleSoundPlay = () => {
    if (isSoundPlaying) {
      stopSoundscape();
    } else {
      const targetType = soundscape === 'ninguno' ? 'lluvia' : soundscape;
      if (soundscape === 'ninguno') setSoundscape('lluvia');
      startSoundscape(targetType);
    }
  };

  const handleSelectSoundscape = (type: SleepSoundscapeType) => {
    setSoundscape(type);
    if (type === 'ninguno') {
      stopSoundscape();
    } else if (isSoundPlaying) {
      startSoundscape(type);
    }
  };

  const handleVolumeChange = (nextVol: number) => {
    setSoundVolume(nextVol);
    soundEngineRef.current?.setVolume(nextVol);
  };

  const handleToggleTestAlarm = () => {
    if (isTestingAlarm) {
      alarmEngineRef.current?.stop();
      setIsTestingAlarm(false);
    } else {
      alarmEngineRef.current?.start();
      setIsTestingAlarm(true);
    }
  };

  const triggerSmartAlarmNow = (isSmartEarly: boolean) => {
    if (alarmTriggeredRef.current) return;
    alarmTriggeredRef.current = true;
    setAlarmTriggeredSmart(isSmartEarly);
    setIsAlarmRinging(true);
    if (isSoundPlaying) {
      stopSoundscape();
    }
    alarmEngineRef.current?.start();
  };

  const handleStartSleepMode = async () => {
    setJustSavedMsg(null);
    setSensorNotice(null);
    if (isTestingAlarm) {
      alarmEngineRef.current?.stop();
      setIsTestingAlarm(false);
    }

    const now = Date.now();
    const startIso = new Date(now).toISOString();
    const win = computeTargetWakeWindow(targetWakeTime, smartWindowMin, now);

    targetWindowRef.current = {
      targetMs: win.targetMs,
      windowStartMs: win.windowStartMs,
    };
    sleepStartMsRef.current = now;
    alarmTriggeredRef.current = false;
    samplesRef.current = [
      {
        minuteOffset: 0,
        timestamp: startIso,
        movementScore: 20,
        audioDbLevel: 12,
        audioVariability: 12,
      },
    ];
    noiseEventsRef.current = [];
    liveMotionPeakRef.current = 0;
    liveAudioPeakRef.current = 0;
    audioWindowSamplesRef.current = [];
    lastAudioSampleRef.current = 0;
    lastMotionSampleRef.current = 0;
    lastNoiseEventMsRef.current = 0;

    setBedtimeIso(startIso);
    setLiveEventsCount(0);
    setIsAlarmRinging(false);
    setAlarmTriggeredSmart(false);
    setNowTickMs(now);
    setIsSleeping(true);

    // Stop active music playback cleanly on sleep monitor start
    hardwareRef.current.requestAudioFocus('sleep_aid');
    await acquireWakeLock();

    const notices: string[] = [];

    // 1. Optional Microphone Amplitude Analyzer (no audio recorded or stored)
    if (
      useMicMonitor &&
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices?.getUserMedia
    ) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        hardwareRef.current.registerMediaStream('sleep_mic', stream);
        const winAudio = window as unknown as {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        };
        const AudioCtx = winAudio.AudioContext ?? winAudio.webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          micStreamRef.current = stream;
          micCtxRef.current = ctx;
          analyserRef.current = analyser;
          setMicActive(true);
        } else {
          hardwareRef.current.releaseMediaStream('sleep_mic');
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch {
        setMicActive(false);
        notices.push('Micrófono no autorizado; usando estimación silenciosa.');
      }
    }

    // 2. Accelerometer (devicemotion)
    if (useMotionMonitor && typeof window !== 'undefined' && 'DeviceMotionEvent' in window) {
      try {
        const DME = window.DeviceMotionEvent as unknown as {
          requestPermission?: () => Promise<'granted' | 'denied'>;
        };
        if (typeof DME.requestPermission === 'function') {
          const perm = await DME.requestPermission();
          if (perm !== 'granted') {
            notices.push('Acelerómetro sin permiso; monitoreo por ciclo.');
          }
        }

        let prevMag = 9.81;
        const onMotion = (ev: DeviceMotionEvent) => {
          const acc = ev.accelerationIncludingGravity ?? ev.acceleration;
          if (!acc) return;
          const x = acc.x ?? 0;
          const y = acc.y ?? 0;
          const z = acc.z ?? 0;
          const mag = Math.sqrt(x * x + y * y + z * z);
          const delta = Math.abs(mag - prevMag);
          prevMag = mag;
          const normalized = Math.min(100, Math.round(delta * 26));
          lastMotionSampleRef.current = normalized;
          if (normalized > liveMotionPeakRef.current) {
            liveMotionPeakRef.current = normalized;
          }
        };
        motionHandlerRef.current = onMotion;
        window.addEventListener('devicemotion', onMotion);
        setMotionActive(true);
      } catch {
        setMotionActive(false);
      }
    }

    if (notices.length > 0) {
      setSensorNotice(notices.join(' '));
    }

    // 3. Start sleep soundscape if selected
    if (soundscape !== 'ninguno') {
      startSoundscape(soundscape);
    }
  };

  // Real-time 500ms sampling loop + smart alarm evaluation while sleeping
  useEffect(() => {
    if (!isSleeping) return undefined;

    const timeData = analyserRef.current
      ? new Uint8Array(analyserRef.current.fftSize)
      : null;

    let lastEpochCapturedMin = 0;

    const sampler = window.setInterval(() => {
      const now = Date.now();

      // Measure mic RMS amplitude without storing audio blobs
      let currentAudio = 0;
      if (analyserRef.current && timeData) {
        analyserRef.current.getByteTimeDomainData(timeData);
        let sumSq = 0;
        for (let i = 0; i < timeData.length; i += 1) {
          const v = (timeData[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / timeData.length);
        currentAudio = Math.min(100, Math.round(rms * 340));
      } else {
        // Gentle baseline ambient estimate when mic disabled
        currentAudio = Math.round(6 + Math.random() * 6);
      }

      lastAudioSampleRef.current = currentAudio;
      if (currentAudio > liveAudioPeakRef.current) {
        liveAudioPeakRef.current = currentAudio;
      }
      audioWindowSamplesRef.current.push(currentAudio);
      if (audioWindowSamplesRef.current.length > 120) {
        audioWindowSamplesRef.current.shift();
      }

      const currentMotion = motionActive
        ? lastMotionSampleRef.current
        : Math.round(6 + Math.random() * 8);

      const uiStepMs = isLowPowerActiveNow() ? 2000 : 500;
      if (Math.floor(now / uiStepMs) !== Math.floor((now - 500) / uiStepMs)) {
        setLiveAudioLevel(currentAudio);
        setLiveMotionLevel(currentMotion);
      }

      const minuteOffset = Math.max(
        0,
        Math.floor((now - sleepStartMsRef.current) / 60_000),
      );

      // Detect acoustic / snore / movement spike (throttled to max 1 event per 20s)
      if (
        (currentAudio >= 34 || currentMotion >= 45) &&
        now - lastNoiseEventMsRef.current > 20_000
      ) {
        lastNoiseEventMsRef.current = now;
        const type: SleepNoiseEvent['type'] =
          currentAudio >= 34 && currentMotion < 30
            ? 'ronquido'
            : currentAudio >= 34
              ? 'ruido_ambiente'
              : 'movimiento';
        const intensity = Math.max(currentAudio, currentMotion);
        const label =
          type === 'ronquido'
            ? intensity >= 60
              ? 'Ronquido intenso detectado'
              : 'Ronquido leve / respiración fuerte'
            : type === 'ruido_ambiente'
              ? 'Ruido ambiental nocturno'
              : 'Cambio de postura / movimiento';
        noiseEventsRef.current.push({
          id: `ev_${now}`,
          timestamp: new Date(now).toISOString(),
          minuteOffset,
          type,
          intensity,
          label,
        });
        setLiveEventsCount(noiseEventsRef.current.length);
      }

      // Record epoch summary every 1 minute
      if (minuteOffset > lastEpochCapturedMin) {
        lastEpochCapturedMin = minuteOffset;
        const peakMotion = liveMotionPeakRef.current;
        const peakAudio = liveAudioPeakRef.current;
        const winSamples = audioWindowSamplesRef.current;
        let audioVar = 10;
        if (winSamples.length > 1) {
          const mean = winSamples.reduce((a, b) => a + b, 0) / winSamples.length;
          const variance =
            winSamples.reduce((a, b) => a + (b - mean) ** 2, 0) / winSamples.length;
          audioVar = Math.min(100, Math.round(Math.sqrt(variance) * 3.5));
        }
        const hadRecentEvent =
          now - lastNoiseEventMsRef.current <= 60_000 && noiseEventsRef.current.length > 0;
        samplesRef.current.push({
          minuteOffset,
          timestamp: new Date(now).toISOString(),
          movementScore: peakMotion,
          audioDbLevel: peakAudio,
          audioVariability: audioVar,
          snoreOrNoiseEvent: hadRecentEvent,
        });
        liveMotionPeakRef.current = 0;
        liveAudioPeakRef.current = 0;
        audioWindowSamplesRef.current = [];
      }

      // Smart Alarm check
      if (!alarmTriggeredRef.current) {
        const { targetMs, windowStartMs } = targetWindowRef.current;
        if (now >= targetMs) {
          triggerSmartAlarmNow(false);
        } else if (now >= windowStartMs) {
          // Inside smart window: wake on light sleep movement or elevated restlessness
          const movementSignal = Math.max(currentMotion, liveMotionPeakRef.current);
          if (movementSignal >= 26 || currentAudio >= 38) {
            triggerSmartAlarmNow(true);
          }
        }
      }
    }, 500);

    return () => window.clearInterval(sampler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSleeping, motionActive]);

  const handleSnooze5Min = () => {
    alarmEngineRef.current?.stop();
    setIsAlarmRinging(false);
    alarmTriggeredRef.current = false;
    const snoozeTarget = Date.now() + 5 * 60_000;
    targetWindowRef.current = {
      targetMs: snoozeTarget,
      windowStartMs: snoozeTarget - 60_000,
    };
  };

  const handleStopSleepMode = async () => {
    alarmEngineRef.current?.stop();
    if (isSoundPlaying) {
      stopSoundscape();
    }
    stopSensors();
    await releaseWakeLock();

    const nowIso = new Date().toISOString();
    const finalMinuteOffset = Math.max(
      1,
      Math.round((Date.now() - sleepStartMsRef.current) / 60_000),
    );
    const winSamples = audioWindowSamplesRef.current;
    let finalVar = 14;
    if (winSamples.length > 1) {
      const mean = winSamples.reduce((a, b) => a + b, 0) / winSamples.length;
      const variance =
        winSamples.reduce((a, b) => a + (b - mean) ** 2, 0) / winSamples.length;
      finalVar = Math.min(100, Math.round(Math.sqrt(variance) * 3.5));
    }
    samplesRef.current.push({
      minuteOffset: finalMinuteOffset,
      timestamp: nowIso,
      movementScore: Math.max(25, liveMotionPeakRef.current),
      audioDbLevel: Math.max(15, liveAudioPeakRef.current),
      audioVariability: finalVar,
    });

    const session = buildSleepSessionFromSamples({
      bedtimeAt: bedtimeIso || new Date(Date.now() - 60_000).toISOString(),
      wakeUpAt: nowIso,
      targetWakeTime,
      smartWindowMin,
      triggeredBySmartAlarm: alarmTriggeredSmart,
      soundscapeUsed: soundscape,
      micEnabled: micActive || useMicMonitor,
      motionEnabled: motionActive || useMotionMonitor,
      samples: samplesRef.current,
      noiseEvents: noiseEventsRef.current,
    });

    const savedAnalytics = computeSleepSessionAnalytics(session);

    setIsSleeping(false);
    setIsAlarmRinging(false);
    onSaveSleepSession(session);
    setSelectedSessionId(session.id);
    setJustSavedMsg(
      `Noche guardada (${formatMinutesAsHoursMin(session.durationMinutes)} · ${
        savedAnalytics.completedCycles90
      } ciclos · Calidad ${session.sleepQualityPct}%). Check-In diario y recuperación física/mental actualizados.`,
    );
  };

  const handleSimulateLightWakeInWindow = () => {
    liveMotionPeakRef.current = 42;
    samplesRef.current.push({
      minuteOffset: Math.max(
        1,
        Math.round((Date.now() - sleepStartMsRef.current) / 60_000),
      ),
      timestamp: new Date().toISOString(),
      movementScore: 42,
      audioDbLevel: 26,
      audioVariability: 22,
    });
    triggerSmartAlarmNow(true);
  };

  const handleSaveDemoNight = () => {
    const demoSession = buildDemoSleepSession({
      targetWakeTime,
      smartWindowMin,
      soundscapeUsed: soundscape,
    });
    const demoAnalytics = computeSleepSessionAnalytics(demoSession);
    onSaveSleepSession(demoSession);
    setSelectedSessionId(demoSession.id);
    setJustSavedMsg(
      `Noche de ejemplo registrada (${formatMinutesAsHoursMin(
        demoSession.durationMinutes,
      )} · ${demoAnalytics.completedCycles90} ciclos de 90m · Calidad ${
        demoSession.sleepQualityPct
      }%) y sincronizada con tu Check-In diario.`,
    );
  };

  // Weekly sleep averages
  const weeklyStats = useMemo(() => {
    const recent = sortedSessions.slice(0, 7);
    if (recent.length === 0) return null;
    const avgMin =
      recent.reduce((acc, s) => acc + s.durationMinutes, 0) / recent.length;
    const avgQuality =
      recent.reduce((acc, s) => acc + s.sleepQualityPct, 0) / recent.length;
    return {
      nights: recent.length,
      avgDurationLabel: formatMinutesAsHoursMin(avgMin),
      avgQualityPct: Math.round(avgQuality),
    };
  }, [sortedSessions]);

  const cycleRecommendations = useMemo(
    () => computeSleepCycleRecommendations(calcMode, calcBaseTime, 15),
    [calcMode, calcBaseTime],
  );

  const activeAnalytics = useMemo(
    () => (activeSession ? computeSleepSessionAnalytics(activeSession) : null),
    [activeSession],
  );

  // 4-Level Stepped Hypnogram SVG geometry for activeSession
  const hypnogram = useMemo(() => {
    if (!activeSession || activeSession.timeline.length === 0) return null;
    const pts = activeSession.timeline;
    const width = 640;
    const leftPad = 68;
    const rightPad = 18;
    const plotWidth = width - leftPad - rightPad;
    const bottomY = 172;
    const maxOffset = Math.max(5, pts[pts.length - 1].minuteOffset);
    const intervalFallback = pts.length > 1 ? maxOffset / (pts.length - 1) : 5;

    const segments = pts.map((p, idx) => {
      const startOff = p.minuteOffset;
      const nextOff =
        idx < pts.length - 1 ? pts[idx + 1].minuteOffset : startOff + intervalFallback;
      const clampedEnd = Math.max(startOff + 1, Math.min(maxOffset + intervalFallback, nextOff));
      const x1 = leftPad + (startOff / (maxOffset + intervalFallback)) * plotWidth;
      const x2 = leftPad + (clampedEnd / (maxOffset + intervalFallback)) * plotWidth;
      const y = phaseToY(p.phase);
      return {
        idx,
        x1,
        x2,
        y,
        color: phaseColorHex(p.phase),
        point: p,
      };
    });

    // Stepped path (H / V transitions)
    let stepPath = '';
    segments.forEach((seg, idx) => {
      if (idx === 0) {
        stepPath += `M ${seg.x1.toFixed(1)} ${seg.y.toFixed(1)} H ${seg.x2.toFixed(1)}`;
      } else {
        stepPath += ` V ${seg.y.toFixed(1)} H ${seg.x2.toFixed(1)}`;
      }
    });
    const lastSeg = segments[segments.length - 1];
    const firstSeg = segments[0];
    const areaPath = `${stepPath} V ${bottomY} H ${firstSeg.x1.toFixed(1)} Z`;

    // 90-minute cycle boundary markers
    const totalTimelineSpan = maxOffset + intervalFallback;
    const cycleMarkers: { label: string; x: number }[] = [];
    for (let m = 90, c = 1; m < totalTimelineSpan; m += 90, c += 1) {
      cycleMarkers.push({
        label: `C${c}`,
        x: leftPad + (m / totalTimelineSpan) * plotWidth,
      });
    }

    // Hour / milestone ticks along bottom axis
    const startMs = Date.parse(activeSession.bedtimeAt);
    const xTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => {
      const offsetMin = Math.round(totalTimelineSpan * frac);
      const label = Number.isNaN(startMs)
        ? `${Math.floor(offsetMin / 60)}h`
        : formatClockTime(new Date(startMs + offsetMin * 60_000));
      return {
        x: leftPad + frac * plotWidth,
        label,
      };
    });

    return {
      width,
      leftPad,
      rightPad,
      bottomY,
      segments,
      stepPath,
      areaPath,
      cycleMarkers,
      xTicks,
    };
  }, [activeSession]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-indigo-300 text-xs font-bold">
              <Moon className="w-4 h-4" />
              <span>Monitor nocturno y recuperación</span>
            </div>
            <h2 className="mt-1 text-2xl sm:text-3xl font-extrabold font-display text-white">
              Sueño y Descanso
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Alarma inteligente en sueño ligero, sonidos relajantes y sincronización directa con tu Check-In diario.
            </p>
          </div>

          {weeklyStats && (
            <div className="grid grid-cols-2 gap-3 shrink-0">
              <div className="rounded-2xl border border-[#252A36] bg-[#0D0F14] px-4 py-2.5">
                <p className="text-[11px] text-zinc-400">Promedio ({weeklyStats.nights}n)</p>
                <p className="text-base font-extrabold font-mono tabular-nums text-white">
                  {weeklyStats.avgDurationLabel}
                </p>
              </div>
              <div className="rounded-2xl border border-[#252A36] bg-[#0D0F14] px-4 py-2.5">
                <p className="text-[11px] text-zinc-400">Calidad media</p>
                <p className="text-base font-extrabold font-mono tabular-nums text-indigo-300">
                  {weeklyStats.avgQualityPct}%
                </p>
              </div>
            </div>
          )}
        </div>

        {justSavedMsg && (
          <div className="mt-4 rounded-2xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 flex items-center gap-2.5 text-xs sm:text-sm text-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{justSavedMsg}</span>
          </div>
        )}
      </div>

      {/* Main 2-column Setup + Soundscape Studio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Smart Alarm & Night Monitor Setup */}
        <section className="lg:col-span-7 rounded-3xl border border-[#222631] bg-[#12141A] p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-indigo-500/15 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
                <AlarmClock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Alarma Inteligente</h3>
                <p className="text-xs text-zinc-400">
                  Despierta progresivamente al detectar movimiento ligero
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleToggleTestAlarm}
              className={`min-h-[40px] rounded-xl border px-3 text-xs font-bold flex items-center gap-1.5 transition-colors ${
                isTestingAlarm
                  ? 'border-amber-400 bg-amber-400/20 text-amber-200'
                  : 'border-[#2B303C] bg-[#171A23] text-zinc-300 hover:text-white'
              }`}
            >
              <BellRing className="w-3.5 h-3.5" />
              {isTestingAlarm ? 'Detener prueba' : 'Probar alarma'}
            </button>
          </div>

          {/* Time & Window Picker */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center rounded-2xl border border-[#242834] bg-[#0D0F14] p-4">
            <div>
              <label
                htmlFor="sleep-wake-time"
                className="block text-xs font-semibold text-zinc-400 mb-1.5"
              >
                Hora límite para despertar
              </label>
              <input
                id="sleep-wake-time"
                type="time"
                value={targetWakeTime}
                onChange={(e) => setTargetWakeTime(e.target.value || '07:00')}
                className="w-full min-h-[54px] rounded-2xl border border-[#2C3140] bg-[#141720] px-4 text-3xl font-extrabold font-mono tabular-nums text-white focus:border-[#D4FF33] focus:outline-none"
              />
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-semibold text-zinc-400">
                Ventana inteligente previa
              </span>
              <div className="grid grid-cols-3 gap-2">
                {WINDOW_OPTIONS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setSmartWindowMin(w)}
                    className={`min-h-[44px] rounded-xl text-xs font-mono font-bold transition-colors ${
                      smartWindowMin === w
                        ? 'bg-[#D4FF33] text-[#0A0B0D]'
                        : 'border border-[#2A2F3D] bg-[#151822] text-zinc-300 hover:text-white'
                    }`}
                  >
                    {w} min
                  </button>
                ))}
              </div>
              <p className="text-xs text-indigo-300 font-mono tabular-nums">
                Ventana activa: {previewWindow.windowStartLabel} – {previewWindow.targetLabel}
              </p>
            </div>
          </div>

          {/* Sensor Toggles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setUseMicMonitor((v) => !v)}
              className={`min-h-[52px] rounded-2xl border px-3.5 py-2.5 flex items-center justify-between gap-2 text-left transition-colors ${
                useMicMonitor
                  ? 'border-indigo-400/50 bg-indigo-500/10 text-white'
                  : 'border-[#252A36] bg-[#0D0F14] text-zinc-400'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {useMicMonitor ? (
                  <Mic className="w-4 h-4 text-indigo-300 shrink-0" />
                ) : (
                  <MicOff className="w-4 h-4 text-zinc-500 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate">Amplitud de micrófono</p>
                  <p className="text-[11px] text-zinc-400 truncate">
                    Detecta ronquidos sin guardar audio
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-bold shrink-0">
                {useMicMonitor ? 'Activo' : 'Off'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setUseMotionMonitor((v) => !v)}
              className={`min-h-[52px] rounded-2xl border px-3.5 py-2.5 flex items-center justify-between gap-2 text-left transition-colors ${
                useMotionMonitor
                  ? 'border-indigo-400/50 bg-indigo-500/10 text-white'
                  : 'border-[#252A36] bg-[#0D0F14] text-zinc-400'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Smartphone className="w-4 h-4 text-indigo-300 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate">Acelerómetro nocturno</p>
                  <p className="text-[11px] text-zinc-400 truncate">
                    Movimiento ligero en colchón
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-bold shrink-0">
                {useMotionMonitor ? 'Activo' : 'Off'}
              </span>
            </button>
          </div>

          {/* Primary Start Sleep CTA + Demo Preview */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={() => void handleStartSleepMode()}
              className="flex-1 min-h-[56px] rounded-2xl bg-[#D4FF33] hover:bg-[#c5f022] px-6 text-base font-extrabold text-[#0A0B0D] flex items-center justify-center gap-2.5 active:scale-[0.98] transition-transform"
            >
              <Moon className="w-5 h-5" />
              Iniciar modo dormir
            </button>

            <button
              type="button"
              onClick={handleSaveDemoNight}
              className="min-h-[56px] rounded-2xl border border-[#2C3140] bg-[#161923] hover:border-indigo-400/50 px-4 text-xs font-bold text-zinc-200 flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4 text-indigo-300" />
              Simular noche (7h 45m)
            </button>
          </div>
        </section>

        {/* Right: Sleep Soundscape Player (Web Audio API) */}
        <section className="lg:col-span-5 rounded-3xl border border-[#222631] bg-[#12141A] p-5 sm:p-6 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-300">
                  <Volume2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Sonidos para dormir</h3>
                  <p className="text-xs text-zinc-400">
                    Audio Web sintetizado en tiempo real
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleToggleSoundPlay}
                className={`min-h-[42px] px-3.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-colors ${
                  isSoundPlaying
                    ? 'bg-sky-400 text-[#0A0B0D]'
                    : 'border border-[#2C3140] bg-[#171B25] text-white hover:border-sky-400/50'
                }`}
              >
                {isSoundPlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    Pausar
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Escuchar
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {SOUNDSCAPES.map(({ id, label, subtitle, Icon }) => {
                const selected = soundscape === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleSelectSoundscape(id)}
                    className={`min-h-[60px] rounded-2xl border p-3 text-left transition-colors ${
                      selected
                        ? 'border-sky-400/60 bg-sky-500/10 text-white'
                        : 'border-[#252A36] bg-[#0D0F14] text-zinc-300 hover:border-zinc-600'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          selected ? 'text-sky-300' : 'text-zinc-400'
                        }`}
                      />
                      <span className="text-xs font-bold truncate">{label}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-400 truncate">{subtitle}</p>
                  </button>
                );
              })}
            </div>

            {/* Volume slider */}
            <div className="rounded-2xl border border-[#242834] bg-[#0D0F14] p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Volumen ambiente</span>
                <span className="font-mono tabular-nums font-bold text-white">
                  {Math.round(soundVolume * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={soundVolume}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                className="w-full accent-sky-400"
              />
            </div>
          </div>

          {/* Auto-off timer */}
          <div className="space-y-2 pt-2 border-t border-white/5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-sky-300" />
                Apagado automático
              </span>
              {isSoundPlaying && soundRemainingSec !== null && (
                <span className="font-mono tabular-nums font-bold text-sky-300">
                  Apaga en {formatCountdownSec(soundRemainingSec)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {TIMER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setSoundTimerMin(opt.value);
                    if (isSoundPlaying) {
                      setSoundRemainingSec(opt.value > 0 ? opt.value * 60 : null);
                    }
                  }}
                  className={`min-h-[40px] rounded-xl text-xs font-bold transition-colors ${
                    soundTimerMin === opt.value
                      ? 'bg-sky-400 text-[#0A0B0D]'
                      : 'border border-[#262B38] bg-[#0D0F14] text-zinc-300 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* 90-Minute Sleep/Wake Cycle Calculator */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white">
                Calculadora de ciclos de 90 min
              </h3>
              <p className="text-xs text-zinc-400">
                Despierta al final de un ciclo completo (incluye ~15 min para conciliar el sueño)
              </p>
            </div>
          </div>

          <div className="inline-flex rounded-2xl border border-[#252A36] bg-[#0D0F14] p-1 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => {
                setCalcMode('bedtime');
                setCalcBaseTime('23:00');
              }}
              className={`min-h-[38px] px-3 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                calcMode === 'bedtime'
                  ? 'bg-[#D4FF33] text-[#0A0B0D]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Si me duermo a las...
            </button>
            <button
              type="button"
              onClick={() => {
                setCalcMode('waketime');
                setCalcBaseTime(targetWakeTime);
              }}
              className={`min-h-[38px] px-3 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                calcMode === 'waketime'
                  ? 'bg-[#D4FF33] text-[#0A0B0D]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Si despierto a las...
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-stretch">
          <div className="md:col-span-3 rounded-2xl border border-[#242834] bg-[#0D0F14] p-3.5 flex flex-col justify-center">
            <label
              htmlFor="sleep-cycle-calc-time"
              className="text-[11px] font-semibold text-zinc-400 mb-1"
            >
              {calcMode === 'bedtime' ? 'Hora de acostarte' : 'Hora deseada de despertar'}
            </label>
            <input
              id="sleep-cycle-calc-time"
              type="time"
              value={calcBaseTime}
              onChange={(e) => setCalcBaseTime(e.target.value || '23:00')}
              className="w-full min-h-[46px] rounded-xl border border-[#2C3140] bg-[#141720] px-3 text-xl font-extrabold font-mono tabular-nums text-white focus:border-[#D4FF33] focus:outline-none"
            />
          </div>

          <div className="md:col-span-9 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {cycleRecommendations.map((rec) => (
              <div
                key={rec.cycles}
                className={`rounded-2xl border p-3.5 flex flex-col justify-between gap-2 ${
                  rec.isRecommended
                    ? 'border-[#D4FF33]/50 bg-[#D4FF33]/10'
                    : 'border-[#242834] bg-[#0D0F14]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-zinc-300 font-mono tabular-nums">
                    {rec.cycles} ciclos · {rec.sleepHoursLabel}
                  </span>
                  {rec.isRecommended && (
                    <span className="text-[10px] font-extrabold text-[#D4FF33] uppercase tracking-wide">
                      Óptimo
                    </span>
                  )}
                </div>

                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-extrabold font-mono tabular-nums text-white">
                    {rec.timeHHMM}
                  </span>
                  <span className="text-[11px] text-zinc-400">
                    {calcMode === 'bedtime' ? 'Despertar' : 'Acostarse'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (calcMode === 'bedtime') {
                      setTargetWakeTime(rec.timeHHMM);
                    } else {
                      setTargetWakeTime(calcBaseTime);
                    }
                    setJustSavedMsg(
                      calcMode === 'bedtime'
                        ? `Alarma ajustada a las ${rec.timeHHMM} para completar ${rec.cycles} ciclos de 90 min.`
                        : `Alarma ajustada a las ${calcBaseTime}. Intenta dormir a las ${rec.timeHHMM} para ${rec.cycles} ciclos.`,
                    );
                  }}
                  className={`min-h-[38px] w-full rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                    rec.isRecommended
                      ? 'bg-[#D4FF33] text-[#0A0B0D] hover:bg-[#c5f022]'
                      : 'border border-[#2C3140] bg-[#151822] text-zinc-200 hover:border-emerald-400/50'
                  }`}
                >
                  {calcMode === 'bedtime' ? 'Usar en alarma' : 'Fijar alarma'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Night Summary & 4-Phase Stepped Hypnogram */}
      {activeSession && activeAnalytics ? (
        <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span>{activeSession.date}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {formatClockTime(activeSession.bedtimeAt)} –{' '}
                  {formatClockTime(activeSession.wakeUpAt)}
                </span>
                {activeSession.triggeredBySmartAlarm && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#D4FF33] font-semibold">
                      Despertar inteligente
                    </span>
                  </>
                )}
              </div>
              <h3 className="mt-1 text-xl sm:text-2xl font-extrabold font-display text-white">
                Resumen de la mañana: 4 fases y ciclos
              </h3>
            </div>

            {/* Automatic Check-in Sync Indicator */}
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 flex items-center gap-2.5 shrink-0">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="text-xs">
                <p className="font-bold text-emerald-200">
                  Check-In diario sincronizado
                </p>
                <p className="text-zinc-300 font-mono tabular-nums">
                  {todayReadiness
                    ? `Preparación hoy: ${todayReadiness.score}/100 · ${todayReadiness.sleepHours}h`
                    : `${(activeSession.durationMinutes / 60).toFixed(1)}h registradas`}
                </p>
              </div>
            </div>
          </div>

          {/* 4 Headline Sleep KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-[#242834] bg-[#0D0F14] p-3.5">
              <p className="text-xs text-zinc-400">Tiempo dormido</p>
              <p className="mt-1 text-xl font-extrabold font-mono tabular-nums text-white">
                {formatMinutesAsHoursMin(activeSession.durationMinutes)}
              </p>
            </div>
            <div className="rounded-2xl border border-[#242834] bg-[#0D0F14] p-3.5">
              <p className="text-xs text-zinc-400">Calidad de sueño</p>
              <p className="mt-1 text-xl font-extrabold font-mono tabular-nums text-[#D4FF33]">
                {activeSession.sleepQualityPct}%
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-3.5">
              <p className="text-xs text-zinc-400">Ciclos de 90 min</p>
              <p className="mt-1 text-xl font-extrabold font-mono tabular-nums text-emerald-300">
                {activeAnalytics.completedCycles90} completos
              </p>
              <p className="text-[11px] font-mono tabular-nums text-zinc-400">
                +{activeAnalytics.partialCycleMin} min en ciclo parcial
              </p>
            </div>
            <div className="rounded-2xl border border-[#242834] bg-[#0D0F14] p-3.5">
              <p className="text-xs text-zinc-400">Ruidos / Ronquidos</p>
              <p className="mt-1 text-xl font-extrabold font-mono tabular-nums text-amber-300">
                {activeSession.snoreEventsCount} / {activeSession.noiseEventsCount}
              </p>
            </div>
          </div>

          {/* 4-Level Stepped Hypnogram SVG Chart */}
          {hypnogram && (
            <div className="rounded-2xl border border-[#242834] bg-[#0B0D12] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="font-bold text-white">Hipnograma nocturno (intervalos de 5 min)</span>
                  <span className="ml-2 text-[11px] text-zinc-400">
                    · Ciclos C1–C{Math.max(1, activeAnalytics.completedCycles90)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px]">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#FB923C]">
                    <span className="w-2 h-2 rounded-full bg-[#FB923C]" />
                    Despierto
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#22D3EE]">
                    <span className="w-2 h-2 rounded-full bg-[#22D3EE]" />
                    REM
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#60A5FA]">
                    <span className="w-2 h-2 rounded-full bg-[#60A5FA]" />
                    Ligero
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#34D399]">
                    <span className="w-2 h-2 rounded-full bg-[#34D399]" />
                    Profundo
                  </span>
                </div>
              </div>

              <div className="w-full overflow-x-auto">
                <svg
                  viewBox={`0 0 ${hypnogram.width} 198`}
                  className="w-full min-w-[500px] h-52"
                  role="img"
                  aria-label="Hipnograma de 4 fases del sueño"
                >
                  <defs>
                    <linearGradient id="sleepHypnoSteppedFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FB923C" stopOpacity="0.16" />
                      <stop offset="35%" stopColor="#22D3EE" stopOpacity="0.22" />
                      <stop offset="68%" stopColor="#60A5FA" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#34D399" stopOpacity="0.34" />
                    </linearGradient>
                  </defs>

                  {/* 4 Horizontal Phase Zone Bands */}
                  <rect
                    x={hypnogram.leftPad}
                    y={12}
                    width={hypnogram.width - hypnogram.leftPad - hypnogram.rightPad}
                    height={32}
                    fill="#FB923C"
                    fillOpacity="0.04"
                    rx="4"
                  />
                  <rect
                    x={hypnogram.leftPad}
                    y={52}
                    width={hypnogram.width - hypnogram.leftPad - hypnogram.rightPad}
                    height={32}
                    fill="#22D3EE"
                    fillOpacity="0.04"
                    rx="4"
                  />
                  <rect
                    x={hypnogram.leftPad}
                    y={94}
                    width={hypnogram.width - hypnogram.leftPad - hypnogram.rightPad}
                    height={32}
                    fill="#60A5FA"
                    fillOpacity="0.04"
                    rx="4"
                  />
                  <rect
                    x={hypnogram.leftPad}
                    y={136}
                    width={hypnogram.width - hypnogram.leftPad - hypnogram.rightPad}
                    height={32}
                    fill="#34D399"
                    fillOpacity="0.06"
                    rx="4"
                  />

                  {/* Horizontal Phase Guides */}
                  {[26, 68, 110, 152].map((yPos) => (
                    <line
                      key={yPos}
                      x1={hypnogram.leftPad}
                      y1={yPos}
                      x2={hypnogram.width - hypnogram.rightPad}
                      y2={yPos}
                      stroke="#232836"
                      strokeDasharray="3 4"
                    />
                  ))}

                  {/* 90-Minute Cycle Vertical Markers */}
                  {hypnogram.cycleMarkers.map((cm) => (
                    <g key={cm.label}>
                      <line
                        x1={cm.x}
                        y1={12}
                        x2={cm.x}
                        y2={hypnogram.bottomY}
                        stroke="#2E3546"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={cm.x}
                        y={10}
                        textAnchor="middle"
                        fill="#71717A"
                        fontSize="9"
                        fontFamily="monospace"
                      >
                        {cm.label}
                      </text>
                    </g>
                  ))}

                  {/* Y-axis 4 Phase Labels */}
                  <text x="6" y="30" fill="#FB923C" fontSize="10" fontWeight="700">
                    Despierto
                  </text>
                  <text x="6" y="72" fill="#22D3EE" fontSize="10" fontWeight="700">
                    REM
                  </text>
                  <text x="6" y="114" fill="#60A5FA" fontSize="10" fontWeight="700">
                    Ligero
                  </text>
                  <text x="6" y="156" fill="#34D399" fontSize="10" fontWeight="700">
                    Profundo
                  </text>

                  {/* Stepped Area + Neutral Connector Path */}
                  <path d={hypnogram.areaPath} fill="url(#sleepHypnoSteppedFill)" />
                  <path
                    d={hypnogram.stepPath}
                    fill="none"
                    stroke="#475569"
                    strokeOpacity="0.55"
                    strokeWidth="1.5"
                    strokeLinejoin="miter"
                  />

                  {/* Color-coded 5-minute horizontal phase steps */}
                  {hypnogram.segments.map((seg) => (
                    <line
                      key={seg.idx}
                      x1={seg.x1}
                      y1={seg.y}
                      x2={seg.x2}
                      y2={seg.y}
                      stroke={seg.color}
                      strokeWidth="4.5"
                      strokeLinecap="butt"
                    />
                  ))}

                  {/* Noise / Snore event markers */}
                  {hypnogram.segments
                    .filter((seg) => seg.point.snoreOrNoiseEvent)
                    .map((seg) => (
                      <circle
                        key={`ev_${seg.idx}`}
                        cx={(seg.x1 + seg.x2) / 2}
                        cy={seg.y}
                        r="4.5"
                        fill="#F59E0B"
                        stroke="#0B0D12"
                        strokeWidth="1.5"
                      />
                    ))}

                  {/* X-axis Hour Ticks */}
                  {hypnogram.xTicks.map((tick, idx) => (
                    <text
                      key={idx}
                      x={tick.x}
                      y="191"
                      textAnchor={
                        idx === 0
                          ? 'start'
                          : idx === hypnogram.xTicks.length - 1
                            ? 'end'
                            : 'middle'
                      }
                      fill="#71717A"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {tick.label}
                    </text>
                  ))}
                </svg>
              </div>
            </div>
          )}

          {/* 4-Phase Breakdown vs Healthy Ranges */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-white">
                Desglose por fase vs. rango saludable
              </h4>
              <span className="text-[11px] text-zinc-400">
                Tiempo exacto y porcentaje de la noche
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {activeAnalytics.phases.map((p) => {
                const statusBadgeStyle =
                  p.status === 'Óptimo'
                    ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
                    : p.status === 'Bajo'
                      ? 'text-amber-300 border-amber-500/30 bg-amber-500/10'
                      : 'text-orange-300 border-orange-500/30 bg-orange-500/10';
                return (
                  <div
                    key={p.phase}
                    className="rounded-2xl border border-[#242834] bg-[#0D0F14] p-3.5 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-white">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: p.colorHex }}
                        />
                        {p.label}
                      </span>
                      <span
                        className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold ${statusBadgeStyle}`}
                      >
                        {p.status}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-lg font-extrabold font-mono tabular-nums text-white">
                        {formatMinutesAsHoursMin(p.minutes)}
                      </span>
                      <span
                        className="text-sm font-extrabold font-mono tabular-nums"
                        style={{ color: p.colorHex }}
                      >
                        {p.pct}%
                      </span>
                    </div>

                    <div className="h-2 rounded-full bg-[#191D28] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, Math.max(4, p.pct))}%`,
                          backgroundColor: p.colorHex,
                        }}
                      />
                    </div>

                    <p className="text-[11px] text-zinc-400 font-mono tabular-nums">
                      Rango sano: {p.healthyRangeLabel}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Physical vs. Mental Recovery Impact + Mexican Spanish Recommendation */}
          <div className="rounded-2xl border border-[#242834] bg-[#0D0F14] p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#D4FF33]" />
                <h4 className="text-sm font-bold text-white">
                  Impacto en Recuperación Física vs. Mental
                </h4>
              </div>
              <span className="text-[11px] text-zinc-400">
                Sincronizado con tu Check-In diario
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-200">
                    <Dumbbell className="w-3.5 h-3.5 text-emerald-400" />
                    Recuperación Física
                  </span>
                  <span className="text-lg font-extrabold font-mono tabular-nums text-emerald-300">
                    {activeAnalytics.physicalRecoveryPct}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[#181D27] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all duration-300"
                    style={{ width: `${activeAnalytics.physicalRecoveryPct}%` }}
                  />
                </div>
                <p className="text-[11px] text-zinc-400 font-mono tabular-nums">
                  Impulsada por {activeAnalytics.deepPct}% de Sueño Profundo ({formatMinutesAsHoursMin(activeAnalytics.deepMin)})
                </p>
              </div>

              <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/5 p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-cyan-200">
                    <Brain className="w-3.5 h-3.5 text-cyan-400" />
                    Recuperación Mental / Enfoque
                  </span>
                  <span className="text-lg font-extrabold font-mono tabular-nums text-cyan-300">
                    {activeAnalytics.mentalRecoveryPct}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[#181D27] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-cyan-400 transition-all duration-300"
                    style={{ width: `${activeAnalytics.mentalRecoveryPct}%` }}
                  />
                </div>
                <p className="text-[11px] text-zinc-400 font-mono tabular-nums">
                  Impulsada por {activeAnalytics.remPct}% de Sueño REM ({formatMinutesAsHoursMin(activeAnalytics.remMin)})
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[#D4FF33]/25 bg-[#D4FF33]/5 px-3.5 py-2.5 flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-[#D4FF33] shrink-0 mt-0.5" />
              <p className="text-xs text-zinc-200 leading-relaxed">
                <strong className="text-[#D4FF33]">Recomendación para hoy: </strong>
                {activeAnalytics.recommendation}
              </p>
            </div>
          </div>

          {/* Noise & Snore Events Log */}
          <div className="space-y-2.5">
            <h4 className="text-sm font-bold text-white">
              Registro de ruidos y ronquidos ({activeSession.noiseEvents.length})
            </h4>
            {activeSession.noiseEvents.length === 0 ? (
              <p className="rounded-2xl border border-[#242834] bg-[#0D0F14] px-4 py-3 text-xs text-zinc-400">
                Noche silenciosa sin picos acústicos o ronquidos significativos detectados.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {activeSession.noiseEvents.slice(0, 8).map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-2xl border border-[#242834] bg-[#0D0F14] px-3.5 py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">{ev.label}</p>
                      <p className="text-[11px] text-zinc-400 font-mono tabular-nums">
                        {formatClockTime(ev.timestamp)} · Min +{ev.minuteOffset}
                      </p>
                    </div>
                    <span className="font-mono tabular-nums text-xs font-bold text-amber-300 shrink-0">
                      {ev.intensity}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-6 text-center space-y-2">
          <Moon className="w-8 h-8 text-indigo-300 mx-auto" />
          <h3 className="text-base font-bold text-white">
            Aún no hay noches registradas
          </h3>
          <p className="text-xs text-zinc-400 max-w-md mx-auto">
            Usa &ldquo;Iniciar modo dormir&rdquo; antes de acostarte o presiona &ldquo;Simular noche&rdquo; para ver el hipnograma de 4 fases, ciclos de 90 min y tu recuperación física y mental.
          </p>
        </section>
      )}

      {/* IndexedDB Sleep History List */}
      {sortedSessions.length > 0 && (
        <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white">
              Historial de sueño (IndexedDB)
            </h3>
            <span className="text-xs text-zinc-400 font-mono tabular-nums">
              {sortedSessions.length} registro{sortedSessions.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="space-y-2">
            {sortedSessions.map((s) => {
              const isSelected = activeSession?.id === s.id;
              const sAnalytics = computeSleepSessionAnalytics(s);
              return (
                <div
                  key={s.id}
                  className={`rounded-2xl border p-3.5 flex items-center justify-between gap-3 transition-colors ${
                    isSelected
                      ? 'border-indigo-400/60 bg-indigo-500/10'
                      : 'border-[#242834] bg-[#0D0F14] hover:border-zinc-700'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedSessionId(s.id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <span className="font-mono tabular-nums">{s.date}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formatClockTime(s.bedtimeAt)} – {formatClockTime(s.wakeUpAt)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-emerald-300">
                        {sAnalytics.completedCycles90} ciclos
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-extrabold font-mono tabular-nums text-white">
                        {formatMinutesAsHoursMin(s.durationMinutes)}
                      </span>
                      <span className="text-xs font-mono tabular-nums font-bold text-[#D4FF33]">
                        Calidad {s.sleepQualityPct}%
                      </span>
                      <span className="text-xs font-mono tabular-nums text-zinc-400">
                        Profundo {sAnalytics.deepPct}% · REM {sAnalytics.remPct}% · Física {sAnalytics.physicalRecoveryPct}% · Mental {sAnalytics.mentalRecoveryPct}%
                      </span>
                    </div>
                  </button>

                  <InlineDeleteConfirmButton
                    onConfirm={() => onDeleteSleepSession(s.id)}
                    ariaLabel={`Eliminar noche del ${s.date}`}
                    size="md"
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Pure OLED Black (#000000) Full-Screen Night Monitor Overlay */}
      {isSleeping && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Monitor nocturno activo"
          className={`fixed inset-0 z-50 flex flex-col justify-between p-6 sm:p-10 transition-colors duration-700 ${
            isAlarmRinging ? 'bg-[#12151C]' : 'bg-[#000000]'
          }`}
        >
          {/* Top Quiet Status */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
            <div className="flex items-center gap-2">
              <Moon className="w-4 h-4 text-indigo-400/80" />
              <span>Modo nocturno atenuado</span>
              {wakeLockActive && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-zinc-400">
                    <BatteryCharging className="w-3.5 h-3.5" />
                    Pantalla activa
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-3 font-mono tabular-nums">
              <span>Mic: {micActive ? 'OK' : 'Off'}</span>
              <span>Mov: {motionActive ? 'OK' : 'Ciclo'}</span>
              <span>Eventos: {liveEventsCount}</span>
            </div>
          </div>

          {/* Center Dimmed Clock */}
          <div className="text-center space-y-4 my-auto">
            {isAlarmRinging ? (
              <div className="space-y-3">
                <Sun className="w-12 h-12 text-[#D4FF33] mx-auto" />
                <p className="text-sm font-bold text-[#D4FF33]">
                  {alarmTriggeredSmart
                    ? 'Movimiento ligero detectado · Alarma inteligente'
                    : 'Hora de despertar'}
                </p>
              </div>
            ) : (
              <p className="text-xs text-zinc-500 font-mono tabular-nums">
                Ventana inteligente: {previewWindow.windowStartLabel} –{' '}
                {previewWindow.targetLabel}
              </p>
            )}

            <p
              className={`text-6xl sm:text-8xl font-extrabold font-mono tabular-nums tracking-tight ${
                isAlarmRinging ? 'text-white' : 'text-zinc-400'
              }`}
            >
              {formatClockTime(new Date(nowTickMs))}
            </p>

            {sensorNotice && (
              <p className="text-[11px] text-zinc-500 max-w-sm mx-auto">{sensorNotice}</p>
            )}

            {/* Minimal OLED mode refreshes clock only every 60s; live sensor bars appear only if alarm is ringing */}
            {!isAlarmRinging ? (
              <p className="text-[11px] text-zinc-700 font-mono">
                OLED negro activo · reloj cada 60 s
              </p>
            ) : (
              <div className="max-w-xs mx-auto pt-4 space-y-2">
                <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                  <span className="w-16 text-left">Audio</span>
                  <div className="flex-1 h-1.5 rounded-full bg-zinc-900 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500/60 transition-all duration-300"
                      style={{ width: `${Math.max(4, liveAudioLevel)}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                  <span className="w-16 text-left">Movimiento</span>
                  <div className="flex-1 h-1.5 rounded-full bg-zinc-900 overflow-hidden">
                    <div
                      className="h-full bg-sky-500/60 transition-all duration-300"
                      style={{ width: `${Math.max(4, liveMotionLevel)}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Soundscape active mini control inside night screen */}
            {isSoundPlaying && !isAlarmRinging && (
              <div className="pt-3 flex items-center justify-center gap-3 text-xs text-zinc-400">
                <span className="font-mono tabular-nums">
                  Sonido activo
                  {soundRemainingSec !== null
                    ? ` · ${formatCountdownSec(soundRemainingSec)}`
                    : ''}
                </span>
                <button
                  type="button"
                  onClick={stopSoundscape}
                  className="min-h-[36px] rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 text-xs text-zinc-300"
                >
                  Silenciar
                </button>
              </div>
            )}
          </div>

          {/* Bottom Thumb Zone Actions */}
          <div className="max-w-md w-full mx-auto space-y-2.5">
            {isAlarmRinging ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleSnooze5Min}
                  className="min-h-[56px] rounded-2xl border border-[#2C3140] bg-[#171A23] px-5 text-sm font-bold text-white"
                >
                  Posponer 5 min
                </button>
                <button
                  type="button"
                  onClick={() => void handleStopSleepMode()}
                  className="min-h-[56px] rounded-2xl bg-[#D4FF33] px-5 text-sm font-extrabold text-[#0A0B0D]"
                >
                  Detener alarma y guardar
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => void handleStopSleepMode()}
                  className="w-full min-h-[56px] rounded-2xl border border-zinc-800 bg-zinc-900/90 hover:border-indigo-400/50 px-5 text-sm font-bold text-zinc-200"
                >
                  Despertar y detener monitoreo
                </button>
                <button
                  type="button"
                  onClick={handleSimulateLightWakeInWindow}
                  className="w-full min-h-[40px] rounded-xl text-[11px] font-medium text-zinc-500 hover:text-zinc-300"
                >
                  Probar disparo de alarma inteligente ahora
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
