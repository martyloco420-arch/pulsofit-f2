import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bluetooth,
  Check,
  Clock,
  Flame,
  Footprints,
  Gauge,
  Heart,
  MapPin,
  Minus,
  Navigation,
  Pause,
  PauseCircle,
  Play,
  Plus,
  RotateCcw,
  Share2,
  Square,
  Target,
  Timer,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { InlineDeleteConfirmButton } from './InlineDeleteConfirmButton';
import { generateAndShareCardioCard } from '../lib/sessionShareCard';
import {
  computeHeartRateZone,
  connectBluetoothHeartRateMonitor,
  isBluetoothHeartRateSupported,
  type HeartRateDeviceHandle,
} from '../lib/bluetoothHeartRate';
import {
  ACTIVITY_OPTIONS,
  buildKilometerVoiceCue,
  buildTimedVoiceCue,
  classifyGpsSignalQuality,
  computeAvgSpeedKmh,
  estimateCardioCalories,
  estimateCardioSteps,
  formatCardioDuration,
  formatPaceMinKm,
  getActivityMeta,
  haversineDistanceKm,
  validateGpsPoint,
} from '../lib/cardio';
import {
  LOW_POWER_GPS_INTERVAL_MS,
  NORMAL_GPS_INTERVAL_MS,
  useLowPowerMode,
} from '../lib/lowPowerMode';
import { getTodayIsoDate } from '../lib/storage';
import {
  KM_TO_MI,
  displayDistanceToKm,
  formatDistance,
  getDistanceUnit,
  kmToDisplayDistance,
  paceSecPerKmToUnit,
} from '../lib/units';
import { cancelCoachSpeech, speakCoachCue } from '../lib/voiceCoach';
import { evaluateCardioPR } from '../lib/progressiveOverload';
import { useHardwareManager } from '../hooks/useHardwareManager';
import type {
  CardioActivityType,
  CardioSession,
  CardioSplit,
  GpsPoint,
  ShoeGear,
  UserProfile,
} from '../types/fitness';
import { CardioRouteMap } from './CardioRouteMap';

interface CardioTabProps {
  profile: UserProfile;
  cardioSessions: CardioSession[];
  shoes: ShoeGear[];
  initialActivityType?: CardioActivityType | null;
  onClearInitialActivity?: () => void;
  onSaveCardioSession: (session: CardioSession) => void;
  onDeleteCardioSession: (id: string) => void;
  onAddShoe: (name: string, brand?: string) => void;
  onSetActiveShoe: (id: string) => void;
  onDeleteShoe: (id: string) => void;
}

type TrackingPhase = 'idle' | 'running' | 'paused';

