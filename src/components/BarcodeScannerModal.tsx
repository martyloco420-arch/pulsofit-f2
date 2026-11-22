import React, { useEffect, useRef, useState } from 'react';
import { Barcode, Camera, Check, Loader2, Search, X } from 'lucide-react';
import { lookupFoodBarcode, type BarcodeProductLookup } from '../lib/aiClient';
import { useHardwareManager } from '../hooks/useHardwareManager';
import type { FavoriteMeal, FoodEntry, MealType } from '../types/fitness';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  selectedDate: string;
  initialMealType: MealType;
  onClose: () => void;
  onAddFood: (entry: Omit<FoodEntry, 'id' | 'createdAt'>) => void;
  onSaveFavorite?: (fav: Omit<FavoriteMeal, 'id' | 'createdAt'>) => void;
}

const MEAL_OPTIONS: { id: MealType; label: string }[] = [
  { id: 'desayuno', label: 'Desayuno' },
  { id: 'almuerzo', label: 'Almuerzo' },
  { id: 'cena', label: 'Cena' },
  { id: 'snack', label: 'Snack' },
];

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  selectedDate,
  initialMealType,
  onClose,
  onAddFood,
  onSaveFavorite,
}) => {
  const [mealType, setMealType] = useState<MealType>(initialMealType);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<BarcodeProductLookup | null>(null);
  const [gramsText, setGramsText] = useState('100');
  const [saveAsFavorite, setSaveAsFavorite] = useState(false);

  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const hardware = useHardwareManager();
  const hardwareRef = useRef(hardware);
  hardwareRef.current = hardware;

  const hasNativeDetector =
    typeof window !== 'undefined' && 'BarcodeDetector' in window;

  useEffect(() => {
    setMealType(initialMealType);
  }, [initialMealType, isOpen]);

  const stopCamera = () => {
    hardwareRef.current.releaseMediaStream('barcode_camera');
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setError(null);
      setProduct(null);
    }
    return () => stopCamera();
  }, [isOpen]);

  const handleLookupCode = async (code: string) => {
    setError(null);
    setIsLookingUp(true);
    setProduct(null);
    try {
      const found = await lookupFoodBarcode(code);
      setProduct(found);
      setGramsText(String(found.defaultGrams || 100));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se encontró el código en OpenFoodFacts.',
      );
    } finally {
      setIsLookingUp(false);
    }
  };

  const startCameraScan = async () => {
    setError(null);
    if (!hasNativeDetector || !navigator.mediaDevices?.getUserMedia) {
      setError(
        'Tu navegador no soporta escaneo automático en cámara. Escribe el código EAN/UPC abajo.',
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });
      streamRef.current = stream;
      hardwareRef.current.registerMediaStream('barcode_camera', stream);
      setCameraActive(true);
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 60);

      const Detector = (
        window as unknown as {
          BarcodeDetector: new (opts: { formats: string[] }) => {
            detect: (
              src: HTMLVideoElement,
            ) => Promise<{ rawValue?: string }[]>;
          };
        }
      ).BarcodeDetector;
      const detector = new Detector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
      });

      const scanLoop = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const results = await detector.detect(videoRef.current);
          const raw = results[0]?.rawValue;
          if (raw) {
            stopCamera();
            setBarcodeInput(raw);
            void handleLookupCode(raw);
            return;
          }
        } catch {
          // Ignore single frame errors
        }
        if (streamRef.current) {
          window.setTimeout(() => void scanLoop(), 350);
        }
      };
      void scanLoop();
    } catch {
      stopCamera();
      setError('No se pudo abrir la cámara. Verifica permisos o ingresa el código a mano.');
    }
  };

  if (!isOpen) return null;

  const gramsNum = Math.max(1, Number(gramsText.replace(',', '.')) || 100);
  const factor = gramsNum / 100;
  const scaled = product
    ? {
        calories: Math.round(product.per100g.calories * factor),
        proteinG: Math.round(product.per100g.proteinG * factor * 10) / 10,
        carbsG: Math.round(product.per100g.carbsG * factor * 10) / 10,
        fatG: Math.round(product.per100g.fatG * factor * 10) / 10,
      }
    : null;

  const handleConfirm = () => {
    if (!product || !scaled) return;
    const finalName = `${product.name} (${gramsNum}g)`;
    onAddFood({
      date: selectedDate,
      mealType,
      name: finalName,
      calories: scaled.calories,
      proteinG: Math.round(scaled.proteinG),
      carbsG: Math.round(scaled.carbsG),
      fatG: Math.round(scaled.fatG),
    });
    if (saveAsFavorite && onSaveFavorite) {
      onSaveFavorite({
        name: finalName,
        defaultMealType: mealType,
        calories: scaled.calories,
        proteinG: Math.round(scaled.proteinG),
        carbsG: Math.round(scaled.carbsG),
        fatG: Math.round(scaled.fatG),
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl border border-[#262B36] bg-[#13151A] max-h-[90dvh] flex flex-col">
        <div className="w-10 h-1.5 bg-zinc-700 rounded-full mx-auto mt-3 sm:hidden" />
        <div className="p-5 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Barcode className="w-5 h-5 text-[#D4FF33]" />
            <h3 className="text-xl font-bold font-display text-white">
              Escáner de código de barras
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar escáner de código"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-4 gap-1.5">
            {MEAL_OPTIONS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMealType(m.id)}
                className={`min-h-[40px] rounded-xl text-xs font-bold ${
                  mealType === m.id
                    ? 'bg-[#D4FF33] text-[#0A0B0D]'
                    : 'bg-[#1A1D26] text-zinc-300'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {cameraActive ? (
            <div className="relative rounded-2xl overflow-hidden border border-[#D4FF33]/50 bg-black">
              <video ref={videoRef} playsInline muted className="w-full h-52 object-cover" />
              <button
                type="button"
                onClick={stopCamera}
                className="absolute bottom-3 right-3 min-h-[38px] rounded-xl bg-black/80 px-3 text-xs font-bold text-white"
              >
                Detener cámara
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startCameraScan}
              className="w-full min-h-[50px] flex items-center justify-center gap-2 rounded-2xl border border-[#D4FF33]/40 bg-[#181C24] text-sm font-bold text-[#D4FF33] hover:bg-[#202634]"
            >
              <Camera className="w-5 h-5" />
              Escanear con cámara {hasNativeDetector ? '(EAN / UPC)' : '(Modo manual disponible)'}
            </button>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleLookupCode(barcodeInput);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              inputMode="numeric"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              placeholder="Ej. 7501055300075 (código EAN/UPC)"
              className="flex-1 min-h-[48px] rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] px-4 text-sm font-mono text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
            />
            <button
              type="submit"
              disabled={isLookingUp || barcodeInput.trim().length < 4}
              className="min-h-[48px] px-4 rounded-2xl bg-[#D4FF33] disabled:opacity-50 text-sm font-extrabold text-[#0A0B0D] flex items-center gap-1.5"
            >
              {isLookingUp ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Buscar
            </button>
          </form>

          {error && (
            <p role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-200">
              {error}
            </p>
          )}

          {product && scaled && (
            <div className="rounded-2xl border border-[#D4FF33]/40 bg-[#0E1014] p-4 space-y-4">
              <div>
                <p className="text-xs font-bold text-[#D4FF33]">OpenFoodFacts · {product.barcode}</p>
                <h4 className="text-lg font-extrabold text-white mt-0.5">{product.name}</h4>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Por 100g: {product.per100g.calories} kcal · P {product.per100g.proteinG}g · C{' '}
                  {product.per100g.carbsG}g · G {product.per100g.fatG}g
                </p>
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-semibold text-zinc-300">
                  Cantidad consumida (g / ml)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={gramsText}
                  onChange={(e) => setGramsText(e.target.value)}
                  className="w-28 min-h-[44px] rounded-xl border border-[#2B303C] bg-[#161922] px-3 text-right font-mono font-bold text-white focus:border-[#D4FF33] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-4 gap-2 text-center rounded-xl bg-[#161922] p-3 font-mono tabular-nums">
                <div>
                  <span className="block text-[10px] text-zinc-400">Calorías</span>
                  <span className="text-sm font-extrabold text-[#D4FF33]">{scaled.calories}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-zinc-400">Proteína</span>
                  <span className="text-sm font-extrabold text-white">{scaled.proteinG}g</span>
                </div>
                <div>
                  <span className="block text-[10px] text-zinc-400">Carbs</span>
                  <span className="text-sm font-extrabold text-white">{scaled.carbsG}g</span>
                </div>
                <div>
                  <span className="block text-[10px] text-zinc-400">Grasas</span>
                  <span className="text-sm font-extrabold text-white">{scaled.fatG}g</span>
                </div>
              </div>

              {onSaveFavorite && (
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveAsFavorite}
                    onChange={(e) => setSaveAsFavorite(e.target.checked)}
                    className="w-4 h-4 accent-[#D4FF33]"
                  />
                  Guardar también en Mis Favoritos (1 toque)
                </label>
              )}

              <button
                type="button"
                onClick={handleConfirm}
                className="w-full min-h-[50px] rounded-2xl bg-[#D4FF33] text-sm font-extrabold text-[#0A0B0D] flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                Agregar a mi registro
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
