import type { MuscleGroup, WeightUnit, WorkoutExercise } from '../types/fitness';
import { synthesizeVoiceCoachTtsAi } from './aiClient';
import { kgToDisplayWeight } from './units';

const MUSCLE_POSTURE_TIPS: Record<MuscleGroup, string> = {
  pecho: 'Mantén los hombros atrás y abajo, escápulas retraídas y controla la bajada.',
  espalda: 'Inicia el tirón desde los codos, mantén la espalda neutra y evita balancear el torso.',
  hombros: 'Activa el abdomen y los glúteos para estabilizar la zona lumbar sin encoger el cuello.',
  biceps: 'Mantén los codos fijos pegados a los costados y controla la fase excéntrica.',
  triceps: 'Bloquea la posición de los codos y extiende el brazo por completo sin impulso.',
  cuadriceps: 'Alinea las rodillas con las puntas de los pies y mantén el pecho erguido.',
  isquiotibiales: 'Lleva la cadera hacia atrás manteniendo la espalda recta y siente el estiramiento.',
  gluteos: 'Aprieta fuerte arriba durante un segundo manteniendo las costillas alineadas.',
  pantorrillas: 'Haz una pausa breve abajo en máximo estiramiento y sube de forma controlada.',
  abdomen: 'Mantén la zona lumbar estable y respira de forma controlada en cada repetición.',
};

let activeAudioElement: HTMLAudioElement | null = null;
let speechGenerationId = 0;
let defaultPreferredVoiceUri: string | undefined;

// Audio Ducking Bridge (reduces local music player volume to 20% while coach speaks)
type DuckListener = (duckFactor: number | null) => void;
const duckListeners = new Set<DuckListener>();
let duckSafetyTimer: number | null = null;
let isCurrentlyDucked = false;

function notifyDuckListeners(factor: number | null) {
  for (const listener of duckListeners) {
    try {
      listener(factor);
    } catch {
      // Ignore listener errors
    }
  }
}

export function subscribeAudioDucking(listener: DuckListener): () => void {
  duckListeners.add(listener);
  if (isCurrentlyDucked) {
    listener(0.2);
  }
  return () => {
    duckListeners.delete(listener);
  };
}

export function beginAudioDucking() {
  if (duckSafetyTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(duckSafetyTimer);
    duckSafetyTimer = null;
  }
  isCurrentlyDucked = true;
  notifyDuckListeners(0.2);
  if (typeof window !== 'undefined') {
    // Safety guard in case browser TTS fails to fire onend
    duckSafetyTimer = window.setTimeout(() => {
      endAudioDucking();
    }, 20000);
  }
}

export function endAudioDucking() {
  if (duckSafetyTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(duckSafetyTimer);
    duckSafetyTimer = null;
  }
  if (!isCurrentlyDucked) return;
  isCurrentlyDucked = false;
  notifyDuckListeners(null);
}

export function setDefaultPreferredVoiceUri(voiceUri?: string): void {
  defaultPreferredVoiceUri = voiceUri?.trim() || undefined;
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && ('speechSynthesis' in window || 'Audio' in window);
}

export function isBlockedSpainVoice(voice: SpeechSynthesisVoice): boolean {
  const lang = (voice.lang || '').toLowerCase().replace('_', '-');
  const name = (voice.name || '').toLowerCase();
  if (lang === 'es-es' || lang.startsWith('es-es-')) return true;
  if (
    name.includes('spain') ||
    name.includes('españa') ||
    name.includes('castilian') ||
    name.includes('castellano') ||
    name.includes('es-es')
  ) {
    return true;
  }
  return false;
}

function getLatamLocalePriority(voice: SpeechSynthesisVoice): number {
  const lang = (voice.lang || '').toLowerCase().replace('_', '-');
  const name = (voice.name || '').toLowerCase();
  if (lang.startsWith('es-mx')) {
    if (name.includes('mexic') || name.includes('dalia') || name.includes('jorge') || name.includes('sabina') || name.includes('raul') || name.includes('paulina') || name.includes('google')) {
      return 0;
    }
    return 1;
  }
  if (lang.startsWith('es-us')) return 2;
  if (lang.startsWith('es-419')) return 3;
  if (
    lang.startsWith('es-co') ||
    lang.startsWith('es-ar') ||
    lang.startsWith('es-cl') ||
    lang.startsWith('es-pe') ||
    lang.startsWith('es-ec') ||
    lang.startsWith('es-ve') ||
    lang.startsWith('es-uy') ||
    lang.startsWith('es-gt') ||
    lang.startsWith('es-cr') ||
    lang.startsWith('es-do') ||
    lang.startsWith('es-pa')
  ) {
    return 4;
  }
  if (lang === 'es' && (name.includes('mexic') || name.includes('latin'))) return 5;
  return 6;
}

/**
 * Returns only Spanish voices from Mexico / US / Latin America.
 * Explicitly blocks every es-ES (Spain) voice.
 */
export function getAvailableMexicanVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return [];

  return voices
    .filter((v) => {
      const lang = (v.lang || '').toLowerCase().replace('_', '-');
      return lang.startsWith('es') && !isBlockedSpainVoice(v);
    })
    .sort((a, b) => {
      const diff = getLatamLocalePriority(a) - getLatamLocalePriority(b);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name, 'es');
    });
}