export const CardioTab: React.FC<CardioTabProps> = ({
  profile,
  cardioSessions,
  shoes,
  initialActivityType = null,
  onClearInitialActivity,
  onSaveCardioSession,
  onDeleteCardioSession,
  onAddShoe,
  onSetActiveShoe,
  onDeleteShoe,
}) => {
  const distanceUnit = getDistanceUnit(profile.distanceUnit);
  const [activityType, setActivityType] = useState<CardioActivityType>(
    initialActivityType ?? 'correr',
  );
  const [phase, setPhase] = useState<TrackingPhase>('idle');
  const [startedAtIso, setStartedAtIso] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0); // active moving seconds
  const [totalElapsedSec, setTotalElapsedSec] = useState(0); // wall-clock seconds
  const [distanceKm, setDistanceKm] = useState(0);
  const [currentPaceSecPerKm, setCurrentPaceSecPerKm] = useState(0);
  const [routePoints, setRoutePoints] = useState<GpsPoint[]>([]);
  const [previewCenter, setPreviewCenter] = useState<GpsPoint | null>(null);
  const [splits, setSplits] = useState<CardioSplit[]>([]);

  // Walk/Session goal & smart auto-pause settings
  const [targetDistanceKm, setTargetDistanceKm] = useState<number | null>(null);
  const [customGoalInput, setCustomGoalInput] = useState('');
  const [pauseOnTargetReached, setPauseOnTargetReached] = useState(true);
  const [autoPauseEnabled, setAutoPauseEnabled] = useState(true);
  const [isAutoPaused, setIsAutoPaused] = useState(false);
  const [targetReachedBanner, setTargetReachedBanner] = useState(false);

  // Voice Coach state
  const [voiceEnabled, setVoiceEnabled] = useState(profile.voiceCoachEnabled ?? true);
  const [lastVoiceText, setLastVoiceText] = useState<string | null>(null);

  // GPS & WakeLock state
  const [gpsStatus, setGpsStatus] = useState<
    'ready' | 'searching' | 'locked' | 'error' | 'indoor'
  >('ready');
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsAccuracyM, setGpsAccuracyM] = useState<number | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  // Indoor treadmill input helper
  const [manualKmInput, setManualKmInput] = useState('');

  // Shoe tracker state
  const [selectedShoeId, setSelectedShoeId] = useState<string>(() => {
    const active = shoes.find((s) => s.isActive);
    return active?.id ?? shoes[0]?.id ?? '';
  });
  const [showAddShoe, setShowAddShoe] = useState(false);
  const [newShoeName, setNewShoeName] = useState('');
  const [newShoeBrand, setNewShoeBrand] = useState('');

  // History expand + save feedback
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(
    cardioSessions[0]?.id ?? null,
  );
  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [lastCompletedCardio, setLastCompletedCardio] = useState<CardioSession | null>(null);
  const [isGeneratingCardId, setIsGeneratingCardId] = useState<string | null>(null);
  const [cardioCardFeedback, setCardioCardFeedback] = useState<{
    sessionId: string;
    dataUrl: string;
    message: string;
  } | null>(null);

  // Refs for accurate timer, smart auto-pause, GPS accumulation, splits & voice cues
  const phaseRef = useRef<TrackingPhase>('idle');
  const sessionStartWallMsRef = useRef<number | null>(null);
  const accumulatedSecRef = useRef(0);
  const segmentStartMsRef = useRef<number | null>(null);
  const distanceKmRef = useRef(0);
  const routePointsRef = useRef<GpsPoint[]>([]);
  const splitsRef = useRef<CardioSplit[]>([]);
  const lastSplitCumulativeSecRef = useRef(0);
  const lastCueTimestampRef = useRef(0);
  const lastTimedBlockRef = useRef(0);
  const watchIdRef = useRef<number | null>(null);
  const hrHandleRef = useRef<HeartRateDeviceHandle | null>(null);

  // Smart auto-pause & target goal refs
  const autoPauseEnabledRef = useRef(autoPauseEnabled);
  autoPauseEnabledRef.current = autoPauseEnabled;
  const isAutoPausedRef = useRef(false);
  const lastMovementMsRef = useRef<number>(Date.now());
  const pauseAnchorPtRef = useRef<GpsPoint | null>(null);
  const targetDistanceKmRef = useRef<number | null>(targetDistanceKm);
  targetDistanceKmRef.current = targetDistanceKm;
  const pauseOnTargetReachedRef = useRef(pauseOnTargetReached);
  pauseOnTargetReachedRef.current = pauseOnTargetReached;
  const targetReachedRef = useRef(false);

  const [hrBpm, setHrBpm] = useState<number | null>(null);
  const [hrDeviceName, setHrDeviceName] = useState<string | null>(null);
  const [isConnectingHr, setIsConnectingHr] = useState(false);

  useEffect(() => {
    if (initialActivityType && phaseRef.current === 'idle') {
      setActivityType(initialActivityType);
      if (initialActivityType === 'caminar' && targetDistanceKmRef.current === null) {
        setTargetDistanceKm(4);
      }
      onClearInitialActivity?.();
    }
  }, [initialActivityType, onClearInitialActivity]);

  const handleToggleHeartRate = async () => {
    if (hrHandleRef.current) {
      hrHandleRef.current.disconnect();
      hrHandleRef.current = null;
      setHrDeviceName(null);
      setHrBpm(null);
      return;
    }
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
    } catch {
      // User cancelled or Bluetooth unavailable
    } finally {
      setIsConnectingHr(false);
    }
  };

  const activityMeta = useMemo(() => getActivityMeta(activityType), [activityType]);

  // Keep selectedShoeId synced when shoes change
  useEffect(() => {
    if (shoes.length === 0) {
      setSelectedShoeId('');
      return;
    }
    const stillExists = shoes.some((s) => s.id === selectedShoeId);
    if (!stillExists) {
      const active = shoes.find((s) => s.isActive) ?? shoes[0];
      setSelectedShoeId(active.id);
    }
  }, [shoes, selectedShoeId]);

  const activeShoe = useMemo(
    () => shoes.find((s) => s.id === selectedShoeId) ?? null,
    [shoes, selectedShoeId],
  );

  const wornOutShoes = useMemo(
    () => shoes.filter((s) => s.accumulatedKm >= (s.maxAlertKm || 650)),
    [shoes],
  );

  const lowPower = useLowPowerMode();
  const isLowPowerRef = useRef(lowPower.isLowPower);
  isLowPowerRef.current = lowPower.isLowPower;
  const lastGpsSampleMsRef = useRef<number>(0);

  const hardware = useHardwareManager();
  const hardwareRef = useRef(hardware);
  hardwareRef.current = hardware;

  const triggerCue = (text: string, forceSpeak = false) => {
    setLastVoiceText(text);
    if (!voiceEnabled && !forceSpeak) return;
    lastCueTimestampRef.current = Date.now();
    speakCoachCue(text, {
      enabled: true,
      muted: false,
      preferredVoiceUri: profile.preferredVoiceUri,
    });
  };

  const handleShareCardioSession = async (session: CardioSession) => {
    if (isGeneratingCardId) return;
    setIsGeneratingCardId(session.id);
    try {
      const result = await generateAndShareCardioCard({ session, profile });
      setCardioCardFeedback({
        sessionId: session.id,
        dataUrl: result.dataUrl,
        message:
          result.status === 'shared'
            ? 'Tarjeta compartida correctamente.'
            : 'Tarjeta PNG descargada en tu dispositivo.',
      });
    } catch {
      setCardioCardFeedback({
        sessionId: session.id,
        dataUrl: '',
        message: 'No se pudo generar la tarjeta resumen.',
      });
    } finally {
      setIsGeneratingCardId(null);
    }
  };

  // Acquire / release screen Wake Lock via global Hardware Manager
  const acquireWakeLock = async () => {
    const ok = await hardwareRef.current.acquireWakeLock('gps-cardio');
    setWakeLockActive(ok);
  };

  const releaseWakeLock = async () => {
    await hardwareRef.current.releaseWakeLock('gps-cardio');
    setWakeLockActive(false);
  };

  const stopGpsWatch = () => {
    hardwareRef.current.clearGpsWatch();
    if (watchIdRef.current !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  // Sync wakeLock indicator with global hardware manager & cleanup on unmount
  useEffect(() => {
    if (phase === 'running') {
      setWakeLockActive(hardware.wakeLockActive);
    }
  }, [phase, hardware.wakeLockActive]);

  useEffect(() => {
    return () => {
      stopGpsWatch();
      void releaseWakeLock();
      cancelCoachSpeech();
      hrHandleRef.current?.disconnect();
    };
  }, []);

  // Get initial preview GPS fix when idle & GPS mode is selected
  useEffect(() => {
    if (phase !== 'idle') return;
    if (!activityMeta.usesGps) {
      setGpsStatus('indoor');
      setGpsError(null);
      return;
    }
    if (!('geolocation' in navigator)) {
      setGpsStatus('error');
      setGpsError('Tu navegador no soporta geolocalización GPS. Usa Caminadora si entrenas en interior.');
      return;
    }

    setGpsStatus('searching');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const initialAccuracy = Math.round(pos.coords.accuracy);
        setPreviewCenter({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          timestamp: pos.timestamp || Date.now(),
          accuracyM: initialAccuracy,
        });
        setGpsAccuracyM(initialAccuracy);
        setGpsStatus(initialAccuracy <= 25 ? 'locked' : 'searching');
        setGpsError(null);
      },
      () => {
        setGpsStatus('ready');
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 15000 },
    );
  }, [activityMeta.usesGps, phase]);

  // Process newly crossed 1 km splits and trigger voice cue
  const checkAndRecordSplits = (nextDistKm: number, currentElapsedSec: number) => {
    const completedWholeKm = Math.floor(nextDistKm);
    const existingCount = splitsRef.current.length;
    if (completedWholeKm <= existingCount) return;

    const newSplits = [...splitsRef.current];
    let latestSplitSec = 0;

    for (let km = existingCount + 1; km <= completedWholeKm; km += 1) {
      const splitTimeSec = Math.max(
        1,
        Math.round(currentElapsedSec - lastSplitCumulativeSecRef.current),
      );
      lastSplitCumulativeSecRef.current = currentElapsedSec;
      latestSplitSec = splitTimeSec;
      newSplits.push({
        kmNumber: km,
        splitTimeSec,
        paceSecPerKm: splitTimeSec,
        cumulativeSec: Math.round(currentElapsedSec),
      });
    }

    splitsRef.current = newSplits;
    setSplits(newSplits);

    if (voiceEnabled && completedWholeKm > 0) {
      let cueText = buildKilometerVoiceCue(
        completedWholeKm,
        currentElapsedSec,
        latestSplitSec,
        distanceUnit,
      );
      if (completedWholeKm % 5 === 0) {
        const blockSplits = newSplits.slice(completedWholeKm - 5, completedWholeKm);
        const fiveKmSec = blockSplits.reduce((acc, s) => acc + s.splitTimeSec, 0);
        const fiveKmMin = Math.floor(fiveKmSec / 60);
        const fiveKmRemSec = fiveKmSec % 60;
        cueText += ` Bloque de 5 kilómetros completado en ${fiveKmMin} minutos y ${fiveKmRemSec} segundos.`;
      }
      triggerCue(cueText);
    }
  };

  const handlePauseSession = (customCue?: string) => {
    if (phaseRef.current !== 'running') return;
    if (segmentStartMsRef.current && !isAutoPausedRef.current) {
      accumulatedSecRef.current += (Date.now() - segmentStartMsRef.current) / 1000;
    }
    segmentStartMsRef.current = null;
    isAutoPausedRef.current = false;
    setIsAutoPaused(false);
    setElapsedSec(Math.floor(accumulatedSecRef.current));
    if (sessionStartWallMsRef.current) {
      setTotalElapsedSec(
        Math.max(
          Math.floor(accumulatedSecRef.current),
          Math.floor((Date.now() - sessionStartWallMsRef.current) / 1000),
        ),
      );
    }
    phaseRef.current = 'paused';
    setPhase('paused');
    stopGpsWatch();
    void releaseWakeLock();
    if (voiceEnabled) {
      triggerCue(customCue ?? 'Sesión en pausa.');
    }
  };

  const checkTargetDistanceReached = (nextDistKm: number) => {
    const goalKm = targetDistanceKmRef.current;
    if (!goalKm || goalKm <= 0 || targetReachedRef.current) return;
    if (nextDistKm < goalKm) return;

    targetReachedRef.current = true;
    setTargetReachedBanner(true);
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate([200, 100, 200, 100, 300]);
      }
    } catch {
      // Ignore vibration errors
    }

    const goalDisplay = formatDistance(goalKm, distanceUnit, 1);
    const cueMsg = pauseOnTargetReachedRef.current
      ? `¡Meta de ${goalDisplay} alcanzada! Sesión pausada automáticamente.`
      : `¡Meta de ${goalDisplay} alcanzada! Excelente ritmo, puedes continuar si lo deseas.`;

    if (pauseOnTargetReachedRef.current && phaseRef.current === 'running') {
      handlePauseSession(cueMsg);
    } else if (voiceEnabled) {
      triggerCue(cueMsg);
    }
  };

  // Elapsed timer (active vs total wall-clock) + smart GPS auto-pause + 5-min cues
  useEffect(() => {
    if (phase === 'idle') return;

    const tick = () => {
      const now = Date.now();
      if (sessionStartWallMsRef.current) {
        setTotalElapsedSec(Math.max(0, Math.floor((now - sessionStartWallMsRef.current) / 1000)));
      }

      if (phaseRef.current !== 'running') return;

      // Smart Auto-Pause detection while GPS running
      if (
        autoPauseEnabledRef.current &&
        activityMeta.usesGps &&
        !isAutoPausedRef.current &&
        accumulatedSecRef.current + (segmentStartMsRef.current ? (now - segmentStartMsRef.current) / 1000 : 0) >= 8 &&
        now - lastMovementMsRef.current >= 8000
      ) {
        if (segmentStartMsRef.current) {
          accumulatedSecRef.current += (now - segmentStartMsRef.current) / 1000;
          segmentStartMsRef.current = null;
        }
        isAutoPausedRef.current = true;
        setIsAutoPaused(true);
        const pts = routePointsRef.current;
        pauseAnchorPtRef.current = pts[pts.length - 1] ?? null;
        setCurrentPaceSecPerKm(0);
      }

      const segSec =
        !isAutoPausedRef.current && segmentStartMsRef.current
          ? (now - segmentStartMsRef.current) / 1000
          : 0;
      const activeTotal = Math.max(0, Math.floor(accumulatedSecRef.current + segSec));
      setElapsedSec(activeTotal);

      // Every 5 minutes (300s) of active time, announce progress
      const fiveMinBlock = Math.floor(activeTotal / 300);
      if (fiveMinBlock > lastTimedBlockRef.current && activeTotal >= 300) {
        lastTimedBlockRef.current = fiveMinBlock;
        const dist = distanceKmRef.current;
        const avgPace = dist > 0.02 ? activeTotal / dist : 0;
        if (voiceEnabled && now - lastCueTimestampRef.current > 25000) {
          triggerCue(buildTimedVoiceCue(fiveMinBlock * 5, dist, avgPace, distanceUnit));
        }
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase, activityMeta.usesGps, voiceEnabled, distanceUnit]);

  const startGpsWatch = () => {
    if (!activityMeta.usesGps || !('geolocation' in navigator)) return;
    stopGpsWatch();
    setGpsStatus('searching');
    setGpsError(null);
    lastGpsSampleMsRef.current = 0;

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const nowSampleMs = Date.now();
        const pts = routePointsRef.current;
        const minSampleGapMs = isLowPowerRef.current
          ? LOW_POWER_GPS_INTERVAL_MS
          : NORMAL_GPS_INTERVAL_MS;

        if (
          phaseRef.current === 'running' &&
          pts.length > 0 &&
          nowSampleMs - lastGpsSampleMsRef.current < minSampleGapMs
        ) {
          return;
        }

        const accuracy = Math.round(pos.coords.accuracy);
        setGpsAccuracyM(accuracy);

        const nextPt: GpsPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          timestamp: pos.timestamp || nowSampleMs,
          accuracyM: accuracy,
        };

        setPreviewCenter(nextPt);
        setGpsStatus(accuracy <= 25 ? 'locked' : 'searching');
        setGpsError(null);

        if (phaseRef.current !== 'running') return;

        if (pts.length === 0) {
          // Initial anchor point: accept if coords.accuracy <= 50m
          const initialValidation = validateGpsPoint(nextPt, null);
          if (initialValidation.accepted) {
            lastGpsSampleMsRef.current = nowSampleMs;
            routePointsRef.current = [nextPt];
            setRoutePoints([nextPt]);
            lastMovementMsRef.current = nowSampleMs;
            pauseAnchorPtRef.current = nextPt;
          }
          return;
        }

        lastGpsSampleMsRef.current = nowSampleMs;

        const lastPt = pts[pts.length - 1];
        const validation = validateGpsPoint(nextPt, lastPt);
        if (!validation.accepted) {
          return;
        }

        const speedMps =
          typeof pos.coords.speed === 'number' ? pos.coords.speed : null;

        // If smart auto-paused, check whether user started moving again
        if (isAutoPausedRef.current) {
          const anchor = pauseAnchorPtRef.current ?? lastPt;
          const movedFromAnchorKm = haversineDistanceKm(anchor, nextPt);
          const hasMovingSpeed =
            (speedMps !== null && speedMps >= 0.6) ||
            validation.speedMps >= 0.6;
          if (hasMovingSpeed || movedFromAnchorKm >= 0.008) {
            isAutoPausedRef.current = false;
            setIsAutoPaused(false);
            segmentStartMsRef.current = Date.now();
            lastMovementMsRef.current = Date.now();
            pauseAnchorPtRef.current = null;
            if (
              voiceEnabled &&
              Date.now() - lastCueTimestampRef.current > 8000
            ) {
              triggerCue('Movimiento detectado, reanudando.');
            }
          } else {
            return;
          }
        }

        const segKm = validation.distanceKm;

        lastMovementMsRef.current = Date.now();
        pauseAnchorPtRef.current = nextPt;

        const updatedPoints = [...pts, nextPt];
        routePointsRef.current = updatedPoints;
        setRoutePoints(updatedPoints);

        const nextDist = distanceKmRef.current + segKm;
        distanceKmRef.current = nextDist;
        setDistanceKm(nextDist);

        // Calculate smoothed current pace over last ~30s or last few segments
        let windowDistKm = 0;
        let windowSec = 0;
        for (let i = updatedPoints.length - 1; i > 0; i -= 1) {
          const pB = updatedPoints[i];
          const pA = updatedPoints[i - 1];
          windowDistKm += haversineDistanceKm(pA, pB);
          windowSec += Math.max(1, (pB.timestamp - pA.timestamp) / 1000);
          if (windowSec >= 25 || i === updatedPoints.length - 6) break;
        }
        if (windowDistKm > 0.01 && windowSec > 0) {
          setCurrentPaceSecPerKm(windowSec / windowDistKm);
        }

        const currentSegSec =
          !isAutoPausedRef.current && segmentStartMsRef.current
            ? (Date.now() - segmentStartMsRef.current) / 1000
            : 0;
        const currentElapsed = accumulatedSecRef.current + currentSegSec;
        checkAndRecordSplits(nextDist, currentElapsed);
        checkTargetDistanceReached(nextDist);
      },
      (err) => {
        setGpsStatus('error');
        if (err.code === err.PERMISSION_DENIED) {
          setGpsError(
            'Permiso de ubicación denegado. Actívalo en tu navegador o cambia a modo Caminadora.',
          );
        } else if (err.code === err.TIMEOUT) {
          setGpsError('Señal GPS lenta. Acércate a cielo abierto mientras el reloj sigue corriendo.');
        } else {
          setGpsError('No se pudo leer el GPS. El cronómetro sigue activo.');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: isLowPowerRef.current ? LOW_POWER_GPS_INTERVAL_MS : 1000,
        timeout: 12000,
      },
    );
    watchIdRef.current = id;
    hardwareRef.current.registerGpsWatch(id);
  };

  // Reconfigure GPS watch interval if Low Power Mode toggles mid-session
  useEffect(() => {
    if (phase === 'running' && activityMeta.usesGps) {
      startGpsWatch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowPower.isLowPower]);

  const handleStartSession = () => {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    sessionStartWallMsRef.current = nowMs;
    accumulatedSecRef.current = 0;
    segmentStartMsRef.current = nowMs;
    distanceKmRef.current = 0;
    routePointsRef.current = [];
    splitsRef.current = [];
    lastSplitCumulativeSecRef.current = 0;
    lastCueTimestampRef.current = 0;
    lastTimedBlockRef.current = 0;
    lastMovementMsRef.current = nowMs;
    pauseAnchorPtRef.current = null;
    isAutoPausedRef.current = false;
    targetReachedRef.current = false;

    setStartedAtIso(nowIso);
    setElapsedSec(0);
    setTotalElapsedSec(0);
    setDistanceKm(0);
    setCurrentPaceSecPerKm(0);
    setRoutePoints([]);
    setSplits([]);
    setIsAutoPaused(false);
    setTargetReachedBanner(false);
    setConfirmDiscard(false);
    setSavedBanner(null);

    phaseRef.current = 'running';
    setPhase('running');

    void acquireWakeLock();
    if (activityMeta.usesGps) {
      startGpsWatch();
    } else {
      setGpsStatus('indoor');
    }

    if (voiceEnabled) {
      const goalCue =
        targetDistanceKm && targetDistanceKm > 0
          ? ` Meta fijada en ${formatDistance(targetDistanceKm, distanceUnit, 1)}.`
          : '';
      triggerCue(
        `Iniciando sesión de ${activityMeta.label}.${goalCue} Avisos de ritmo activos cada kilómetro y cada 5 minutos.`,
      );
    }
  };

  const handleResumeSession = () => {
    if (phase !== 'paused') return;
    const nowMs = Date.now();
    segmentStartMsRef.current = nowMs;
    lastMovementMsRef.current = nowMs;
    isAutoPausedRef.current = false;
    setIsAutoPaused(false);
    phaseRef.current = 'running';
    setPhase('running');
    void acquireWakeLock();
    if (activityMeta.usesGps) {
      startGpsWatch();
    }
    if (voiceEnabled) {
      triggerCue('Reanudando actividad.');
    }
  };

  const adjustIndoorDistance = (deltaKm: number) => {
    const next = Math.max(0, Math.round((distanceKmRef.current + deltaKm) * 100) / 100);
    distanceKmRef.current = next;
    setDistanceKm(next);

    const currentSegSec =
      phaseRef.current === 'running' && !isAutoPausedRef.current && segmentStartMsRef.current
        ? (Date.now() - segmentStartMsRef.current) / 1000
        : 0;
    const currentElapsed = accumulatedSecRef.current + currentSegSec;

    if (next > 0.02 && currentElapsed > 0) {
      setCurrentPaceSecPerKm(currentElapsed / next);
    }
    if (deltaKm > 0) {
      checkAndRecordSplits(next, currentElapsed);
      checkTargetDistanceReached(next);
    }
  };

  const applyManualKmInput = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(manualKmInput.replace(',', '.'));
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 300) return;
    const targetKm = Math.round(displayDistanceToKm(parsed, distanceUnit) * 100) / 100;
    const delta = targetKm - distanceKmRef.current;
    adjustIndoorDistance(delta);
    setManualKmInput('');
  };

  const handleFinishAndSave = () => {
    const nowMs = Date.now();
    const finalSegSec =
      phaseRef.current === 'running' && !isAutoPausedRef.current && segmentStartMsRef.current
        ? (nowMs - segmentStartMsRef.current) / 1000
        : 0;
    const finalActiveSec = Math.max(1, Math.round(accumulatedSecRef.current + finalSegSec));
    const wallSec = sessionStartWallMsRef.current
      ? Math.max(finalActiveSec, Math.round((nowMs - sessionStartWallMsRef.current) / 1000))
      : finalActiveSec;
    const pausedSec = Math.max(0, wallSec - finalActiveSec);

    const finalDist = Math.round(distanceKmRef.current * 100) / 100;
    const avgPace = finalDist > 0.02 ? Math.round(finalActiveSec / finalDist) : 0;
    const avgSpeedKmh = computeAvgSpeedKmh(finalDist, finalActiveSec);
    const estimatedSteps = estimateCardioSteps(
      activityType,
      finalDist,
      finalActiveSec,
      profile.heightCm,
    );
    const caloriesBurned = estimateCardioCalories(
      activityType,
      profile.weightKg,
      finalActiveSec,
      finalDist,
    );

    const completedIso = new Date(nowMs).toISOString();
    const baseSession: CardioSession = {
      id: `cardio_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
      date: getTodayIsoDate(),
      activityType,
      startedAt: startedAtIso ?? completedIso,
      completedAt: completedIso,
      durationSec: finalActiveSec,
      totalDurationSec: wallSec,
      pausedDurationSec: pausedSec,
      distanceKm: finalDist,
      avgPaceSecPerKm: avgPace,
      avgSpeedKmh,
      estimatedSteps,
      caloriesBurned,
      targetDistanceKm,
      pauseOnTargetReached,
      routePoints: routePointsRef.current,
      splits: splitsRef.current,
      shoeId: activeShoe?.id ?? null,
      shoeName: activeShoe
        ? `${activeShoe.brand ? `${activeShoe.brand} ` : ''}${activeShoe.name}`
        : null,
    };

    const cardioPr = evaluateCardioPR(baseSession, cardioSessions);
    const session: CardioSession = {
      ...baseSession,
      ...(cardioPr.isPR ? { isPR: true, prLabels: cardioPr.prLabels } : {}),
    };

    stopGpsWatch();
    void releaseWakeLock();
    phaseRef.current = 'idle';
    isAutoPausedRef.current = false;
    setIsAutoPaused(false);
    setPhase('idle');

    onSaveCardioSession(session);
    setExpandedSessionId(session.id);
    setLastCompletedCardio(session);
    setCardioCardFeedback(null);
    setSavedBanner(
      `Sesión guardada: ${formatDistance(finalDist, distanceUnit)} · ${caloriesBurned} kcal sumadas a Nutrición`,
    );

    if (voiceEnabled) {
      const spokenDist = kmToDisplayDistance(finalDist, distanceUnit)
        .toFixed(2)
        .replace('.', ' punto ');
      const unitWord = distanceUnit === 'mi' ? 'millas' : 'kilómetros';
      triggerCue(
        `Sesión finalizada y guardada. Distancia total ${spokenDist} ${unitWord} y ${caloriesBurned} calorías quemadas.`,
      );
    }
  };

  const handleDiscardSession = () => {
    stopGpsWatch();
    void releaseWakeLock();
    cancelCoachSpeech();
    phaseRef.current = 'idle';
    isAutoPausedRef.current = false;
    targetReachedRef.current = false;
    sessionStartWallMsRef.current = null;
    setPhase('idle');
    setIsAutoPaused(false);
    setTargetReachedBanner(false);
    setElapsedSec(0);
    setTotalElapsedSec(0);
    setDistanceKm(0);
    setCurrentPaceSecPerKm(0);
    setRoutePoints([]);
    setSplits([]);
    setConfirmDiscard(false);
  };

  const avgPaceSecPerKm =
    distanceKm > 0.02 && elapsedSec > 0 ? elapsedSec / distanceKm : 0;
  const liveAvgSpeedKmh = computeAvgSpeedKmh(distanceKm, elapsedSec);
  const liveDisplaySpeed =
    distanceUnit === 'mi'
      ? Math.round(liveAvgSpeedKmh * KM_TO_MI * 10) / 10
      : liveAvgSpeedKmh;
  const liveEstimatedSteps = estimateCardioSteps(
    activityType,
    distanceKm,
    elapsedSec,
    profile.heightCm,
  );
  const liveCalories = estimateCardioCalories(
    activityType,
    profile.weightKg,
    elapsedSec,
    distanceKm,
  );

  const handleCreateShoe = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShoeName.trim()) return;
    onAddShoe(newShoeName.trim(), newShoeBrand.trim() || undefined);
    setNewShoeName('');
    setNewShoeBrand('');
    setShowAddShoe(false);
  };

  const totalCardioKmAllTime = useMemo(
    () => cardioSessions.reduce((acc, s) => acc + s.distanceKm, 0),
    [cardioSessions],
  );

  return (
    <div className="space-y-6">
      {/* Post-Cardio Summary & Share Card Modal */}
      {lastCompletedCardio && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl border border-[#262B36] bg-[#13151A] p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[#D4FF33]">
                  {getActivityMeta(lastCompletedCardio.activityType).label} guardada
                </p>
                <h3 className="mt-0.5 text-2xl sm:text-3xl font-extrabold font-display tracking-tight text-white">
                  Ruta completada
                </h3>
                {lastCompletedCardio.isPR && (
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-400/60 bg-gradient-to-r from-amber-400/20 via-[#D4FF33]/20 to-amber-400/15 px-3 py-1 text-xs font-extrabold text-amber-200">
                    <Trophy className="w-3.5 h-3.5 text-[#D4FF33]" />
                    <span>
                      PR
                      {lastCompletedCardio.prLabels &&
                      lastCompletedCardio.prLabels.length > 0
                        ? ` · ${lastCompletedCardio.prLabels.join(' · ')}`
                        : ''}
                    </span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setLastCompletedCardio(null)}
                aria-label="Cerrar resumen de cardio"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-2xl bg-[#1A1D24] p-3 text-center">
                <p className="text-[11px] text-zinc-400">Distancia</p>
                <p className="mt-0.5 text-xl font-extrabold font-mono tabular-nums text-[#D4FF33]">
                  {formatDistance(lastCompletedCardio.distanceKm, distanceUnit, 2)}
                </p>
              </div>
              <div className="rounded-2xl bg-[#1A1D24] p-3 text-center">
                <p className="text-[11px] text-zinc-400">Tiempo activo</p>
                <p className="mt-0.5 text-xl font-extrabold font-mono tabular-nums text-white">
                  {formatCardioDuration(lastCompletedCardio.durationSec)}
                </p>
              </div>
              <div className="rounded-2xl bg-[#1A1D24] p-3 text-center">
                <p className="text-[11px] text-zinc-400">Ritmo promedio</p>
                <p className="mt-0.5 text-lg font-extrabold font-mono tabular-nums text-sky-300">
                  {formatPaceMinKm(
                    paceSecPerKmToUnit(lastCompletedCardio.avgPaceSecPerKm, distanceUnit),
                  )}
                  <span className="text-[11px] text-zinc-400">/{distanceUnit}</span>
                </p>
              </div>
              <div className="rounded-2xl bg-[#1A1D24] p-3 text-center">
                <p className="text-[11px] text-zinc-400">Calorías</p>
                <p className="mt-0.5 text-lg font-extrabold font-mono tabular-nums text-amber-300">
                  {lastCompletedCardio.caloriesBurned} kcal
                </p>
              </div>
            </div>

            {lastCompletedCardio.routePoints.length > 0 && (
              <CardioRouteMap
                points={lastCompletedCardio.routePoints}
                heightClass="h-44"
                interactive={false}
              />
            )}

            {cardioCardFeedback?.sessionId === lastCompletedCardio.id && (
              <div className="rounded-2xl border border-[#D4FF33]/35 bg-[#0D0F14] p-2.5 flex items-center gap-3">
                {cardioCardFeedback.dataUrl && (
                  <img
                    src={cardioCardFeedback.dataUrl}
                    alt="Vista previa tarjeta cardio"
                    className="w-12 h-14 object-cover rounded-xl border border-white/10 shrink-0"
                  />
                )}
                <p className="text-xs font-semibold text-[#D4FF33]">
                  {cardioCardFeedback.message}
                </p>
              </div>
            )}

            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={() => void handleShareCardioSession(lastCompletedCardio)}
                disabled={isGeneratingCardId === lastCompletedCardio.id}
                className="w-full min-h-[48px] rounded-2xl border border-[#D4FF33]/45 bg-[#D4FF33]/12 px-4 text-sm font-extrabold text-[#D4FF33] inline-flex items-center justify-center gap-2 hover:bg-[#D4FF33]/20 active:scale-[0.98] transition-all disabled:opacity-60"
              >
                <Share2 className="w-4 h-4" />
                {isGeneratingCardId === lastCompletedCardio.id
                  ? 'Generando tarjeta...'
                  : 'Generar Tarjeta Resumen'}
              </button>
              <button
                type="button"
                onClick={() => setLastCompletedCardio(null)}
                className="w-full min-h-[48px] rounded-2xl bg-[#D4FF33] px-4 text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header & Voice Coach Switch */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold font-display tracking-tight text-white">
            Cardio y rastreo GPS
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Mapa en vivo, parciales cada 1 km, avisos de voz y control de tenis
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isBluetoothHeartRateSupported() && (
            <button
              type="button"
              onClick={handleToggleHeartRate}
              disabled={isConnectingHr}
              className={`min-h-[48px] inline-flex items-center justify-center gap-2 rounded-2xl border px-3.5 text-xs font-bold transition-colors ${
                hrDeviceName
                  ? 'border-rose-400/50 bg-rose-500/15 text-rose-200'
                  : 'border-[#262B36] bg-[#14171F] text-zinc-200 hover:border-[#D4FF33]'
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
          <button
            type="button"
            onClick={() => {
              const next = !voiceEnabled;
              setVoiceEnabled(next);
              if (!next) cancelCoachSpeech();
            }}
            className={`min-h-[48px] inline-flex items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-bold transition-colors shrink-0 ${
              voiceEnabled
                ? 'border-[#D4FF33] bg-[#D4FF33]/15 text-[#D4FF33]'
                : 'border-[#262B36] bg-[#14171F] text-zinc-400'
            }`}
          >
            {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            Coach de Voz: {voiceEnabled ? 'Activo' : 'Apagado'}
          </button>
        </div>
      </div>

      {hrBpm !== null && (() => {
        const zone = computeHeartRateZone(hrBpm, profile.age);
        return (
          <div className={`rounded-2xl border px-4 py-2.5 flex items-center justify-between ${zone.bgClass}`}>
            <span className="flex items-center gap-2 text-xs font-bold text-white">
              <Heart className="w-4 h-4 text-rose-400 fill-rose-400" />
              {hrDeviceName}
            </span>
            <span className="font-mono tabular-nums text-sm font-extrabold text-white">
              <span className={`mr-2 ${zone.colorClass}`}>{zone.shortLabel} ({zone.pctMax}%)</span>
              {hrBpm} BPM
            </span>
          </div>
        );
      })()}

      {/* Saved Confirmation Banner */}
      {savedBanner && (
        <div
          role="status"
          className="rounded-2xl border border-[#D4FF33]/40 bg-[#D4FF33]/10 px-4 py-3.5 flex items-center justify-between gap-3 text-sm text-[#D4FF33] font-semibold"
        >
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{savedBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSavedBanner(null)}
            className="text-xs text-zinc-300 underline"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* 650 km / ~404 mi Shoe Wear Global Alert */}
      {wornOutShoes.length > 0 && (
        <div
          role="alert"
          className="rounded-2xl border border-amber-500/50 bg-amber-950/35 px-4 py-3.5 flex items-start gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-100">
            <p className="font-bold">
              Alerta de desgaste en tus tenis (+{formatDistance(650, distanceUnit, 0)})
            </p>
            <p className="text-xs text-amber-200/80 mt-0.5">
              {wornOutShoes
                .map(
                  (s) =>
                    `${s.brand ? `${s.brand} ` : ''}${s.name} (${formatDistance(s.accumulatedKm, distanceUnit, 1)})`,
                )
                .join(' · ')}{' '}
              — Considera renovarlos para proteger tus articulaciones.
            </p>
          </div>
        </div>
      )}

      {/* Activity Type Selector (Locked while session active) */}
      <section className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {ACTIVITY_OPTIONS.map((opt) => {
            const selected = activityType === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={phase !== 'idle'}
                onClick={() => setActivityType(opt.id)}
                className={`min-h-[60px] rounded-2xl border p-3 text-left transition-all disabled:opacity-60 ${
                  selected
                    ? 'border-[#D4FF33] bg-[#D4FF33] text-[#0A0B0D]'
                    : 'border-[#222631] bg-[#12141A] text-white hover:bg-[#181C24]'
                }`}
              >
                <p className="text-sm font-extrabold">{opt.label}</p>
                <p
                  className={`text-[11px] mt-0.5 ${
                    selected ? 'text-[#0A0B0D]/80 font-semibold' : 'text-zinc-400'
                  }`}
                >
                  {opt.subtitle}
                </p>
              </button>
            );
          })}
        </div>

        {/* Pre-session Target Distance & Smart Auto-Pause Setup */}
        {phase === 'idle' && (
          <div className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-[#D4FF33]" />
                <p className="text-sm font-extrabold text-white">
                  Objetivo de distancia ({activityType === 'caminar' ? 'Caminata' : activityMeta.label})
                </p>
              </div>
              <span className="text-xs font-mono text-[#D4FF33] font-bold">
                {targetDistanceKm
                  ? `Meta: ${formatDistance(targetDistanceKm, distanceUnit, 1)}`
                  : 'Libre (sin meta)'}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {[null, 3, 4, 5, 7, 10].map((kmVal) => {
                const selected = targetDistanceKm === kmVal;
                return (
                  <button
                    key={kmVal === null ? 'free' : kmVal}
                    type="button"
                    onClick={() => {
                      setTargetDistanceKm(kmVal);
                      setCustomGoalInput('');
                    }}
                    className={`min-h-[42px] px-3.5 rounded-xl border text-xs font-extrabold transition-colors ${
                      selected
                        ? 'border-[#D4FF33] bg-[#D4FF33] text-[#0A0B0D]'
                        : 'border-[#262B36] bg-[#161922] text-zinc-200 hover:border-zinc-500'
                    }`}
                  >
                    {kmVal === null ? 'Sin meta' : formatDistance(kmVal, distanceUnit, distanceUnit === 'mi' ? 1 : 0)}
                  </button>
                );
              })}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const parsed = parseFloat(customGoalInput.replace(',', '.'));
                  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 200) return;
                  const km = Math.round(displayDistanceToKm(parsed, distanceUnit) * 100) / 100;
                  setTargetDistanceKm(km);
                }}
                className="flex items-center gap-1.5"
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={customGoalInput}
                  onChange={(e) => setCustomGoalInput(e.target.value)}
                  placeholder={`Otro (${distanceUnit})`}
                  className="w-24 min-h-[42px] rounded-xl border border-[#262B36] bg-[#0D0F14] px-2.5 text-xs font-mono text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
                />
                {customGoalInput.trim() && (
                  <button
                    type="submit"
                    className="min-h-[42px] rounded-xl bg-[#D4FF33]/20 border border-[#D4FF33]/40 px-2.5 text-xs font-bold text-[#D4FF33]"
                  >
                    Fijar
                  </button>
                )}
              </form>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              {activityMeta.usesGps && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoPauseEnabled}
                  onClick={() => setAutoPauseEnabled((v) => !v)}
                  className={`min-h-[46px] rounded-2xl border px-3.5 py-2 flex items-center justify-between gap-2 text-left transition-colors ${
                    autoPauseEnabled
                      ? 'border-[#D4FF33]/40 bg-[#D4FF33]/10 text-white'
                      : 'border-[#252A36] bg-[#0D0F14] text-zinc-400'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold">Auto-pausa inteligente</p>
                    <p className="text-[11px] text-zinc-400 truncate">
                      Pausa al detenerte y reanuda al caminar
                    </p>
                  </div>
                  <span
                    className={`rounded-lg px-2 py-0.5 text-[10px] font-extrabold shrink-0 ${
                      autoPauseEnabled
                        ? 'bg-[#D4FF33] text-[#0A0B0D]'
                        : 'bg-[#1E2330] text-zinc-400'
                    }`}
                  >
                    {autoPauseEnabled ? 'ON' : 'OFF'}
                  </span>
                </button>
              )}

              {targetDistanceKm !== null && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={pauseOnTargetReached}
                  onClick={() => setPauseOnTargetReached((v) => !v)}
                  className={`min-h-[46px] rounded-2xl border px-3.5 py-2 flex items-center justify-between gap-2 text-left transition-colors ${
                    pauseOnTargetReached
                      ? 'border-[#D4FF33]/40 bg-[#D4FF33]/10 text-white'
                      : 'border-[#252A36] bg-[#0D0F14] text-zinc-400'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold">Pausar al alcanzar meta</p>
                    <p className="text-[11px] text-zinc-400 truncate">
                      Detiene el reloj al completar {formatDistance(targetDistanceKm, distanceUnit, 1)}
                    </p>
                  </div>
                  <span
                    className={`rounded-lg px-2 py-0.5 text-[10px] font-extrabold shrink-0 ${
                      pauseOnTargetReached
                        ? 'bg-[#D4FF33] text-[#0A0B0D]'
                        : 'bg-[#1E2330] text-zinc-400'
                    }`}
                  >
                    {pauseOnTargetReached ? 'ON' : 'OFF'}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Live Map / Indoor Banner + Real-Time Metrics Panel */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-4">
        {/* GPS & WakeLock & Auto-Pause Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {(() => {
              if (gpsStatus === 'indoor') {
                return (
                  <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30">
                    <Navigation className="w-3.5 h-3.5" />
                    Modo interior (Caminadora sin GPS)
                  </span>
                );
              }
              if (gpsStatus === 'error') {
                return (
                  <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                    <Navigation className="w-3.5 h-3.5" />
                    GPS no disponible
                  </span>
                );
              }
              const signal = classifyGpsSignalQuality(gpsAccuracyM);
              const badgeClasses =
                signal.quality === 'optima'
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                  : signal.quality === 'aceptable'
                    ? 'bg-[#D4FF33]/15 text-[#D4FF33] border border-[#D4FF33]/35'
                    : 'bg-amber-500/15 text-amber-300 border border-amber-500/30';
              return (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-bold ${badgeClasses}`}
                >
                  <Navigation className="w-3.5 h-3.5" />
                  Señal GPS: {signal.label}
                  {gpsAccuracyM !== null ? ` (±${gpsAccuracyM} m)` : ''}
                </span>
              );
            })()}

            {isAutoPaused && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/20 border border-amber-400/40 px-2.5 py-1 font-extrabold text-amber-200">
                <PauseCircle className="w-3.5 h-3.5" />
                Auto-pausa (detenido)
              </span>
            )}

            {wakeLockActive && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-[#D4FF33]/15 border border-[#D4FF33]/35 px-2.5 py-1 font-bold text-[#D4FF33]">
                Pantalla / GPS bloqueado activo
              </span>
            )}
          </div>

          {activeShoe && (
            <span className="text-zinc-400 font-semibold">
              Tenis: <strong className="text-zinc-200">{activeShoe.name}</strong>
            </span>
          )}
        </div>

        {/* Target Progress Bar during live session */}
        {phase !== 'idle' && targetDistanceKm && targetDistanceKm > 0 && (
          <div className="rounded-2xl border border-[#252A36] bg-[#0D0F14] p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-zinc-200 flex items-center gap-1.5">
                <Target className="w-4 h-4 text-[#D4FF33]" />
                Meta: {formatDistance(targetDistanceKm, distanceUnit, 1)}
              </span>
              <span className="font-mono tabular-nums font-extrabold text-[#D4FF33]">
                {Math.min(100, Math.round((distanceKm / targetDistanceKm) * 100))}%
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-[#1C202B] overflow-hidden">
              <div
                className="h-full bg-[#D4FF33] transition-all duration-300"
                style={{
                  width: `${Math.min(100, Math.round((distanceKm / targetDistanceKm) * 100))}%`,
                }}
              />
            </div>
            {targetReachedBanner && (
              <p className="text-xs font-bold text-[#D4FF33]">
                ¡Objetivo completado! Puedes finalizar o reanudar para sumar distancia extra.
              </p>
            )}
          </div>
        )}

        {gpsError && (
          <p className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-200">
            {gpsError}
          </p>
        )}

        {/* Interactive Leaflet + OpenStreetMap Route Map */}
        {activityMeta.usesGps ? (
          <CardioRouteMap
            points={routePoints}
            liveCenter={previewCenter}
            heightClass="h-64 sm:h-72"
            interactive={true}
          />
        ) : (
          <div className="rounded-2xl border border-[#252A36] bg-[#0D0F14] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-white">
                Control manual de distancia en caminadora
              </p>
              <span className="text-xs font-mono text-[#D4FF33]">
                {formatDistance(distanceKm, distanceUnit)}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                disabled={phase === 'idle'}
                onClick={() => adjustIndoorDistance(displayDistanceToKm(-0.1, distanceUnit))}
                className="min-h-[48px] rounded-xl border border-[#2A2F3D] bg-[#161922] text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-1"
              >
                <Minus className="w-4 h-4" />
                0.1
              </button>
              <button
                type="button"
                disabled={phase === 'idle'}
                onClick={() => adjustIndoorDistance(displayDistanceToKm(0.1, distanceUnit))}
                className="min-h-[48px] rounded-xl border border-[#2A2F3D] bg-[#161922] text-sm font-bold text-[#D4FF33] disabled:opacity-40"
              >
                +0.1 {distanceUnit}
              </button>
              <button
                type="button"
                disabled={phase === 'idle'}
                onClick={() => adjustIndoorDistance(displayDistanceToKm(0.5, distanceUnit))}
                className="min-h-[48px] rounded-xl border border-[#2A2F3D] bg-[#161922] text-sm font-bold text-[#D4FF33] disabled:opacity-40"
              >
                +0.5 {distanceUnit}
              </button>
              <button
                type="button"
                disabled={phase === 'idle'}
                onClick={() => adjustIndoorDistance(displayDistanceToKm(1.0, distanceUnit))}
                className="min-h-[48px] rounded-xl border border-[#D4FF33]/40 bg-[#D4FF33]/15 text-sm font-bold text-[#D4FF33] disabled:opacity-40"
              >
                +1.0 {distanceUnit}
              </button>
            </div>
            <form onSubmit={applyManualKmInput} className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                disabled={phase === 'idle'}
                value={manualKmInput}
                onChange={(e) => setManualKmInput(e.target.value)}
                placeholder={`Distancia exacta en ${distanceUnit} (ej. 5.25)`}
                className="flex-1 min-h-[46px] rounded-xl border border-[#262B36] bg-[#14171F] px-3.5 text-sm text-white placeholder:text-zinc-500 disabled:opacity-40"
              />
              <button
                type="submit"
                disabled={phase === 'idle' || !manualKmInput}
                className="min-h-[46px] rounded-xl bg-white px-4 text-xs font-extrabold text-[#0A0B0D] disabled:opacity-40"
              >
                Fijar {distanceUnit}
              </button>
            </form>
          </div>
        )}

        {/* High-Contrast Live Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div className="col-span-2 sm:col-span-1 rounded-2xl bg-[#0D0F14] border border-[#222631] p-3.5">
            <p className="text-[11px] font-semibold text-zinc-400">Distancia</p>
            <p className="mt-1 text-3xl font-extrabold font-mono tabular-nums text-[#D4FF33]">
              {kmToDisplayDistance(distanceKm, distanceUnit).toFixed(2)}
              <span className="text-sm font-bold text-zinc-400 ml-1">{distanceUnit}</span>
            </p>
          </div>

          <div className="rounded-2xl bg-[#0D0F14] border border-[#222631] p-3.5">
            <p className="text-[11px] font-semibold text-zinc-400">Tiempo activo</p>
            <p className="mt-1 text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-white">
              {formatCardioDuration(elapsedSec)}
            </p>
            {totalElapsedSec > elapsedSec + 1 && (
              <p className="text-[10px] font-mono tabular-nums text-zinc-400 mt-0.5">
                Total: {formatCardioDuration(totalElapsedSec)}
              </p>
            )}
          </div>

          <div className="rounded-2xl bg-[#0D0F14] border border-[#222631] p-3.5">
            <p className="text-[11px] font-semibold text-zinc-400">Ritmo prom.</p>
            <p className="mt-1 text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-sky-300">
              {formatPaceMinKm(paceSecPerKmToUnit(avgPaceSecPerKm, distanceUnit))}
              <span className="text-xs font-normal text-zinc-400 ml-1">/{distanceUnit}</span>
            </p>
            {currentPaceSecPerKm > 0 && (
              <p className="text-[10px] font-mono tabular-nums text-zinc-400 mt-0.5">
                Actual: {formatPaceMinKm(paceSecPerKmToUnit(currentPaceSecPerKm, distanceUnit))}
              </p>
            )}
          </div>

          <div className="rounded-2xl bg-[#0D0F14] border border-[#222631] p-3.5">
            <p className="text-[11px] font-semibold text-zinc-400">Velocidad</p>
            <p className="mt-1 text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-emerald-300">
              {liveDisplaySpeed.toFixed(1)}
              <span className="text-xs font-normal text-zinc-400 ml-1">
                {distanceUnit === 'mi' ? 'mph' : 'km/h'}
              </span>
            </p>
          </div>

          <div className="rounded-2xl bg-[#0D0F14] border border-[#222631] p-3.5">
            <p className="text-[11px] font-semibold text-zinc-400">Pasos est.</p>
            <p className="mt-1 text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-white">
              {activityType === 'ciclismo' ? '—' : liveEstimatedSteps.toLocaleString('es-ES')}
            </p>
          </div>

          <div className="rounded-2xl bg-[#0D0F14] border border-[#222631] p-3.5">
            <p className="text-[11px] font-semibold text-zinc-400">Calorías est.</p>
            <p className="mt-1 text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-amber-300">
              {liveCalories}
              <span className="text-xs font-normal text-zinc-400 ml-1">kcal</span>
            </p>
          </div>
        </div>

        {/* Last Voice Cue + Manual Announce Button */}
        {phase !== 'idle' && (
          <div className="rounded-2xl border border-[#252A36] bg-[#0E1016] px-3.5 py-2.5 flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-300 truncate">
              {lastVoiceText
                ? `Coach: "${lastVoiceText}"`
                : 'Los avisos de voz sonarán cada 1 km y cada 5 minutos.'}
            </p>
            <button
              type="button"
              onClick={() => {
                const displayDist = kmToDisplayDistance(distanceKm, distanceUnit);
                const distSay = displayDist.toFixed(2).replace('.', ' punto ');
                const totalMin = Math.floor(elapsedSec / 60);
                const totalRemSec = elapsedSec % 60;
                const paceInUnit = paceSecPerKmToUnit(avgPaceSecPerKm, distanceUnit);
                const unitPlural = distanceUnit === 'mi' ? 'millas' : 'kilómetros';
                const unitSingular = distanceUnit === 'mi' ? 'milla' : 'kilómetro';
                const paceText =
                  paceInUnit > 0
                    ? `Ritmo promedio ${Math.floor(paceInUnit / 60)} minutos ${Math.round(paceInUnit % 60)} segundos por ${unitSingular}.`
                    : '';
                triggerCue(
                  `Distancia actual ${distSay} ${unitPlural} en ${totalMin} minutos y ${totalRemSec} segundos. ${paceText}`.trim(),
                  true,
                );
              }}
              className="min-h-[40px] shrink-0 rounded-xl border border-[#2F3545] bg-[#181C25] px-3 text-xs font-bold text-[#D4FF33] inline-flex items-center gap-1.5"
            >
              <Volume2 className="w-3.5 h-3.5" />
              Decir estado
            </button>
          </div>
        )}

        {/* Primary Big Session Action Controls */}
        {phase === 'idle' ? (
          <button
            type="button"
            onClick={handleStartSession}
            className="w-full min-h-[60px] rounded-2xl bg-[#D4FF33] text-[#0A0B0D] text-lg font-extrabold flex items-center justify-center gap-2.5 active:scale-[0.98] transition-transform"
          >
            <Play className="w-5 h-5 fill-current" />
            Iniciar {activityMeta.label}
          </button>
        ) : (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-3">
              {phase === 'running' ? (
                <button
                  type="button"
                  onClick={() => handlePauseSession()}
                  className="min-h-[58px] rounded-2xl bg-amber-400 text-[#0A0B0D] text-base font-extrabold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                >
                  <Pause className="w-5 h-5 fill-current" />
                  Pausar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleResumeSession}
                  className="min-h-[58px] rounded-2xl bg-[#D4FF33] text-[#0A0B0D] text-base font-extrabold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                >
                  <Play className="w-5 h-5 fill-current" />
                  Reanudar
                </button>
              )}

              <button
                type="button"
                onClick={handleFinishAndSave}
                className="min-h-[58px] rounded-2xl bg-white text-[#0A0B0D] text-base font-extrabold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <Square className="w-4 h-4 fill-current" />
                Finalizar y Guardar
              </button>
            </div>

            {!confirmDiscard ? (
              <button
                type="button"
                onClick={() => setConfirmDiscard(true)}
                className="w-full min-h-[44px] rounded-xl text-xs font-semibold text-zinc-400 hover:text-rose-400"
              >
                Descartar sesión sin guardar
              </button>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2">
                <span className="text-xs text-rose-200 font-semibold">
                  ¿Seguro que deseas descartar esta ruta?
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDiscard(false)}
                    className="min-h-[38px] rounded-lg bg-[#1A1D24] px-3 text-xs font-bold text-white"
                  >
                    No
                  </button>
                  <button
                    type="button"
                    onClick={handleDiscardSession}
                    className="min-h-[38px] rounded-lg bg-rose-500 px-3 text-xs font-bold text-white"
                  >
                    Descartar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Live Splits / Laps Table (1 km & 5 km) */}
        {splits.length > 0 && (
          <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Timer className="w-4 h-4 text-[#D4FF33]" />
                Splits exactos por 1 km y 5 km ({splits.length})
              </h3>
              <span className="text-xs text-zinc-400">Parciales oficiales</span>
            </div>

            {splits.length >= 5 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Array.from({ length: Math.floor(splits.length / 5) }, (_, idx) => {
                  const blockSplits = splits.slice(idx * 5, (idx + 1) * 5);
                  const blockSec = blockSplits.reduce((acc, s) => acc + s.splitTimeSec, 0);
                  const avgPace = Math.round(blockSec / 5);
                  const cumul = blockSplits[4]?.cumulativeSec ?? blockSec;
                  return (
                    <div
                      key={`5k_${idx}`}
                      className="rounded-xl border border-[#D4FF33]/35 bg-[#D4FF33]/10 px-3 py-2 flex items-center justify-between text-xs font-mono tabular-nums"
                    >
                      <div>
                        <span className="font-extrabold text-[#D4FF33]">
                          Split 5 km #{idx + 1}
                        </span>
                        <span className="block text-[10px] text-zinc-400">
                          Km {idx * 5 + 1}–{(idx + 1) * 5} · {formatPaceMinKm(avgPace)} {distanceUnit === 'mi' ? '/mi' : '/km'}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-extrabold text-white">
                          {formatCardioDuration(blockSec)}
                        </span>
                        <span className="block text-[10px] text-zinc-400">
                          Acum. {formatCardioDuration(cumul)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="divide-y divide-white/5 text-xs font-mono tabular-nums">
              <div className="grid grid-cols-3 pb-1.5 text-zinc-500 font-sans font-semibold">
                <span>Kilómetro</span>
                <span className="text-center">Tiempo parcial</span>
                <span className="text-right">Acumulado</span>
              </div>
              {splits.map((sp) => (
                <div key={sp.kmNumber} className="grid grid-cols-3 py-2 text-zinc-200">
                  <span className="font-bold text-[#D4FF33]">
                    Km {sp.kmNumber}
                    {sp.kmNumber % 5 === 0 ? ' · 5K' : ''}
                  </span>
                  <span className="text-center font-bold">
                    {formatCardioDuration(sp.splitTimeSec)}
                  </span>
                  <span className="text-right text-zinc-400">
                    {formatCardioDuration(sp.cumulativeSec)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Mis Tenis (Shoe Tracker & 650 km Wear Alert) */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Footprints className="w-5 h-5 text-[#D4FF33]" />
            <div>
              <h2 className="text-xl font-bold font-display text-white">Mis Tenis</h2>
              <p className="text-xs text-zinc-400">
                Desgaste acumulado y alerta automática a los {formatDistance(650, distanceUnit, 0)}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAddShoe((v) => !v)}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-[#2A2F3D] bg-[#171A23] px-3.5 text-xs font-bold text-[#D4FF33]"
          >
            <Plus className="w-4 h-4" />
            Agregar tenis
          </button>
        </div>

        {showAddShoe && (
          <form
            onSubmit={handleCreateShoe}
            className="rounded-2xl border border-[#282D3A] bg-[#0D0F14] p-4 space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                required
                value={newShoeBrand}
                onChange={(e) => setNewShoeBrand(e.target.value)}
                placeholder="Marca (ej. ASICS, Nike, Hoka)"
                className="min-h-[46px] rounded-xl border border-[#262B36] bg-[#14171F] px-3.5 text-sm text-white placeholder:text-zinc-500"
              />
              <input
                type="text"
                required
                value={newShoeName}
                onChange={(e) => setNewShoeName(e.target.value)}
                placeholder="Modelo (ej. Novablast 4, Pegasus)"
                className="min-h-[46px] rounded-xl border border-[#262B36] bg-[#14171F] px-3.5 text-sm text-white placeholder:text-zinc-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddShoe(false)}
                className="min-h-[44px] rounded-xl px-4 text-xs font-semibold text-zinc-400"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="min-h-[44px] rounded-xl bg-[#D4FF33] px-5 text-xs font-extrabold text-[#0A0B0D]"
              >
                Guardar tenis
              </button>
            </div>
          </form>
        )}

        {shoes.length === 0 ? (
          <p className="text-sm text-zinc-400">
            Aún no registras tenis. Agrega tu par habitual para llevar su kilometraje y saber cuándo reemplazarlos.
          </p>
        ) : (
          <div className="space-y-3">
            {shoes.map((shoe) => {
              const limit = shoe.maxAlertKm || 650;
              const pct = Math.min(100, Math.round((shoe.accumulatedKm / limit) * 100));
              const needsReplacement = shoe.accumulatedKm >= limit;
              const isSelected = shoe.id === selectedShoeId;

              return (
                <div
                  key={shoe.id}
                  className={`rounded-2xl border p-4 space-y-2.5 transition-colors ${
                    isSelected
                      ? 'border-[#D4FF33]/60 bg-[#171B22]'
                      : 'border-[#222631] bg-[#0E1015]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedShoeId(shoe.id);
                        onSetActiveShoe(shoe.id);
                      }}
                      className="text-left min-w-0 flex-1"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-extrabold text-white">
                          {shoe.brand ? `${shoe.brand} ` : ''}
                          {shoe.name}
                        </span>
                        {isSelected && (
                          <span className="rounded-md bg-[#D4FF33] px-2 py-0.5 text-[10px] font-extrabold text-[#0A0B0D]">
                            En uso
                          </span>
                        )}
                        {needsReplacement && (
                          <span className="rounded-md bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                            Superó {formatDistance(limit, distanceUnit, 0)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-mono tabular-nums text-zinc-400 mt-1">
                        {kmToDisplayDistance(shoe.accumulatedKm, distanceUnit).toFixed(1)} /{' '}
                        {Math.round(kmToDisplayDistance(limit, distanceUnit))} {distanceUnit} ({pct}%)
                      </p>
                    </button>

                    <InlineDeleteConfirmButton
                      onConfirm={() => onDeleteShoe(shoe.id)}
                      ariaLabel={`Eliminar ${shoe.name}`}
                      size="md"
                    />
                  </div>

                  <div className="h-2.5 w-full rounded-lg bg-[#1F2430] overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        needsReplacement
                          ? 'bg-rose-500'
                          : pct >= 80
                            ? 'bg-amber-400'
                            : 'bg-[#D4FF33]'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Completed Cardio Routes History */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xl font-bold font-display text-white">
            Historial de rutas ({cardioSessions.length})
          </h2>
          <span className="text-xs font-mono tabular-nums text-zinc-400">
            Total acumulado: {formatDistance(totalCardioKmAllTime, distanceUnit, 1)}
          </span>
        </div>

        {cardioSessions.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#2A2F3D] bg-[#12141A] p-7 text-center space-y-2">
            <MapPin className="w-7 h-7 text-zinc-500 mx-auto" />
            <p className="text-sm font-semibold text-zinc-300">
              Todavía no tienes rutas de cardio guardadas
            </p>
            <p className="text-xs text-zinc-500">
              Inicia una carrera, caminata o sesión en caminadora para ver tu mapa, ritmo y calorías.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {cardioSessions.map((session) => {
              const meta = getActivityMeta(session.activityType);
              const isExpanded = expandedSessionId === session.id;
              const dateLabel = new Date(session.completedAt).toLocaleDateString('es-ES', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              });

              // Pace per km chart scaling
              const maxSplitPace = Math.max(
                1,
                ...session.splits.map((s) => s.paceSecPerKm),
              );

              const activeSec = session.durationSec;
              const totalSec = session.totalDurationSec ?? activeSec;
              const pausedSec = session.pausedDurationSec ?? Math.max(0, totalSec - activeSec);
              const sessionSteps =
                session.estimatedSteps ??
                estimateCardioSteps(
                  session.activityType,
                  session.distanceKm,
                  activeSec,
                  profile.heightCm,
                );
              const speedKmh =
                session.avgSpeedKmh ?? computeAvgSpeedKmh(session.distanceKm, activeSec);
              const displaySpeed =
                distanceUnit === 'mi'
                  ? Math.round(speedKmh * KM_TO_MI * 10) / 10
                  : speedKmh;

              return (
                <article
                  key={session.id}
                  className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedSessionId(isExpanded ? null : session.id)
                      }
                      className="text-left flex-1 min-w-0"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-[#D4FF33]">
                          {meta.label}
                        </span>
                        {session.isPR && (
                          <span
                            title={
                              session.prLabels?.join(' · ') || 'Récord Personal'
                            }
                            className="inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-gradient-to-r from-amber-400/25 via-[#D4FF33]/25 to-amber-400/20 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-200"
                          >
                            <Trophy className="w-3 h-3 text-[#D4FF33]" />
                            PR
                            {session.prLabels && session.prLabels.length > 0
                              ? ` · ${session.prLabels.join(' · ')}`
                              : ''}
                          </span>
                        )}
                        <span className="text-xs text-zinc-500">· {dateLabel}</span>
                        {session.targetDistanceKm && session.distanceKm >= session.targetDistanceKm && (
                          <span className="text-[11px] font-bold text-emerald-300">
                            · Meta {formatDistance(session.targetDistanceKm, distanceUnit, 1)} cumplida
                          </span>
                        )}
                        {session.shoeName && (
                          <span className="text-[11px] text-zinc-400 truncate">
                            · {session.shoeName}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 grid grid-cols-4 gap-2 text-xs font-mono tabular-nums">
                        <div>
                          <p className="text-[10px] font-sans text-zinc-500">Distancia</p>
                          <p className="text-base font-extrabold text-white">
                            {formatDistance(session.distanceKm, distanceUnit)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-sans text-zinc-500">T. activo</p>
                          <p className="text-base font-extrabold text-white">
                            {formatCardioDuration(activeSec)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-sans text-zinc-500">Ritmo</p>
                          <p className="text-base font-extrabold text-sky-300">
                            {formatPaceMinKm(
                              paceSecPerKmToUnit(session.avgPaceSecPerKm, distanceUnit),
                            )}
                            <span className="text-[10px] text-zinc-400">/{distanceUnit}</span>
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-sans text-zinc-500">Calorías</p>
                          <p className="text-base font-extrabold text-amber-300">
                            {session.caloriesBurned}
                          </p>
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSessionId(isExpanded ? null : session.id)
                        }
                        className="min-h-[42px] rounded-xl border border-[#2A2F3D] bg-[#171A23] px-3 text-xs font-bold text-zinc-200"
                      >
                        {isExpanded ? 'Ocultar' : 'Ver detalle'}
                      </button>
                      <InlineDeleteConfirmButton
                        onConfirm={() => onDeleteCardioSession(session.id)}
                        ariaLabel="Eliminar sesión de cardio"
                        size="md"
                      />
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="space-y-4 pt-3 border-t border-white/10">
                      {/* Full Walk/Cardio Summary Grid (Active vs Total, Avg Speed, Steps, Pace) */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                        <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3">
                          <p className="text-[11px] text-zinc-400">Tiempo activo vs. total</p>
                          <p className="mt-1 font-mono tabular-nums text-sm font-extrabold text-white">
                            {formatCardioDuration(activeSec)}
                            <span className="text-zinc-500 font-normal"> / {formatCardioDuration(totalSec)}</span>
                          </p>
                          {pausedSec > 0 && (
                            <p className="text-[10px] text-amber-300 mt-0.5 font-mono">
                              Pausa: {formatCardioDuration(pausedSec)}
                            </p>
                          )}
                        </div>

                        <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3">
                          <p className="text-[11px] text-zinc-400 flex items-center gap-1">
                            <Gauge className="w-3.5 h-3.5 text-emerald-400" />
                            Velocidad promedio
                          </p>
                          <p className="mt-1 font-mono tabular-nums text-sm font-extrabold text-emerald-300">
                            {displaySpeed.toFixed(1)} {distanceUnit === 'mi' ? 'mph' : 'km/h'}
                          </p>
                          <p className="text-[10px] text-zinc-400 mt-0.5 font-mono">
                            Ritmo: {formatPaceMinKm(paceSecPerKmToUnit(session.avgPaceSecPerKm, distanceUnit))}/{distanceUnit}
                          </p>
                        </div>

                        <div className="col-span-2 sm:col-span-1 rounded-2xl border border-[#222631] bg-[#0D0F14] p-3">
                          <p className="text-[11px] text-zinc-400 flex items-center gap-1">
                            <Footprints className="w-3.5 h-3.5 text-[#D4FF33]" />
                            Pasos estimados
                          </p>
                          <p className="mt-1 font-mono tabular-nums text-sm font-extrabold text-white">
                            {session.activityType === 'ciclismo'
                              ? 'N/A (Ciclismo)'
                              : sessionSteps.toLocaleString('es-ES')}
                          </p>
                          <p className="text-[10px] text-amber-300 mt-0.5 font-mono">
                            {session.caloriesBurned} kcal quemadas
                          </p>
                        </div>
                      </div>

                      {session.routePoints.length > 0 ? (
                        <CardioRouteMap
                          points={session.routePoints}
                          heightClass="h-52"
                          interactive={false}
                        />
                      ) : (
                        <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3 text-xs text-zinc-400 flex items-center gap-2">
                          <Activity className="w-4 h-4 text-[#D4FF33]" />
                          Sesión registrada sin trazo GPS (modo caminadora o distancia manual).
                        </div>
                      )}

                      {/* Pace Chart + Splits / Laps Table */}
                      {session.splits.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-[#D4FF33]" />
                              Gráfica de ritmo y vueltas (Laps por km)
                            </p>
                            <span className="text-[11px] font-mono text-zinc-400">
                              min/{distanceUnit}
                            </span>
                          </div>

                          <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3.5 space-y-2">
                            {session.splits.map((sp) => {
                              const widthPct = Math.max(
                                18,
                                Math.round((sp.paceSecPerKm / maxSplitPace) * 100),
                              );
                              return (
                                <div
                                  key={sp.kmNumber}
                                  className="grid grid-cols-[46px_1fr_54px] items-center gap-2.5 text-xs font-mono tabular-nums"
                                >
                                  <span className="text-zinc-400">Km {sp.kmNumber}</span>
                                  <div className="h-5 rounded-md bg-[#171B24] overflow-hidden">
                                    <div
                                      className="h-full bg-[#D4FF33] rounded-md"
                                      style={{ width: `${widthPct}%` }}
                                    />
                                  </div>
                                  <span className="text-right font-bold text-white">
                                    {formatPaceMinKm(
                                      paceSecPerKmToUnit(sp.paceSecPerKm, distanceUnit),
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3.5 divide-y divide-white/5 text-xs font-mono tabular-nums">
                            {session.splits.map((sp) => (
                              <div
                                key={sp.kmNumber}
                                className="flex items-center justify-between py-1.5"
                              >
                                <span className="text-[#D4FF33] font-bold">
                                  Lap {sp.kmNumber} (Km {sp.kmNumber})
                                </span>
                                <span className="text-white">
                                  Vuelta: {formatCardioDuration(sp.splitTimeSec)}
                                </span>
                                <span className="text-zinc-400">
                                  Acum: {formatCardioDuration(sp.cumulativeSec)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400 pt-1">
                        <span className="inline-flex items-center gap-1.5">
                          <Flame className="w-3.5 h-3.5 text-amber-400" />
                          {session.caloriesBurned} kcal sincronizadas con Nutrición
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <RotateCcw className="w-3 h-3" />
                          {session.routePoints.length} puntos GPS
                        </span>
                      </div>

                      <div className="pt-1 space-y-2">
                        <button
                          type="button"
                          onClick={() => void handleShareCardioSession(session)}
                          disabled={isGeneratingCardId === session.id}
                          className="w-full min-h-[44px] rounded-2xl border border-[#D4FF33]/40 bg-[#D4FF33]/10 px-4 text-xs font-extrabold text-[#D4FF33] inline-flex items-center justify-center gap-2 hover:bg-[#D4FF33]/18 active:scale-[0.98] transition-all disabled:opacity-60"
                        >
                          <Share2 className="w-4 h-4" />
                          {isGeneratingCardId === session.id
                            ? 'Generando tarjeta...'
                            : 'Generar Tarjeta Resumen'}
                        </button>
                        {cardioCardFeedback?.sessionId === session.id && (
                          <p className="text-xs font-semibold text-[#D4FF33] text-center">
                            {cardioCardFeedback.message}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
