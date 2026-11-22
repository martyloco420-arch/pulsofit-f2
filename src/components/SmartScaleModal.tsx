import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bluetooth,
  BluetoothSearching,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Plus,
  Radio,
  Scale,
  Share2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
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
  OKOK_REFERENCE_MAC,
  connectBluetoothScale,
  isBleAdvertisementScanSupported,
  isWebBluetoothSupported,
  scanOkokAdvertisements,
  type BleReading,
} from '../lib/bluetoothScale';
import { shiftIsoDate } from '../lib/compareDates';
import {
  build19MetricCards,
  computeBodyCompositionScan,
  getDefaultTimeSlot,
  getScanTimeSlot,
  getTimeSlotLabel,
  type MetricCardDescriptor,
} from '../lib/bodyComposition';
import {
  interpretBodyScansAi,
  parseScaleScreenshotAi,
} from '../lib/aiClient';
import { useHardwareManager } from '../hooks/useHardwareManager';
import { generateAndShareScaleCard } from '../lib/scaleShareCard';
import { getTodayIsoDate } from '../lib/storage';
import {
  cmToDisplayWaist,
  displayWaistToCm,
  displayWeightToKg,
  formatWaist,
  formatWeight,
  getWaistUnit,
  getWeightUnit,
  kgToDisplayWeight,
} from '../lib/units';
import type {
  BodyCompositionScan,
  MetricStatusLevel,
  UserProfile,
  WeighInTimeSlot,
} from '../types/fitness';

interface SmartScaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  bodyScans: BodyCompositionScan[];
  onSaveScan: (scan: BodyCompositionScan) => void;
  onDeleteScan?: (scanId: string) => void;
}

interface AiInterpretation {
  verdict: string;
  summary: string;
  recommendations: string[];
}

type HistoryTimeFilter = 'all' | WeighInTimeSlot;
type TrendRangeFilter = '7D' | '30D' | '90D';

const TREND_RANGES: ReadonlyArray<{ id: TrendRangeFilter; days: number; label: string }> = [
  { id: '7D', days: 7, label: '7 días' },
  { id: '30D', days: 30, label: '30 días' },
  { id: '90D', days: 90, label: '90 días' },
];

function playLockChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(990, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch {
    // Ignore audio context restrictions
  }
}

function getStatusTextClass(status: MetricStatusLevel): string {
  switch (status) {
    case 'Perfecto':
    case 'Saludable':
      return 'text-emerald-400';
    case 'Bajo':
      return 'text-sky-400';
    case 'Alto':
      return 'text-amber-300';
    case 'Crítico':
      return 'text-rose-400';
  }
}

interface ScaleChartPoint {
  id: string;
  timestamp: number;
  date: string;
  shortDate: string;
  fullDateTime: string;
  weightKg: number;
  displayWeight: number;
}

interface Scale30dTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ScaleChartPoint }>;
  weightUnit: 'kg' | 'lb';
}

