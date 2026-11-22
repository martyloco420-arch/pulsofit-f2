import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ImagePlus,
  Loader2,
  Mic,
  MicOff,
  Plus,
  Sparkles,
  Trash2,
  Utensils,
  X,
} from 'lucide-react';
import {
  scanPlatePhotoAi,
  type DailyNutritionContextForAi,
  type MealAnalysisScope,
  type SuggestedComplementFood,
} from '../lib/aiClient';
import type { FoodEntry, MealType } from '../types/fitness';

interface PlateScannerModalProps {
  isOpen: boolean;
  initialMealType: MealType;
  selectedDate: string;
  dailyContext: DailyNutritionContextForAi;
  onClose: () => void;
  onSaveEntries: (entries: Omit<FoodEntry, 'id' | 'createdAt'>[]) => void;
}

interface EditableScannedItem {
  id: string;
  name: string;
  grams: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  mealSlot: MealType;
  // Base ratios so adjusting grams scales macros proportionally
  baseGrams: number;
  baseCalories: number;
  baseProteinG: number;
  baseCarbsG: number;
  baseFatG: number;
}

interface SpeechRecognitionInstanceLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const MEAL_SCOPE_OPTIONS: { id: MealAnalysisScope; label: string }[] = [
  { id: 'desayuno', label: 'Desayuno' },
  { id: 'almuerzo', label: 'Comida' },
  { id: 'cena', label: 'Cena' },
  { id: 'snack', label: 'Snack' },
  { id: 'dia_completo', label: 'Día completo' },
];

const MEAL_SLOT_LABELS: Record<MealType, string> = {
  desayuno: 'Desayuno',
  almuerzo: 'Comida',
  cena: 'Cena',
  snack: 'Snack',
};

async function compressImageToJpegBase64(file: File): Promise<{
  previewUrl: string;
  base64: string;
  mimeType: string;
}> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'));
    reader.readAsDataURL(file);
  });

  // Compress captured phone photos to max 800px width and 0.75 JPEG quality for fast upload and storage
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Formato de imagen no compatible.'));
    image.src = dataUrl;
  });

  const maxWidth = 800;
  const scale = img.width > maxWidth ? maxWidth / img.width : 1;
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const commaIdx = dataUrl.indexOf(',');
    return {
      previewUrl: dataUrl,
      base64: commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl,
      mimeType: file.type || 'image/jpeg',
    };
  }

  ctx.drawImage(img, 0, 0, width, height);
  const jpegUrl = canvas.toDataURL('image/jpeg', 0.75);
  const commaIdx = jpegUrl.indexOf(',');
  return {
    previewUrl: jpegUrl,
    base64: commaIdx >= 0 ? jpegUrl.slice(commaIdx + 1) : jpegUrl,
    mimeType: 'image/jpeg',
  };
}

