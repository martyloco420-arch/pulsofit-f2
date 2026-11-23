import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bluetooth,
  BluetoothSearching,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Flame,
  HeartPulse,
  Loader2,
  Plus,
  Radio,
  Scale,
  ShieldCheck,
  Square,
} from 'lucide-react';
import { useHardwareManager } from '../hooks/useHardwareManager';
import {
  OKOK_REFERENCE_MAC,
  connectBluetoothScale,
  isWebBluetoothSupported,
  scanOkokAdvertisements,
  type BleReading,
} from '../lib/bluetoothScale';
import {
  build19MetricCards,
  computeBodyCompositionScan,
  getDefaultTimeSlot,
} from '../lib/bodyComposition';
import {
  cmToDisplayWaist,
  displayWeightToKg,
  getWaistUnit,
  getWeightUnit,
  kgToDisplayWeight,
} from '../lib/units';
import type {
  BloodPressureRecord,
  BodyCompositionScan,
  BodyWeightEntry,
  DailyReadinessEntry,
  PulseHrvRecord,
  UserProfile,
  WeightUnit,
} from '../types/fitness';
import { HeartRateStressModule } from './HeartRateStressModule';
import { HrvRhrTrend30dCard } from './HrvRhrTrend30dCard';

interface SaludTabProps {
  profileId?: string;
  profile: UserProfile;
  bodyScans: BodyCompositionScan[];
  bodyWeights: BodyWeightEntry[];
  pulseRecords: PulseHrvRecord[];
  bloodPressureRecords: BloodPressureRecord[];
  todayReadiness: DailyReadinessEntry | null;
  recoveryIndex0To100: number;
  isHydrated?: boolean;
  onUpdateProfile: (profile: UserProfile) => void;
  onSaveScan?: (scan: BodyCompositionScan) => void;
  onOpenScale: () => void;
  onSavePulseRecord: (record: PulseHrvRecord) => void;
  onDeletePulseRecord: (id: string) => void;
  onSaveBloodPressureRecord: (record: BloodPressureRecord) => void;
  onDeleteBloodPressureRecord: (id: string) => void;
}

type BleLivePhase = 'idle' | 'searching' | 'waiting_step' | 'weighing' | 'stabilized';

function formatMetricDisplay(
  value: number,
  unit: string,
  weightUnit: WeightUnit,
  waistUnit: 'cm' | 'in',
): { val: string; unit: string } {
  if (unit === 'kg') {
    return {
      val: kgToDisplayWeight(value, weightUnit).toFixed(1),
      unit: weightUnit,
    };
  }
  if (unit === 'cm') {
    return {
      val: cmToDisplayWaist(value, waistUnit).toFixed(1),
      unit: waistUnit,
    };
  }
  return {
    val: Number.isInteger(value) ? String(value) : value.toFixed(1),
    unit,
  };
}

function getLocalCalendarDate(): string {
  return new Date().toLocaleDateString('en-CA');
}

function playScaleLockBeep(): void {
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
    gain.gain.setValueAtTime(0.14, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.42);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.42);
  } catch {
    // Ignore browser audio restrictions
  }
}