const Scale30dTooltip: React.FC<Scale30dTooltipProps> = ({
  active,
  payload,
  weightUnit,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;
  return (
    <div className="rounded-xl border border-[#2C3344] bg-[#0B0D12]/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="text-[11px] text-zinc-400">{pt.fullDateTime}</p>
      <p className="mt-0.5 text-sm font-extrabold font-mono tabular-nums text-[#a3e635]">
        {pt.displayWeight} {weightUnit}
      </p>
    </div>
  );
};

export const SmartScaleModal: React.FC<SmartScaleModalProps> = ({
  isOpen,
  onClose,
  profile,
  bodyScans,
  onSaveScan,
  onDeleteScan,
}) => {
  const hardware = useHardwareManager();
  const weightUnit = getWeightUnit(profile.weightUnit);
  const waistUnit = getWaistUnit(profile);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bleDisconnectRef = useRef<(() => void) | null>(null);
  const stableSamplesRef = useRef<number[]>([]);
  const autoSavedSessionRef = useRef(false);
  const bleWaistRef = useRef('');
  const bleTimeSlotRef = useRef<WeighInTimeSlot>(getDefaultTimeSlot());

  const [broadScanMode, setBroadScanMode] = useState(false);
  const [bleState, setBleState] = useState<'idle' | 'connecting' | 'weighing' | 'locked'>('idle');
  const [bleStatusMsg, setBleStatusMsg] = useState<string | null>(null);
  const [bleError, setBleError] = useState<string | null>(null);
  const [liveReading, setLiveReading] = useState<BleReading | null>(null);
  const [bleReadingHistory, setBleReadingHistory] = useState<number[]>([]);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [bleWaistText, setBleWaistText] = useState('');
  const [bleTimeSlot, setBleTimeSlot] = useState<WeighInTimeSlot>(() => getDefaultTimeSlot());
  const [bleAutoSavedScanId, setBleAutoSavedScanId] = useState<string | null>(null);

  bleWaistRef.current = bleWaistText;
  bleTimeSlotRef.current = bleTimeSlot;

  // Screenshot AI import state
  const [isParsingImage, setIsParsingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  // Quick manual BIA + Waist registration
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualWeight, setManualWeight] = useState(
    String(kgToDisplayWeight(profile.weightKg, weightUnit)),
  );
  const [manualWaist, setManualWaist] = useState('');
  const [manualFatPct, setManualFatPct] = useState('');
  const [manualTimeSlot, setManualTimeSlot] = useState<WeighInTimeSlot>(() =>
    getDefaultTimeSlot(),
  );
  const [manualError, setManualError] = useState<string | null>(null);

  // Metrics & History UI state
  const [showSecondaryMetrics, setShowSecondaryMetrics] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryTimeFilter>('all');
  const [trendRange, setTrendRange] = useState<TrendRangeFilter>('30D');

  // Share Card state
  const [isGeneratingCard, setIsGeneratingCard] = useState(false);
  const [cardPreviewUrl, setCardPreviewUrl] = useState<string | null>(null);
  const [cardFeedback, setCardFeedback] = useState<string | null>(null);

  // AI Interpretation state
  const [aiInterpretation, setAiInterpretation] = useState<AiInterpretation | null>(null);
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [interpretError, setInterpretError] = useState<string | null>(null);

  const bleSupported = isWebBluetoothSupported();
  const bleAdScanSupported = isBleAdvertisementScanSupported();

  useEffect(() => {
    setManualWeight(String(kgToDisplayWeight(profile.weightKg, weightUnit)));
  }, [profile.weightKg, weightUnit]);

  useEffect(() => {
    if (!isOpen) {
      hardware.stopBleScan();
      bleDisconnectRef.current?.();
      bleDisconnectRef.current = null;
      setBleState('idle');
      setLiveReading(null);
      setBleReadingHistory([]);
      setBleAutoSavedScanId(null);
      autoSavedSessionRef.current = false;
      stableSamplesRef.current = [];
      setCardPreviewUrl(null);
      setCardFeedback(null);
    } else {
      const slot = getDefaultTimeSlot();
      setManualTimeSlot(slot);
      setBleTimeSlot(slot);
    }
  }, [isOpen, hardware.stopBleScan]);

  const sortedScansDesc = useMemo(
    () => [...bodyScans].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
    [bodyScans],
  );
  const sortedScansAsc = useMemo(
    () => [...sortedScansDesc].reverse(),
    [sortedScansDesc],
  );
  const latestScan = sortedScansDesc[0] ?? null;
  const previousScan = sortedScansDesc[1] ?? null;

  const metricCards = useMemo(() => {
    if (!latestScan) return [];
    return build19MetricCards(latestScan, sortedScansDesc, profile);
  }, [latestScan, sortedScansDesc, profile]);

  const primaryCards = useMemo(
    () => metricCards.filter((c) => c.isPrimaryOkok),
    [metricCards],
  );
  const secondaryCards = useMemo(
    () => metricCards.filter((c) => !c.isPrimaryOkok),
    [metricCards],
  );

  // Chronological delta lookup by scan id (always compares to the weigh-in immediately prior in time)
  const deltaByScanId = useMemo(() => {
    const map = new Map<string, number | null>();
    for (let i = 0; i < sortedScansAsc.length; i++) {
      const cur = sortedScansAsc[i];
      const prev = i > 0 ? sortedScansAsc[i - 1] : null;
      map.set(
        cur.id,
        prev ? Math.round((cur.weightKg - prev.weightKg) * 10) / 10 : null,
      );
    }
    return map;
  }, [sortedScansAsc]);

  const filteredHistoryScans = useMemo(() => {
    if (historyFilter === 'all') return sortedScansDesc;
    return sortedScansDesc.filter((s) => getScanTimeSlot(s) === historyFilter);
  }, [sortedScansDesc, historyFilter]);

  const best30DaysWeightKg = useMemo(() => {
    if (sortedScansDesc.length === 0) return null;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = sortedScansDesc.filter((s) => Date.parse(s.recordedAt) >= cutoff);
    const pool = recent.length > 0 ? recent : sortedScansDesc;
    const target = profile.targetWeightKg || latestScan?.idealWeightKg || 70;
    return pool.reduce(
      (best, s) =>
        Math.abs(s.weightKg - target) < Math.abs(best - target) ? s.weightKg : best,
      pool[0].weightKg,
    );
  }, [sortedScansDesc, profile.targetWeightKg, latestScan?.idealWeightKg]);

  const activeRangeMeta = useMemo(
    () => TREND_RANGES.find((r) => r.id === trendRange) ?? TREND_RANGES[1],
    [trendRange],
  );

  const trendRangeData = useMemo<ScaleChartPoint[]>(() => {
    const todayIso = getTodayIsoDate();
    const cutoffIso = shiftIsoDate(todayIso, -activeRangeMeta.days);
    return sortedScansAsc
      .filter((s) => s.date >= cutoffIso && s.date <= todayIso)
      .map((s) => {
        const [y, m, d] = s.date.split('-').map((n) => parseInt(n, 10));
        const dt = new Date(y, (m || 1) - 1, d || 1);
        const parsedRecordedAt = Date.parse(s.recordedAt);
        const timestamp = Number.isNaN(parsedRecordedAt)
          ? dt.getTime()
          : parsedRecordedAt;
        const shortDate = Number.isNaN(dt.getTime())
          ? s.date.slice(5)
          : dt
              .toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
              .replace('.', '');
        const timeStr = new Date(timestamp).toLocaleTimeString('es-MX', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        return {
          id: s.id,
          timestamp,
          date: s.date,
          shortDate,
          fullDateTime: `${s.date} · ${timeStr}`,
          weightKg: s.weightKg,
          displayWeight: kgToDisplayWeight(s.weightKg, weightUnit),
        };
      });
  }, [sortedScansAsc, weightUnit, activeRangeMeta.days]);

  const trendNetDeltaDisplay = useMemo(() => {
    if (trendRangeData.length < 2) return 0;
    const first = trendRangeData[0].displayWeight;
    const last = trendRangeData[trendRangeData.length - 1].displayWeight;
    const raw = Math.round((last - first) * 10) / 10;
    if (Object.is(raw, -0) || Math.abs(raw) < 0.05) return 0;
    return raw;
  }, [trendRangeData]);

  const recent10Scans = useMemo(
    () => sortedScansDesc.slice(0, 10),
    [sortedScansDesc],
  );

  const parseOptionalWaistCm = (rawText: string): number | undefined => {
    const cleaned = rawText.replace(',', '.').trim();
    if (!cleaned) return undefined;
    const val = parseFloat(cleaned);
    if (Number.isNaN(val) || val <= 0) return undefined;
    const cm = displayWaistToCm(val, waistUnit);
    if (cm < 40 || cm > 200) return undefined;
    return cm;
  };

  const persistStabilizedBleScan = (reading: BleReading, reasonMsg: string) => {
    if (autoSavedSessionRef.current) return;
    autoSavedSessionRef.current = true;

    const waistCm = parseOptionalWaistCm(bleWaistRef.current);
    const scan = computeBodyCompositionScan(
      {
        weightKg: reading.weightKg,
        waistCm,
        timeSlot: bleTimeSlotRef.current,
        impedanceOhm: reading.impedanceOhm,
        source: 'bluetooth',
        date: getTodayIsoDate(),
      },
      profile,
    );

    onSaveScan(scan);
    setBleAutoSavedScanId(scan.id);
    setAiInterpretation(null);
    setBleState('locked');
    setBleStatusMsg(reasonMsg);
    playLockChime();
    hardware.stopBleScan();
    bleDisconnectRef.current?.();
    bleDisconnectRef.current = null;
  };

  const handleIncomingReading = (reading: BleReading) => {
    if (autoSavedSessionRef.current) return;

    setBleState('weighing');
    setLiveReading(reading);

    const roundedCentigrams = Math.round(reading.weightKg * 100);
    const samples = stableSamplesRef.current;
    samples.push(roundedCentigrams);
    if (samples.length > 6) samples.shift();
    setBleReadingHistory([...samples].map((cg) => cg / 100));

    const recent3 = samples.slice(-3);
    const threeConsecutiveIdentical =
      recent3.length >= 3 &&
      recent3[0] === recent3[1] &&
      recent3[1] === recent3[2];

    if (reading.isStabilizedFlag) {
      persistStabilizedBleScan(
        reading,
        'Peso estabilizado (bandera de bloqueo) y guardado en el historial',
      );
      return;
    }

    if (threeConsecutiveIdentical) {
      persistStabilizedBleScan(
        reading,
        'Peso estabilizado (3 lecturas idénticas) y guardado en el historial',
      );
      return;
    }

    setBleStatusMsg('Pesando en tiempo real... mantente quieto sobre la báscula');
  };

  const handleStartBluetooth = async () => {
    setBleError(null);
    setBleStatusMsg(null);
    setLiveReading(null);
    setBleReadingHistory([]);
    setBleAutoSavedScanId(null);
    autoSavedSessionRef.current = false;
    stableSamplesRef.current = [];
    setBleState('connecting');

    try {
      const conn = await connectBluetoothScale(
        broadScanMode,
        handleIncomingReading,
        (status) => setBleStatusMsg(status),
      );
      const stopFn = () => {
        conn.disconnect();
        bleDisconnectRef.current = null;
      };
      bleDisconnectRef.current = stopFn;
      hardware.registerBleScan(stopFn);
      setDeviceName(conn.deviceName);
      setBleState('weighing');
    } catch (err) {
      setBleState('idle');
      setBleError(
        err instanceof Error
          ? err.message
          : 'No se pudo vincular con la báscula Bluetooth. Usa Registro rápido manual.',
      );
    }
  };

  const handleStartPassiveAdScan = async () => {
    setBleError(null);
    setBleStatusMsg(null);
    setLiveReading(null);
    setBleReadingHistory([]);
    setBleAutoSavedScanId(null);
    autoSavedSessionRef.current = false;
    stableSamplesRef.current = [];
    setBleState('connecting');

    try {
      const conn = await scanOkokAdvertisements(
        (reading, devLabel) => {
          setDeviceName(devLabel);
          handleIncomingReading(reading);
        },
        (status) => setBleStatusMsg(status),
      );
      const stopFn = () => {
        conn.disconnect();
        bleDisconnectRef.current = null;
      };
      bleDisconnectRef.current = stopFn;
      hardware.registerBleScan(stopFn);
      setDeviceName(`OKOK BLE (${OKOK_REFERENCE_MAC})`);
      setBleState('weighing');
    } catch (err) {
      setBleState('idle');
      setShowManualForm(true);
      setBleError(
        err instanceof Error
          ? err.message
          : 'El navegador bloqueó el escaneo sin emparejar; abrimos el registro rápido.',
      );
    }
  };

  const handleConfirmBluetoothReading = () => {
    if (!liveReading) return;
    if (!autoSavedSessionRef.current) {
      persistStabilizedBleScan(
        liveReading,
        'Pesaje fijado y guardado en tu historial',
      );
      return;
    }
    setBleState('idle');
    setLiveReading(null);
    setBleReadingHistory([]);
    setBleWaistText('');
    setBleAutoSavedScanId(null);
    autoSavedSessionRef.current = false;
  };

  const handleScreenshotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsParsingImage(true);
    setImageError(null);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = reader.result as string;
          const commaIdx = res.indexOf(',');
          resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
        };
        reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
        reader.readAsDataURL(file);
      });

      const data = await parseScaleScreenshotAi<{
        weightKg?: number;
        bmi?: number;
        bodyFatPct?: number;
        skeletalMusclePct?: number;
        totalMusclePct?: number;
        bodyWaterPct?: number;
        visceralFatLevel?: number;
        boneMassKg?: number;
        bmrKcal?: number;
        proteinPct?: number;
        bodyAge?: number;
        leanMassKg?: number;
      }>(base64, file.type || 'image/png');

      const scan = computeBodyCompositionScan(
        {
          weightKg: Number(data.weightKg),
          waistCm: parseOptionalWaistCm(manualWaist),
          timeSlot: manualTimeSlot,
          bmi: typeof data.bmi === 'number' ? data.bmi : undefined,
          bodyFatPct: typeof data.bodyFatPct === 'number' ? data.bodyFatPct : undefined,
          skeletalMusclePct:
            typeof data.skeletalMusclePct === 'number' ? data.skeletalMusclePct : undefined,
          totalMusclePct:
            typeof data.totalMusclePct === 'number' ? data.totalMusclePct : undefined,
          bodyWaterPct:
            typeof data.bodyWaterPct === 'number' ? data.bodyWaterPct : undefined,
          visceralFatLevel:
            typeof data.visceralFatLevel === 'number' ? data.visceralFatLevel : undefined,
          boneMassKg: typeof data.boneMassKg === 'number' ? data.boneMassKg : undefined,
          bmrKcal: typeof data.bmrKcal === 'number' ? data.bmrKcal : undefined,
          proteinPct: typeof data.proteinPct === 'number' ? data.proteinPct : undefined,
          bodyAge: typeof data.bodyAge === 'number' ? data.bodyAge : undefined,
          leanMassKg: typeof data.leanMassKg === 'number' ? data.leanMassKg : undefined,
          source: 'captura_ia',
          date: getTodayIsoDate(),
        },
        profile,
      );

      onSaveScan(scan);
      setAiInterpretation(null);
      playLockChime();
    } catch (err) {
      setImageError(
        err instanceof Error
          ? err.message
          : 'Error al importar la captura de báscula.',
      );
    } finally {
      setIsParsingImage(false);
      e.target.value = '';
    }
  };

  const handleManualCalculate = (e: React.FormEvent) => {
    e.preventDefault();
    setManualError(null);
    const rawW = parseFloat(manualWeight.replace(',', '.'));
    const minW = weightUnit === 'lb' ? 55 : 25;
    const maxW = weightUnit === 'lb' ? 620 : 280;
    if (Number.isNaN(rawW) || rawW < minW || rawW > maxW) {
      setManualError(`Ingresa un peso válido entre ${minW} y ${maxW} ${weightUnit}.`);
      return;
    }

    const rawWaistTrimmed = manualWaist.trim();
    let waistCm: number | undefined;
    if (rawWaistTrimmed) {
      const parsedWaist = parseFloat(rawWaistTrimmed.replace(',', '.'));
      const minWaist = waistUnit === 'in' ? 16 : 40;
      const maxWaist = waistUnit === 'in' ? 78 : 200;
      if (Number.isNaN(parsedWaist) || parsedWaist < minWaist || parsedWaist > maxWaist) {
        setManualError(
          `La medida de cintura debe estar entre ${minWaist} y ${maxWaist} ${waistUnit}.`,
        );
        return;
      }
      waistCm = displayWaistToCm(parsedWaist, waistUnit);
    }

    const w = displayWeightToKg(rawW, weightUnit);
    const fat = parseFloat(manualFatPct.replace(',', '.'));
    const scan = computeBodyCompositionScan(
      {
        weightKg: w,
        waistCm,
        timeSlot: manualTimeSlot,
        bodyFatPct: !Number.isNaN(fat) && fat > 3 && fat < 65 ? fat : undefined,
        source: 'manual',
        date: getTodayIsoDate(),
      },
      profile,
    );
    onSaveScan(scan);
    setShowManualForm(false);
    setAiInterpretation(null);
    playLockChime();
  };

  const handleInterpretWithAi = async () => {
    if (sortedScansDesc.length === 0) return;
    setIsInterpreting(true);
    setInterpretError(null);
    try {
      const data = await interpretBodyScansAi<AiInterpretation>(profile, sortedScansAsc);
      setAiInterpretation(data);
    } catch (err) {
      setInterpretError(
        err instanceof Error
          ? err.message
          : 'Error de conexión al analizar composición corporal.',
      );
    } finally {
      setIsInterpreting(false);
    }
  };

  const handleShareOrDownloadCard = async () => {
    if (!latestScan) return;
    setIsGeneratingCard(true);
    setCardFeedback(null);
    try {
      const res = await generateAndShareScaleCard({
        latestScan,
        previousScan,
        best30DaysWeightKg,
        recentScansAsc: sortedScansAsc,
        profile,
      });
      setCardPreviewUrl(res.dataUrl);
      setCardFeedback(
        res.status === 'shared'
          ? 'Tarjeta compartida correctamente.'
          : 'Tarjeta PNG descargada en tu dispositivo.',
      );
    } catch (err) {
      setCardFeedback(
        err instanceof Error
          ? err.message
          : 'No se pudo generar la tarjeta descargable.',
      );
    } finally {
      setIsGeneratingCard(false);
    }
  };

  const renderMetricCard = (card: MetricCardDescriptor) => {
    const isKgMetric = card.unit === 'kg';
    const isCmMetric = card.unit === 'cm';

    const displayUnit = isKgMetric
      ? weightUnit
      : isCmMetric
        ? waistUnit
        : card.unit;

    const convertNum = (v: number) =>
      isKgMetric
        ? kgToDisplayWeight(v, weightUnit)
        : isCmMetric
          ? cmToDisplayWaist(v, waistUnit)
          : v;

    const displayValue = convertNum(card.value);
    const displayDelta =
      card.previousDelta !== null
        ? (card.previousDelta < 0 ? -1 : 1) * convertNum(Math.abs(card.previousDelta))
        : null;
    const displayBest30 =
      card.best30DaysValue !== null ? convertNum(card.best30DaysValue) : null;

    return (
      <div
        key={card.key}
        className="rounded-2xl border border-[#222631] bg-[#13151A] p-4 flex flex-col justify-between gap-2.5"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-semibold text-zinc-200 leading-snug">
            {card.label}
          </span>
          <span
            className={`text-xs font-bold shrink-0 ${getStatusTextClass(card.status)}`}
          >
            {card.status}
          </span>
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-extrabold font-mono tabular-nums text-white">
            {displayValue}
          </span>
          {displayUnit && (
            <span className="text-xs text-zinc-400">{displayUnit}</span>
          )}
        </div>

        {/* Barra semáforo 4 zonas: Bajo / Saludable / Alto / Crítico */}
        <div className="space-y-1">
          <div className="relative h-2.5 w-full rounded-full overflow-hidden flex bg-[#1C2029]">
            {card.rangeBar.segments.map((seg) => (
              <div
                key={seg.label}
                title={seg.label}
                className={`h-full ${seg.colorClass} opacity-85`}
                style={{ width: `${seg.widthPct}%` }}
              />
            ))}
            {/* Posición actual */}
            <span
              aria-hidden="true"
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 border-[#0A0B0D] shadow"
              style={{ left: `${card.rangeBar.markerPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-zinc-500">
            <span>Bajo</span>
            <span className="text-emerald-400/90">Saludable</span>
            <span>Alto</span>
            <span className="text-rose-400/90">Crítico</span>
          </div>
        </div>

        {/* Guía explicativa breve */}
        <p className="text-[11px] text-zinc-400 leading-snug">{card.guide}</p>

        <div className="text-[11px] font-mono tabular-nums text-zinc-400 pt-1.5 border-t border-white/5 space-y-0.5">
          {card.subLabel ? (
            <p className="text-zinc-300 font-sans">{card.subLabel}</p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <span>
              vs Anterior:{' '}
              <strong className="text-zinc-200">
                {displayDelta === null
                  ? 'Primer dato'
                  : `${displayDelta > 0 ? '+' : ''}${Math.round(displayDelta * 10) / 10}${
                      displayUnit ? ` ${displayUnit}` : ''
                    }`}
              </strong>
            </span>
            {displayBest30 !== null && (
              <span>
                Mejor 30d:{' '}
                <strong className="text-[#D4FF33]">
                  {displayBest30}
                  {displayUnit ? ` ${displayUnit}` : ''}
                </strong>
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-sm">
      <div className="w-full max-w-4xl rounded-t-3xl sm:rounded-3xl border border-[#262B36] bg-[#0E1014] max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="w-10 h-1.5 bg-zinc-700 rounded-full mx-auto mt-3 sm:hidden shrink-0" />

        {/* Modal Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between gap-3 shrink-0 bg-[#12141A]">
          <div>
            <p className="text-xs font-bold text-[#D4FF33]">
              Estilo OKOK · BLE ref. {OKOK_REFERENCE_MAC}
            </p>
            <h2 className="text-2xl font-extrabold font-display text-white">
              Báscula Inteligente y Composición Corporal
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar báscula inteligente"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 max-h-[85vh] overflow-y-auto p-5 space-y-6">
          {/* 1. CONEXIÓN BLE OKOK, CAPTURA IA Y REGISTRO RÁPIDO MANUAL + CINTURA */}
          <section className="rounded-3xl border border-[#222631] bg-[#13151A] p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                disabled={!bleSupported || bleState === 'connecting'}
                onClick={handleStartBluetooth}
                className="min-h-[52px] flex items-center justify-center gap-2 rounded-2xl bg-[#D4FF33] disabled:opacity-50 px-4 text-xs sm:text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform"
              >
                {bleState === 'connecting' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Conectando BLE...
                  </>
                ) : (
                  <>
                    <Bluetooth className="w-4 h-4" />
                    Báscula OKOK (BLE)
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowManualForm((v) => !v)}
                className={`min-h-[52px] flex items-center justify-center gap-2 rounded-2xl border px-4 text-xs sm:text-sm font-bold active:scale-[0.98] transition-all ${
                  showManualForm
                    ? 'border-[#D4FF33] bg-[#D4FF33]/15 text-[#D4FF33]'
                    : 'border-[#2F3545] bg-[#1A1E28] hover:bg-[#232836] text-white'
                }`}
              >
                <Plus className="w-4 h-4 text-[#D4FF33]" />
                Captura manual / Cintura
              </button>

              <button
                type="button"
                disabled={isParsingImage}
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[52px] flex items-center justify-center gap-2 rounded-2xl border border-[#2F3545] bg-[#1A1E28] hover:bg-[#232836] px-4 text-xs sm:text-sm font-bold text-white active:scale-[0.98] transition-transform"
              >
                {isParsingImage ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#D4FF33]" />
                    Analizando captura...
                  </>
                ) : (
                  <>
                    <Camera className="w-4 h-4 text-[#D4FF33]" />
                    Importar captura IA
                  </>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleScreenshotUpload}
                className="hidden"
              />
            </div>

            {/* BLE Scan Options */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => setBroadScanMode((v) => !v)}
                className="min-h-[40px] flex items-center gap-2 text-xs text-zinc-300 hover:text-white"
              >
                <span
                  className={`w-4 h-4 rounded flex items-center justify-center border ${
                    broadScanMode
                      ? 'bg-[#D4FF33] border-[#D4FF33] text-[#0A0B0D]'
                      : 'border-zinc-600'
                  }`}
                >
                  {broadScanMode && '✓'}
                </span>
                Escaneo amplio (todos los dispositivos BLE)
              </button>

              {bleSupported && (
                <button
                  type="button"
                  onClick={handleStartPassiveAdScan}
                  disabled={bleState === 'connecting'}
                  className="min-h-[40px] inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-300 hover:text-[#D4FF33]"
                >
                  <Radio className="w-3.5 h-3.5 text-[#D4FF33]" />
                  {bleAdScanSupported
                    ? `Escuchar anuncios OKOK (${OKOK_REFERENCE_MAC})`
                    : `Probar anuncios sin emparejar (${OKOK_REFERENCE_MAC})`}
                </button>
              )}
            </div>

            {!bleSupported && (
              <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-500/30 rounded-xl p-3">
                Web Bluetooth requiere Chrome/Edge en Android, Windows o macOS. Si el navegador bloquea el escaneo BLE, usa <strong>Captura manual / Cintura</strong> o <strong>Importar captura IA</strong>.
              </p>
            )}

            {bleError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 flex flex-wrap items-center justify-between gap-2">
                <p role="alert" className="text-xs font-semibold text-rose-300">
                  {bleError}
                </p>
                {!showManualForm && (
                  <button
                    type="button"
                    onClick={() => setShowManualForm(true)}
                    className="min-h-[36px] rounded-lg bg-[#D4FF33] px-3 text-xs font-extrabold text-[#0A0B0D]"
                  >
                    Abrir captura manual
                  </button>
                )}
              </div>
            )}

            {imageError && (
              <p role="alert" className="text-xs font-semibold text-rose-400">
                {imageError}
              </p>
            )}

            {/* Live Bluetooth Weighing Screen */}
            {(bleState === 'weighing' || bleState === 'locked') && (
              <div
                className={`rounded-2xl border p-5 space-y-4 ${
                  bleState === 'locked'
                    ? 'border-emerald-400/60 bg-emerald-950/15'
                    : 'border-[#D4FF33]/50 bg-[#0B0D10]'
                }`}
              >
                <div
                  className={`flex items-center justify-center gap-2 text-xs font-bold ${
                    bleState === 'locked' ? 'text-emerald-300' : 'text-[#D4FF33]'
                  }`}
                >
                  {bleState === 'locked' ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <BluetoothSearching className="w-4 h-4 animate-pulse" />
                  )}
                  <span>
                    {deviceName} · {bleStatusMsg || 'Estabilizando lectura...'}
                  </span>
                </div>

                <div className="text-center space-y-1.5">
                  <p className="text-5xl font-extrabold font-mono tabular-nums text-white">
                    {liveReading
                      ? kgToDisplayWeight(liveReading.weightKg, weightUnit).toFixed(
                          weightUnit === 'lb' ? 1 : 2,
                        )
                      : weightUnit === 'lb'
                        ? '0.0'
                        : '0.00'}{' '}
                    <span className="text-xl text-zinc-400">{weightUnit}</span>
                  </p>
                  {liveReading && weightUnit === 'lb' && (
                    <p className="text-xs font-mono text-zinc-400">
                      Guardado interno: {liveReading.weightKg.toFixed(2)} kg
                    </p>
                  )}
                  {liveReading?.impedanceOhm && (
                    <p className="text-xs font-mono text-zinc-400">
                      Impedancia BIA: {Math.round(liveReading.impedanceOhm)} Ω
                    </p>
                  )}
                  {bleState === 'weighing' && bleReadingHistory.length > 0 && (
                    <p className="text-[11px] font-mono text-zinc-500">
                      Lecturas en vivo:{' '}
                      {bleReadingHistory
                        .slice(-4)
                        .map((kg) => kgToDisplayWeight(kg, weightUnit).toFixed(weightUnit === 'lb' ? 1 : 2))
                        .join(' → ')}{' '}
                      {weightUnit}
                    </p>
                  )}
                </div>

                {bleState === 'weighing' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md mx-auto">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 mb-1">
                        Cintura opcional ({waistUnit})
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder={waistUnit === 'in' ? 'Ej. 32.5' : 'Ej. 82.5'}
                        value={bleWaistText}
                        onChange={(e) => setBleWaistText(e.target.value)}
                        className="w-full min-h-[44px] rounded-xl border border-[#2A2F3D] bg-[#12151C] px-3 text-sm font-mono text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 mb-1">
                        Horario del pesaje
                      </label>
                      <select
                        value={bleTimeSlot}
                        onChange={(e) => setBleTimeSlot(e.target.value as WeighInTimeSlot)}
                        className="w-full min-h-[44px] rounded-xl border border-[#2A2F3D] bg-[#12151C] px-3 text-xs font-bold text-white focus:border-[#D4FF33] focus:outline-none"
                      >
                        <option value="manana">Mañana / Ayunas</option>
                        <option value="tarde">Tarde</option>
                        <option value="noche">Noche</option>
                      </select>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-center gap-3">
                  {bleAutoSavedScanId ? (
                    <>
                      <button
                        type="button"
                        onClick={handleConfirmBluetoothReading}
                        className="min-h-[48px] rounded-2xl bg-emerald-400 px-6 text-sm font-extrabold text-[#0A0B0D]"
                      >
                        Listo · Ver métricas actualizadas
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleStartBluetooth()}
                        className="min-h-[48px] rounded-2xl bg-[#1C2029] border border-[#2F3545] px-4 text-sm font-semibold text-zinc-200 hover:text-white"
                      >
                        Nuevo pesaje BLE
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={!liveReading}
                        onClick={handleConfirmBluetoothReading}
                        className="min-h-[48px] rounded-2xl bg-[#D4FF33] disabled:opacity-40 px-6 text-sm font-extrabold text-[#0A0B0D]"
                      >
                        Fijar y guardar ahora
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          hardware.stopBleScan();
                          bleDisconnectRef.current?.();
                          bleDisconnectRef.current = null;
                          setBleState('idle');
                          setLiveReading(null);
                          setBleReadingHistory([]);
                        }}
                        className="min-h-[48px] rounded-2xl bg-[#1C2029] px-4 text-sm font-semibold text-zinc-300"
                      >
                        Cancelar
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Quick Manual BIA + Waist Form */}
            {showManualForm && (
              <form
                onSubmit={handleManualCalculate}
                className="rounded-2xl border border-[#222631] bg-[#0D0F13] p-4 space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">
                      Peso ({weightUnit})
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      value={manualWeight}
                      onChange={(e) => setManualWeight(e.target.value)}
                      className="w-full min-h-[46px] rounded-xl border border-[#2A2F3D] bg-[#090A0D] px-3 text-sm font-mono text-white focus:border-[#D4FF33] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">
                      Cintura ({waistUnit})
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder={waistUnit === 'in' ? 'Ej. 32.5' : 'Ej. 82.0'}
                      value={manualWaist}
                      onChange={(e) => setManualWaist(e.target.value)}
                      className="w-full min-h-[46px] rounded-xl border border-[#2A2F3D] bg-[#090A0D] px-3 text-sm font-mono text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">
                      % Grasa (opcional)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Auto por perfil"
                      value={manualFatPct}
                      onChange={(e) => setManualFatPct(e.target.value)}
                      className="w-full min-h-[46px] rounded-xl border border-[#2A2F3D] bg-[#090A0D] px-3 text-sm font-mono text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">
                      Horario
                    </label>
                    <select
                      value={manualTimeSlot}
                      onChange={(e) =>
                        setManualTimeSlot(e.target.value as WeighInTimeSlot)
                      }
                      className="w-full min-h-[46px] rounded-xl border border-[#2A2F3D] bg-[#090A0D] px-3 text-xs font-bold text-white focus:border-[#D4FF33] focus:outline-none"
                    >
                      <option value="manana">Mañana / Ayunas</option>
                      <option value="tarde">Tarde</option>
                      <option value="noche">Noche</option>
                    </select>
                  </div>
                </div>

                {manualError && (
                  <p role="alert" className="text-xs font-semibold text-rose-400">
                    {manualError}
                  </p>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="min-h-[46px] rounded-xl bg-[#D4FF33] px-5 text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98]"
                  >
                    Guardar registro y calcular métricas
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* 1B. TENDENCIA DE PESO (7D/30D/90D RECHARTS) E HISTORIAL RECIENTE (ÚLTIMAS 10 PESADAS) */}
          <section className="rounded-3xl border border-[#222631] bg-[#13151A] p-5 space-y-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base sm:text-lg font-extrabold font-display text-white">
                    Tendencia de peso
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Últimos {activeRangeMeta.label} en {weightUnit.toUpperCase()} ({trendRangeData.length}{' '}
                    {trendRangeData.length === 1 ? 'registro' : 'registros'})
                  </p>
                </div>
              </div>

              {/* Selectores tipo píldora (7D | 30D | 90D) y badge de Pérdida/Ganancia Total */}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div
                  role="group"
                  aria-label="Rango de tendencia de peso"
                  className="inline-flex items-center gap-1 rounded-full border border-[#232834] bg-[#0B0D12] p-1"
                >
                  {TREND_RANGES.map((range) => {
                    const isActive = trendRange === range.id;
                    return (
                      <button
                        key={range.id}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => setTrendRange(range.id)}
                        className={`min-h-[32px] rounded-full px-3.5 text-xs font-extrabold transition-colors ${
                          isActive
                            ? 'bg-[#a3e635] text-[#0A0B0D]'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        {range.id}
                      </button>
                    );
                  })}
                </div>

                <div
                  className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-1.5 ${
                    trendNetDeltaDisplay < 0
                      ? 'border-emerald-400/35 bg-emerald-400/12 text-emerald-400'
                      : trendNetDeltaDisplay > 0
                        ? 'border-amber-400/35 bg-amber-400/12 text-amber-300'
                        : 'border-[#282D3B] bg-[#0D0F14] text-zinc-300'
                  }`}
                >
                  <span className="text-[11px] font-semibold opacity-90">
                    Cambio en {activeRangeMeta.label}:
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-extrabold font-mono tabular-nums">
                    {trendNetDeltaDisplay < 0 ? (
                      <TrendingDown className="w-3.5 h-3.5" />
                    ) : trendNetDeltaDisplay > 0 ? (
                      <TrendingUp className="w-3.5 h-3.5" />
                    ) : null}
                    {trendNetDeltaDisplay > 0
                      ? `+${trendNetDeltaDisplay.toFixed(1)}`
                      : trendNetDeltaDisplay < 0
                        ? `-${Math.abs(trendNetDeltaDisplay).toFixed(1)}`
                        : '0.0'}{' '}
                    {weightUnit}
                  </span>
                </div>
              </div>
            </div>

            {trendRangeData.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#272C38] bg-[#0D0F14] px-4 py-5 text-center">
                <p className="text-xs text-zinc-400">
                  Sin registros de peso en los últimos {activeRangeMeta.label}. Sube a la báscula o registra tu peso manualmente para ver la curva.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-[#1E2330] bg-[#0D0F14] pt-3 pb-1 px-2">
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart
                    data={trendRangeData}
                    margin={{ top: 8, right: 12, left: -10, bottom: 2 }}
                  >
                    <CartesianGrid
                      stroke="#1C212E"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      type="number"
                      dataKey="timestamp"
                      domain={['dataMin', 'dataMax']}
                      scale="time"
                      minTickGap={24}
                      tick={{ fill: '#71717A', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(ts: number) => {
                        const dt = new Date(ts);
                        return Number.isNaN(dt.getTime())
                          ? ''
                          : dt
                              .toLocaleDateString('es-MX', {
                                day: 'numeric',
                                month: 'short',
                              })
                              .replace('.', '');
                      }}
                    />
                    <YAxis
                      domain={['dataMin - 1', 'dataMax + 1']}
                      tick={{ fill: '#71717A', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={44}
                      tickFormatter={(v: number) => `${Math.round(v * 10) / 10}`}
                    />
                    <Tooltip
                      content={<Scale30dTooltip weightUnit={weightUnit} />}
                      cursor={{ stroke: '#3F4659', strokeDasharray: '3 3' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="displayWeight"
                      stroke="#a3e635"
                      strokeWidth={2.5}
                      dot={{
                        r: 3.5,
                        fill: '#a3e635',
                        stroke: '#0D0F14',
                        strokeWidth: 1.5,
                      }}
                      activeDot={{
                        r: 5.5,
                        fill: '#D4FF33',
                        stroke: '#0D0F14',
                        strokeWidth: 2,
                      }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Historial Reciente (últimas 10 pesadas) */}
            <div className="space-y-2.5 pt-2 border-t border-white/5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-white">
                  Historial Reciente
                </h4>
                <span className="text-[11px] font-mono text-zinc-400">
                  Últimas {recent10Scans.length} de {sortedScansDesc.length}
                </span>
              </div>

              {recent10Scans.length === 0 ? (
                <p className="text-xs text-zinc-500 py-2">
                  No hay pesadas registradas todavía.
                </p>
              ) : (
                <ul className="divide-y divide-white/5 rounded-2xl border border-[#202531] bg-[#0D0F14] px-3">
                  {recent10Scans.map((scan) => {
                    const timeStr = new Date(scan.recordedAt).toLocaleTimeString(
                      'es-MX',
                      { hour: '2-digit', minute: '2-digit', hour12: false },
                    );
                    const originLabel =
                      scan.source === 'bluetooth'
                        ? 'BLE'
                        : scan.source === 'captura_ia'
                          ? 'IA'
                          : 'Manual';

                    return (
                      <li
                        key={scan.id}
                        className="py-2.5 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex items-center gap-2.5">
                          <span className="text-xs font-mono font-semibold text-zinc-300">
                            {scan.date}
                          </span>
                          <span className="text-xs font-mono text-zinc-500">
                            {timeStr}
                          </span>
                          <span className="text-[10px] font-bold uppercase tracking-wide rounded-md border border-[#272D3B] bg-[#141821] px-1.5 py-0.5 text-zinc-400">
                            {originLabel}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-extrabold font-mono tabular-nums text-white">
                            {formatWeight(scan.weightKg, weightUnit)}
                          </span>
                          {onDeleteScan && (
                            <InlineDeleteConfirmButton
                              onConfirm={() => onDeleteScan(scan.id)}
                              ariaLabel={`Eliminar pesada del ${scan.date} a las ${timeStr}`}
                              title="Eliminar pesada"
                              size="sm"
                            />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* 2. PANEL DE MÉTRICAS CORPORALES CON SEMÁFORO, HISTORIAL Y TARJETA DESCARGABLE */}
          {!latestScan ? (
            <div className="rounded-3xl border border-dashed border-[#2A2F3D] bg-[#12141A] p-8 text-center space-y-2">
              <Scale className="w-8 h-8 text-zinc-500 mx-auto" />
              <p className="text-base font-bold text-white">
                Aún no tienes escaneos corporales
              </p>
              <p className="text-sm text-zinc-400">
                Vincula tu báscula OKOK BLE, sube una captura o usa Captura manual para generar tus métricas con barra semáforo.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-2xl font-extrabold font-display text-white">
                    Panel corporal OKOK
                  </h3>
                  <p className="text-xs text-zinc-400">
                    {new Date(latestScan.recordedAt).toLocaleDateString('es-MX', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    · {getTimeSlotLabel(getScanTimeSlot(latestScan))} ·{' '}
                    {latestScan.source === 'bluetooth'
                      ? 'Bluetooth BLE'
                      : latestScan.source === 'captura_ia'
                        ? 'Captura con IA'
                        : 'Registro manual'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleShareOrDownloadCard}
                    disabled={isGeneratingCard}
                    className="min-h-[46px] inline-flex items-center justify-center gap-2 rounded-2xl bg-[#D4FF33] hover:bg-[#c5f022] px-4 text-xs sm:text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98]"
                  >
                    {isGeneratingCard ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Share2 className="w-4 h-4" />
                    )}
                    Compartir / Descargar Tarjeta
                  </button>

                  <button
                    type="button"
                    onClick={handleInterpretWithAi}
                    disabled={isInterpreting}
                    className="min-h-[46px] inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1C212C] hover:bg-[#252B3A] border border-[#D4FF33]/40 px-4 text-xs sm:text-sm font-bold text-[#D4FF33] active:scale-[0.98]"
                  >
                    {isInterpreting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Analizando...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Análisis IA
                      </>
                    )}
                  </button>
                </div>
              </div>

              {cardFeedback && (
                <div className="rounded-2xl border border-[#D4FF33]/30 bg-[#13171D] p-3 flex flex-wrap items-center justify-between gap-3">
                  <p role="status" className="text-xs font-semibold text-[#D4FF33]">
                    {cardFeedback}
                  </p>
                  {cardPreviewUrl && (
                    <a
                      href={cardPreviewUrl}
                      download={`pulsofit-bascula-${latestScan.date}.png`}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-white hover:text-[#D4FF33]"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Descargar PNG de nuevo
                    </a>
                  )}
                </div>
              )}

              {interpretError && (
                <p role="alert" className="text-xs font-semibold text-rose-400">
                  {interpretError}
                </p>
              )}

              {aiInterpretation && (
                <section className="rounded-3xl border border-[#D4FF33]/40 bg-[#141820] p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-[#D4FF33]" />
                    <h4 className="text-xl font-extrabold font-display text-white">
                      {aiInterpretation.verdict}
                    </h4>
                  </div>
                  <p className="text-sm text-zinc-200 leading-relaxed">
                    {aiInterpretation.summary}
                  </p>
                  {aiInterpretation.recommendations.length > 0 && (
                    <ul className="space-y-1.5 text-xs text-zinc-300 pt-2 border-t border-white/10">
                      {aiInterpretation.recommendations.map((rec, i) => (
                        <li key={i}>· {rec}</li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {/* Primary OKOK Metrics Grid (10 core metrics with traffic-light range bars & guides) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {primaryCards.map(renderMetricCard)}
                {typeof latestScan.waistCm !== 'number' && (
                  <div className="rounded-2xl border border-dashed border-[#2C3240] bg-[#111318] p-4 flex flex-col justify-between gap-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold text-zinc-300">
                        Cintura ({waistUnit})
                      </span>
                      <span className="text-xs font-semibold text-zinc-500">
                        Sin dato
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Agrega tu medida de cintura en el registro manual o al pesar por BLE para activar su barra semáforo de riesgo metabólico.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowManualForm(true)}
                      className="min-h-[40px] rounded-xl border border-[#2C3240] bg-[#181C25] text-xs font-bold text-[#D4FF33] hover:border-[#D4FF33]/50"
                    >
                      Registrar cintura en {waistUnit}
                    </button>
                  </div>
                )}
              </div>

              {/* Complementary Metrics Accordion */}
              {secondaryCards.length > 0 && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setShowSecondaryMetrics((v) => !v)}
                    className="w-full min-h-[46px] rounded-2xl border border-[#252A36] bg-[#12141A] px-4 flex items-center justify-between text-xs font-bold text-zinc-200 hover:border-[#D4FF33]/40"
                  >
                    <span>
                      Métricas detalladas complementarias ({secondaryCards.length} indicadores)
                    </span>
                    {showSecondaryMetrics ? (
                      <ChevronUp className="w-4 h-4 text-[#D4FF33]" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-zinc-400" />
                    )}
                  </button>

                  {showSecondaryMetrics && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {secondaryCards.map(renderMetricCard)}
                    </div>
                  )}
                </div>
              )}

              {/* 3. TABLA DE HISTORIAL DE PESAJES CON FILTROS POR HORARIO Y DIFERENCIA (+/-) */}
              <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-extrabold font-display text-white">
                      Historial de pesajes
                    </h4>
                    <p className="text-xs text-zinc-400">
                      Compara tu evolución por horario y diferencia exacta frente al pesaje anterior
                    </p>
                  </div>

                  {/* Interactive Filter Bar */}
                  <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-[#0B0C0F] border border-[#232834]">
                    {(
                      [
                        { id: 'all', label: 'Todos' },
                        { id: 'manana', label: 'Mañana/Ayunas' },
                        { id: 'tarde', label: 'Tarde' },
                        { id: 'noche', label: 'Noche' },
                      ] as { id: HistoryTimeFilter; label: string }[]
                    ).map((f) => {
                      const active = historyFilter === f.id;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setHistoryFilter(f.id)}
                          className={`min-h-[36px] rounded-lg px-2.5 text-xs font-bold whitespace-nowrap transition-colors ${
                            active
                              ? 'bg-[#D4FF33] text-[#0A0B0D]'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {filteredHistoryScans.length === 0 ? (
                  <p className="text-xs text-zinc-400 py-6 text-center border border-dashed border-[#252A36] rounded-2xl">
                    No hay pesajes registrados en este horario.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-white/10 text-zinc-400">
                          <th className="py-2.5 pr-3 font-semibold">Fecha y horario</th>
                          <th className="py-2.5 px-3 font-semibold">Peso</th>
                          <th className="py-2.5 px-3 font-semibold">Diferencia (+/-)</th>
                          <th className="py-2.5 px-3 font-semibold">Grasa / Músculo</th>
                          <th className="py-2.5 px-3 font-semibold">Cintura</th>
                          <th className="py-2.5 pl-3 text-right font-semibold">Origen</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {filteredHistoryScans.map((scan) => {
                          const diffKg = deltaByScanId.get(scan.id) ?? null;
                          const diffDisplay =
                            diffKg !== null
                              ? (diffKg < 0 ? -1 : 1) *
                                kgToDisplayWeight(Math.abs(diffKg), weightUnit)
                              : null;
                          const slot = getScanTimeSlot(scan);
                          const timeStr = new Date(scan.recordedAt).toLocaleTimeString(
                            'es-MX',
                            { hour: '2-digit', minute: '2-digit' },
                          );

                          return (
                            <tr key={scan.id} className="hover:bg-white/[0.02]">
                              <td className="py-3 pr-3 whitespace-nowrap">
                                <p className="font-mono font-bold text-white">
                                  {scan.date} · {timeStr}
                                </p>
                                <p className="text-[11px] text-zinc-400">
                                  {getTimeSlotLabel(slot)}
                                </p>
                              </td>
                              <td className="py-3 px-3 font-mono font-extrabold tabular-nums text-white whitespace-nowrap">
                                {formatWeight(scan.weightKg, weightUnit)}
                              </td>
                              <td className="py-3 px-3 font-mono font-bold tabular-nums whitespace-nowrap">
                                {diffDisplay === null ? (
                                  <span className="text-zinc-500">Primer dato</span>
                                ) : Math.abs(diffDisplay) < 0.05 ? (
                                  <span className="text-zinc-300">0 {weightUnit}</span>
                                ) : (
                                  <span
                                    className={
                                      diffDisplay < 0
                                        ? 'text-[#D4FF33]'
                                        : 'text-amber-300'
                                    }
                                  >
                                    {diffDisplay > 0 ? `+${diffDisplay}` : diffDisplay}{' '}
                                    {weightUnit}
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-3 font-mono tabular-nums text-zinc-300 whitespace-nowrap">
                                {scan.bodyFatPct.toFixed(1)}% / {scan.totalMusclePct.toFixed(1)}%
                              </td>
                              <td className="py-3 px-3 font-mono tabular-nums text-zinc-300 whitespace-nowrap">
                                {typeof scan.waistCm === 'number'
                                  ? formatWaist(scan.waistCm, waistUnit)
                                  : '—'}
                              </td>
                              <td className="py-3 pl-3 text-right whitespace-nowrap">
                                <div className="inline-flex items-center justify-end gap-2">
                                  <span className="text-[11px] text-zinc-400">
                                    {scan.source === 'bluetooth'
                                      ? 'BLE'
                                      : scan.source === 'captura_ia'
                                        ? 'IA'
                                        : 'Manual'}
                                  </span>
                                  {onDeleteScan && (
                                    <InlineDeleteConfirmButton
                                      onConfirm={() => onDeleteScan(scan.id)}
                                      ariaLabel={`Eliminar pesaje del ${scan.date}`}
                                      title="Eliminar pesaje"
                                      size="sm"
                                    />
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
