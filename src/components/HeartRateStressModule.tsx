import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Camera,
  CheckCircle2,
  Fingerprint,
  Flashlight,
  HeartPulse,
  PauseCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Square,
  Stethoscope,
} from 'lucide-react';
import { InlineDeleteConfirmButton } from './InlineDeleteConfirmButton';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  type FingerPlacementStatus,
  PPG_MAX_BPM,
  PPG_MIN_BPM,
  PPG_MIN_SIGNAL_QUALITY_PCT,
  PPG_MIN_VALID_BEATS,
  PPG_STRICT_MIN_RED_AVG,
  type PpgSample,
  analyzeRgbFrame,
  classifyBloodPressure,
  computeBpmAndHrv,
  computePulseRecoveryImpact,
  computeStressPct,
  detrendPpgSeries,
} from '../lib/pulsePpgEngine';
import {
  LOW_POWER_FPS_INTERVAL_MS,
  useLowPowerMode,
} from '../lib/lowPowerMode';
import { getTodayIsoDate } from '../lib/storage';
import {
  disableStreamTorchAndStop,
  useHardwareManager,
} from '../hooks/useHardwareManager';
import type {
  BloodPressureRecord,
  DailyReadinessEntry,
  PulseHrvRecord,
} from '../types/fitness';

interface HeartRateStressModuleProps {
  pulseRecords: PulseHrvRecord[];
  bloodPressureRecords: BloodPressureRecord[];
  todayReadiness: DailyReadinessEntry | null;
  isHydrated?: boolean;
  onSavePulseRecord: (record: PulseHrvRecord) => void;
  onDeletePulseRecord: (id: string) => void;
  onSaveBloodPressureRecord: (record: BloodPressureRecord) => void;
  onDeleteBloodPressureRecord: (id: string) => void;
}

const CALIBRATION_DURATION_SEC = 3;
const SCAN_DURATION_SEC = 20;
const FINGER_LIFT_RESET_MS = 750;

export function computeStressPctFromRecord(record: PulseHrvRecord): number {
  return computeStressPct(record.bpm, record.hrvRmssdMs);
}

export function classifyBpmRange(bpm: number): {
  label: 'Reposo' | 'Normal' | 'Elevado';
  badgeClass: string;
  textClass: string;
} {
  if (bpm < 60) {
    return {
      label: 'Reposo',
      badgeClass: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300',
      textClass: 'text-emerald-300',
    };
  }
  if (bpm < 85) {
    return {
      label: 'Normal',
      badgeClass: 'border-sky-400/40 bg-sky-400/15 text-sky-300',
      textClass: 'text-sky-300',
    };
  }
  return {
    label: 'Elevado',
    badgeClass: 'border-rose-400/40 bg-rose-500/15 text-rose-300',
    textClass: 'text-rose-300',
  };
}

export function classifyStressRange(stressPct: number): {
  label: 'Bajo' | 'Moderado' | 'Alto';
  badgeClass: string;
  textClass: string;
} {
  if (stressPct <= 30) {
    return {
      label: 'Bajo',
      badgeClass: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300',
      textClass: 'text-emerald-300',
    };
  }
  if (stressPct <= 58) {
    return {
      label: 'Moderado',
      badgeClass: 'border-amber-400/40 bg-amber-400/15 text-amber-300',
      textClass: 'text-amber-300',
    };
  }
  return {
    label: 'Alto',
    badgeClass: 'border-rose-400/40 bg-rose-500/15 text-rose-300',
    textClass: 'text-rose-300',
  };
}

function formatShortDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${mon} · ${hh}:${mm}`;
}

function formatChartAxisLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(5, 10);
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${mon}`;
}

interface BiometricChartPoint {
  id: string;
  label: string;
  fullTime: string;
  bpm: number;
  stressPct: number;
  hrvRmssdMs: number;
}

const BiometricTooltip: React.FC<{
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: BiometricChartPoint }>;
}> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;
  const bpmCls = classifyBpmRange(pt.bpm);
  const stressCls = classifyStressRange(pt.stressPct);

  return (
    <div className="rounded-xl border border-[#2C3344] bg-[#0B0D12]/95 px-3 py-2 shadow-xl space-y-1">
      <p className="text-[11px] font-mono text-zinc-400">{pt.fullTime}</p>
      <p className="text-xs font-extrabold font-mono text-rose-300">
        Pulso: {pt.bpm} BPM{' '}
        <span className={`font-sans font-bold ${bpmCls.textClass}`}>({bpmCls.label})</span>
      </p>
      <p className="text-xs font-extrabold font-mono text-amber-300">
        Estrés: {pt.stressPct}%{' '}
        <span className={`font-sans font-bold ${stressCls.textClass}`}>
          ({stressCls.label})
        </span>
      </p>
      <p className="text-[11px] font-mono text-[#D4FF33]">HRV: {pt.hrvRmssdMs} ms</p>
    </div>
  );
};

