import { useSyncExternalStore } from 'react';
import type { LowPowerPreference } from '../types/fitness';

export interface BatteryStatusSnapshot {
  supported: boolean;
  level: number | null; // 0..1
  charging: boolean | null;
}

export type LowPowerActivationReason =
  | 'manual_on'
  | 'manual_off'
  | 'battery_low'
  | 'normal';

export interface LowPowerState {
  preference: LowPowerPreference;
  isLowPower: boolean;
  reason: LowPowerActivationReason;
  battery: BatteryStatusSnapshot;
}

interface NativeBatteryManager extends EventTarget {
  level: number;
  charging: boolean;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<NativeBatteryManager>;
};

export const LOW_POWER_BATTERY_THRESHOLD = 0.2;
export const LOW_POWER_FPS_INTERVAL_MS = 66; // ~15 fps (vs 60fps ~16.6ms)
export const LOW_POWER_GPS_INTERVAL_MS = 5000;
export const NORMAL_GPS_INTERVAL_MS = 1000;
export const LOW_POWER_IDB_BATCH_MS = 30000;

let currentPreference: LowPowerPreference = 'auto';
let currentBattery: BatteryStatusSnapshot = {
  supported: false,
  level: null,
  charging: null,
};
let batteryInitialized = false;
const listeners = new Set<() => void>();

function computeSnapshot(): LowPowerState {
  if (currentPreference === 'on') {
    return {
      preference: currentPreference,
      isLowPower: true,
      reason: 'manual_on',
      battery: currentBattery,
    };
  }
  if (currentPreference === 'off') {
    return {
      preference: currentPreference,
      isLowPower: false,
      reason: 'manual_off',
      battery: currentBattery,
    };
  }

  const autoTriggered = Boolean(
    currentBattery.supported &&
      currentBattery.level !== null &&
      currentBattery.level <= LOW_POWER_BATTERY_THRESHOLD &&
      currentBattery.charging === false,
  );

  return {
    preference: currentPreference,
    isLowPower: autoTriggered,
    reason: autoTriggered ? 'battery_low' : 'normal',
    battery: currentBattery,
  };
}

let cachedSnapshot: LowPowerState = computeSnapshot();

function syncDocumentClass(isLowPower: boolean): void {
  if (typeof document === 'undefined') return;
  try {
    document.documentElement.classList.toggle('low-power-mode', isLowPower);
  } catch {
    // Ignore DOM unavailable
  }
}

function emitUpdate(): void {
  cachedSnapshot = computeSnapshot();
  syncDocumentClass(cachedSnapshot.isLowPower);
  listeners.forEach((fn) => fn());
}

export function initBatteryMonitor(): void {
  if (batteryInitialized) return;
  batteryInitialized = true;

  if (typeof navigator === 'undefined') return;

  try {
    if ('getBattery' in navigator) {
      const nav = navigator as NavigatorWithBattery;
      if (typeof nav.getBattery === 'function') {
        void nav
          .getBattery()
          .then((battery) => {
            if (!battery) return;
            const updateFromBattery = () => {
              currentBattery = {
                supported: true,
                level:
                  typeof battery.level === 'number' && Number.isFinite(battery.level)
                    ? Math.max(0, Math.min(1, battery.level))
                    : null,
                charging:
                  typeof battery.charging === 'boolean' ? battery.charging : null,
              };
              emitUpdate();
            };

            updateFromBattery();

            try {
              battery.addEventListener('levelchange', updateFromBattery);
              battery.addEventListener('chargingchange', updateFromBattery);
            } catch {
              // Ignore listener errors on partial implementations
            }
          })
          .catch(() => {
            currentBattery = {
              supported: false,
              level: null,
              charging: null,
            };
          });
      }
    }
  } catch {
    currentBattery = {
      supported: false,
      level: null,
      charging: null,
    };
  }
}

export function setLowPowerPreference(pref?: LowPowerPreference): void {
  const normalized: LowPowerPreference =
    pref === 'on' || pref === 'off' ? pref : 'auto';
  if (normalized === currentPreference) {
    syncDocumentClass(cachedSnapshot.isLowPower);
    return;
  }
  currentPreference = normalized;
  emitUpdate();
}

export function getLowPowerSnapshot(): LowPowerState {
  return cachedSnapshot;
}

export function isLowPowerActiveNow(): boolean {
  return cachedSnapshot.isLowPower;
}

export function subscribeLowPower(listener: () => void): () => void {
  initBatteryMonitor();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLowPowerMode(): LowPowerState {
  return useSyncExternalStore(
    subscribeLowPower,
    getLowPowerSnapshot,
    getLowPowerSnapshot,
  );
}
