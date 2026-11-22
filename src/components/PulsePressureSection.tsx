import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Camera,
  CheckCircle2,
  Fingerprint,
  Flashlight,
  HeartPulse,
  Plus,
  ShieldCheck,
  Square,
  Stethoscope,
} from 'lucide-react';
import { InlineDeleteConfirmButton } from './InlineDeleteConfirmButton';
import {
  type FingerPlacementStatus,
  PPG_MAX_BPM,
  PPG_MIN_BPM,
  PPG_MIN_SIGNAL_QUALITY_PCT,
  PPG_MIN_VALID_BEATS,
  type PpgSample,
  analyzeRgbFrame,
  classifyBloodPressure,
  computeBpmAndHrv,
  computePulseRecoveryImpact,
  detrendPpgSeries,
} from '../lib/pulsePpgEngine';
import {
  LOW_POWER_FPS_INTERVAL_MS,
  useLowPowerMode,
} from '../lib/lowPowerMode';
import { getTodayIsoDate } from '../lib/storage';
import { useHardwareManager } from '../hooks/useHardwareManager';
import type {
  BloodPressureRecord,
  DailyReadinessEntry,
  PulseHrvRecord,
} from '../types/fitness';

interface PulsePressureSectionProps {
  pulseRecords: PulseHrvRecord[];
  bloodPressureRecords: BloodPressureRecord[];
  todayReadiness: DailyReadinessEntry | null;
  onSavePulseRecord: (record: PulseHrvRecord) => void;
  onDeletePulseRecord: (id: string) => void;
  onSaveBloodPressureRecord: (record: BloodPressureRecord) => void;
  onDeleteBloodPressureRecord: (id: string) => void;
}

const CALIBRATION_DURATION_SEC = 3;
const SCAN_DURATION_SEC = 20;

function formatShortDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${mon} · ${hh}:${mm}`;
}

export const PulsePressureSection: React.FC<PulsePressureSectionProps> = ({
  pulseRecords,
  bloodPressureRecords,
  todayReadiness,
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
  const [torchSupportedMsg, setTorchSupportedMsg] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [liveWavePoints, setLiveWavePoints] = useState<number[]>([]);
  const [liveBpmPreview, setLiveBpmPreview] = useState<number | null>(null);
  const [scanResultNotice, setScanResultNotice] = useState<string | null>(null);
  const [redCoveragePct, setRedCoveragePct] = useState(0);

  // Manual PPG fallback state
  const [showManualPulse, setShowManualPulse] = useState(false);
  const [manualBpmStr, setManualBpmStr] = useState('64');
  const [manualHrvStr, setManualHrvStr] = useState('48');

  // Blood Pressure Quick Entry State (string inputs while typing)
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
  const scanStartPerfRef = useRef<number>(0);
  const lastFramePerfRef = useRef<number>(0);
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

  const sortedPulse = useMemo(
    () => [...pulseRecords].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
    [pulseRecords],
  );
  const latestPulse = sortedPulse[0] ?? null;

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

  const stopCameraResources = () => {
    stopScanLoop();
    stopPreviewLoop();
    hardwareRef.current.releaseMediaStream('ppg_camera');
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setPreviewActive(false);
  };

  const acquireRearCameraStream = async (): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 320 },
          height: { ideal: 240 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
    } catch {
      return navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      }).catch(() =>
        navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        }),
      );
    }
  };

  const sampleRoiFromVideo = () => {
    const video = videoRef.current;
    const canvas = hiddenCanvasRef.current;
    if (!video || !canvas) return null;
    if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return null;
    }
    const roiSize = 32;
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
      const minGap = isLowPowerRef.current ? 240 : 140;
      if (nowPerf - lastPreviewPerfRef.current >= minGap) {
        lastPreviewPerfRef.current = nowPerf;
        const rgb = sampleRoiFromVideo();
        if (rgb) {
          setRedCoveragePct(rgb.redCoveragePct);
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
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      hardwareRef.current.registerMediaStream('ppg_camera', stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPreviewActive(true);
      startPreviewLoop();
    } catch {
      // Preview waits for user gesture if auto-start is blocked by browser
      setPreviewActive(false);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    void startCameraPreview();
    return () => {
      isMountedRef.current = false;
      stopCameraResources();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const turnOffTorchAndRestorePreview = async () => {
    stopScanLoop();
    // Stopping and reopening without torch reliably turns off LED flash on mobile
    stopCameraResources();
    scanPhaseRef.current = 'idle';
    setScanPhase('idle');
    setIsScanning(false);
    setCalibrationElapsedSec(0);
    setElapsedSec(0);
    await startCameraPreview();
  };

  const finishPpgScan = () => {
    const capturedSamples = [...samplesRef.current];
    void turnOffTorchAndRestorePreview();

    const computed = computeBpmAndHrv(capturedSamples);
    if (
      computed.signalQualityPct < PPG_MIN_SIGNAL_QUALITY_PCT ||
      computed.validBeats < PPG_MIN_VALID_BEATS ||
      computed.bpm < PPG_MIN_BPM ||
      computed.bpm > PPG_MAX_BPM
    ) {
      setCameraError(
        `Lectura descartada (calidad ${computed.signalQualityPct}% · ${computed.validBeats} latidos claros). Se requiere al menos ${PPG_MIN_SIGNAL_QUALITY_PCT}% de calidad y ${PPG_MIN_VALID_BEATS} latidos claros. Cubre por completo cámara y flash sin presionar fuerte y repite la toma.`,
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
    setScanResultNotice(
      `Medición guardada (calidad ${record.signalQualityPct}%): ${record.bpm} BPM · HRV ${record.hrvRmssdMs} ms (RMSSD). Recuperación actualizada.`,
    );
  };

  const handleCancelScan = () => {
    samplesRef.current = [];
    setLiveBpmPreview(null);
    setLiveWavePoints([]);
    void turnOffTorchAndRestorePreview();
  };

  const handleStartPpgScan = async () => {
    setCameraError(null);
    setScanResultNotice(null);
    setTorchSupportedMsg(null);
    setLiveWavePoints([]);
    setLiveBpmPreview(null);
    setCalibrationElapsedSec(0);
    setElapsedSec(0);
    samplesRef.current = [];

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
      let stream = streamRef.current;
      if (!stream || stream.getTracks().every((t) => t.readyState === 'ended')) {
        stream = await acquireRearCameraStream();
        streamRef.current = stream;
      }
      hardwareRef.current.registerMediaStream('ppg_camera', stream);

      // Attempt to enable continuous torch/flash safely
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
        try {
          await videoTrack.applyConstraints({
            advanced: [{ torch: true } as unknown as MediaTrackConstraintSet],
          });
          setTorchSupportedMsg('Flash continuo activo');
        } catch {
          setTorchSupportedMsg(
            'Flash no disponible en este navegador/vista previa; usa buena iluminación sobre el lente.',
          );
        }
      }

      if (videoRef.current) {
        if (videoRef.current.srcObject !== stream) {
          videoRef.current.srcObject = stream;
        }
        await videoRef.current.play().catch(() => {});
      }

      setPreviewActive(true);
      setIsScanning(true);
      scanPhaseRef.current = 'calibrating';
      setScanPhase('calibrating');
      scanStartPerfRef.current = performance.now();
      lastFramePerfRef.current = 0;
      lastUiWaveUpdateRef.current = 0;

      const calibrationMs = CALIBRATION_DURATION_SEC * 1000;
      const totalScanMs = calibrationMs + SCAN_DURATION_SEC * 1000;

      const processFrame = (nowPerf: number) => {
        if (!streamRef.current || !videoRef.current || !hiddenCanvasRef.current) {
          return;
        }

        const totalElapsedMs = nowPerf - scanStartPerfRef.current;
        if (totalElapsedMs >= totalScanMs) {
          setElapsedSec(SCAN_DURATION_SEC);
          finishPpgScan();
          return;
        }

        // Throttle PPG frame processing & live chart redraws to ~15fps when Low Power Mode is active
        const lowPowerOn = isLowPowerRef.current;
        if (lowPowerOn && nowPerf - lastFramePerfRef.current < LOW_POWER_FPS_INTERVAL_MS) {
          rafRef.current = requestAnimationFrame(processFrame);
          return;
        }
        lastFramePerfRef.current = nowPerf;

        // Phase 1: Automatic 3-second camera exposure calibration ("Calibrando luz...")
        if (totalElapsedMs < calibrationMs) {
          setCalibrationElapsedSec(Math.min(CALIBRATION_DURATION_SEC, totalElapsedMs / 1000));
          const rgb = sampleRoiFromVideo();
          if (rgb) {
            setRedCoveragePct(rgb.redCoveragePct);
            setFingerStatus(rgb.fingerStatus);
          }
          rafRef.current = requestAnimationFrame(processFrame);
          return;
        }

        // Transition from calibration -> clean 20s measurement
        if (scanPhaseRef.current === 'calibrating') {
          scanPhaseRef.current = 'measuring';
          setScanPhase('measuring');
          setCalibrationElapsedSec(CALIBRATION_DURATION_SEC);
          samplesRef.current = [];
          lastUiWaveUpdateRef.current = 0;
        }

        const measureElapsedMs = totalElapsedMs - calibrationMs;
        const measureElapsedS = Math.min(SCAN_DURATION_SEC, measureElapsedMs / 1000);
        setElapsedSec(measureElapsedS);

        const rgb = sampleRoiFromVideo();
        if (rgb) {
          samplesRef.current.push({
            t: nowPerf,
            v: rgb.avgR,
            g: rgb.avgG,
            redCoveragePct: rgb.redCoveragePct,
          });
          setRedCoveragePct(rgb.redCoveragePct);
          setFingerStatus(rgb.fingerStatus);

          // Update live waveform & BPM preview (~12fps normal, ~7fps in Low Power Mode)
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

            if (measureElapsedS >= 4.5 && samplesRef.current.length >= 45) {
              const interim = computeBpmAndHrv(samplesRef.current.slice(-300));
              if (
                interim.bpm >= PPG_MIN_BPM &&
                interim.bpm <= PPG_MAX_BPM &&
                interim.signalQualityPct >= 50
              ) {
                setLiveBpmPreview(interim.bpm);
              }
            }
          }
        }

        rafRef.current = requestAnimationFrame(processFrame);
      };

      rafRef.current = requestAnimationFrame(processFrame);
    } catch {
      stopCameraResources();
      scanPhaseRef.current = 'idle';
      setScanPhase('idle');
      setIsScanning(false);
      setCameraError(
        'No se pudo acceder a la cámara trasera. Verifica permisos o registra tu pulso manualmente.',
      );
    }
  };

  const handleSaveManualPulse = (e: React.FormEvent) => {
    e.preventDefault();
    const bpm = Number.parseInt(manualBpmStr, 10);
    const hrv = Number.parseInt(manualHrvStr, 10);
    if (Number.isNaN(bpm) || bpm < 35 || bpm > 210) return;
    const safeHrv = Number.isNaN(hrv) ? 45 : Math.max(10, Math.min(180, hrv));
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
      `Pulso guardado (${bpm} BPM · HRV ${safeHrv} ms) y sincronizado con el Check-In diario.`,
    );
  };

  const handleSaveBloodPressure = (e: React.FormEvent) => {
    e.preventDefault();
    setBpSavedMsg(null);
    setBpErrorMsg(null);

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

  // Live PPG wave SVG polyline
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

  // Historical Blood Pressure SVG Chart (chronological, up to last 12 readings)
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
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-rose-400 text-xs font-bold">
              <HeartPulse className="w-4 h-4" />
              <span>Biometría cardiovascular</span>
            </div>
            <h2 className="mt-1 text-2xl sm:text-3xl font-extrabold font-display text-white">
              Pulso y Presión
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Escáner óptico PPG (BPM y HRV RMSSD) con cámara trasera y seguimiento de presión arterial.
            </p>
          </div>

          {todayReadiness && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 flex items-center gap-2.5 shrink-0">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="text-xs">
                <p className="font-bold text-emerald-200">Check-In diario activo</p>
                <p className="text-zinc-300 font-mono tabular-nums">
                  Preparación: {todayReadiness.score}/100
                  {todayReadiness.restingBpm ? ` · ${todayReadiness.restingBpm} BPM` : ''}
                  {todayReadiness.hrvRmssdMs ? ` · HRV ${todayReadiness.hrvRmssdMs}ms` : ''}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SECTION 1: PPG CAMERA & FLASH SCANNER */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/15 border border-rose-400/30 flex items-center justify-center text-rose-400">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">
                Escáner de Pulso Cardiaco (PPG · 20s)
              </h3>
              <p className="text-xs text-zinc-400">
                Extrae el canal rojo en tiempo real para medir BPM promedio y HRV (RMSSD)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowManualPulse((v) => !v)}
            className="min-h-[40px] rounded-xl border border-[#2B303C] bg-[#171A23] px-3.5 text-xs font-bold text-zinc-300 hover:text-white"
          >
            {showManualPulse ? 'Cerrar manual' : 'Captura manual'}
          </button>
        </div>

        {/* Hidden processing canvas + camera video preview */}
        <canvas ref={hiddenCanvasRef} className="hidden" />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Left: Camera Finger Placement + Controls */}
          <div className="lg:col-span-5 rounded-2xl border border-[#242834] bg-[#0D0F14] p-4 flex flex-col justify-between space-y-4">
            <div className="flex items-center gap-4">
              {/* Circular live rear camera preview + red coverage indicator */}
              <button
                type="button"
                onClick={() => {
                  if (!previewActive && !isScanning) {
                    void startCameraPreview();
                  }
                }}
                aria-label="Vista previa en vivo de cámara trasera"
                className={`relative w-24 h-24 rounded-full overflow-hidden border-2 flex items-center justify-center shrink-0 transition-colors ${
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
                      className={`mt-10 text-[10px] font-mono tabular-nums font-extrabold px-1.5 py-0.5 rounded bg-black/75 ${
                        fingerStatus === 'bien_puesto'
                          ? 'text-emerald-300'
                          : fingerStatus === 'ajustar'
                            ? 'text-amber-300'
                            : 'text-rose-200'
                      }`}
                    >
                      Rojo {redCoveragePct}%
                    </span>
                  )}
                </div>
              </button>

              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-bold text-white">
                    {!isScanning
                      ? 'Listo para escanear'
                      : scanPhase === 'calibrating'
                        ? 'Calibrando luz...'
                        : fingerStatus === 'bien_puesto'
                          ? 'Dedo bien puesto sobre el lente'
                          : fingerStatus === 'ajustar'
                            ? 'Ajusta un poco tu dedo sobre el flash'
                            : 'Coloca tu dedo cubriendo cámara y flash'}
                  </p>
                  {(previewActive || isScanning) && (
                    <span
                      className={`text-[10px] font-mono tabular-nums font-bold px-1.5 py-0.5 rounded-md border ${
                        redCoveragePct >= 65
                          ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                          : redCoveragePct >= 30
                            ? 'border-amber-400/40 bg-amber-500/15 text-amber-300'
                            : 'border-[#2D3343] bg-[#161A24] text-zinc-300'
                      }`}
                    >
                      Cobertura roja {redCoveragePct}%
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  {previewActive
                    ? 'Verifica en el círculo que el lente trasero quede cubierto en rojo (≥65%) antes o durante el escaneo.'
                    : 'Toca el círculo o inicia el escáner para activar la vista previa de la cámara trasera.'}
                </p>
                {torchSupportedMsg && (
                  <p className="text-[11px] text-amber-300 flex items-center gap-1">
                    <Flashlight className="w-3 h-3 shrink-0" />
                    <span>{torchSupportedMsg}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Calibration (3s) & Measurement (20s) Progress Bar */}
            {isScanning && (
              <div className="space-y-1.5">
                {scanPhase === 'calibrating' ? (
                  <>
                    <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                      <span className="text-amber-300 font-bold">
                        Calibrando luz... ({Math.max(1, Math.ceil(CALIBRATION_DURATION_SEC - calibrationElapsedSec))}s)
                      </span>
                      <span className="font-bold text-amber-300">
                        {Math.min(100, Math.round((calibrationElapsedSec / CALIBRATION_DURATION_SEC) * 100))}%
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
                      <span className="text-zinc-400">
                        Midiendo pulso ({Math.round(elapsedSec)}s / {SCAN_DURATION_SEC}s)
                      </span>
                      <span className="font-bold text-[#D4FF33]">{progressPct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-[#191D28] overflow-hidden">
                      <div
                        className="h-full bg-[#D4FF33] transition-all duration-150"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Scan / Stop CTA */}
            {isScanning ? (
              <button
                type="button"
                onClick={handleCancelScan}
                className="w-full min-h-[52px] rounded-2xl border border-rose-500/40 bg-rose-500/15 px-5 text-sm font-extrabold text-rose-200 flex items-center justify-center gap-2"
              >
                <Square className="w-4 h-4 fill-current" />
                Cancelar medición
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleStartPpgScan()}
                className="w-full min-h-[52px] rounded-2xl bg-[#D4FF33] hover:bg-[#c5f022] px-5 text-sm font-extrabold text-[#0A0B0D] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <HeartPulse className="w-4 h-4" />
                Iniciar escáner PPG (20s)
              </button>
            )}
          </div>

          {/* Right: Live Waveform Graph + Last Metrics */}
          <div className="lg:col-span-7 rounded-2xl border border-[#242834] bg-[#0D0F14] p-4 flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-rose-400" />
                <span className="text-xs font-bold text-white">
                  {isScanning ? 'Onda de pulso en vivo' : 'Última onda registrada'}
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

            {/* Waveform SVG */}
            <div className="h-28 rounded-xl border border-white/5 bg-[#090B0F] flex items-center justify-center overflow-hidden px-2">
              {liveWavePath ? (
                <svg
                  viewBox="0 0 520 92"
                  className="w-full h-24"
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
                  Inicia el escáner PPG de 20 segundos para visualizar tu onda cardiaca en tiempo real.
                </p>
              )}
            </div>

            {/* BPM + HRV + Recovery KPI Strip */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="rounded-xl bg-[#141720] border border-[#232836] p-3">
                <p className="text-[11px] text-zinc-400">Pulso medio</p>
                <p className="mt-0.5 text-xl font-extrabold font-mono tabular-nums text-white">
                  {latestPulse ? `${latestPulse.bpm}` : '--'}{' '}
                  <span className="text-xs font-normal text-zinc-400">BPM</span>
                </p>
              </div>
              <div className="rounded-xl bg-[#141720] border border-[#232836] p-3">
                <p className="text-[11px] text-zinc-400">HRV (RMSSD)</p>
                <p className="mt-0.5 text-xl font-extrabold font-mono tabular-nums text-[#D4FF33]">
                  {latestPulse ? `${latestPulse.hrvRmssdMs}` : '--'}{' '}
                  <span className="text-xs font-normal text-zinc-400">ms</span>
                </p>
              </div>
              <div className="rounded-xl bg-[#141720] border border-[#232836] p-3">
                <p className="text-[11px] text-zinc-400">Calidad / Recup.</p>
                <p className="mt-0.5 text-xl font-extrabold font-mono tabular-nums text-emerald-300">
                  {latestPulse ? `${latestPulse.recoveryImpactScore}%` : '--'}
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
                max={180}
                value={manualHrvStr}
                onChange={(e) => setManualHrvStr(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-[#2C3140] bg-[#141720] px-3 text-sm font-mono text-white focus:border-[#D4FF33] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="min-h-[44px] rounded-xl bg-[#D4FF33] px-4 text-xs font-extrabold text-[#0A0B0D]"
            >
              Guardar y actualizar Check-In
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

        {/* Recent PPG Measurements */}
        {sortedPulse.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-white/5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-zinc-300">
                Historial reciente de Pulso y HRV (IndexedDB)
              </span>
              <span className="font-mono text-zinc-500">{sortedPulse.length} tomas</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {sortedPulse.slice(0, 6).map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-[#242834] bg-[#0D0F14] px-3.5 py-2.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold font-mono tabular-nums text-white">
                      {item.bpm} BPM{' '}
                      <span className="text-[#D4FF33] text-xs font-bold">
                        · HRV {item.hrvRmssdMs} ms
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
              ))}
            </div>
          </div>
        )}
      </section>

      {/* SECTION 2: BLOOD PRESSURE LOG & TREND CHART */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-300">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">
                Registro y Tendencia de Presión Arterial
              </h3>
              <p className="text-xs text-zinc-400">
                Semáforo automático (Normal, Elevada, Alta) e historial en IndexedDB
              </p>
            </div>
          </div>

          {latestBp && (
            <div className="text-right">
              <p className="text-xs text-zinc-400">Última toma</p>
              <p className="text-lg font-extrabold font-mono tabular-nums text-white">
                {latestBp.systolic}/{latestBp.diastolic}{' '}
                <span className="text-xs font-normal text-zinc-400">mmHg</span>
              </p>
            </div>
          )}
        </div>

        {/* Quick Entry Form + Live Traffic-Light Indicator */}
        <form onSubmit={handleSaveBloodPressure} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="bp-systolic"
                className="block text-xs font-semibold text-zinc-400 mb-1"
              >
                Sistólica (mmHg)
              </label>
              <input
                id="bp-systolic"
                type="number"
                min={65}
                max={250}
                value={systolicStr}
                onChange={(e) => setSystolicStr(e.target.value)}
                className="w-full min-h-[48px] rounded-2xl border border-[#2C3140] bg-[#0D0F14] px-3.5 text-lg font-extrabold font-mono tabular-nums text-white focus:border-[#D4FF33] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="bp-diastolic"
                className="block text-xs font-semibold text-zinc-400 mb-1"
              >
                Diastólica (mmHg)
              </label>
              <input
                id="bp-diastolic"
                type="number"
                min={35}
                max={150}
                value={diastolicStr}
                onChange={(e) => setDiastolicStr(e.target.value)}
                className="w-full min-h-[48px] rounded-2xl border border-[#2C3140] bg-[#0D0F14] px-3.5 text-lg font-extrabold font-mono tabular-nums text-white focus:border-[#D4FF33] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="bp-pulse"
                className="block text-xs font-semibold text-zinc-400 mb-1"
              >
                Pulso (BPM · opcional)
              </label>
              <input
                id="bp-pulse"
                type="number"
                min={35}
                max={210}
                placeholder={latestPulse ? String(latestPulse.bpm) : '68'}
                value={bpPulseStr}
                onChange={(e) => setBpPulseStr(e.target.value)}
                className="w-full min-h-[48px] rounded-2xl border border-[#2C3140] bg-[#0D0F14] px-3.5 text-lg font-extrabold font-mono tabular-nums text-white placeholder:text-zinc-600 focus:border-[#D4FF33] focus:outline-none"
              />
            </div>
          </div>

          {/* Semáforo de rango preview */}
          {liveBpPreview && (
            <div
              className={`rounded-2xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${liveBpPreview.borderBg}`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-3 h-3 rounded-full shrink-0 ${liveBpPreview.dotColor}`}
                  aria-hidden="true"
                />
                <span className={`text-sm font-extrabold ${liveBpPreview.labelColor}`}>
                  Semáforo: {liveBpPreview.category}
                </span>
              </div>
              <p className="text-xs text-zinc-300">{liveBpPreview.advice}</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={bpNotes}
              onChange={(e) => setBpNotes(e.target.value)}
              placeholder="Nota opcional (ej. en reposo, brazo izquierdo, mañana)..."
              maxLength={80}
              className="flex-1 min-h-[48px] rounded-2xl border border-[#2C3140] bg-[#0D0F14] px-3.5 text-xs text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
            />
            <button
              type="submit"
              className="min-h-[48px] rounded-2xl bg-[#D4FF33] hover:bg-[#c5f022] px-5 text-sm font-extrabold text-[#0A0B0D] inline-flex items-center justify-center gap-2 shrink-0"
            >
              <Plus className="w-4 h-4" />
              Guardar toma
            </button>
          </div>

          {bpErrorMsg && (
            <p className="text-xs font-semibold text-rose-400">{bpErrorMsg}</p>
          )}
          {bpSavedMsg && (
            <p className="text-xs font-semibold text-emerald-300">{bpSavedMsg}</p>
          )}
        </form>

        {/* Historical Blood Pressure Dual-Line SVG Chart */}
        {bpChart ? (
          <div className="rounded-2xl border border-[#242834] bg-[#0B0D12] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-bold text-white">
                Tendencia histórica (últimas {bpChart.coords.length} tomas)
              </span>
              <div className="flex items-center gap-4 text-[11px]">
                <span className="text-rose-300 font-semibold">Sistólica</span>
                <span className="text-sky-300 font-semibold">Diastólica</span>
                <span className="text-zinc-500">Ref 120/80</span>
              </div>
            </div>

            <div className="w-full overflow-x-auto">
              <svg
                viewBox={`0 0 ${bpChart.w} ${bpChart.h}`}
                className="w-full min-w-[440px] h-48"
                role="img"
                aria-label="Gráfica histórica de presión arterial"
              >
                {/* Normal reference lines 120 / 80 */}
                <line
                  x1="24"
                  y1={bpChart.y120}
                  x2={bpChart.w - 24}
                  y2={bpChart.y120}
                  stroke="#334155"
                  strokeDasharray="4 4"
                />
                <text
                  x={bpChart.w - 26}
                  y={bpChart.y120 - 4}
                  textAnchor="end"
                  fill="#64748B"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  120
                </text>

                <line
                  x1="24"
                  y1={bpChart.y80}
                  x2={bpChart.w - 24}
                  y2={bpChart.y80}
                  stroke="#334155"
                  strokeDasharray="4 4"
                />
                <text
                  x={bpChart.w - 26}
                  y={bpChart.y80 - 4}
                  textAnchor="end"
                  fill="#64748B"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  80
                </text>

                {/* Diastolic & Systolic lines */}
                {bpChart.coords.length > 1 && (
                  <>
                    <path
                      d={bpChart.sysPath}
                      fill="none"
                      stroke="#FB7185"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d={bpChart.diaPath}
                      fill="none"
                      stroke="#38BDF8"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
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
                    <circle cx={c.x} cy={c.ySys} r="4.5" fill="#FB7185" />
                    <circle cx={c.x} cy={c.yDia} r="4.5" fill="#38BDF8" />
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
                      y={c.yDia + 14}
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
        ) : (
          <div className="rounded-2xl border border-dashed border-[#272C38] bg-[#0D0F14] p-5 text-center text-xs text-zinc-400">
            Registra tu primera toma de presión arterial para ver el semáforo y la gráfica de tendencia.
          </div>
        )}

        {/* Saved Blood Pressure List */}
        {sortedBp.length > 0 && (
          <div className="space-y-2">
            {sortedBp.slice(0, 8).map((bp) => {
              const cls = classifyBloodPressure(bp.systolic, bp.diastolic);
              return (
                <div
                  key={bp.id}
                  className="rounded-2xl border border-[#242834] bg-[#0D0F14] px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${cls.dotColor}`}
                        aria-hidden="true"
                      />
                      <span className="text-base font-extrabold font-mono tabular-nums text-white">
                        {bp.systolic}/{bp.diastolic} mmHg
                      </span>
                      <span className={`text-xs font-bold ${cls.labelColor}`}>
                        {bp.category}
                      </span>
                      {bp.pulseBpm && (
                        <span className="text-xs font-mono tabular-nums text-zinc-400">
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