export const PlateScannerModal: React.FC<PlateScannerModalProps> = ({
  isOpen,
  initialMealType,
  selectedDate,
  dailyContext,
  onClose,
  onSaveEntries,
}) => {
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null);

  const [mealScope, setMealScope] = useState<MealAnalysisScope>(initialMealType);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [imageBase64, setImageBase64] = useState<string>('');
  const [imageMimeType, setImageMimeType] = useState<string>('image/jpeg');
  const [contextText, setContextText] = useState<string>('');

  // Voice dictation state
  const [isListeningVoice, setIsListeningVoice] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [dishSummary, setDishSummary] = useState<string>('');
  const [nutritionistFeedback, setNutritionistFeedback] = useState<string>('');
  const [editableItems, setEditableItems] = useState<EditableScannedItem[]>([]);
  const [suggestedAdditions, setSuggestedAdditions] = useState<SuggestedComplementFood[]>([]);

  // Extra manual ingredient state
  const [showAddExtra, setShowAddExtra] = useState(false);
  const [extraName, setExtraName] = useState('');
  const [extraGrams, setExtraGrams] = useState('50');
  const [extraCalories, setExtraCalories] = useState('');
  const [extraProtein, setExtraProtein] = useState('');
  const [extraCarbs, setExtraCarbs] = useState('');
  const [extraFat, setExtraFat] = useState('');

  useEffect(() => {
    if (isOpen) {
      setMealScope(initialMealType);
    } else {
      try {
        recognitionRef.current?.stop();
      } catch {
        // Ignore stop errors
      }
      setIsListeningVoice(false);
    }
  }, [isOpen, initialMealType]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // Ignore cleanup errors
      }
    };
  }, []);

  const totals = useMemo(
    () =>
      editableItems.reduce(
        (acc, item) => ({
          grams: acc.grams + item.grams,
          calories: acc.calories + item.calories,
          proteinG: acc.proteinG + item.proteinG,
          carbsG: acc.carbsG + item.carbsG,
          fatG: acc.fatG + item.fatG,
        }),
        { grams: 0, calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      ),
    [editableItems],
  );

  const remainingAfterMeal = useMemo(() => {
    const remCal = Math.round(
      dailyContext.calorieTarget - (dailyContext.consumedCalories + totals.calories),
    );
    const remProt = Math.round(
      dailyContext.proteinTargetG - (dailyContext.consumedProteinG + totals.proteinG),
    );
    return {
      calories: remCal,
      proteinG: remProt,
    };
  }, [dailyContext, totals.calories, totals.proteinG]);

  const handleToggleVoiceDictation = () => {
    setVoiceError(null);
    if (isListeningVoice) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // Ignore
      }
      setIsListeningVoice(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstanceLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstanceLike;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      setVoiceError(
        'Tu navegador no permite dictado por voz directo. Puedes escribir o usar el micrófono del teclado.',
      );
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = 'es-MX';
      rec.interimResults = false;
      rec.continuous = false;

      rec.onresult = (event) => {
        const chunks: string[] = [];
        for (let i = 0; i < event.results.length; i += 1) {
          const piece = event.results[i]?.[0]?.transcript?.trim();
          if (piece) chunks.push(piece);
        }
        const spoken = chunks.join(' ').trim();
        if (spoken) {
          setContextText((prev) => (prev.trim() ? `${prev.trim()}, ${spoken}` : spoken));
        }
      };

      rec.onerror = (ev) => {
        if (ev.error === 'not-allowed') {
          setVoiceError('Permiso de micrófono denegado. Actívalo en tu navegador.');
        } else if (ev.error !== 'aborted') {
          setVoiceError('No se pudo captar la voz con claridad. Intenta de nuevo.');
        }
        setIsListeningVoice(false);
      };

      rec.onend = () => {
        setIsListeningVoice(false);
      };

      recognitionRef.current = rec;
      rec.start();
      setIsListeningVoice(true);
    } catch {
      setVoiceError('No se pudo iniciar el micrófono.');
      setIsListeningVoice(false);
    }
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanError(null);
    try {
      const processed = await compressImageToJpegBase64(file);
      setPreviewUrl(processed.previewUrl);
      setImageBase64(processed.base64);
      setImageMimeType(processed.mimeType);
      setEditableItems([]);
      setDishSummary('');
      setNutritionistFeedback('');
      setSuggestedAdditions([]);
    } catch (err) {
      setScanError(
        err instanceof Error ? err.message : 'No se pudo cargar la fotografía.',
      );
    } finally {
      e.target.value = '';
    }
  };

  const handleAnalyzeFood = async () => {
    if (!imageBase64 && !contextText.trim()) return;
    setIsAnalyzing(true);
    setScanError(null);
    try {
      const result = await scanPlatePhotoAi(
        imageBase64,
        imageMimeType,
        contextText.trim(),
        {
          mealScope,
          dailyContext,
        },
      );
      setDishSummary(result.dishSummary || 'Comida analizada');
      setNutritionistFeedback(result.nutritionistFeedback || '');
      setSuggestedAdditions(
        Array.isArray(result.suggestedAdditions) ? result.suggestedAdditions : [],
      );
      const fallbackSlot: MealType =
        mealScope === 'dia_completo' ? 'almuerzo' : mealScope;

      setEditableItems(
        result.items.map((item, idx) => {
          const grams = Math.max(1, Math.round(item.grams));
          const calories = Math.max(0, Math.round(item.calories));
          const proteinG = Math.max(0, Math.round(item.proteinG * 10) / 10);
          const carbsG = Math.max(0, Math.round(item.carbsG * 10) / 10);
          const fatG = Math.max(0, Math.round(item.fatG * 10) / 10);
          const resolvedSlot: MealType =
            mealScope === 'dia_completo' && item.mealSlot
              ? item.mealSlot
              : fallbackSlot;
          return {
            id: `scan_item_${Date.now()}_${idx}`,
            name: item.name,
            grams,
            calories,
            proteinG,
            carbsG,
            fatG,
            mealSlot: resolvedSlot,
            baseGrams: grams,
            baseCalories: calories,
            baseProteinG: proteinG,
            baseCarbsG: carbsG,
            baseFatG: fatG,
          };
        }),
      );
    } catch (err) {
      setScanError(
        err instanceof Error
          ? err.message
          : 'Error al analizar la comida con Nutriólogo IA.',
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGramsChange = (id: string, nextGramsRaw: string) => {
    const parsed = Math.max(0, Number(nextGramsRaw) || 0);
    setEditableItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const factor = item.baseGrams > 0 ? parsed / item.baseGrams : 1;
        return {
          ...item,
          grams: parsed,
          calories: Math.round(item.baseCalories * factor),
          proteinG: Math.round(item.baseProteinG * factor * 10) / 10,
          carbsG: Math.round(item.baseCarbsG * factor * 10) / 10,
          fatG: Math.round(item.baseFatG * factor * 10) / 10,
        };
      }),
    );
  };

  const handleFieldChange = (
    id: string,
    field: 'name' | 'calories' | 'proteinG' | 'carbsG' | 'fatG' | 'mealSlot',
    rawValue: string,
  ) => {
    setEditableItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        if (field === 'name') {
          return { ...item, name: rawValue };
        }
        if (field === 'mealSlot') {
          return { ...item, mealSlot: rawValue as MealType };
        }
        const num = Math.max(0, Number(rawValue) || 0);
        return {
          ...item,
          [field]: field === 'calories' ? Math.round(num) : Math.round(num * 10) / 10,
        };
      }),
    );
  };

  const handleRemoveItem = (id: string) => {
    setEditableItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleAddSuggestedFood = (suggestion: SuggestedComplementFood) => {
    const defaultSlot: MealType =
      mealScope === 'dia_completo' ? 'snack' : mealScope;
    setEditableItems((prev) => [
      ...prev,
      {
        id: `sug_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        name: `${suggestion.name} (${suggestion.portion})`,
        grams: 100,
        calories: Math.max(0, Math.round(suggestion.calories)),
        proteinG: Math.max(0, Math.round(suggestion.proteinG * 10) / 10),
        carbsG: Math.max(0, Math.round(suggestion.carbsG * 10) / 10),
        fatG: Math.max(0, Math.round(suggestion.fatG * 10) / 10),
        mealSlot: defaultSlot,
        baseGrams: 100,
        baseCalories: Math.max(0, Math.round(suggestion.calories)),
        baseProteinG: Math.max(0, Math.round(suggestion.proteinG * 10) / 10),
        baseCarbsG: Math.max(0, Math.round(suggestion.carbsG * 10) / 10),
        baseFatG: Math.max(0, Math.round(suggestion.fatG * 10) / 10),
      },
    ]);
  };

  const handleAddManualExtra = (e: React.FormEvent) => {
    e.preventDefault();
    if (!extraName.trim()) return;
    const grams = Math.max(1, Math.round(Number(extraGrams) || 50));
    const proteinG = Math.max(0, Math.round((Number(extraProtein) || 0) * 10) / 10);
    const carbsG = Math.max(0, Math.round((Number(extraCarbs) || 0) * 10) / 10);
    const fatG = Math.max(0, Math.round((Number(extraFat) || 0) * 10) / 10);
    const calRaw = Math.max(0, Math.round(Number(extraCalories) || 0));
    const calories = calRaw || Math.round(proteinG * 4 + carbsG * 4 + fatG * 9);
    const defaultSlot: MealType =
      mealScope === 'dia_completo' ? 'almuerzo' : mealScope;

    setEditableItems((prev) => [
      ...prev,
      {
        id: `extra_${Date.now()}`,
        name: extraName.trim(),
        grams,
        calories,
        proteinG,
        carbsG,
        fatG,
        mealSlot: defaultSlot,
        baseGrams: grams,
        baseCalories: calories,
        baseProteinG: proteinG,
        baseCarbsG: carbsG,
        baseFatG: fatG,
      },
    ]);

    setExtraName('');
    setExtraGrams('50');
    setExtraCalories('');
    setExtraProtein('');
    setExtraCarbs('');
    setExtraFat('');
    setShowAddExtra(false);
  };

  const handleSaveAllToLog = () => {
    if (editableItems.length === 0) return;
    const entries: Omit<FoodEntry, 'id' | 'createdAt'>[] = editableItems.map((item) => ({
      date: selectedDate,
      mealType: mealScope === 'dia_completo' ? item.mealSlot : mealScope,
      name: item.grams > 0 && !item.name.includes('(') ? `${item.name} (${item.grams}g)` : item.name,
      calories: Math.max(0, Math.round(item.calories)),
      proteinG: Math.max(0, Math.round(item.proteinG)),
      carbsG: Math.max(0, Math.round(item.carbsG)),
      fatG: Math.max(0, Math.round(item.fatG)),
    }));
    onSaveEntries(entries);
    setPreviewUrl('');
    setImageBase64('');
    setContextText('');
    setDishSummary('');
    setNutritionistFeedback('');
    setEditableItems([]);
    setSuggestedAdditions([]);
    onClose();
  };

  if (!isOpen) return null;

  const canAnalyze = Boolean(imageBase64 || contextText.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-t-3xl sm:rounded-3xl border border-[#262B36] bg-[#12141A] max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="w-10 h-1.5 bg-zinc-700 rounded-full mx-auto mt-3 sm:hidden shrink-0" />

        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div>
            <h2 className="text-xl font-bold font-display text-white flex items-center gap-2">
              <Camera className="w-5 h-5 text-[#D4FF33]" />
              Nutriólogo IA con Cámara y Voz
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Toma foto, sube de galería o dicta por voz para calcular macros y completar tu meta
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar Nutriólogo IA"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Meal Scope Selector (Desayuno, Comida, Cena, Snack, Día completo) */}
          <div>
            <span className="block text-xs font-semibold text-zinc-300 mb-2">
              Tiempo de comida a analizar
            </span>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 p-1 rounded-2xl bg-[#0B0C0F]">
              {MEAL_SCOPE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMealScope(opt.id)}
                  className={`min-h-[42px] px-2 rounded-xl text-xs font-bold transition-colors ${
                    mealScope === opt.id
                      ? 'bg-[#D4FF33] text-[#0A0B0D]'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Camera & Gallery Capture */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="min-h-[54px] flex items-center justify-center gap-2.5 rounded-2xl bg-[#D4FF33] px-4 text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform"
            >
              <Camera className="w-5 h-5" />
              Tomar foto con cámara
            </button>

            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              className="min-h-[54px] flex items-center justify-center gap-2.5 rounded-2xl border border-[#2D3342] bg-[#181B23] hover:bg-[#20242F] px-4 text-sm font-bold text-white active:scale-[0.98] transition-transform"
            >
              <ImagePlus className="w-5 h-5 text-[#D4FF33]" />
              Subir de galería
            </button>

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFilePicked}
              className="hidden"
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              onChange={handleFilePicked}
              className="hidden"
            />
          </div>

          {/* Photo Preview + Voice / Text Description + Analyze Action */}
          <div className="space-y-3 rounded-2xl border border-[#222631] bg-[#0D0F13] p-4">
            {previewUrl && (
              <div className="relative rounded-2xl overflow-hidden bg-black max-h-60 flex items-center justify-center">
                <img
                  src={previewUrl}
                  alt="Vista previa de la comida a analizar"
                  className="max-h-60 w-auto object-contain"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPreviewUrl('');
                    setImageBase64('');
                  }}
                  aria-label="Quitar foto"
                  className="absolute top-2 right-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl bg-black/75 text-zinc-200 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="plate-context-input"
                  className="block text-xs font-semibold text-zinc-300"
                >
                  {previewUrl
                    ? 'Detalles extra opcionales (voz o texto)'
                    : 'O describe tu comida por voz o texto'}
                </label>
                <button
                  type="button"
                  onClick={handleToggleVoiceDictation}
                  className={`min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors ${
                    isListeningVoice
                      ? 'border-rose-400 bg-rose-500/20 text-rose-200 animate-pulse'
                      : 'border-[#2D3342] bg-[#161922] text-[#D4FF33] hover:border-[#D4FF33]'
                  }`}
                >
                  {isListeningVoice ? (
                    <>
                      <MicOff className="w-3.5 h-3.5" />
                      Detener voz
                    </>
                  ) : (
                    <>
                      <Mic className="w-3.5 h-3.5" />
                      Dictar por voz
                    </>
                  )}
                </button>
              </div>

              <textarea
                id="plate-context-input"
                rows={2}
                value={contextText}
                onChange={(e) => setContextText(e.target.value)}
                placeholder={
                  previewUrl
                    ? 'Ej. cocinado con aceite de oliva, 2 tortillas de maíz y vaso de leche'
                    : 'Ej. 3 huevos revueltos con jamón, 2 tortillas de maíz, medio aguacate y café sin azúcar'
                }
                className="w-full rounded-xl border border-[#2A2F3D] bg-[#12141A] p-3 text-sm text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
              />

              {voiceError && (
                <p className="text-xs text-amber-300">{voiceError}</p>
              )}
            </div>

            <button
              type="button"
              onClick={handleAnalyzeFood}
              disabled={isAnalyzing || !canAnalyze}
              className="w-full min-h-[52px] flex items-center justify-center gap-2 rounded-2xl bg-[#D4FF33] disabled:opacity-50 text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98]"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analizando con Nutriólogo IA...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {editableItems.length > 0
                    ? 'Volver a analizar comida'
                    : 'Analizar comida con Gemini IA'}
                </>
              )}
            </button>
          </div>

          {scanError && (
            <p role="alert" className="text-sm font-semibold text-rose-400">
              {scanError}
            </p>
          )}

          {/* Editable Results + Nutritionist Feedback + Remaining Daily Goal Suggestions */}
          {editableItems.length > 0 && (
            <div className="space-y-4 pt-2 border-t border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-[#D4FF33]">
                    Resultado estimado · {dishSummary}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Ajusta gramos o macros si hace falta antes de guardar en tu día
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddExtra((v) => !v)}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[#D4FF33]/40 bg-[#181C26] px-3 text-xs font-bold text-[#D4FF33]"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Agregar extra
                </button>
              </div>

              {/* Nutritionist IA Feedback */}
              {nutritionistFeedback && (
                <div className="rounded-2xl border border-[#D4FF33]/30 bg-[#D4FF33]/10 px-4 py-3 text-xs text-zinc-100 leading-relaxed">
                  <span className="font-extrabold text-[#D4FF33] block mb-0.5">
                    Evaluación del Nutriólogo IA
                  </span>
                  {nutritionistFeedback}
                </div>
              )}

              {/* Totals Summary */}
              <div className="grid grid-cols-4 gap-2 rounded-2xl border border-[#222631] bg-[#0B0C0F] p-3 text-center">
                <div>
                  <span className="text-[11px] text-zinc-400 block">Calorías</span>
                  <span className="text-base font-extrabold font-mono text-[#D4FF33]">
                    {Math.round(totals.calories)}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-zinc-400 block">Proteína</span>
                  <span className="text-base font-extrabold font-mono text-white">
                    {Math.round(totals.proteinG)}g
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-zinc-400 block">Carbs</span>
                  <span className="text-base font-extrabold font-mono text-sky-300">
                    {Math.round(totals.carbsG)}g
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-zinc-400 block">Grasas</span>
                  <span className="text-base font-extrabold font-mono text-amber-300">
                    {Math.round(totals.fatG)}g
                  </span>
                </div>
              </div>

              {/* Optional Manual Extra Ingredient Form */}
              {showAddExtra && (
                <form
                  onSubmit={handleAddManualExtra}
                  className="rounded-2xl border border-[#D4FF33]/40 bg-[#0D0F13] p-4 space-y-3"
                >
                  <p className="text-xs font-bold text-white">
                    Agregar ingrediente extra manual
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      required
                      value={extraName}
                      onChange={(e) => setExtraName(e.target.value)}
                      placeholder="Ej. Queso panela"
                      className="col-span-2 min-h-[42px] rounded-xl border border-[#2A2F3D] bg-[#12141A] px-3 text-xs text-white focus:border-[#D4FF33] focus:outline-none"
                    />
                    <input
                      type="number"
                      min={1}
                      value={extraGrams}
                      onChange={(e) => setExtraGrams(e.target.value)}
                      placeholder="Gramos"
                      className="min-h-[42px] rounded-xl border border-[#2A2F3D] bg-[#12141A] px-3 text-xs font-mono text-white focus:border-[#D4FF33] focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <input
                      type="number"
                      min={0}
                      value={extraCalories}
                      onChange={(e) => setExtraCalories(e.target.value)}
                      placeholder="kcal"
                      className="min-h-[40px] rounded-xl border border-[#2A2F3D] bg-[#12141A] px-2.5 text-xs font-mono text-white focus:border-[#D4FF33] focus:outline-none"
                    />
                    <input
                      type="number"
                      min={0}
                      value={extraProtein}
                      onChange={(e) => setExtraProtein(e.target.value)}
                      placeholder="P (g)"
                      className="min-h-[40px] rounded-xl border border-[#2A2F3D] bg-[#12141A] px-2.5 text-xs font-mono text-white focus:border-[#D4FF33] focus:outline-none"
                    />
                    <input
                      type="number"
                      min={0}
                      value={extraCarbs}
                      onChange={(e) => setExtraCarbs(e.target.value)}
                      placeholder="C (g)"
                      className="min-h-[40px] rounded-xl border border-[#2A2F3D] bg-[#12141A] px-2.5 text-xs font-mono text-white focus:border-[#D4FF33] focus:outline-none"
                    />
                    <input
                      type="number"
                      min={0}
                      value={extraFat}
                      onChange={(e) => setExtraFat(e.target.value)}
                      placeholder="G (g)"
                      className="min-h-[40px] rounded-xl border border-[#2A2F3D] bg-[#12141A] px-2.5 text-xs font-mono text-white focus:border-[#D4FF33] focus:outline-none"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddExtra(false)}
                      className="min-h-[38px] rounded-xl bg-[#1A1E27] px-3 text-xs font-semibold text-zinc-300"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="min-h-[38px] rounded-xl bg-[#D4FF33] px-4 text-xs font-extrabold text-[#0A0B0D]"
                    >
                      Añadir
                    </button>
                  </div>
                </form>
              )}

              {/* Editable Ingredient List */}
              <div className="space-y-3">
                {editableItems.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-[#222631] bg-[#0D0F13] p-3.5 space-y-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={item.name}
                        onChange={(e) =>
                          handleFieldChange(item.id, 'name', e.target.value)
                        }
                        aria-label="Nombre del alimento"
                        className="flex-1 min-h-[40px] rounded-xl border border-[#262B37] bg-[#12141A] px-3 text-sm font-bold text-white focus:border-[#D4FF33] focus:outline-none"
                      />
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={item.grams}
                          onChange={(e) => handleGramsChange(item.id, e.target.value)}
                          aria-label={`Gramos de ${item.name}`}
                          className="w-20 min-h-[40px] rounded-xl border border-[#D4FF33]/40 bg-[#12141A] px-2.5 text-right text-sm font-mono font-bold text-[#D4FF33] focus:border-[#D4FF33] focus:outline-none"
                        />
                        <span className="text-xs font-mono text-zinc-400">g</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                        aria-label={`Eliminar ${item.name}`}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {mealScope === 'dia_completo' && (
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-zinc-400">Tiempo sugerido:</span>
                        <div className="flex items-center gap-1">
                          {(['desayuno', 'almuerzo', 'cena', 'snack'] as MealType[]).map((slot) => (
                            <button
                              key={slot}
                              type="button"
                              onClick={() => handleFieldChange(item.id, 'mealSlot', slot)}
                              className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-bold ${
                                item.mealSlot === slot
                                  ? 'bg-[#D4FF33] text-[#0A0B0D]'
                                  : 'bg-[#171A23] text-zinc-400'
                              }`}
                            >
                              {MEAL_SLOT_LABELS[slot]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-0.5">
                          kcal
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={item.calories}
                          onChange={(e) =>
                            handleFieldChange(item.id, 'calories', e.target.value)
                          }
                          className="w-full min-h-[36px] rounded-lg border border-[#232834] bg-[#12141A] px-2 text-xs font-mono text-white focus:border-[#D4FF33] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-0.5">
                          Prot (g)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.5"
                          value={item.proteinG}
                          onChange={(e) =>
                            handleFieldChange(item.id, 'proteinG', e.target.value)
                          }
                          className="w-full min-h-[36px] rounded-lg border border-[#232834] bg-[#12141A] px-2 text-xs font-mono text-white focus:border-[#D4FF33] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-0.5">
                          Carbs (g)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.5"
                          value={item.carbsG}
                          onChange={(e) =>
                            handleFieldChange(item.id, 'carbsG', e.target.value)
                          }
                          className="w-full min-h-[36px] rounded-lg border border-[#232834] bg-[#12141A] px-2 text-xs font-mono text-white focus:border-[#D4FF33] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-0.5">
                          Grasa (g)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.5"
                          value={item.fatG}
                          onChange={(e) =>
                            handleFieldChange(item.id, 'fatG', e.target.value)
                          }
                          className="w-full min-h-[36px] rounded-lg border border-[#232834] bg-[#12141A] px-2 text-xs font-mono text-white focus:border-[#D4FF33] focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Remaining Goal + AI Food Suggestions to Complete Protein & Calories */}
              <div className="rounded-2xl border border-[#252A36] bg-[#0B0C0F] p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-extrabold text-white flex items-center gap-1.5">
                      <Utensils className="w-3.5 h-3.5 text-[#D4FF33]" />
                      ¿Qué te falta para tu meta diaria?
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {remainingAfterMeal.proteinG <= 0 && remainingAfterMeal.calories <= 0
                        ? '¡Con esta comida alcanzas tu meta diaria de proteína y calorías!'
                        : `Al guardar esto te faltarán ${Math.max(0, remainingAfterMeal.proteinG)} g de proteína y ${Math.max(0, remainingAfterMeal.calories)} kcal hoy.`}
                    </p>
                  </div>
                </div>

                {suggestedAdditions.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-[#D4FF33]">
                      Sugerencias para completar tu día:
                    </p>
                    {suggestedAdditions.map((sug, idx) => (
                      <div
                        key={`${sug.name}_${idx}`}
                        className="rounded-xl border border-[#222631] bg-[#12141A] p-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-white truncate">
                            {sug.name}{' '}
                            <span className="text-zinc-400 font-normal">({sug.portion})</span>
                          </p>
                          <p className="text-[11px] font-mono tabular-nums text-[#D4FF33] mt-0.5">
                            +{sug.calories} kcal · P {sug.proteinG}g · C {sug.carbsG}g · G {sug.fatG}g
                          </p>
                          <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                            {sug.reason}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAddSuggestedFood(sug)}
                          className="min-h-[38px] shrink-0 rounded-xl border border-[#D4FF33]/40 bg-[#181C25] hover:bg-[#D4FF33] hover:text-[#0A0B0D] px-3 text-xs font-extrabold text-[#D4FF33] transition-colors"
                        >
                          + Sumar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer 1-Tap Save CTA */}
        {editableItems.length > 0 && (
          <div className="p-4 border-t border-white/10 bg-[#0E1014] shrink-0">
            <button
              type="button"
              onClick={handleSaveAllToLog}
              className="w-full min-h-[54px] flex items-center justify-center gap-2 rounded-2xl bg-[#D4FF33] px-5 text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform"
            >
              <Check className="w-5 h-5 stroke-[2.5]" />
              Guardar en mi registro del día ({Math.round(totals.calories)} kcal · {Math.round(totals.proteinG)}g P)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
