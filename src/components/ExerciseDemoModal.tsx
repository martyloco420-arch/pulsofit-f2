import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Timer,
  X,
} from 'lucide-react';
import {
  findBestFreeExerciseMatch,
  getFreeExerciseImageUrls,
  getMovementPattern,
  getThreeStepGuide,
  loadFreeExerciseDb,
  resolveDetailedAnatomy,
  type FreeExerciseDbItem,
  type MovementPattern,
} from '../lib/exerciseDemoDb';
import type { MuscleGroup } from '../types/fitness';
import { MuscleAnatomyMap } from './MuscleAnatomyMap';

export interface InspectedExerciseInfo {
  name: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  notes?: string;
}

interface ExerciseDemoModalProps {
  exercise: InspectedExerciseInfo | null;
  onClose: () => void;
  restRemaining?: number | null;
  onSyncDetectedMuscles?: (
    primary: MuscleGroup[],
    secondary: MuscleGroup[],
  ) => void;
}

const MovementSvgFallback: React.FC<{
  pattern: MovementPattern;
  exerciseName: string;
}> = ({ pattern, exerciseName }) => {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-gradient-to-b from-[#131720] to-[#0B0D12]">
      <svg
        viewBox="0 0 240 130"
        className="w-48 h-28 text-[#D4FF33]"
        role="img"
        aria-label={`Ilustración técnica de ${exerciseName}`}
      >
        {/* Floor reference */}
        <line
          x1="24"
          y1="112"
          x2="216"
          y2="112"
          stroke="#2B3242"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {pattern === 'squat' && (
          <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            {/* Squat figure */}
            <circle cx="115" cy="30" r="9" />
            <path d="M115 41 L104 72 L126 84 L118 110" />
            <path d="M104 72 L88 86 L94 110" stroke="#9CA3AF" />
            <path d="M90 46 L142 46" stroke="#F4F5F7" strokeWidth="4" />
            {/* Motion arrow */}
            <path d="M175 38 L175 84 M169 76 L175 84 L181 76" stroke="#EF4444" strokeWidth="2.5" />
            <path d="M192 84 L192 38 M186 46 L192 38 L198 46" stroke="#D4FF33" strokeWidth="2.5" />
          </g>
        )}

        {pattern === 'hinge' && (
          <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="145" cy="46" r="9" />
            <path d="M137 52 L96 68 L108 110" />
            <path d="M132 58 L132 94" stroke="#F4F5F7" strokeWidth="3" />
            <circle cx="132" cy="99" r="7" stroke="#F4F5F7" />
            <path d="M180 86 C182 62 174 44 156 36" stroke="#D4FF33" strokeWidth="2.5" />
          </g>
        )}

        {pattern === 'pull' && (
          <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="65" y1="22" x2="175" y2="22" stroke="#F4F5F7" strokeWidth="4" />
            <circle cx="120" cy="44" r="9" />
            <path d="M120 55 L120 92 L106 110 M120 92 L134 110" />
            <path d="M120 60 L92 48 L88 22 M120 60 L148 48 L152 22" />
            <path d="M190 78 L190 36 M184 44 L190 36 L196 44" stroke="#D4FF33" strokeWidth="2.5" />
          </g>
        )}

        {pattern === 'curl' && (
          <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="108" cy="28" r="9" />
            <path d="M108 39 L108 82 L98 110 M108 82 L120 110" />
            <path d="M108 46 L112 72 L138 56" />
            <circle cx="141" cy="54" r="5" fill="#F4F5F7" stroke="none" />
            <path d="M158 84 C166 68 164 52 148 44" stroke="#D4FF33" strokeWidth="2.5" />
          </g>
        )}

        {pattern === 'raise' && (
          <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="120" cy="28" r="9" />
            <path d="M120 39 L120 82 L108 110 M120 82 L132 110" />
            <path d="M120 46 L72 46 M120 46 L168 46" />
            <path d="M68 82 C62 66 62 56 68 48" stroke="#D4FF33" strokeWidth="2.5" />
            <path d="M172 82 C178 66 178 56 172 48" stroke="#D4FF33" strokeWidth="2.5" />
          </g>
        )}

        {pattern === 'core' && (
          <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="174" cy="76" r="8" />
            <path d="M164 80 L96 86 L58 108" />
            <path d="M158 84 L158 108 L174 108" />
            <rect x="108" y="75" width="32" height="6" rx="2" fill="#EF4444" stroke="none" />
          </g>
        )}

        {pattern === 'push' && (
          <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="64" y="88" width="112" height="8" rx="3" fill="#252B37" stroke="none" />
            <circle cx="80" cy="76" r="8" />
            <path d="M88 80 L150 80 L166 108" />
            <path d="M114 80 L114 44" />
            <line x1="88" y1="42" x2="140" y2="42" stroke="#F4F5F7" strokeWidth="4" />
            <path d="M182 74 L182 36 M176 44 L182 36 L188 44" stroke="#D4FF33" strokeWidth="2.5" />
          </g>
        )}
      </svg>
      <p className="text-xs font-semibold text-zinc-300 mt-1">
        Esquema biomecánico de trayectoria
      </p>
      <p className="text-[11px] text-zinc-500 mt-0.5">
        Modo sin conexión o ejercicio personalizado
      </p>
    </div>
  );
};