export const SaludTab: React.FC<SaludTabProps> = ({
  profileId,
  profile,
  bodyScans,
  bodyWeights,
  pulseRecords,
  bloodPressureRecords,
  todayReadiness,
  recoveryIndex0To100,
  isHydrated = true,
  onUpdateProfile,
  onSaveScan,
  onOpenScale,
  onSavePulseRecord,
  onDeletePulseRecord,
  onSaveBloodPressureRecord,
  onDeleteBloodPressureRecord,
}) => {
  const hardware = useHardwareManager();
  const [showAll19Metrics, setShowAll19Metrics] = useState(false);

  // Passive & Fallback BLE Scale Live State
  const [blePhase, setBlePhase] = useState<BleLivePhase>('idle');
  const [bleStatusText, setBleStatusText] = useState<string>('');
  const [bleMode, setBleMode] = useState<'passive_scan' | 'request_device'>('passive_scan');
  const [bleCompatibilityNotice, setBleCompatibilityNotice] = useState<string | null>(null);
  const [liveReading, setLiveReading] = useState<BleReading | null>(null);
  const [liveSamplesKg, setLiveSamplesKg] = useState<number[]>([]);
  const [detectedDeviceLabel, setDetectedDeviceLabel] = useState<string | null>(null);
  const [savedConfirmedMsg, setSavedConfirmedMsg] = useState<string | null>(null);

  // Inline Quick Manual Weight Capture Fallback
  const [showQuickManualForm, setShowQuickManualForm] = useState(false);
  const [quickManualWeightText, setQuickManualWeightText] = useState('');
  const [quickManualError, setQuickManualError] = useState<string | null>(null);

  const stableSamplesRef = useRef<number[]>([]);
  const autoSavedLockRef = useRef(false);
  const scanRegisteredInHwRef = useRef(false);
  const isHydratedRef = useRef(isHydrated);
  isHydratedRef.current = isHydrated;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const onSaveScanRef = useRef(onSaveScan);
  onSaveScanRef.current = onSaveScan;

  const weightUnit = getWeightUnit(profile.weightUnit);
  const waistUnit = getWaistUnit(profile);
  const traditionalBleSupported = isWebBluetoothSupported();

  const sortedScansDesc = useMemo(
    () => [...bodyScans].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
    [bodyScans],
  );
  const latestScan = sortedScansDesc[0] ?? null;
  const previousScan = sortedScansDesc[1] ?? null;

  const latestWeightKg = useMemo(() => {
    if (latestScan) return latestScan.weightKg;
    const sortedWeights = [...bodyWeights].sort((a, b) => b.date.localeCompare(a.date));
    return sortedWeights[0]?.weightKg ?? profile.weightKg;
  }, [latestScan, bodyWeights, profile.weightKg]);

  useEffect(() => {
    if (!showQuickManualForm) {
      setQuickManualWeightText(
        String(kgToDisplayWeight(latestWeightKg, weightUnit)),
      );
    }
  }, [latestWeightKg, weightUnit, showQuickManualForm]);

  // If HardwareManager externally stops the BLE scan (tab switch / app minimized), reset active scan UI
  useEffect(() => {
    if (
      scanRegisteredInHwRef.current &&
      !hardware.bleScanActive &&
      (blePhase === 'searching' || blePhase === 'waiting_step' || blePhase === 'weighing')
    ) {
      scanRegisteredInHwRef.current = false;
      setBlePhase('idle');
      setBleStatusText('');
    }
  }, [hardware.bleScanActive, blePhase]);

  // Stop active BLE scan & PPG camera cleanly if SaludTab unmounts
  useEffect(() => {
    return () => {
      if (scanRegisteredInHwRef.current) {
        scanRegisteredInHwRef.current = false;
        hardware.stopBleScan();
      }
      hardware.releaseMediaStream('ppg_camera');
    };
  }, [hardware]);

  const metricCards = useMemo(() => {
    if (!latestScan) return [];
    return build19MetricCards(latestScan, sortedScansDesc, profile);
  }, [latestScan, sortedScansDesc, profile]);

  const visibleCards = showAll19Metrics ? metricCards : metricCards.slice(0, 6);

  const handleToggleWeightUnit = (unit: WeightUnit) => {
    if (unit === weightUnit) return;
    onUpdateProfile({
      ...profile,
      weightUnit: unit,
    });
  };

  const handleStopBleScan = () => {
    scanRegisteredInHwRef.current = false;
    hardware.stopBleScan();
    setBlePhase('idle');
    setBleStatusText('');
  };

  const persistStabilizedReadingKg = (reading: BleReading, reasonText: string) => {
    if (autoSavedLockRef.current) return;
    autoSavedLockRef.current = true;

    scanRegisteredInHwRef.current = false;
    hardware.stopBleScan();

    const safeWeightKg = Math.round(reading.weightKg * 100) / 100;
    const localDate = getLocalCalendarDate();

    setLiveReading({ ...reading, weightKg: safeWeightKg });
    setBlePhase('stabilized');
    setBleStatusText(reasonText);

    if (!isHydratedRef.current) {
      setSavedConfirmedMsg(
        'Esperando hidratación de IndexedDB antes de guardar el registro...',
      );
      return;
    }

    if (onSaveScanRef.current) {
      const scan = computeBodyCompositionScan(
        {
          weightKg: safeWeightKg,
          timeSlot: getDefaultTimeSlot(),
          impedanceOhm: reading.impedanceOhm,
          source: 'bluetooth',
          date: localDate,
        },
        profileRef.current,
      );
      onSaveScanRef.current(scan);
      setSavedConfirmedMsg(
        `Peso guardado en historial (${safeWeightKg.toFixed(2)} kg · ${localDate}) sin sobrescribir registros previos.`,
      );
      playScaleLockBeep();
    }
  };

  const handleIncomingBleReading = (reading: BleReading, label?: string) => {
    if (autoSavedLockRef.current) return;
    if (label) {
      setDetectedDeviceLabel(label);
    }
    setBlePhase('weighing');
    setLiveReading(reading);

    const roundedCentigrams = Math.round(reading.weightKg * 100);
    const samples = stableSamplesRef.current;
    samples.push(roundedCentigrams);
    if (samples.length > 6) samples.shift();
    setLiveSamplesKg(samples.map((cg) => cg / 100));

    const recent3 = samples.slice(-3);
    const threeIdentical =
      recent3.length >= 3 &&
      recent3[0] === recent3[1] &&
      recent3[1] === recent3[2];

    if (reading.isStabilizedFlag) {
      persistStabilizedReadingKg(
        reading,
        'Peso estabilizado en vivo (bandera final de báscula)',
      );
      return;
    }

    if (threeIdentical) {
      persistStabilizedReadingKg(
        reading,
        'Peso estabilizado en vivo (3 lecturas idénticas)',
      );
      return;
    }

    setBleStatusText('Pesando en vivo... mantente quieto sobre la báscula');
  };

  // Primary "Báscula BLE" button: executes unpaired passive advertisement scan (navigator.bluetooth.requestLEScan)
  const handleStartPassiveBleScan = async () => {
    setBleCompatibilityNotice(null);
    setSavedConfirmedMsg(null);
    setLiveReading(null);
    setLiveSamplesKg([]);
    setDetectedDeviceLabel(null);
    stableSamplesRef.current = [];
    autoSavedLockRef.current = false;

    const bluetoothApi =
      typeof navigator !== 'undefined'
        ? (navigator as unknown as {
            bluetooth?: { requestLEScan?: unknown };
          }).bluetooth
        : undefined;

    if (typeof bluetoothApi?.requestLEScan !== 'function') {
      setBlePhase('idle');
      setBleCompatibilityNotice(
        'Este navegador no tiene activo el escaneo BLE pasivo sin emparejar (navigator.bluetooth.requestLEScan). En Android Chrome abre chrome://flags/#enable-experimental-web-platform-features, actívalo y reinicia Chrome. También puedes usar el emparejamiento tradicional (requestDevice) o captura manual.',
      );
      return;
    }

    setBleMode('passive_scan');
    setBlePhase('searching');
    setBleStatusText('Buscando báscula...');

    try {
      const conn = await scanOkokAdvertisements(
        (reading, devLabel) => {
          handleIncomingBleReading(reading, devLabel);
        },
        (status) => {
          setBleStatusText(status);
          if (status.toLowerCase().includes('súbete')) {
            setBlePhase('waiting_step');
          }
        },
      );

      scanRegisteredInHwRef.current = true;
      hardware.registerBleScan(conn.disconnect);
      setDetectedDeviceLabel(`OKOK BLE (${OKOK_REFERENCE_MAC})`);
      setBlePhase('waiting_step');
      setBleStatusText('Súbete a la báscula...');
    } catch (err) {
      scanRegisteredInHwRef.current = false;
      hardware.stopBleScan();
      setBlePhase('idle');
      setBleStatusText('');
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'El navegador o el usuario bloqueó el escaneo BLE sin emparejar. Activa chrome://flags/#enable-experimental-web-platform-features en Android Chrome o usa requestDevice / captura manual.';
      setBleCompatibilityNotice(msg);
    }
  };

  // Fallback 1: Traditional paired GATT connection via navigator.bluetooth.requestDevice
  const handleStartTraditionalRequestDevice = async () => {
    setBleCompatibilityNotice(null);
    setSavedConfirmedMsg(null);
    setLiveReading(null);
    setLiveSamplesKg([]);
    setDetectedDeviceLabel(null);
    stableSamplesRef.current = [];
    autoSavedLockRef.current = false;

    if (!traditionalBleSupported) {
      setShowQuickManualForm(true);
      setBleCompatibilityNotice(
        'Web Bluetooth (requestDevice) no está disponible en este dispositivo/navegador. Usa Captura manual aquí abajo o abre el modal completo para importar captura IA.',
      );
      return;
    }

    setBleMode('request_device');
    setBlePhase('searching');
    setBleStatusText('Buscando báscula...');

    try {
      const conn = await connectBluetoothScale(
        true,
        (reading) => {
          handleIncomingBleReading(reading);
        },
        (status) => {
          setBleStatusText(status);
          if (status.toLowerCase().includes('súbete')) {
            setBlePhase('waiting_step');
          }
        },
      );

      scanRegisteredInHwRef.current = true;
      hardware.registerBleScan(conn.disconnect);
      setDetectedDeviceLabel(conn.deviceName);
      setBlePhase('waiting_step');
      setBleStatusText('Súbete a la báscula...');
    } catch (err) {
      scanRegisteredInHwRef.current = false;
      hardware.stopBleScan();
      setBlePhase('idle');
      setBleStatusText('');
      setBleCompatibilityNotice(
        err instanceof Error
          ? err.message
          : 'No se pudo conectar por emparejamiento tradicional (requestDevice). Usa Captura manual.',
      );
    }
  };

  const handleSaveQuickManualWeight = (e: React.FormEvent) => {
    e.preventDefault();
    setQuickManualError(null);

    if (!isHydrated) {
      setQuickManualError(
        'Espera un momento a que cargue IndexedDB antes de guardar.',
      );
      return;
    }

    const raw = parseFloat(quickManualWeightText.replace(',', '.').trim());
    const minW = weightUnit === 'lb' ? 55 : 25;
    const maxW = weightUnit === 'lb' ? 620 : 280;
    if (Number.isNaN(raw) || raw < minW || raw > maxW) {
      setQuickManualError(`Ingresa un peso válido entre ${minW} y ${maxW} ${weightUnit}.`);
      return;
    }

    const weightKg = Math.round(displayWeightToKg(raw, weightUnit) * 100) / 100;
    const localDate = getLocalCalendarDate();

    if (onSaveScan) {
      const scan = computeBodyCompositionScan(
        {
          weightKg,
          timeSlot: getDefaultTimeSlot(),
          source: 'manual',
          date: localDate,
        },
        profile,
      );
      onSaveScan(scan);
      setShowQuickManualForm(false);
      setBleCompatibilityNotice(null);
      setSavedConfirmedMsg(
        `Pesaje manual guardado (${weightKg.toFixed(1)} kg · ${localDate}).`,
      );
      playScaleLockBeep();
    }
  };

  const handleGuardedSavePulseRecord = (record: PulseHrvRecord) => {
    if (!isHydratedRef.current) return;
    onSavePulseRecord(record);
  };

  const handleGuardedSaveBloodPressureRecord = (record: BloodPressureRecord) => {
    if (!isHydratedRef.current) return;
    onSaveBloodPressureRecord(record);
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Header Salud */}
      <header className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-rose-400 text-xs font-bold">
              <HeartPulse className="w-4 h-4" />
              <span>Biometría y Composición Corporal</span>
            </div>
            <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold font-display text-white">
              Salud
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">
              Frecuencia cardíaca PPG, nivel de estrés, presión arterial y análisis corporal de tu báscula Bluetooth.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Global KG | LB Switch */}
            <div className="inline-flex rounded-xl border border-[#272C3A] bg-[#0B0D12] p-0.5">
              {(['kg', 'lb'] as WeightUnit[]).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => handleToggleWeightUnit(u)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold uppercase transition-colors ${
                    weightUnit === u
                      ? 'bg-[#D4FF33] text-[#0A0B0D]'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>

            <div className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/12 px-3 py-1.5 text-xs font-extrabold text-emerald-300 font-mono">
              <ShieldCheck className="w-4 h-4" />
              Recup. {recoveryIndex0To100}/100
            </div>

            {blePhase === 'searching' ||
            blePhase === 'waiting_step' ||
            blePhase === 'weighing' ? (
              <button
                type="button"
                onClick={handleStopBleScan}
                className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-rose-400/50 bg-rose-500/20 hover:bg-rose-500/30 px-3.5 text-xs font-extrabold text-rose-200"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                Detener escaneo
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleStartPassiveBleScan()}
                className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-[#D4FF33] hover:bg-[#c5f022] px-3.5 text-xs font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform"
              >
                <Bluetooth className="w-3.5 h-3.5" />
                Báscula BLE
              </button>
            )}
          </div>
        </div>

        {/* Live BLE Passive Scan Panel */}
        {blePhase !== 'idle' && (
          <div
            role="status"
            aria-live="polite"
            className={`rounded-2xl border p-4 space-y-3 ${
              blePhase === 'stabilized'
                ? 'border-emerald-400/55 bg-emerald-950/20'
                : 'border-[#D4FF33]/50 bg-[#0B0D12]'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                className={`flex items-center gap-2 text-xs font-extrabold ${
                  blePhase === 'stabilized' ? 'text-emerald-300' : 'text-[#D4FF33]'
                }`}
              >
                {blePhase === 'searching' ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                ) : blePhase === 'stabilized' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <BluetoothSearching className="w-4 h-4 animate-pulse shrink-0" />
                )}
                <span>
                  {bleStatusText ||
                    (blePhase === 'searching'
                      ? 'Buscando báscula...'
                      : blePhase === 'waiting_step'
                        ? 'Súbete a la báscula...'
                        : 'Pesando en vivo...')}
                </span>
              </div>

              <span className="text-[10px] font-mono text-zinc-400">
                {bleMode === 'passive_scan'
                  ? `Escaneo pasivo OKOK (${OKOK_REFERENCE_MAC})`
                  : detectedDeviceLabel || 'BLE GATT'}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-4xl font-extrabold font-mono tabular-nums text-white">
                  {liveReading
                    ? kgToDisplayWeight(liveReading.weightKg, weightUnit).toFixed(
                        weightUnit === 'lb' ? 1 : 2,
                      )
                    : weightUnit === 'lb'
                      ? '0.0'
                      : '0.00'}{' '}
                  <span className="text-lg font-normal text-zinc-400">
                    {weightUnit}
                  </span>
                </p>
                {liveReading && weightUnit === 'lb' && (
                  <p className="text-[11px] font-mono text-zinc-400 mt-0.5">
                    Almacenado interno: {liveReading.weightKg.toFixed(2)} kg
                  </p>
                )}
                {liveSamplesKg.length > 0 && blePhase === 'weighing' && (
                  <p className="text-[11px] font-mono text-zinc-500 mt-0.5">
                    Muestras:{' '}
                    {liveSamplesKg
                      .slice(-4)
                      .map((kg) =>
                        kgToDisplayWeight(kg, weightUnit).toFixed(
                          weightUnit === 'lb' ? 1 : 2,
                        ),
                      )
                      .join(' → ')}{' '}
                    {weightUnit}
                  </p>
                )}
                {savedConfirmedMsg && blePhase === 'stabilized' && (
                  <p className="text-xs font-semibold text-emerald-300 mt-1">
                    {savedConfirmedMsg}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {blePhase === 'weighing' && liveReading && (
                  <button
                    type="button"
                    onClick={() =>
                      persistStabilizedReadingKg(
                        liveReading,
                        'Peso estabilizado manualmente y guardado en vivo',
                      )
                    }
                    className="min-h-[40px] rounded-xl bg-[#D4FF33] px-3.5 text-xs font-extrabold text-[#0A0B0D]"
                  >
                    Fijar peso ahora
                  </button>
                )}

                {blePhase !== 'stabilized' ? (
                  <button
                    type="button"
                    onClick={handleStopBleScan}
                    className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-rose-400/40 bg-rose-500/15 px-3.5 text-xs font-bold text-rose-200 hover:bg-rose-500/25"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    Detener
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleStartPassiveBleScan()}
                      className="min-h-[40px] rounded-xl bg-[#D4FF33] px-3.5 text-xs font-extrabold text-[#0A0B0D]"
                    >
                      Pesar de nuevo
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBlePhase('idle');
                        setLiveReading(null);
                        setSavedConfirmedMsg(null);
                      }}
                      className="min-h-[40px] rounded-xl border border-[#2B3140] bg-[#141720] px-3.5 text-xs font-bold text-zinc-300"
                    >
                      Cerrar
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Saved Toast when quick manual capture succeeds while BLE panel is idle */}
        {blePhase === 'idle' && savedConfirmedMsg && (
          <div className="rounded-2xl border border-emerald-400/40 bg-emerald-950/20 px-4 py-2.5 flex items-center justify-between gap-2 text-xs font-semibold text-emerald-300">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {savedConfirmedMsg}
            </span>
            <button
              type="button"
              onClick={() => setSavedConfirmedMsg(null)}
              className="text-zinc-400 hover:text-white font-bold"
            >
              OK
            </button>
          </div>
        )}

        {/* Compatibility Shielding Notice */}
        {bleCompatibilityNotice && (
          <div
            role="alert"
            className="rounded-2xl border border-amber-400/45 bg-amber-950/20 p-4 space-y-3"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs text-amber-100 leading-relaxed">
                <p className="font-extrabold text-amber-300">
                  Escaneo BLE pasivo no disponible o bloqueado
                </p>
                <p>{bleCompatibilityNotice}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleStartTraditionalRequestDevice()}
                className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-[#D4FF33] px-3.5 text-xs font-extrabold text-[#0A0B0D]"
              >
                <Radio className="w-3.5 h-3.5" />
                Emparejar tradicional (requestDevice)
              </button>
              <button
                type="button"
                onClick={() => setShowQuickManualForm((v) => !v)}
                className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-[#2F3545] bg-[#141720] px-3.5 text-xs font-bold text-zinc-100 hover:border-[#D4FF33]/50"
              >
                <Plus className="w-3.5 h-3.5 text-[#D4FF33]" />
                Captura manual
              </button>
              <button
                type="button"
                onClick={onOpenScale}
                className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-[#2F3545] bg-[#0D0F14] px-3 text-xs font-semibold text-zinc-300 hover:text-white"
              >
                Abrir modal completo
              </button>
            </div>
          </div>
        )}

        {/* Inline Quick Manual Weight Capture Fallback */}
        {showQuickManualForm && (
          <form
            onSubmit={handleSaveQuickManualWeight}
            className="rounded-2xl border border-[#282D3B] bg-[#0B0D12] p-3.5 flex flex-wrap items-end gap-3"
          >
            <div className="flex-1 min-w-[160px]">
              <label
                htmlFor="salud-quick-weight"
                className="block text-[11px] font-bold text-zinc-300 mb-1"
              >
                Registro manual rápido ({weightUnit}) · fecha local {getLocalCalendarDate()}
              </label>
              <input
                id="salud-quick-weight"
                type="text"
                inputMode="decimal"
                value={quickManualWeightText}
                onChange={(e) => setQuickManualWeightText(e.target.value)}
                placeholder={weightUnit === 'lb' ? 'Ej. 165.0' : 'Ej. 75.2'}
                className="w-full min-h-[42px] rounded-xl border border-[#2A2F3D] bg-[#12151C] px-3 text-sm font-mono text-white focus:border-[#D4FF33] focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="min-h-[42px] rounded-xl bg-[#D4FF33] px-4 text-xs font-extrabold text-[#0A0B0D]"
              >
                Guardar peso
              </button>
              <button
                type="button"
                onClick={() => setShowQuickManualForm(false)}
                className="min-h-[42px] rounded-xl border border-[#2A2F3D] bg-[#141720] px-3 text-xs font-bold text-zinc-300"
              >
                Cancelar
              </button>
            </div>

            {quickManualError && (
              <p role="alert" className="w-full text-xs font-semibold text-rose-400">
                {quickManualError}
              </p>
            )}
          </form>
        )}
      </header>

      {/* Isolated Heart Rate (BPM), HRV & Stress Module */}
      <HeartRateStressModule
        pulseRecords={pulseRecords}
        bloodPressureRecords={bloodPressureRecords}
        todayReadiness={todayReadiness}
        isHydrated={isHydrated}
        onSavePulseRecord={handleGuardedSavePulseRecord}
        onDeletePulseRecord={onDeletePulseRecord}
        onSaveBloodPressureRecord={handleGuardedSaveBloodPressureRecord}
        onDeleteBloodPressureRecord={onDeleteBloodPressureRecord}
      />

      {/* 30-Day HRV & Resting Heart Rate Trend */}
      <HrvRhrTrend30dCard pulseRecords={pulseRecords} profileId={profileId} />

      {/* Body Composition Panel (OKOK / Chipsea Smart Scale Breakdown) */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-[#D4FF33]/12 border border-[#D4FF33]/30 flex items-center justify-center text-[#D4FF33]">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">
                Composición Corporal (Báscula Bluetooth)
              </h2>
              <p className="text-xs text-zinc-400">
                {latestScan
                  ? `Último escaneo: ${latestScan.date} (${latestScan.source === 'bluetooth' ? 'BLE OKOK/Chipsea' : latestScan.source === 'captura_ia' ? 'Captura IA' : 'Manual'})`
                  : `Peso base registrado: ${kgToDisplayWeight(latestWeightKg, weightUnit).toFixed(1)} ${weightUnit}`}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenScale}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[#2B3140] bg-[#0D0F14] hover:border-[#D4FF33]/50 px-3.5 text-xs font-bold text-zinc-200"
          >
            <Scale className="w-3.5 h-3.5 text-[#D4FF33]" />
            Historial / Captura IA / Manual
          </button>
        </div>

        {latestScan ? (
          <>
            {/* Top 5 Key Composition Pillars */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div className="rounded-2xl border border-[#242834] bg-[#0D0F14] p-3">
                <p className="text-[11px] text-zinc-400">Peso actual</p>
                <p className="mt-1 text-lg font-extrabold font-mono tabular-nums text-white">
                  {kgToDisplayWeight(latestScan.weightKg, weightUnit).toFixed(1)}{' '}
                  <span className="text-xs font-normal text-zinc-400">{weightUnit}</span>
                </p>
                {previousScan && (
                  <p className="text-[10px] font-mono text-zinc-400 mt-0.5">
                    Δ {latestScan.weightKg - previousScan.weightKg > 0 ? '+' : ''}
                    {kgToDisplayWeight(
                      latestScan.weightKg - previousScan.weightKg,
                      weightUnit,
                    ).toFixed(1)}{' '}
                    {weightUnit}
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-[#242834] bg-[#0D0F14] p-3">
                <p className="text-[11px] text-zinc-400">Grasa corporal</p>
                <p className="mt-1 text-lg font-extrabold font-mono tabular-nums text-amber-300">
                  {latestScan.bodyFatPct.toFixed(1)}%
                </p>
                <p className="text-[10px] font-mono text-zinc-400 mt-0.5">
                  {kgToDisplayWeight(latestScan.bodyFatMassKg, weightUnit).toFixed(1)} {weightUnit}
                </p>
              </div>

              <div className="rounded-2xl border border-[#242834] bg-[#0D0F14] p-3">
                <p className="text-[11px] text-zinc-400">Masa muscular</p>
                <p className="mt-1 text-lg font-extrabold font-mono tabular-nums text-[#D4FF33]">
                  {latestScan.totalMusclePct.toFixed(1)}%
                </p>
                <p className="text-[10px] font-mono text-zinc-400 mt-0.5">
                  {kgToDisplayWeight(latestScan.totalMuscleMassKg, weightUnit).toFixed(1)} {weightUnit}
                </p>
              </div>

              <div className="rounded-2xl border border-[#242834] bg-[#0D0F14] p-3">
                <p className="text-[11px] text-zinc-400">Agua corporal</p>
                <p className="mt-1 text-lg font-extrabold font-mono tabular-nums text-sky-300">
                  {latestScan.bodyWaterPct.toFixed(1)}%
                </p>
                <p className="text-[10px] font-mono text-zinc-400 mt-0.5">
                  {kgToDisplayWeight(latestScan.bodyWaterMassKg, weightUnit).toFixed(1)} {weightUnit}
                </p>
              </div>

              <div className="col-span-2 sm:col-span-1 rounded-2xl border border-[#242834] bg-[#0D0F14] p-3">
                <p className="text-[11px] text-zinc-400">IMC / Basal</p>
                <p className="mt-1 text-lg font-extrabold font-mono tabular-nums text-emerald-300">
                  {latestScan.bmi.toFixed(1)}{' '}
                  <span className="text-[11px] font-bold text-zinc-400">IMC</span>
                </p>
                <p className="text-[10px] font-mono text-zinc-400 mt-0.5 flex items-center gap-1">
                  <Flame className="w-3 h-3 text-amber-400" />
                  {latestScan.bmrKcal} kcal/día
                </p>
              </div>
            </div>

            {/* Detailed Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {visibleCards.map((card) => {
                const formatted = formatMetricDisplay(
                  card.value,
                  card.unit,
                  weightUnit,
                  waistUnit,
                );
                const statusBadge =
                  card.status === 'Saludable' || card.status === 'Perfecto'
                    ? 'border-emerald-400/35 bg-emerald-400/12 text-emerald-300'
                    : card.status === 'Bajo'
                      ? 'border-sky-400/35 bg-sky-400/12 text-sky-300'
                      : card.status === 'Alto'
                        ? 'border-amber-400/35 bg-amber-400/12 text-amber-300'
                        : 'border-rose-400/35 bg-rose-500/15 text-rose-300';

                return (
                  <div
                    key={String(card.key)}
                    className="rounded-2xl border border-[#222733] bg-[#0D0F14] p-3.5 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-zinc-200">{card.label}</p>
                        <p className="mt-0.5 text-lg font-extrabold font-mono tabular-nums text-white">
                          {formatted.val}{' '}
                          <span className="text-xs font-normal text-zinc-400">
                            {formatted.unit}
                          </span>
                        </p>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${statusBadge}`}
                      >
                        {card.status}
                      </span>
                    </div>

                    {/* Traffic Light Range Bar */}
                    <div className="relative h-2 w-full rounded-full overflow-hidden flex bg-[#171B24]">
                      {card.rangeBar.segments.map((seg) => (
                        <div
                          key={seg.label}
                          className={`${seg.colorClass} opacity-75`}
                          style={{ width: `${seg.widthPct}%` }}
                        />
                      ))}
                      <span
                        className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white border-2 border-[#0A0B0D] shadow"
                        style={{ left: `calc(${card.rangeBar.markerPct}% - 5px)` }}
                      />
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-snug">{card.guide}</p>
                  </div>
                );
              })}
            </div>

            {metricCards.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAll19Metrics((v) => !v)}
                className="w-full min-h-[42px] rounded-2xl border border-[#262B38] bg-[#0D0F14] hover:border-[#D4FF33]/40 text-xs font-bold text-zinc-200 flex items-center justify-center gap-1.5"
              >
                {showAll19Metrics ? (
                  <>
                    <ChevronUp className="w-4 h-4 text-[#D4FF33]" />
                    Ocultar métricas detalladas
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4 text-[#D4FF33]" />
                    Ver desglose completo ({metricCards.length} métricas BIA)
                  </>
                )}
              </button>
            )}
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-[#272C38] bg-[#0D0F14] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-bold text-white">
                Sin escaneos de composición corporal todavía
              </p>
              <p className="text-xs text-zinc-400">
                Conecta tu báscula OKOK / Chipsea por Bluetooth o registra tu primer pesaje para calcular % grasa, músculo, agua, IMC y TMB.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleStartPassiveBleScan()}
              className="min-h-[44px] shrink-0 rounded-2xl bg-[#D4FF33] px-4 text-xs font-extrabold text-[#0A0B0D]"
            >
              Conectar báscula
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
