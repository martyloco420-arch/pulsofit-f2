import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Dumbbell,
  Flame,
  Ruler,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { EQUIPMENT_OPTIONS } from '../data/exercises';
import { calculateNutritionTargets } from '../data/foods';
import { triggerHaptic } from '../lib/haptics';
import {
  displayWeightToKg,
  formatLiquid,
  getLiquidUnit,
  getWeightUnit,
  kgToDisplayWeight,
} from '../lib/units';
import type {
  EquipmentType,
  Goal,
  UserProfile,
  WeightUnit,
} from '../types/fitness';

export interface QuickOnboardingResult {
  goal: Goal;
  customGoal: string;
  equipment: EquipmentType[];
  preferredRestSec: number;
  autoStartRest: boolean;
  trainingDaysPerWeek: number;
  weightKg: number;
  heightCm: number;
  weightUnit: WeightUnit;
}

interface QuickOnboardingModalProps {
  isOpen: boolean;
  profile: UserProfile;
  activeProfileLabel: string;
  onClose: () => void;
  onComplete: (result: QuickOnboardingResult) => void;
}

const GOAL_CARDS: { id: Goal; title: string; subtitle: string; defaultCustom: string }[] = [
  {
    id: 'perder_grasa',
    title: 'Perder grasa',
    subtitle: 'Déficit calórico sostenible y protección muscular',
    defaultCustom: 'Pérdida de grasa',
  },
  {
    id: 'mantener_peso',
    title: 'Recomposición y salud',
    subtitle: 'Equilibrio calórico, tono muscular y energía estable',
    defaultCustom: 'Recomposición',
  },
  {
    id: 'ganar_musculo',
    title: 'Ganar músculo y fuerza',
    subtitle: 'Superávit controlado e hipertrofia progresiva',
    defaultCustom: 'Fuerza',
  },
];

const CUSTOM_GOAL_CHIPS = [
  'Pérdida de grasa',
  'Recomposición',
  'Fuerza',
  'Resistencia',
  'Salud y Energía',
];

const REST_PRESETS = [60, 90, 120, 150];

