export type HapticStyle = 'light' | 'medium' | 'success';

const HAPTIC_PATTERNS: Record<HapticStyle, number | number[]> = {
  light: 10,
  medium: 24,
  success: [14, 45, 24],
};

/**
 * Dispara retroalimentación háptica segura en dispositivos compatibles
 * sin lanzar excepciones en navegadores sin Vibration API (e.g. iOS Safari / desktop).
 */
export function triggerHaptic(style: HapticStyle = 'light'): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.vibrate !== 'function') return false;
  try {
    return navigator.vibrate(HAPTIC_PATTERNS[style]);
  } catch {
    return false;
  }
}