function pickMexicanSpanishVoice(preferredVoiceUri?: string): SpeechSynthesisVoice | null {
  const allowedVoices = getAvailableMexicanVoices();
  if (allowedVoices.length === 0) return null;

  const targetUri = preferredVoiceUri?.trim() || defaultPreferredVoiceUri;
  if (targetUri) {
    const matched = allowedVoices.find((v) => v.voiceURI === targetUri);
    if (matched) return matched;
  }

  return allowedVoices[0] ?? null;
}

export function cancelCoachSpeech(): void {
  speechGenerationId += 1;
  endAudioDucking();

  if (activeAudioElement) {
    try {
      activeAudioElement.pause();
      activeAudioElement.src = '';
    } catch {
      // Ignore cleanup errors
    }
    activeAudioElement = null;
  }

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore browser speech cancellation errors
    }
  }
}

function speakViaWebSpeech(
  text: string,
  rate = 1.0,
  preferredVoiceUri?: string,
): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    // Force es-MX regardless of device locale
    utterance.lang = 'es-MX';
    utterance.rate = rate;
    utterance.pitch = 1.0;

    const voice = pickMexicanSpanishVoice(preferredVoiceUri);
    if (voice && !isBlockedSpainVoice(voice)) {
      utterance.voice = voice;
    }

    const genId = speechGenerationId;
    beginAudioDucking();

    utterance.onstart = () => {
      if (genId === speechGenerationId) {
        beginAudioDucking();
      }
    };
    utterance.onend = () => {
      if (genId === speechGenerationId) {
        endAudioDucking();
      }
    };
    utterance.onerror = () => {
      if (genId === speechGenerationId) {
        endAudioDucking();
      }
    };

    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    endAudioDucking();
    return false;
  }
}

export function speakVoiceTest(preferredVoiceUri?: string): boolean {
  return speakCoachCue(
    '¡Qué tal! Soy tu coach de PulsoFit en español de México. Vamos a entrenar con todo.',
    { enabled: true, muted: false, preferredVoiceUri },
  );
}

export function speakCoachCue(
  text: string,
  options?: {
    enabled?: boolean;
    muted?: boolean;
    rate?: number;
    preferredVoiceUri?: string;
  },
): boolean {
  const enabled = options?.enabled ?? true;
  const muted = options?.muted ?? false;

  if (!enabled || muted || !text.trim()) {
    return false;
  }

  cancelCoachSpeech();
  const currentGenId = speechGenerationId;

  // Prefer Web Speech API so es-MX / LatAm voice filter, utterance.lang='es-MX',
  // and user's Perfil voice selection are strictly honored with zero latency.
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    return speakViaWebSpeech(text, options?.rate ?? 1.0, options?.preferredVoiceUri);
  }

  // Fallback to server Gemini TTS only if Web Speech API is unavailable in the runtime
  const hasOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  if (hasOnline) {
    beginAudioDucking();
    void synthesizeVoiceCoachTtsAi(text)
      .then(({ audioBase64, mimeType }) => {
        if (currentGenId !== speechGenerationId) {
          endAudioDucking();
          return;
        }
        const audio = new Audio(`data:${mimeType || 'audio/wav'};base64,${audioBase64}`);
        activeAudioElement = audio;
        audio.onended = () => {
          if (activeAudioElement === audio) {
            activeAudioElement = null;
          }
          if (currentGenId === speechGenerationId) {
            endAudioDucking();
          }
        };
        audio.onerror = () => {
          if (currentGenId === speechGenerationId) {
            endAudioDucking();
          }
        };
        return audio.play();
      })
      .catch(() => {
        if (currentGenId === speechGenerationId) {
          endAudioDucking();
        }
      });
    return true;
  }

  return false;
}

export function getTechnicalTipForExercise(exercise: WorkoutExercise): string {
  if (exercise.notes && exercise.notes.trim().length > 0) {
    return exercise.notes.trim();
  }
  const primary = exercise.primaryMuscles[0];
  return (
    MUSCLE_POSTURE_TIPS[primary] ??
    'Mantén la postura estable y controla tanto la subida como la bajada.'
  );
}

export function buildExerciseStartCue(
  exercise: WorkoutExercise,
  weightUnit: WeightUnit = 'kg',
): string {
  const setCount = exercise.sets.length;
  const targetReps = exercise.sets[0]?.reps ?? 10;
  const targetWeight = exercise.sets[0]?.weightKg ?? 0;
  let weightPhrase = ' con peso corporal';
  if (exercise.loadMode === 'bands' && exercise.bandConfig) {
    weightPhrase = ` con ${exercise.bandConfig.label}`;
  } else if (targetWeight > 0) {
    const displayWeight = kgToDisplayWeight(targetWeight, weightUnit);
    weightPhrase = ` con ${displayWeight} ${weightUnit === 'lb' ? 'libras' : 'kilos'}`;
  }
  const tip = getTechnicalTipForExercise(exercise);

  return `Iniciando ${exercise.name}. Objetivo: ${setCount} ${
    setCount === 1 ? 'serie' : 'series'
  } de ${targetReps} repeticiones${weightPhrase}. Tip técnico: ${tip}`;
}