export const HeartRateStressModule: React.FC<HeartRateStressModuleProps> = ({
  pulseRecords,
  bloodPressureRecords,
  todayReadiness,
  isHydrated = true,
  onSavePulseRecord,
  onDeletePulseRecord,
  onSaveBloodPressureRecord,
  onDeleteBloodPressureRecord,
}) => {
  // PPG Camera Scanner State
  const [isScanning, setIsScanning] = useState(false);
  const [scanPhase, setScanPhase] = useState<'idle' | 'calibrating' | 'measuring'>('idle');
  const [calibrationElapsedSec, setCalibrationElapsedSec] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [previewActive, setPreviewActive] = useState(false);
  const [fingerStatus, setFingerStatus] =
    useState<FingerPlacementStatus>('sin_dedo');
  const [fingerPaused, setFingerPaused] = useState(false);
  const [fingerResetNotice, setFingerResetNotice] = useState<string | null>(null);
  const [torchActive, setTorchActive] = useState(false);
  const [torchSupportedMsg, setTorchSupportedMsg] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [liveWavePoints, setLiveWavePoints] = useState<number[]>([]);
  const [liveBpmPreview, setLiveBpmPreview] = useState<number | null>(null);
  const [scanResultNotice, setScanResultNotice] = useState<string | null>(null);
  const [redCoveragePct, setRedCoveragePct] = useState(0);
  const [avgRedDebug, setAvgRedDebug] = useState(0);

  // Manual PPG fallback state
  const [showManualPulse, setShowManualPulse] = useState(false);
  const [manualBpmStr, setManualBpmStr] = useState('64');
  const [manualHrvStr, setManualHrvStr] = useState('48');

  // Blood Pressure Quick Entry State
  const [systolicStr, setSystolicStr] = useState('118');
  const [diastolicStr, setDiastolicStr] = useState('76');
  const [bpPulseStr, setBpPulseStr] = useState('');
  const [bpNotes, setBpNotes] = useState('');
  const [bpSavedMsg, setBpSavedMsg] = useState<string | null>(null);
  const [bpErrorMsg, setBpErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const previewRafRef = useRef<number | null>(null);
  const samplesRef = useRef<PpgSample[]>([]);
  const validCalibrationMsRef = useRef<number>(0);
  const validMeasureMsRef = useRef<number>(0);
  const fingerAbsentSincePerfRef = useRef<number | null>(null);
  const lastFramePerfRef = useRef<number>(0);
  const lastSampleTickPerfRef = useRef<number>(0);
  const lastPreviewPerfRef = useRef<number>(0);
  const lastUiWaveUpdateRef = useRef<number>(0);
  const scanPhaseRef = useRef<'idle' | 'calibrating' | 'measuring'>('idle');
  const isMountedRef = useRef(true);

  const lowPower = useLowPowerMode();
  const isLowPowerRef = useRef(lowPower.isLowPower);
  isLowPowerRef.current = lowPower.isLowPower;
  const hardware = useHardwareManager();
  const hardwareRef = useRef(hardware);
  hardwareRef.current = hardware;
  const isHydratedRef = useRef(isHydrated);
  isHydratedRef.current = isHydrated;

  const sortedPulse = useMemo(
    () => [...pulseRecords].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
    [pulseRecords],
  );
  const latestPulse = sortedPulse[0] ?? null;
  const latestStressPct = latestPulse ? computeStressPctFromRecord(latestPulse) : null;
  const latestBpmClass = latestPulse ? classifyBpmRange(latestPulse.bpm) : null;
  const latestStressClass =
    latestStressPct !== null ? classifyStressRange(latestStressPct) : null;

  const biometricChartData = useMemo<BiometricChartPoint[]>(() => {
    const asc = [...sortedPulse].slice(0, 20).reverse();
    return asc.map((item) => ({
      id: item.id,
      label: formatChartAxisLabel(item.recordedAt),
      fullTime: formatShortDateTime(item.recordedAt),
      bpm: item.bpm,
      stressPct: computeStressPctFromRecord(item),
      hrvRmssdMs: item.hrvRmssdMs,
    }));
  }, [sortedPulse]);

  const sortedBp = useMemo(
    () =>
      [...bloodPressureRecords].sort((a, b) =>
        b.recordedAt.localeCompare(a.recordedAt),
      ),
    [bloodPressureRecords],
  );
  const latestBp = sortedBp[0] ?? null;

  const parsedSys = Number.parseInt(systolicStr, 10);
  const parsedDia = Number.parseInt(diastolicStr, 10);
  const liveBpPreview = useMemo(() => {
    if (
      Number.isNaN(parsedSys) ||
      Number.isNaN(parsedDia) ||
      parsedSys < 60 ||
      parsedDia < 35
    ) {
      return null;
    }
    return classifyBloodPressure(parsedSys, parsedDia);
  }, [parsedSys, parsedDia]);

  const stopPreviewLoop = () => {
    if (previewRafRef.current !== null) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
    }
  };

  const stopScanLoop = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const stopCameraResources = async (): Promise<void> => {
    stopScanLoop();
    stopPreviewLoop();
    const localStream = streamRef.current;
    streamRef.current = null;

    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch {
        // Ignore pause errors
      }
      videoRef.current.srcObject = null;
    }

    if (localStream) {
      await disableStreamTorchAndStop(localStream);
    }
    hardwareRef.current.releaseMediaStream('ppg_camera');

    if (isMountedRef.current) {
      setTorchActive(false);
      setPreviewActive(false);
    }
  };

  const acquireRearCameraStream = async (): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
    } catch {
      return navigator.mediaDevices
        .getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
        .catch(() =>
          navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          }),
        );
    }
  };

  const attachAndWaitForVideoPlaying = async (
    video: HTMLVideoElement,
    stream: MediaStream,
  ): Promise<void> => {
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    const playingPromise = new Promise<void>((resolve) => {
      if (!video.paused && video.readyState >= 3 && video.videoWidth > 0) {
        resolve();
        return;
      }

      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('loadeddata', onLoadedData);
        window.clearTimeout(timer);
        resolve();
      };
      const onPlaying = () => done();
      const onLoadedData = () => {
        if (!video.paused && video.videoWidth > 0) {
          done();
        }
      };
      const timer = window.setTimeout(done, 1500);

      video.addEventListener('playing', onPlaying, { once: true });
      video.addEventListener('loadeddata', onLoadedData);
    });

    await video.play().catch(() => {});
    await playingPromise;
  };

  const enableTorchOnActiveStream = async (
    stream: MediaStream,
  ): Promise<boolean> => {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== 'live') {
      setTorchActive(false);
      setTorchSupportedMsg('Pista de video inactiva; intenta reiniciar el escáner.');
      return false;
    }

    const capabilities =
      typeof videoTrack.getCapabilities === 'function'
        ? (videoTrack.getCapabilities() as MediaTrackCapabilities & {
            torch?: boolean;
          })
        : undefined;

    if (!capabilities?.torch) {
      setTorchActive(false);
      setTorchSupportedMsg(
        'Este lente o navegador no expone control de flash (torch: false). Ilumina el dedo o usa "Reintentar Flash".',
      );
      return false;
    }

    if (typeof videoTrack.applyConstraints !== 'function') {
      setTorchActive(false);
      setTorchSupportedMsg('El navegador no soporta applyConstraints para el flash.');
      return false;
    }

    try {
      await videoTrack.applyConstraints({
        advanced: [{ torch: true } as unknown as MediaTrackConstraintSet],
      });
      setTorchActive(true);
      setTorchSupportedMsg('Flash LED continuo activo');
      return true;
    } catch {
      setTorchActive(false);
      setTorchSupportedMsg(
        'Android apagó o bloqueó el flash LED. Presiona "Encender/Reintentar Flash".',
      );
      return false;
    }
  };

  const handleRetryTorch = async () => {
    setCameraError(null);
    const stream = streamRef.current;
    if (!stream || stream.getTracks().every((t) => t.readyState === 'ended')) {
      setTorchSupportedMsg('Iniciando cámara trasera para encender el flash...');
      try {
        const freshStream = await acquireRearCameraStream();
        if (!isMountedRef.current) {
          await disableStreamTorchAndStop(freshStream);
          return;
        }
        streamRef.current = freshStream;
        hardwareRef.current.registerMediaStream('ppg_camera', freshStream);
        if (videoRef.current) {
          await attachAndWaitForVideoPlaying(videoRef.current, freshStream);
        }
        setPreviewActive(true);
        await enableTorchOnActiveStream(freshStream);
        if (scanPhaseRef.current === 'idle') {
          startPreviewLoop();
        }
      } catch {
        setTorchActive(false);
        setTorchSupportedMsg(
          'No se pudo abrir la cámara trasera para reintentar el flash.',
        );
      }
      return;
    }

    if (videoRef.current && videoRef.current.paused) {
      await attachAndWaitForVideoPlaying(videoRef.current, stream);
    }
    await enableTorchOnActiveStream(stream);
  };

  const sampleRoiFromVideo = () => {
    const video = videoRef.current;
    const canvas = hiddenCanvasRef.current;
    if (!video || !canvas) return null;
    if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return null;
    }
    const roiSize = 36;
    if (canvas.width !== roiSize) canvas.width = roiSize;
    if (canvas.height !== roiSize) canvas.height = roiSize;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const sx = Math.max(0, Math.floor((video.videoWidth - roiSize) / 2));
    const sy = Math.max(0, Math.floor((video.videoHeight - roiSize) / 2));
    ctx.drawImage(video, sx, sy, roiSize, roiSize, 0, 0, roiSize, roiSize);
    const frameData = ctx.getImageData(0, 0, roiSize, roiSize).data;
    return analyzeRgbFrame(frameData);
  };

  const startPreviewLoop = () => {
    stopPreviewLoop();
    lastPreviewPerfRef.current = 0;

    const previewFrame = (nowPerf: number) => {
      if (!isMountedRef.current || !streamRef.current || scanPhaseRef.current !== 'idle') {
        return;
      }
      if (streamRef.current.getTracks().every((t) => t.readyState === 'ended')) {
        void stopCameraResources();
        return;
      }
      const minGap = isLowPowerRef.current ? 240 : 140;
      if (nowPerf - lastPreviewPerfRef.current >= minGap) {
        lastPreviewPerfRef.current = nowPerf;
        const rgb = sampleRoiFromVideo();
        if (rgb) {
          setRedCoveragePct(rgb.redCoveragePct);
          setAvgRedDebug(Math.round(rgb.avgR));
          setFingerStatus(rgb.fingerStatus);
        }
      }
      previewRafRef.current = requestAnimationFrame(previewFrame);
    };

    previewRafRef.current = requestAnimationFrame(previewFrame);
  };

  const startCameraPreview = async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      streamRef.current
    ) {
      return;
    }
    try {
      const stream = await acquireRearCameraStream();
      if (!isMountedRef.current) {
        await disableStreamTorchAndStop(stream);
        return;
      }
      streamRef.current = stream;
      hardwareRef.current.registerMediaStream('ppg_camera', stream);
      if (videoRef.current) {
        await attachAndWaitForVideoPlaying(videoRef.current, stream);
      }
      setPreviewActive(true);
      await enableTorchOnActiveStream(stream);
      startPreviewLoop();
    } catch {
      setPreviewActive(false);
    }
  };

  useEffect(() => {
    if (!isScanning) {
      void hardwareRef.current.releaseWakeLock('ppg-scanner');
      return undefined;
    }
    void hardwareRef.current.acquireWakeLock('ppg-scanner');
    return () => {
      void hardwareRef.current.releaseWakeLock('ppg-scanner');
    };
  }, [isScanning]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      void hardwareRef.current.releaseWakeLock('ppg-scanner');
      void stopCameraResources();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const turnOffTorchAndStopCamera = async () => {
    stopScanLoop();
    await stopCameraResources();
    await hardwareRef.current.releaseWakeLock('ppg-scanner');
    scanPhaseRef.current = 'idle';
    validCalibrationMsRef.current = 0;
    validMeasureMsRef.current = 0;
    fingerAbsentSincePerfRef.current = null;
    setScanPhase('idle');
    setIsScanning(false);
    setFingerPaused(false);
    setCalibrationElapsedSec(0);
    setElapsedSec(0);
  };

  const finishPpgScan = async () => {
    const capturedSamples = [...samplesRef.current];
    await turnOffTorchAndStopCamera();

    if (!isHydratedRef.current) {
      setCameraError(
        'Esperando hidratación de IndexedDB; repite la lectura en un segundo para guardarla.',
      );
      return;
    }

    const validFingerSamplesCount = capturedSamples.filter(
      (s) => s.v > PPG_STRICT_MIN_RED_AVG && (s.redCoveragePct ?? 0) >= 65,
    ).length;
    const validFingerShare =
      capturedSamples.length > 0
        ? validFingerSamplesCount / capturedSamples.length
        : 0;

    if (capturedSamples.length < 90 || validFingerShare < 0.85) {
      setCameraError(
        'Lectura cancelada por ruido o dedo levantado. No se guardaron datos: mantén el dedo firme cubriendo cámara y flash durante los 20s completos.',
      );
      return;
    }

    const computed = computeBpmAndHrv(capturedSamples);
    if (
      computed.signalQualityPct < PPG_MIN_SIGNAL_QUALITY_PCT ||
      computed.validBeats < PPG_MIN_VALID_BEATS ||
      computed.bpm < PPG_MIN_BPM ||
      computed.bpm > PPG_MAX_BPM ||
      computed.hrvRmssdMs <= 0
    ) {
      setCameraError(
        `Lectura descartada por ruido (calidad ${computed.signalQualityPct}% · ${computed.validBeats} latidos válidos). Se requiere ≥${PPG_MIN_SIGNAL_QUALITY_PCT}% de señal y ≥${PPG_MIN_VALID_BEATS} latidos claros sin mover el dedo.`,
      );
      return;
    }

    const recoveryImpactScore = computePulseRecoveryImpact(
      computed.bpm,
      computed.hrvRmssdMs,
    );
    const today = getTodayIsoDate();
    const record: PulseHrvRecord = {
      id: `ppg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date: today,
      recordedAt: new Date().toISOString(),
      bpm: computed.bpm,
      hrvRmssdMs: computed.hrvRmssdMs,
      recoveryImpactScore,
      signalQualityPct: computed.signalQualityPct,
      durationSec: SCAN_DURATION_SEC,
      source: 'ppg_camara',
      waveformPreview: computed.waveformPreview,
    };

    onSavePulseRecord(record);
    setBpPulseStr(String(computed.bpm));
    const stressPct = computeStressPctFromRecord(record);
    setScanResultNotice(
      `Medición guardada (${record.signalQualityPct}% señal): ${record.bpm} BPM · HRV ${record.hrvRmssdMs} ms · Estrés ${stressPct}%.`,
    );
  };

  const handleCancelScan = () => {
    samplesRef.current = [];
    setLiveBpmPreview(null);
    setLiveWavePoints([]);
    setFingerResetNotice(null);
    void turnOffTorchAndStopCamera();
  };

  const handleStartPpgScan = async () => {
    setCameraError(null);
    setScanResultNotice(null);
    setFingerResetNotice(null);
    setTorchSupportedMsg(null);
    setTorchActive(false);
    setLiveWavePoints([]);
    setLiveBpmPreview(null);
    setCalibrationElapsedSec(0);
    setElapsedSec(0);
    setFingerPaused(false);
    samplesRef.current = [];
    validCalibrationMsRef.current = 0;
    validMeasureMsRef.current = 0;
    fingerAbsentSincePerfRef.current = null;

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setCameraError(
        'Este navegador no permite acceso a cámara web (getUserMedia). Usa la captura manual debajo.',
      );
      return;
    }

    try {
      stopPreviewLoop();
      void hardwareRef.current.acquireWakeLock('ppg-scanner');

      // 1. Open rear camera stream FIRST with 640x480@30fps constraints
      let stream = streamRef.current;
      if (!stream || stream.getTracks().every((t) => t.readyState === 'ended')) {
        stream = await acquireRearCameraStream();
        streamRef.current = stream;
      }
      hardwareRef.current.registerMediaStream('ppg_camera', stream);

      // 2. Assign to <video> and WAIT for playing / video.play() BEFORE touching torch constraints
      if (videoRef.current) {
        await attachAndWaitForVideoPlaying(videoRef.current, stream);
      }

      // 3. Verify track.getCapabilities()?.torch and apply torch: true after playback started
      await enableTorchOnActiveStream(stream);

      setPreviewActive(true);
      setIsScanning(true);
      scanPhaseRef.current = 'calibrating';
      setScanPhase('calibrating');
      lastFramePerfRef.current = 0;
      lastSampleTickPerfRef.current = performance.now();
      lastUiWaveUpdateRef.current = 0;

      const calibrationMs = CALIBRATION_DURATION_SEC * 1000;
      const measureDurationMs = SCAN_DURATION_SEC * 1000;

      const processFrame = (nowPerf: number) => {
        if (!streamRef.current || !videoRef.current || !hiddenCanvasRef.current) {
          return;
        }
        if (streamRef.current.getTracks().every((t) => t.readyState === 'ended')) {
          handleCancelScan();
          return;
        }

        const lowPowerOn = isLowPowerRef.current;
        if (lowPowerOn && nowPerf - lastFramePerfRef.current < LOW_POWER_FPS_INTERVAL_MS) {
          rafRef.current = requestAnimationFrame(processFrame);
          return;
        }

        const dtMs = Math.min(180, Math.max(0, nowPerf - lastSampleTickPerfRef.current));
        lastSampleTickPerfRef.current = nowPerf;
        lastFramePerfRef.current = nowPerf;

        const rgb = sampleRoiFromVideo();
        if (!rgb) {
          rafRef.current = requestAnimationFrame(processFrame);
          return;
        }

        setRedCoveragePct(rgb.redCoveragePct);
        setAvgRedDebug(Math.round(rgb.avgR));
        setFingerStatus(rgb.fingerStatus);

        // Strict finger gate: requires avgR > 175 AND R > G * 1.8 (and R > B * 1.8) before counting time
        if (!rgb.isFingerDetected) {
          setFingerPaused(true);
          if (fingerAbsentSincePerfRef.current === null) {
            fingerAbsentSincePerfRef.current = nowPerf;
          }
          const absentDurationMs = nowPerf - fingerAbsentSincePerfRef.current;

          if (scanPhaseRef.current === 'calibrating') {
            validCalibrationMsRef.current = 0;
            setCalibrationElapsedSec(0);
          } else if (
            scanPhaseRef.current === 'measuring' &&
            absentDurationMs >= FINGER_LIFT_RESET_MS
          ) {
            // Finger lifted mid-test: reset the 20s timer and discard partial buffer so noise is never saved
            validMeasureMsRef.current = 0;
            samplesRef.current = [];
            setElapsedSec(0);
            setLiveWavePoints([]);
            setLiveBpmPreview(null);
            setFingerResetNotice(
              'Temporizador reiniciado a 0s porque retiraste el dedo. Coloca el dedo cubriendo cámara y flash.',
            );
          }

          rafRef.current = requestAnimationFrame(processFrame);
          return;
        }

        // Finger properly detected covering illuminated lens
        fingerAbsentSincePerfRef.current = null;
        setFingerPaused(false);
        setFingerResetNotice(null);

        // Phase 1: 3s calibration while finger covers lens + flash
        if (scanPhaseRef.current === 'calibrating') {
          validCalibrationMsRef.current += dtMs;
          setCalibrationElapsedSec(
            Math.min(CALIBRATION_DURATION_SEC, validCalibrationMsRef.current / 1000),
          );

          if (validCalibrationMsRef.current >= calibrationMs) {
            scanPhaseRef.current = 'measuring';
            setScanPhase('measuring');
            setCalibrationElapsedSec(CALIBRATION_DURATION_SEC);
            validMeasureMsRef.current = 0;
            samplesRef.current = [];
            lastUiWaveUpdateRef.current = 0;
          }

          rafRef.current = requestAnimationFrame(processFrame);
          return;
        }

        // Phase 2: 20s clean measurement
        validMeasureMsRef.current += dtMs;
        const measureElapsedS = Math.min(
          SCAN_DURATION_SEC,
          validMeasureMsRef.current / 1000,
        );
        setElapsedSec(measureElapsedS);

        samplesRef.current.push({
          t: nowPerf,
          v: rgb.avgR,
          g: rgb.avgG,
          redCoveragePct: rgb.redCoveragePct,
        });

        if (validMeasureMsRef.current >= measureDurationMs) {
          setElapsedSec(SCAN_DURATION_SEC);
          void finishPpgScan();
          return;
        }

        const waveIntervalMs = lowPowerOn ? 140 : 85;
        if (nowPerf - lastUiWaveUpdateRef.current > waveIntervalMs) {
          lastUiWaveUpdateRef.current = nowPerf;
          const recent = samplesRef.current.slice(-140);
          const detrended = detrendPpgSeries(recent);
          const tail = detrended.slice(-75);
          if (tail.length > 4) {
            const minV = Math.min(...tail.map((p) => p.ac));
            const maxV = Math.max(...tail.map((p) => p.ac));
            const span = Math.max(0.15, maxV - minV);
            setLiveWavePoints(
              tail.map((p) => Math.round(((p.ac - minV) / span) * 100)),
            );
          }

          if (measureElapsedS >= 5 && samplesRef.current.length >= 45) {
            const interim = computeBpmAndHrv(samplesRef.current.slice(-300));
            if (
              interim.bpm >= PPG_MIN_BPM &&
              interim.bpm <= PPG_MAX_BPM &&
              interim.signalQualityPct >= 55
            ) {
              setLiveBpmPreview(interim.bpm);
            }
          }
        }

        rafRef.current = requestAnimationFrame(processFrame);
      };

      rafRef.current = requestAnimationFrame(processFrame);
    } catch {
      await stopCameraResources();
      await hardwareRef.current.releaseWakeLock('ppg-scanner');
      scanPhaseRef.current = 'idle';
      setScanPhase('idle');
      setIsScanning(false);
      setFingerPaused(false);
      setCameraError(
        'No se pudo acceder a la cámara trasera. Verifica permisos o registra tu pulso manualmente.',
      );
    }
  };

  const handleSaveManualPulse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isHydratedRef.current) {
      setCameraError('Esperando hidratación de IndexedDB antes de guardar.');
      return;
    }
    const bpm = Number.parseInt(manualBpmStr, 10);
    const hrv = Number.parseInt(manualHrvStr, 10);
    if (Number.isNaN(bpm) || bpm < 35 || bpm > 210) return;
    const safeHrv = Number.isNaN(hrv) ? 45 : Math.max(10, Math.min(140, hrv));
    const impact = computePulseRecoveryImpact(bpm, safeHrv);
    const record: PulseHrvRecord = {
      id: `ppg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date: getTodayIsoDate(),
      recordedAt: new Date().toISOString(),
      bpm,
      hrvRmssdMs: safeHrv,
      recoveryImpactScore: impact,
      signalQualityPct: 100,
      durationSec: 20,
      source: 'manual',
    };
    onSavePulseRecord(record);
    setShowManualPulse(false);
    setScanResultNotice(
      `Pulso guardado (${bpm} BPM · HRV ${safeHrv} ms · Estrés ${computeStressPctFromRecord(record)}%).`,
    );
  };

  const handleSaveBloodPressure = (e: React.FormEvent) => {
    e.preventDefault();
    setBpSavedMsg(null);
    setBpErrorMsg(null);

    if (!isHydratedRef.current) {
      setBpErrorMsg('Esperando hidratación de IndexedDB antes de guardar.');
      return;
    }

    const sys = Number.parseInt(systolicStr, 10);
    const dia = Number.parseInt(diastolicStr, 10);
    const pulse = bpPulseStr.trim() ? Number.parseInt(bpPulseStr, 10) : undefined;

    if (
      Number.isNaN(sys) ||
      Number.isNaN(dia) ||
      sys < 65 ||
      sys > 250 ||
      dia < 35 ||
      dia > 150 ||
      sys <= dia
    ) {
      setBpErrorMsg(
        'Ingresa valores válidos de Sistólica (65–250) y Diastólica (35–150) mmHg.',
      );
      return;
    }

    const cls = classifyBloodPressure(sys, dia);
    const record: BloodPressureRecord = {
      id: `bp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date: getTodayIsoDate(),
      recordedAt: new Date().toISOString(),
      systolic: sys,
      diastolic: dia,
      pulseBpm:
        pulse && !Number.isNaN(pulse) && pulse >= 35 && pulse <= 210
          ? pulse
          : undefined,
      category: cls.category,
      notes: bpNotes.trim() || undefined,
    };

    onSaveBloodPressureRecord(record);
    setBpNotes('');
    setBpSavedMsg(`Toma ${sys}/${dia} mmHg (${cls.category}) guardada en IndexedDB.`);
  };

  const liveWavePath = useMemo(() => {
    const pts = liveWavePoints.length > 1 ? liveWavePoints : latestPulse?.waveformPreview ?? [];
    if (pts.length < 2) return '';
    const w = 520;
    const h = 92;
    return pts
      .map((val, idx) => {
        const x = (idx / (pts.length - 1)) * w;
        const y = h - 10 - (val / 100) * (h - 20);
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [liveWavePoints, latestPulse]);

  const bpChart = useMemo(() => {
    const recent = [...sortedBp].slice(0, 12).reverse();
    if (recent.length === 0) return null;
    const w = 620;
    const h = 190;
    const minVal = Math.min(50, ...recent.map((r) => r.diastolic - 10));
    const maxVal = Math.max(155, ...recent.map((r) => r.systolic + 10));
    const span = Math.max(40, maxVal - minVal);
    const toY = (v: number) => h - 26 - ((v - minVal) / span) * (h - 46);

    const coords = recent.map((r, i) => {
      const x =
        recent.length === 1 ? w / 2 : 34 + (i / (recent.length - 1)) * (w - 68);
      return {
        x,
        ySys: toY(r.systolic),
        yDia: toY(r.diastolic),
        record: r,
      };
    });

    const sysPath = coords
      .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.ySys.toFixed(1)}`)
      .join(' ');
    const diaPath = coords
      .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.yDia.toFixed(1)}`)
      .join(' ');

    return {
      w,
      h,
      coords,
      sysPath,
      diaPath,
      y120: toY(120),
      y80: toY(80),
    };
  }, [sortedBp]);

  const progressPct = Math.min(100, Math.round((elapsedSec / SCAN_DURATION_SEC) * 100));

  return (
    <div className="space-y-4">
      {/* SECTION 1: PPG CAMERA SCANNER + MANUAL CAPTURE + BPM/HRV/STRESS KPIS */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/15 border border-rose-400/30 flex items-center justify-center text-rose-400">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white">
                Frecuencia Cardíaca (PPG · 20s) y Estrés
              </h3>
              <p className="text-xs text-zinc-400">
                Escáner óptico de pulso, HRV (RMSSD filtrado) y nivel coherente de estrés
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {todayReadiness && (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-300">
                <ShieldCheck className="w-3.5 h-3.5" />
                Check-In {todayReadiness.score}/100
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowManualPulse((v) => !v)}
              className="min-h-[38px] rounded-xl border border-[#2B303C] bg-[#171A23] px-3 text-xs font-bold text-zinc-300 hover:text-white"
            >
              {showManualPulse ? 'Cerrar manual' : 'Captura manual'}
            </button>
          </div>
        </div>

        <canvas ref={hiddenCanvasRef} className="hidden" />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          {/* Left: Camera Finger Placement + Torch Control + Controls */}
          <div className="lg:col-span-5 rounded-2xl border border-[#242834] bg-[#0D0F14] p-4 flex flex-col justify-between space-y-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => {
                  if (!previewActive && !isScanning) {
                    void startCameraPreview();
                  }
                }}
                aria-label="Vista previa en vivo de cámara trasera"
                className={`relative w-20 h-20 rounded-full overflow-hidden border-2 flex items-center justify-center shrink-0 transition-colors ${
                  fingerStatus === 'bien_puesto'
                    ? 'border-emerald-400 bg-rose-950/60'
                    : fingerStatus === 'ajustar'
                      ? 'border-amber-400 bg-rose-950/30'
                      : isScanning
                        ? 'border-rose-500/70 bg-[#141720]'
                        : 'border-[#2B303C] bg-[#141720]'
                }`}
              >
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className={`absolute inset-0 w-full h-full object-cover ${
                    previewActive || isScanning
                      ? 'opacity-100'
                      : 'opacity-0 pointer-events-none'
                  }`}
                />
                <div className="relative z-10 flex flex-col items-center text-center px-1">
                  {!previewActive && !isScanning && (
                    <Fingerprint className="w-7 h-7 text-zinc-400" />
                  )}
                  {(previewActive || isScanning) && (
                    <span
                      className={`mt-8 text-[10px] font-mono tabular-nums font-extrabold px-1.5 py-0.5 rounded bg-black/80 ${
                        fingerStatus === 'bien_puesto'
                          ? 'text-emerald-300'
                          : fingerStatus === 'ajustar'
                            ? 'text-amber-300'
                            : 'text-rose-200'
                      }`}
                    >
                      R {avgRedDebug} · {redCoveragePct}%
                    </span>
                  )}
                </div>
              </button>

              <div className="min-w-0 space-y-1">
                <p className="text-xs font-bold text-white">
                  {!isScanning
                    ? 'Listo para medir con cámara'
                    : fingerPaused || fingerStatus !== 'bien_puesto'
                      ? 'Coloca el dedo cubriendo cámara y flash'
                      : scanPhase === 'calibrating'
                        ? 'Calibrando exposición con dedo puesto...'
                        : 'Dedo bien colocado · capturando pulso'}
                </p>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  {previewActive || isScanning
                    ? 'Requiere canal rojo > 175 y dominancia R > 1.8× G/B para contar tiempo.'
                    : 'Toca el círculo para previsualizar o inicia directo el escáner.'}
                </p>
                {torchSupportedMsg && (
                  <p
                    className={`text-[11px] flex items-center gap-1 ${
                      torchActive ? 'text-emerald-300' : 'text-amber-300'
                    }`}
                  >
                    <Flashlight className="w-3 h-3 shrink-0" />
                    <span>{torchSupportedMsg}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Active Manual Flash Button + Strict Finger Pause Alert */}
            {(isScanning || previewActive) && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => void handleRetryTorch()}
                  className={`w-full min-h-[38px] rounded-xl border px-3 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                    torchActive
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
                      : 'border-amber-400/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                  }`}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Encender/Reintentar Flash
                </button>

                {isScanning && fingerPaused && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="rounded-xl border border-amber-400/45 bg-amber-950/25 px-3 py-2 flex items-center gap-2 text-xs font-bold text-amber-200"
                  >
                    <PauseCircle className="w-4 h-4 text-amber-300 shrink-0" />
                    <span>
                      Coloca el dedo cubriendo cámara y flash (temporizador en pausa)
                    </span>
                  </div>
                )}

                {fingerResetNotice && (
                  <p className="text-[11px] font-semibold text-rose-300">
                    {fingerResetNotice}
                  </p>
                )}
              </div>
            )}

            {isScanning && (
              <div className="space-y-1.5">
                {scanPhase === 'calibrating' ? (
                  <>
                    <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                      <span className="text-amber-300 font-bold">
                        {fingerPaused
                          ? 'Calibración en pausa (falta dedo)'
                          : `Calibrando luz (${Math.max(1, Math.ceil(CALIBRATION_DURATION_SEC - calibrationElapsedSec))}s)`}
                      </span>
                      <span className="font-bold text-amber-300">
                        {Math.min(
                          100,
                          Math.round(
                            (calibrationElapsedSec / CALIBRATION_DURATION_SEC) * 100,
                          ),
                        )}
                        %
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[#191D28] overflow-hidden">
                      <div
                        className="h-full bg-amber-400 transition-all duration-150"
                        style={{
                          width: `${Math.min(100, Math.round((calibrationElapsedSec / CALIBRATION_DURATION_SEC) * 100))}%`,
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                      <span className={fingerPaused ? 'text-amber-300 font-bold' : 'text-zinc-400'}>
                        {fingerPaused
                          ? `En pausa (${Math.round(elapsedSec)}s / ${SCAN_DURATION_SEC}s)`
                          : `Midiendo (${Math.round(elapsedSec)}s / ${SCAN_DURATION_SEC}s)`}
                      </span>
                      <span className="font-bold text-[#D4FF33]">{progressPct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-[#191D28] overflow-hidden">
                      <div
                        className={`h-full transition-all duration-150 ${
                          fingerPaused ? 'bg-amber-400' : 'bg-[#D4FF33]'
                        }`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {isScanning ? (
              <button
                type="button"
                onClick={handleCancelScan}
                className="w-full min-h-[48px] rounded-2xl border border-rose-500/40 bg-rose-500/15 px-5 text-sm font-extrabold text-rose-200 flex items-center justify-center gap-2"
              >
                <Square className="w-4 h-4 fill-current" />
                Cancelar medición
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleStartPpgScan()}
                className="w-full min-h-[48px] rounded-2xl bg-[#D4FF33] hover:bg-[#c5f022] px-5 text-sm font-extrabold text-[#0A0B0D] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <HeartPulse className="w-4 h-4" />
                Iniciar escáner PPG (20s)
              </button>
            )}
          </div>

          {/* Right: Live Waveform + BPM / HRV / Stress KPI Strip */}
          <div className="lg:col-span-7 rounded-2xl border border-[#242834] bg-[#0D0F14] p-4 flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-rose-400" />
                <span className="text-xs font-bold text-white">
                  {isScanning ? 'Onda de pulso en vivo' : 'Última señal registrada'}
                </span>
              </div>
              {isScanning && liveBpmPreview ? (
                <span className="font-mono tabular-nums text-sm font-extrabold text-rose-300">
                  ~{liveBpmPreview} BPM
                </span>
              ) : latestPulse ? (
                <span className="font-mono tabular-nums text-xs text-zinc-400">
                  {formatShortDateTime(latestPulse.recordedAt)}
                </span>
              ) : null}
            </div>

            <div className="h-24 rounded-xl border border-white/5 bg-[#090B0F] flex items-center justify-center overflow-hidden px-2">
              {liveWavePath ? (
                <svg
                  viewBox="0 0 520 92"
                  className="w-full h-20"
                  role="img"
                  aria-label="Gráfica de onda de pulso PPG"
                >
                  <path
                    d={liveWavePath}
                    fill="none"
                    stroke={isScanning ? '#FB7185' : '#D4FF33'}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <p className="text-xs text-zinc-500 text-center">
                  Mide tu pulso con el escáner PPG o captura manualmente para ver tu onda y tendencia.
                </p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="rounded-xl bg-[#141720] border border-[#232836] p-3">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-[11px] text-zinc-400">Pulso</p>
                  {latestBpmClass && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${latestBpmClass.badgeClass}`}
                    >
                      {latestBpmClass.label}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-lg sm:text-xl font-extrabold font-mono tabular-nums text-white">
                  {latestPulse ? `${latestPulse.bpm}` : '--'}{' '}
                  <span className="text-xs font-normal text-zinc-400">BPM</span>
                </p>
              </div>

              <div className="rounded-xl bg-[#141720] border border-[#232836] p-3">
                <p className="text-[11px] text-zinc-400">HRV (RMSSD)</p>
                <p className="mt-1 text-lg sm:text-xl font-extrabold font-mono tabular-nums text-[#D4FF33]">
                  {latestPulse ? `${latestPulse.hrvRmssdMs}` : '--'}{' '}
                  <span className="text-xs font-normal text-zinc-400">ms</span>
                </p>
              </div>

              <div className="rounded-xl bg-[#141720] border border-[#232836] p-3">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-[11px] text-zinc-400">Estrés</p>
                  {latestStressClass && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${latestStressClass.badgeClass}`}
                    >
                      {latestStressClass.label}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-lg sm:text-xl font-extrabold font-mono tabular-nums text-amber-300">
                  {latestStressPct !== null ? `${latestStressPct}%` : '--'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Manual PPG Fallback Form */}
        {showManualPulse && (
          <form
            onSubmit={handleSaveManualPulse}
            className="rounded-2xl border border-[#2A2F3D] bg-[#0D0F14] p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
          >
            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                Pulso en reposo (BPM)
              </label>
              <input
                type="number"
                min={35}
                max={210}
                value={manualBpmStr}
                onChange={(e) => setManualBpmStr(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-[#2C3140] bg-[#141720] px-3 text-sm font-mono text-white focus:border-[#D4FF33] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                HRV RMSSD (ms)
              </label>
              <input
                type="number"
                min={10}
                max={140}
                value={manualHrvStr}
                onChange={(e) => setManualHrvStr(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-[#2C3140] bg-[#141720] px-3 text-sm font-mono text-white focus:border-[#D4FF33] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="min-h-[44px] rounded-xl bg-[#D4FF33] px-4 text-xs font-extrabold text-[#0A0B0D]"
            >
              Guardar y calcular estrés
            </button>
          </form>
        )}

        {cameraError && (
          <p className="rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            {cameraError}
          </p>
        )}

        {scanResultNotice && (
          <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 flex items-center gap-2 text-xs text-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{scanResultNotice}</span>
          </div>
        )}

        {/* RECHARTS HISTORICAL TREND: BPM & ESTRÉS (%) */}
        <div className="rounded-2xl border border-[#242834] bg-[#0B0D12] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-white">
                Tendencia histórica de Pulso (BPM) y Estrés (%)
              </h4>
              <p className="text-[11px] text-zinc-400">
                BPM: Reposo &lt;60 · Normal 60–84 · Elevado ≥85 | Estrés: Bajo ≤30% · Moderado 31–58% · Alto &gt;58%
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-bold">
              <span className="inline-flex items-center gap-1.5 text-rose-300">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                BPM
              </span>
              <span className="inline-flex items-center gap-1.5 text-amber-300">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                Estrés %
              </span>
            </div>
          </div>

          {biometricChartData.length >= 2 ? (
            <div className="w-full min-w-0" style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height={210}>
                <LineChart
                  data={biometricChartData}
                  margin={{ top: 10, right: 8, left: -16, bottom: 2 }}
                >
                  <CartesianGrid stroke="#1C212E" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#71717A', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={22}
                  />
                  <YAxis
                    yAxisId="bpm"
                    domain={['dataMin - 6', 'dataMax + 6']}
                    tick={{ fill: '#FDA4AF', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={38}
                  />
                  <YAxis
                    yAxisId="stress"
                    orientation="right"
                    domain={[0, 100]}
                    tick={{ fill: '#FCD34D', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={34}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip content={<BiometricTooltip />} />
                  <Line
                    yAxisId="bpm"
                    type="monotone"
                    dataKey="bpm"
                    stroke="#FB7185"
                    strokeWidth={2.5}
                    dot={{ r: 3.5, fill: '#FB7185', stroke: '#0B0D12', strokeWidth: 1.5 }}
                    activeDot={{ r: 5, fill: '#FB7185' }}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="stress"
                    type="monotone"
                    dataKey="stressPct"
                    stroke="#F59E0B"
                    strokeWidth={2.2}
                    dot={{ r: 3, fill: '#F59E0B', stroke: '#0B0D12', strokeWidth: 1.5 }}
                    activeDot={{ r: 5, fill: '#FBBF24' }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#272C38] bg-[#0D0F14] px-4 py-4 text-center text-xs text-zinc-400">
              Registra al menos 2 mediciones de pulso para visualizar la gráfica evolutiva de BPM y estrés.
            </div>
          )}
        </div>

        {/* Recent PPG & Stress Measurements */}
        {sortedPulse.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-white/5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-zinc-300">
                Historial biométrico reciente (Pulso, HRV y Estrés)
              </span>
              <span className="font-mono text-zinc-500">{sortedPulse.length} tomas</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {sortedPulse.slice(0, 6).map((item) => {
                const stress = computeStressPctFromRecord(item);
                const stressCls = classifyStressRange(stress);
                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-[#242834] bg-[#0D0F14] px-3.5 py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold font-mono tabular-nums text-white">
                        {item.bpm} BPM{' '}
                        <span className="text-[#D4FF33] text-xs font-bold">
                          · HRV {item.hrvRmssdMs} ms
                        </span>{' '}
                        <span className={`text-xs font-bold ${stressCls.textClass}`}>
                          · Estrés {stress}%
                        </span>
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        {formatShortDateTime(item.recordedAt)} ·{' '}
                        {item.source === 'ppg_camara' ? 'Cámara PPG' : 'Manual'} · Señal{' '}
                        {item.signalQualityPct}%
                      </p>
                    </div>
                    <InlineDeleteConfirmButton
                      onConfirm={() => onDeletePulseRecord(item.id)}
                      ariaLabel={`Eliminar lectura de pulso ${item.bpm} BPM`}
                      size="md"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* SECTION 2: BLOOD PRESSURE LOG & TREND */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-300">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white">
                Registro de Presión Arterial
              </h3>
              <p className="text-xs text-zinc-400">
                Semáforo automático (Normal, Elevada, Alta) e historial
              </p>
            </div>
          </div>

          {latestBp && (
            <div className="text-right">
              <p className="text-xs text-zinc-400">Última toma</p>
              <p className="text-base font-extrabold font-mono tabular-nums text-white">
                {latestBp.systolic}/{latestBp.diastolic}{' '}
                <span className="text-xs font-normal text-zinc-400">mmHg</span>
              </p>
            </div>
          )}
        </div>

        <form onSubmit={handleSaveBloodPressure} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="salud-bp-systolic"
                className="block text-xs font-semibold text-zinc-400 mb-1"
              >
                Sistólica (mmHg)
              </label>
              <input
                id="salud-bp-systolic"
                type="number"
                min={65}
                max={250}
                value={systolicStr}
                onChange={(e) => setSystolicStr(e.target.value)}
                className="w-full min-h-[46px] rounded-2xl border border-[#2C3140] bg-[#0D0F14] px-3.5 text-base font-extrabold font-mono tabular-nums text-white focus:border-[#D4FF33] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="salud-bp-diastolic"
                className="block text-xs font-semibold text-zinc-400 mb-1"
              >
                Diastólica (mmHg)
              </label>
              <input
                id="salud-bp-diastolic"
                type="number"
                min={35}
                max={150}
                value={diastolicStr}
                onChange={(e) => setDiastolicStr(e.target.value)}
                className="w-full min-h-[46px] rounded-2xl border border-[#2C3140] bg-[#0D0F14] px-3.5 text-base font-extrabold font-mono tabular-nums text-white focus:border-[#D4FF33] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="salud-bp-pulse"
                className="block text-xs font-semibold text-zinc-400 mb-1"
              >
                Pulso (BPM · opcional)
              </label>
              <input
                id="salud-bp-pulse"
                type="number"
                min={35}
                max={210}
                placeholder={latestPulse ? String(latestPulse.bpm) : '68'}
                value={bpPulseStr}
                onChange={(e) => setBpPulseStr(e.target.value)}
                className="w-full min-h-[46px] rounded-2xl border border-[#2C3140] bg-[#0D0F14] px-3.5 text-base font-extrabold font-mono tabular-nums text-white placeholder:text-zinc-600 focus:border-[#D4FF33] focus:outline-none"
              />
            </div>
          </div>

          {liveBpPreview && (
            <div
              className={`rounded-2xl border px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${liveBpPreview.borderBg}`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${liveBpPreview.dotColor}`} />
                <span className={`text-xs font-extrabold ${liveBpPreview.labelColor}`}>
                  Semáforo: {liveBpPreview.category}
                </span>
              </div>
              <p className="text-[11px] text-zinc-300">{liveBpPreview.advice}</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              value={bpNotes}
              onChange={(e) => setBpNotes(e.target.value)}
              placeholder="Nota opcional (ej. en reposo, brazo izquierdo)..."
              maxLength={80}
              className="flex-1 min-h-[46px] rounded-2xl border border-[#2C3140] bg-[#0D0F14] px-3.5 text-xs text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
            />
            <button
              type="submit"
              className="min-h-[46px] rounded-2xl bg-[#D4FF33] hover:bg-[#c5f022] px-5 text-xs sm:text-sm font-extrabold text-[#0A0B0D] inline-flex items-center justify-center gap-2 shrink-0"
            >
              <Plus className="w-4 h-4" />
              Guardar toma
            </button>
          </div>

          {bpErrorMsg && <p className="text-xs font-semibold text-rose-400">{bpErrorMsg}</p>}
          {bpSavedMsg && <p className="text-xs font-semibold text-emerald-300">{bpSavedMsg}</p>}
        </form>

        {bpChart && (
          <div className="rounded-2xl border border-[#242834] bg-[#0B0D12] p-3.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-bold text-white">
                Tendencia presión ({bpChart.coords.length} tomas)
              </span>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-rose-300 font-semibold">Sistólica</span>
                <span className="text-sky-300 font-semibold">Diastólica</span>
              </div>
            </div>
            <div className="w-full overflow-x-auto">
              <svg
                viewBox={`0 0 ${bpChart.w} ${bpChart.h}`}
                className="w-full min-w-[420px] h-40"
                role="img"
                aria-label="Gráfica histórica de presión arterial"
              >
                <line
                  x1="24"
                  y1={bpChart.y120}
                  x2={bpChart.w - 24}
                  y2={bpChart.y120}
                  stroke="#334155"
                  strokeDasharray="4 4"
                />
                <line
                  x1="24"
                  y1={bpChart.y80}
                  x2={bpChart.w - 24}
                  y2={bpChart.y80}
                  stroke="#334155"
                  strokeDasharray="4 4"
                />
                {bpChart.coords.length > 1 && (
                  <>
                    <path
                      d={bpChart.sysPath}
                      fill="none"
                      stroke="#FB7185"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <path
                      d={bpChart.diaPath}
                      fill="none"
                      stroke="#38BDF8"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </>
                )}
                {bpChart.coords.map((c) => (
                  <g key={c.record.id}>
                    <line
                      x1={c.x}
                      y1={c.ySys}
                      x2={c.x}
                      y2={c.yDia}
                      stroke="#3F3F46"
                      strokeWidth="1.5"
                    />
                    <circle cx={c.x} cy={c.ySys} r="4" fill="#FB7185" />
                    <circle cx={c.x} cy={c.yDia} r="4" fill="#38BDF8" />
                    <text
                      x={c.x}
                      y={c.ySys - 8}
                      textAnchor="middle"
                      fill="#FDA4AF"
                      fontSize="10"
                      fontFamily="monospace"
                      fontWeight="700"
                    >
                      {c.record.systolic}
                    </text>
                    <text
                      x={c.x}
                      y={c.yDia + 13}
                      textAnchor="middle"
                      fill="#7DD3FC"
                      fontSize="10"
                      fontFamily="monospace"
                      fontWeight="700"
                    >
                      {c.record.diastolic}
                    </text>
                    <text
                      x={c.x}
                      y={bpChart.h - 5}
                      textAnchor="middle"
                      fill="#71717A"
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      {c.record.date.slice(5)}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </div>
        )}

        {sortedBp.length > 0 && (
          <div className="space-y-2">
            {sortedBp.slice(0, 6).map((bp) => {
              const cls = classifyBloodPressure(bp.systolic, bp.diastolic);
              return (
                <div
                  key={bp.id}
                  className="rounded-2xl border border-[#242834] bg-[#0D0F14] px-3.5 py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cls.dotColor}`} />
                      <span className="text-sm font-extrabold font-mono tabular-nums text-white">
                        {bp.systolic}/{bp.diastolic} mmHg
                      </span>
                      <span className={`text-xs font-bold ${cls.labelColor}`}>
                        {bp.category}
                      </span>
                      {bp.pulseBpm && (
                        <span className="text-xs font-mono text-zinc-400">
                          · {bp.pulseBpm} BPM
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                      {formatShortDateTime(bp.recordedAt)}
                      {bp.notes ? ` · ${bp.notes}` : ''}
                    </p>
                  </div>
                  <InlineDeleteConfirmButton
                    onConfirm={() => onDeleteBloodPressureRecord(bp.id)}
                    ariaLabel={`Eliminar toma ${bp.systolic}/${bp.diastolic}`}
                    size="md"
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