export const ExerciseDemoModal: React.FC<ExerciseDemoModalProps> = ({
  exercise,
  onClose,
  restRemaining,
  onSyncDetectedMuscles,
}) => {
  const [matchedItem, setMatchedItem] = useState<FreeExerciseDbItem | null>(null);
  const [isLoadingDb, setIsLoadingDb] = useState(false);
  const [frameIndex, setFrameIndex] = useState<0 | 1>(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (!exercise) return;
    let active = true;
    setIsLoadingDb(true);
    setImgError(false);
    setFrameIndex(0);
    setIsPlaying(true);

    loadFreeExerciseDb()
      .then((db) => {
        if (!active) return;
        const match = findBestFreeExerciseMatch(
          db,
          exercise.name,
          exercise.primaryMuscles,
        );
        setMatchedItem(match);
      })
      .finally(() => {
        if (active) setIsLoadingDb(false);
      });

    return () => {
      active = false;
    };
  }, [exercise?.name]);

  const imageUrls = useMemo(
    () => getFreeExerciseImageUrls(matchedItem),
    [matchedItem],
  );

  // Alternate 0.jpg <-> 1.jpg every 800 ms when playing
  useEffect(() => {
    if (!exercise || !imageUrls || imgError || !isPlaying) return;
    const id = window.setInterval(() => {
      setFrameIndex((prev) => (prev === 0 ? 1 : 0));
    }, 800);
    return () => window.clearInterval(id);
  }, [exercise, imageUrls, imgError, isPlaying]);

  const anatomy = useMemo(() => {
    if (!exercise) return null;
    return resolveDetailedAnatomy(
      exercise.name,
      exercise.primaryMuscles,
      exercise.secondaryMuscles,
      matchedItem,
    );
  }, [exercise, matchedItem]);

  // Sync enriched coarse MuscleGroups back to parent workout if needed
  useEffect(() => {
    if (!exercise || !anatomy || !onSyncDetectedMuscles) return;
    onSyncDetectedMuscles(anatomy.recoveredPrimary, anatomy.recoveredSecondary);
  }, [matchedItem?.id]);

  if (!exercise || !anatomy) return null;

  const pattern = getMovementPattern(exercise.name, exercise.primaryMuscles);
  const guide = getThreeStepGuide(
    exercise.name,
    exercise.primaryMuscles,
    exercise.notes,
  );
  const youtubeSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `${exercise.name} tecnica correcta ejercicio`,
  )}`;

  const showPhotos = Boolean(imageUrls && !imgError && !isLoadingDb);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-modal-title"
    >
      <div className="w-full max-w-xl rounded-t-3xl sm:rounded-3xl border border-[#262B36] bg-[#13151A] max-h-[92dvh] flex flex-col shadow-2xl">
        <div className="w-10 h-1.5 bg-zinc-700 rounded-full mx-auto mt-3 sm:hidden" />

        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-[#D4FF33]">
                Técnica y mapa muscular
              </span>
              {typeof restRemaining === 'number' && restRemaining > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[#D4FF33]/15 border border-[#D4FF33]/35 px-2 py-0.5 text-[11px] font-mono tabular-nums font-bold text-[#D4FF33]">
                  <Timer className="w-3 h-3" />
                  Descanso activo: {Math.floor(restRemaining / 60)}:
                  {String(restRemaining % 60).padStart(2, '0')}
                </span>
              )}
            </div>
            <h2
              id="demo-modal-title"
              className="mt-1 text-xl sm:text-2xl font-extrabold font-display text-white leading-tight"
            >
              {exercise.name}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar técnica del ejercicio"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-6">
          {/* 1. Animated Demonstration Stage (800ms loop or SVG + YouTube Fallback) */}
          <div className="space-y-3">
            <div className="relative h-56 sm:h-64 w-full rounded-2xl overflow-hidden border border-[#252A36] bg-[#0B0C10]">
              {isLoadingDb ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-xs text-zinc-400">
                  <Loader2 className="w-6 h-6 animate-spin text-[#D4FF33]" />
                  Buscando demostración técnica...
                </div>
              ) : showPhotos && imageUrls ? (
                <>
                  <img
                    src={imageUrls[frameIndex]}
                    alt={`${exercise.name} fase ${frameIndex + 1}`}
                    referrerPolicy="no-referrer"
                    onError={() => setImgError(true)}
                    className="w-full h-full object-contain bg-[#0E1015]"
                  />

                  {/* Preload alternate frame invisibly so 800ms swap is instant */}
                  <img
                    src={imageUrls[frameIndex === 0 ? 1 : 0]}
                    alt=""
                    aria-hidden="true"
                    referrerPolicy="no-referrer"
                    onError={() => setImgError(true)}
                    className="hidden"
                  />

                  {/* Scrim + Play/Pause Control */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-mono font-bold text-[#D4FF33]">
                        Fase {frameIndex + 1}/2 · {isPlaying ? 'Bucle 800 ms' : 'En pausa'}
                      </p>
                      {matchedItem && (
                        <p className="text-[11px] text-zinc-300 truncate">
                          Ref: {matchedItem.name}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsPlaying((p) => !p)}
                      className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[#D4FF33] px-3.5 text-xs font-extrabold text-[#0A0B0D] shrink-0 active:scale-95 transition-transform"
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="w-3.5 h-3.5 fill-current" />
                          Pausar
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-current" />
                          Reproducir
                        </>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <MovementSvgFallback pattern={pattern} exerciseName={exercise.name} />
              )}
            </div>

            {/* YouTube Video Demo Fallback / Direct Search */}
            <a
              href={youtubeSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`w-full min-h-[46px] rounded-xl border px-4 flex items-center justify-center gap-2 text-xs font-extrabold transition-colors ${
                showPhotos
                  ? 'border-[#272C38] bg-[#161922] text-zinc-200 hover:bg-[#1E222E]'
                  : 'border-[#D4FF33]/50 bg-[#D4FF33]/15 text-[#D4FF33] hover:bg-[#D4FF33]/25'
              }`}
            >
              <ExternalLink className="w-4 h-4" />
              Buscar demo en YouTube
            </a>
          </div>

          {/* 2. Lyfta-Style Dual Anatomical Muscle Map */}
          <MuscleAnatomyMap activations={anatomy.activations} />

          {/* 3. Quick 3-Step Execution Guide */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-white">
              Guía rápida de ejecución (3 pasos)
            </h3>

            <div className="space-y-2.5">
              <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3.5">
                <p className="text-xs font-extrabold text-[#D4FF33] flex items-center gap-1.5">
                  <span className="font-mono">01.</span> Posición inicial
                </p>
                <p className="mt-1 text-xs sm:text-sm text-zinc-200 leading-relaxed">
                  {guide.startPosition}
                </p>
              </div>

              <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3.5">
                <p className="text-xs font-extrabold text-sky-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span className="font-mono">02.</span> Ejecución controlada
                </p>
                <p className="mt-1 text-xs sm:text-sm text-zinc-200 leading-relaxed">
                  {guide.controlledExecution}
                </p>
              </div>

              <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-3.5">
                <p className="text-xs font-extrabold text-rose-300 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span className="font-mono">03.</span> Error común a evitar
                </p>
                <p className="mt-1 text-xs sm:text-sm text-rose-100/90 leading-relaxed">
                  {guide.commonMistake}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Close CTA */}
        <div className="p-4 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[50px] rounded-2xl bg-[#D4FF33] text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform"
          >
            Volver al entrenamiento
          </button>
        </div>
      </div>
    </div>
  );
};