export const QuickOnboardingModal: React.FC<QuickOnboardingModalProps> = ({
  isOpen,
  profile,
  activeProfileLabel,
  onClose,
  onComplete,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [goal, setGoal] = useState<Goal>(profile.goal);
  const [customGoal, setCustomGoal] = useState<string>(
    profile.customGoal?.trim() ||
      GOAL_CARDS.find((g) => g.id === profile.goal)?.defaultCustom ||
      'Recomposición',
  );
  const [equipment, setEquipment] = useState<EquipmentType[]>(
    profile.equipment.length > 0 ? profile.equipment : ['gimnasio_completo'],
  );
  const [preferredRestSec, setPreferredRestSec] = useState<number>(
    profile.preferredRestSec ?? 90,
  );
  const [autoStartRest, setAutoStartRest] = useState<boolean>(
    profile.autoStartRest ?? true,
  );
  const [trainingDaysPerWeek, setTrainingDaysPerWeek] = useState<number>(
    profile.trainingDaysPerWeek || 4,
  );
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(
    getWeightUnit(profile.weightUnit),
  );
  const [weightInput, setWeightInput] = useState<string>(
    String(kgToDisplayWeight(profile.weightKg || 75, getWeightUnit(profile.weightUnit))),
  );
  const [heightInput, setHeightInput] = useState<string>(
    String(profile.heightCm || 175),
  );

  // Sync draft when modal re-opens or active profile changes
  useEffect(() => {
    if (!isOpen) return;
    const unit = getWeightUnit(profile.weightUnit);
    setStep(1);
    setGoal(profile.goal);
    setCustomGoal(
      profile.customGoal?.trim() ||
        GOAL_CARDS.find((g) => g.id === profile.goal)?.defaultCustom ||
        'Recomposición',
    );
    setEquipment(
      profile.equipment.length > 0 ? profile.equipment : ['gimnasio_completo'],
    );
    setPreferredRestSec(profile.preferredRestSec ?? 90);
    setAutoStartRest(profile.autoStartRest ?? true);
    setTrainingDaysPerWeek(profile.trainingDaysPerWeek || 4);
    setWeightUnit(unit);
    setWeightInput(String(kgToDisplayWeight(profile.weightKg || 75, unit)));
    setHeightInput(String(profile.heightCm || 175));
  }, [isOpen, profile]);

  const parsedWeightKg = useMemo(() => {
    const raw = parseFloat(weightInput.replace(',', '.').trim());
    if (Number.isNaN(raw) || raw <= 0) return profile.weightKg || 75;
    const kg = displayWeightToKg(raw, weightUnit);
    return Math.round(Math.max(30, Math.min(250, kg)) * 10) / 10;
  }, [weightInput, weightUnit, profile.weightKg]);

  const parsedHeightCm = useMemo(() => {
    const raw = parseInt(heightInput.trim(), 10);
    if (Number.isNaN(raw) || raw <= 0) return profile.heightCm || 175;
    return Math.max(120, Math.min(230, raw));
  }, [heightInput, profile.heightCm]);

  const previewTargets = useMemo(() => {
    const draftProfile: UserProfile = {
      ...profile,
      goal,
      equipment,
      trainingDaysPerWeek,
      weightKg: parsedWeightKg,
      heightCm: parsedHeightCm,
      weightUnit,
    };
    return calculateNutritionTargets(draftProfile);
  }, [
    profile,
    goal,
    equipment,
    trainingDaysPerWeek,
    parsedWeightKg,
    parsedHeightCm,
    weightUnit,
  ]);

  if (!isOpen) return null;

  const liquidUnit = getLiquidUnit(profile.liquidUnit);

  const handleToggleUnit = (nextUnit: WeightUnit) => {
    if (nextUnit === weightUnit) return;
    const converted = kgToDisplayWeight(parsedWeightKg, nextUnit);
    setWeightUnit(nextUnit);
    setWeightInput(String(converted));
  };

  const toggleEquipment = (eqId: EquipmentType) => {
    triggerHaptic('light');
    setEquipment((prev) => {
      if (prev.includes(eqId)) {
        return prev.length > 1 ? prev.filter((item) => item !== eqId) : prev;
      }
      return [...prev, eqId];
    });
  };

  const handleFinish = () => {
    triggerHaptic('success');
    onComplete({
      goal,
      customGoal: customGoal.trim() || GOAL_CARDS.find((g) => g.id === goal)?.defaultCustom || 'Salud y Energía',
      equipment: equipment.length > 0 ? equipment : ['gimnasio_completo'],
      preferredRestSec,
      autoStartRest,
      trainingDaysPerWeek,
      weightKg: parsedWeightKg,
      heightCm: parsedHeightCm,
      weightUnit,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Calibración rápida de PulsoFit"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-[#262B38] bg-[#0F1117] shadow-2xl p-5 sm:p-6 space-y-5">
        {/* Header & Step Progress */}
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-[#D4FF33]">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Calibración 30 seg · {activeProfileLabel}</span>
              </div>
              <h2 className="mt-0.5 text-xl sm:text-2xl font-extrabold font-display text-white">
                {step === 1
                  ? '1. Tu meta principal'
                  : step === 2
                    ? '2. Equipo y descansos'
                    : '3. Peso y estatura'}
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar calibración"
              className="min-h-[38px] min-w-[38px] rounded-xl border border-[#262B38] bg-[#161922] text-zinc-400 hover:text-white flex items-center justify-center shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5" aria-label={`Paso ${step} de 3`}>
            {[1, 2, 3].map((idx) => (
              <div
                key={idx}
                className={`h-1.5 rounded-full transition-colors ${
                  idx <= step ? 'bg-[#D4FF33]' : 'bg-[#1E222E]'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Step 1: Meta principal + objetivo personalizado */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              {GOAL_CARDS.map((card) => {
                const active = goal === card.id;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => {
                      triggerHaptic('light');
                      setGoal(card.id);
                      if (!customGoal.trim() || CUSTOM_GOAL_CHIPS.includes(customGoal.trim())) {
                        setCustomGoal(card.defaultCustom);
                      }
                    }}
                    className={`w-full rounded-2xl border px-4 py-3 text-left flex items-center justify-between gap-3 transition-colors ${
                      active
                        ? 'border-[#D4FF33] bg-[#D4FF33]/12 text-white'
                        : 'border-[#252A36] bg-[#141720] text-zinc-300 hover:border-zinc-600'
                    }`}
                  >
                    <div>
                      <p className="text-sm font-extrabold">{card.title}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">{card.subtitle}</p>
                    </div>
                    {active && <Check className="w-5 h-5 text-[#D4FF33] shrink-0" />}
                  </button>
                );
              })}
            </div>

            <div className="rounded-2xl border border-[#222631] bg-[#12141A] p-3.5 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#D4FF33]">
                <Target className="w-3.5 h-3.5" />
                <span>Enfoque para tu Coach IA</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CUSTOM_GOAL_CHIPS.map((chip) => {
                  const active = customGoal.trim().toLowerCase() === chip.toLowerCase();
                  return (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        triggerHaptic('light');
                        setCustomGoal(chip);
                      }}
                      className={`min-h-[30px] rounded-xl border px-2.5 text-[11px] font-bold transition-colors ${
                        active
                          ? 'border-[#D4FF33] bg-[#D4FF33]/15 text-[#D4FF33]'
                          : 'border-[#262B38] bg-[#0B0D12] text-zinc-300 hover:text-white'
                      }`}
                    >
                      {chip}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                value={customGoal}
                onChange={(e) => setCustomGoal(e.target.value)}
                maxLength={140}
                placeholder="O escribe tu objetivo específico (ej. Correr 10K y bajar 3 kg)"
                className="w-full min-h-[40px] rounded-xl border border-[#262B38] bg-[#0B0C0F] px-3 text-xs text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Step 2: Equipo disponible & Estilo de descansos */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                <Dumbbell className="w-3.5 h-3.5 text-[#D4FF33]" />
                <span>Equipo disponible</span>
              </p>
              <div className="grid grid-cols-1 gap-2">
                {EQUIPMENT_OPTIONS.map((eq) => {
                  const selected = equipment.includes(eq.id);
                  return (
                    <button
                      key={eq.id}
                      type="button"
                      onClick={() => toggleEquipment(eq.id)}
                      className={`w-full rounded-2xl border px-3.5 py-2.5 text-left flex items-center justify-between gap-3 transition-colors ${
                        selected
                          ? 'border-[#D4FF33] bg-[#D4FF33]/12 text-white'
                          : 'border-[#252A36] bg-[#141720] text-zinc-300 hover:border-zinc-600'
                      }`}
                    >
                      <div>
                        <p className="text-xs sm:text-sm font-bold">{eq.label}</p>
                        <p className="text-[11px] text-zinc-400">{eq.subtitle}</p>
                      </div>
                      <div
                        className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                          selected ? 'bg-[#D4FF33] text-[#0A0B0D]' : 'border border-zinc-600'
                        }`}
                      >
                        {selected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-[#222631] bg-[#12141A] p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#D4FF33]" />
                  <span>Descanso entre series</span>
                </span>
                <button
                  type="button"
                  onClick={() => setAutoStartRest((v) => !v)}
                  className={`min-h-[28px] rounded-lg px-2.5 text-[11px] font-extrabold border transition-colors ${
                    autoStartRest
                      ? 'border-[#D4FF33]/60 bg-[#D4FF33]/15 text-[#D4FF33]'
                      : 'border-[#2A2F3D] bg-[#0B0D12] text-zinc-400'
                  }`}
                >
                  {autoStartRest ? 'Auto-inicio: ON' : 'Auto-inicio: OFF'}
                </button>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {REST_PRESETS.map((sec) => {
                  const active = preferredRestSec === sec;
                  return (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => {
                        triggerHaptic('light');
                        setPreferredRestSec(sec);
                      }}
                      className={`min-h-[40px] rounded-xl text-xs font-mono font-extrabold transition-colors ${
                        active
                          ? 'bg-[#D4FF33] text-[#0A0B0D]'
                          : 'border border-[#262B38] bg-[#0B0D12] text-zinc-300 hover:text-white'
                      }`}
                    >
                      {sec}s
                    </button>
                  );
                })}
              </div>

              <div className="pt-1 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-300">Días de entreno / semana</span>
                  <span className="font-mono font-bold text-[#D4FF33]">
                    {trainingDaysPerWeek} días
                  </span>
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {[2, 3, 4, 5, 6, 7].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setTrainingDaysPerWeek(d)}
                      className={`min-h-[36px] rounded-xl text-xs font-mono font-extrabold ${
                        trainingDaysPerWeek === d
                          ? 'bg-[#D4FF33] text-[#0A0B0D]'
                          : 'border border-[#262B38] bg-[#0B0D12] text-zinc-300'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Peso actual y estatura + Vista previa de metas */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                <Ruler className="w-3.5 h-3.5 text-[#D4FF33]" />
                <span>Unidad de peso</span>
              </span>
              <div className="inline-flex rounded-xl border border-[#252A36] bg-[#0B0D12] p-1">
                {(['kg', 'lb'] as WeightUnit[]).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => handleToggleUnit(u)}
                    className={`min-h-[30px] min-w-[44px] rounded-lg text-xs font-extrabold uppercase transition-colors ${
                      weightUnit === u
                        ? 'bg-[#D4FF33] text-[#0A0B0D]'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Peso actual ({weightUnit})
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={weightInput}
                  onChange={(e) => setWeightInput(e.target.value)}
                  className="w-full min-h-[50px] rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] px-4 text-lg font-mono font-extrabold tabular-nums text-white focus:border-[#D4FF33] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Estatura (cm)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={heightInput}
                  onChange={(e) => setHeightInput(e.target.value)}
                  className="w-full min-h-[50px] rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] px-4 text-lg font-mono font-extrabold tabular-nums text-white focus:border-[#D4FF33] focus:outline-none"
                />
              </div>
            </div>

            {/* Calibrated Targets Preview */}
            <div className="rounded-2xl border border-[#D4FF33]/30 bg-[#D4FF33]/8 p-4 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#D4FF33]">
                <Flame className="w-4 h-4" />
                <span>Metas calibradas para tu perfil</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-[#0B0D12]/90 border border-white/10 p-2.5">
                  <p className="text-[10px] text-zinc-400">Calorías / día</p>
                  <p className="text-base font-extrabold font-mono text-white mt-0.5">
                    {previewTargets.calories}
                  </p>
                </div>
                <div className="rounded-xl bg-[#0B0D12]/90 border border-white/10 p-2.5">
                  <p className="text-[10px] text-zinc-400">Proteína</p>
                  <p className="text-base font-extrabold font-mono text-[#D4FF33] mt-0.5">
                    {previewTargets.proteinG} g
                  </p>
                </div>
                <div className="rounded-xl bg-[#0B0D12]/90 border border-white/10 p-2.5">
                  <p className="text-[10px] text-zinc-400">Agua base</p>
                  <p className="text-base font-extrabold font-mono text-sky-300 mt-0.5">
                    {formatLiquid(previewTargets.waterMl, liquidUnit)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer Navigation */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10">
          {step === 1 ? (
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-xl px-3.5 text-xs font-semibold text-zinc-400 hover:text-white"
            >
              Omitir por ahora
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
              className="min-h-[44px] rounded-xl border border-[#262B38] bg-[#141720] px-4 text-xs font-bold text-zinc-200 inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Atrás
            </button>
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={() => {
                triggerHaptic('light');
                setStep((s) => (s === 1 ? 2 : 3));
              }}
              className="min-h-[44px] rounded-2xl bg-[#D4FF33] px-5 text-xs sm:text-sm font-extrabold text-[#0A0B0D] inline-flex items-center gap-1.5 active:scale-[0.98]"
            >
              Siguiente
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              className="min-h-[44px] rounded-2xl bg-[#D4FF33] px-5 text-xs sm:text-sm font-extrabold text-[#0A0B0D] inline-flex items-center gap-1.5 active:scale-[0.98]"
            >
              <Check className="w-4 h-4 stroke-[2.5]" />
              Guardar calibración
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
