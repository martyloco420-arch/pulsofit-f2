import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { TabId } from '../types/fitness';
import { beginAudioDucking, endAudioDucking } from '../lib/voiceCoach';

export type MediaStreamOwner =
  | 'ppg_camera'
  | 'barcode_camera'
  | 'sleep_mic'
  | 'plate_speech'
  | 'custom';

export type WakeLockReason = 'cardio' | 'sleep' | 'workout';
export type AudioFocusKind = 'tts' | 'sleep_aid';

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
}

type AudioStopListener = () => void;
const audioStopListeners = new Set<AudioStopListener>();

export function subscribeAudioFocusStop(listener: AudioStopListener): () => void {
  audioStopListeners.add(listener);
  return () => {
    audioStopListeners.delete(listener);
  };
}

export function emitAudioFocusStopMusic(): void {
  for (const listener of audioStopListeners) {
    try {
      listener();
    } catch {
      // Ignore listener errors
    }
  }
}

interface HardwareManagerContextValue {
  wakeLockActive: boolean;
  bleScanActive: boolean;
  activeStreamOwners: MediaStreamOwner[];
  registerMediaStream: (owner: MediaStreamOwner, stream: MediaStream) => void;
  releaseMediaStream: (owner: MediaStreamOwner) => void;
  releaseAllMediaStreams: (exceptOwners?: MediaStreamOwner[]) => void;
  registerBleScan: (stopFn: () => void) => void;
  stopBleScan: () => void;
  registerGpsWatch: (watchId: number) => void;
  clearGpsWatch: () => void;
  acquireWakeLock: (reason: WakeLockReason) => Promise<boolean>;
  releaseWakeLock: (reason?: WakeLockReason) => Promise<void>;
  notifyTabChange: (nextTab: TabId) => void;
  requestAudioFocus: (kind: AudioFocusKind) => void;
  releaseAudioFocus: (kind: AudioFocusKind) => void;
}

const HardwareManagerContext = createContext<HardwareManagerContextValue | null>(
  null,
);

function trackSupportsTorchControl(track: MediaStreamTrack): boolean {
  if (track.kind !== 'video') return false;
  try {
    if (typeof track.getCapabilities === 'function') {
      const caps = track.getCapabilities() as MediaTrackCapabilities & {
        torch?: boolean;
      };
      if (caps && 'torch' in caps) {
        return Boolean(caps.torch);
      }
    }
    if (typeof track.getSettings === 'function') {
      const settings = track.getSettings() as MediaTrackSettings & {
        torch?: boolean;
      };
      if (settings && settings.torch) {
        return true;
      }
    }
  } catch {
    // Fallback to checking applyConstraints availability on live video track
  }
  return typeof track.applyConstraints === 'function';
}

function stopSingleTrackSafely(track: MediaStreamTrack): void {
  try {
    if (track.readyState !== 'ended') {
      track.stop();
    }
  } catch {
    // Ignore track stop errors
  }
}

/**
 * Turns off LED torch (`{ torch: false }`) on live video tracks BEFORE calling `track.stop()`
 * so Android Chrome releases hardware flash cleanly even during tab switch / visibilitychange / pagehide.
 */
export async function disableStreamTorchAndStop(
  stream: MediaStream | null | undefined,
): Promise<void> {
  if (!stream) return;
  let tracks: MediaStreamTrack[] = [];
  try {
    tracks = stream.getTracks();
  } catch {
    return;
  }

  await Promise.all(
    tracks.map(async (track) => {
      if (
        track.kind === 'video' &&
        track.readyState === 'live' &&
        typeof track.applyConstraints === 'function' &&
        trackSupportsTorchControl(track)
      ) {
        try {
          await Promise.race([
            track.applyConstraints({
              advanced: [{ torch: false } as unknown as MediaTrackConstraintSet],
            }),
            new Promise<void>((resolve) => {
              window.setTimeout(resolve, 120);
            }),
          ]);
        } catch {
          // Ignore devices/browsers that reject torch: false constraint
        }
      }
      stopSingleTrackSafely(track);
    }),
  );
}

function stopStreamTracks(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  let tracks: MediaStreamTrack[] = [];
  try {
    tracks = stream.getTracks();
  } catch {
    return;
  }

  tracks.forEach((track) => {
    if (
      track.kind === 'video' &&
      track.readyState === 'live' &&
      typeof track.applyConstraints === 'function' &&
      trackSupportsTorchControl(track)
    ) {
      let stopped = false;
      const finalizeStop = () => {
        if (stopped) return;
        stopped = true;
        stopSingleTrackSafely(track);
      };

      const safetyTimer =
        typeof window !== 'undefined'
          ? window.setTimeout(finalizeStop, 100)
          : null;

      try {
        void track
          .applyConstraints({
            advanced: [{ torch: false } as unknown as MediaTrackConstraintSet],
          })
          .catch(() => {
            // Ignore devices that reject torch constraint
          })
          .finally(() => {
            if (safetyTimer !== null) {
              window.clearTimeout(safetyTimer);
            }
            finalizeStop();
          });
      } catch {
        if (safetyTimer !== null) {
          window.clearTimeout(safetyTimer);
        }
        finalizeStop();
      }
      return;
    }

    stopSingleTrackSafely(track);
  });
}

export const HardwareManagerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const streamsRef = useRef<Map<MediaStreamOwner, MediaStream>>(new Map());
  const bleStopRef = useRef<(() => void) | null>(null);
  const gpsWatchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const wakeReasonsRef = useRef<Set<WakeLockReason>>(new Set());
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [bleScanActive, setBleScanActive] = useState(false);
  const [activeStreamOwners, setActiveStreamOwners] = useState<MediaStreamOwner[]>(
    [],
  );

  const syncOwnersState = useCallback(() => {
    setActiveStreamOwners(Array.from(streamsRef.current.keys()));
  }, []);

  const stopBleScan = useCallback(() => {
    const existingStop = bleStopRef.current;
    bleStopRef.current = null;
    if (existingStop) {
      try {
        existingStop();
      } catch {
        // Ignore BLE scan.stop errors
      }
    }
    setBleScanActive(false);
  }, []);

  const registerBleScan = useCallback((stopFn: () => void) => {
    if (bleStopRef.current && bleStopRef.current !== stopFn) {
      try {
        bleStopRef.current();
      } catch {
        // Ignore previous BLE scan stop errors
      }
    }
    bleStopRef.current = stopFn;
    setBleScanActive(true);
  }, []);

  const releaseMediaStream = useCallback(
    (owner: MediaStreamOwner) => {
      const existing = streamsRef.current.get(owner);
      if (existing) {
        streamsRef.current.delete(owner);
        stopStreamTracks(existing);
        syncOwnersState();
      }
    },
    [syncOwnersState],
  );

  const registerMediaStream = useCallback(
    (owner: MediaStreamOwner, stream: MediaStream) => {
      const prev = streamsRef.current.get(owner);
      if (prev && prev !== stream) {
        stopStreamTracks(prev);
      }
      streamsRef.current.set(owner, stream);
      syncOwnersState();
    },
    [syncOwnersState],
  );

  const releaseAllMediaStreams = useCallback(
    (exceptOwners: MediaStreamOwner[] = []) => {
      const keepSet = new Set(exceptOwners);
      let changed = false;
      for (const [owner, stream] of streamsRef.current.entries()) {
        if (!keepSet.has(owner)) {
          streamsRef.current.delete(owner);
          stopStreamTracks(stream);
          changed = true;
        }
      }
      if (changed) {
        syncOwnersState();
      }
    },
    [syncOwnersState],
  );

  const clearGpsWatch = useCallback(() => {
    if (
      gpsWatchIdRef.current !== null &&
      typeof navigator !== 'undefined' &&
      'geolocation' in navigator
    ) {
      try {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      } catch {
        // Ignore clearWatch errors
      }
      gpsWatchIdRef.current = null;
    }
  }, []);

  const registerGpsWatch = useCallback((watchId: number) => {
    if (
      gpsWatchIdRef.current !== null &&
      gpsWatchIdRef.current !== watchId &&
      typeof navigator !== 'undefined' &&
      'geolocation' in navigator
    ) {
      try {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      } catch {
        // Ignore clearWatch errors
      }
    }
    gpsWatchIdRef.current = watchId;
  }, []);

  const releaseWakeLockSentinelOnly = useCallback(async () => {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    setWakeLockActive(false);
    if (sentinel) {
      try {
        await sentinel.release();
      } catch {
        // Ignore release errors
      }
    }
  }, []);

  const requestWakeLockSentinel = useCallback(async (): Promise<boolean> => {
    if (typeof navigator === 'undefined') return false;
    const nav = navigator as unknown as {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock || typeof nav.wakeLock.request !== 'function') {
      setWakeLockActive(false);
      return false;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      setWakeLockActive(false);
      return false;
    }
    if (wakeLockRef.current && !wakeLockRef.current.released) {
      setWakeLockActive(true);
      return true;
    }
    try {
      const sentinel = await nav.wakeLock.request('screen');
      wakeLockRef.current = sentinel;
      setWakeLockActive(true);
      sentinel.addEventListener?.('release', () => {
        if (wakeLockRef.current === sentinel) {
          wakeLockRef.current = null;
        }
        setWakeLockActive(false);
      });
      return true;
    } catch {
      setWakeLockActive(false);
      return false;
    }
  }, []);

  const acquireWakeLock = useCallback(
    async (reason: WakeLockReason): Promise<boolean> => {
      wakeReasonsRef.current.add(reason);
      return requestWakeLockSentinel();
    },
    [requestWakeLockSentinel],
  );

  const releaseWakeLock = useCallback(
    async (reason?: WakeLockReason) => {
      if (reason) {
        wakeReasonsRef.current.delete(reason);
      } else {
        wakeReasonsRef.current.clear();
      }

      if (wakeReasonsRef.current.size === 0) {
        await releaseWakeLockSentinelOnly();
      }
    },
    [releaseWakeLockSentinelOnly],
  );

  const notifyTabChange = useCallback(
    (nextTab: TabId) => {
      // Immediately disable torch + stop any active camera/mic tracks & active BLE scans on tab change
      releaseAllMediaStreams();
      stopBleScan();
      // Keep WakeLock only if a background cardio or sleep session is actively running
      const hasPersistentBackgroundSession =
        wakeReasonsRef.current.has('cardio') || wakeReasonsRef.current.has('sleep');
      if (nextTab !== 'entrenar') {
        wakeReasonsRef.current.delete('workout');
      }
      if (!hasPersistentBackgroundSession) {
        void releaseWakeLockSentinelOnly();
      }
    },
    [releaseAllMediaStreams, releaseWakeLockSentinelOnly, stopBleScan],
  );

  const requestAudioFocus = useCallback((kind: AudioFocusKind) => {
    if (kind === 'sleep_aid') {
      emitAudioFocusStopMusic();
    } else if (kind === 'tts') {
      beginAudioDucking();
    }
  }, []);

  const releaseAudioFocus = useCallback((kind: AudioFocusKind) => {
    if (kind === 'tts') {
      endAudioDucking();
    }
  }, []);

  // Global visibilitychange / pagehide lifecycle:
  // - hidden / pagehide -> send { torch: false }, stop all camera/mic streams, stop BLE scan & release WakeLock
  // - visible -> re-acquire WakeLock automatically if cardio or sleep monitoring is active
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        releaseAllMediaStreams();
        stopBleScan();
        void releaseWakeLockSentinelOnly();
      } else if (document.visibilityState === 'visible') {
        const shouldRestoreWakeLock =
          wakeReasonsRef.current.has('cardio') ||
          wakeReasonsRef.current.has('sleep');
        if (shouldRestoreWakeLock) {
          void requestWakeLockSentinel();
        }
      }
    };

    const handlePageHide = () => {
      releaseAllMediaStreams();
      stopBleScan();
      void releaseWakeLockSentinelOnly();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      releaseAllMediaStreams();
      stopBleScan();
      clearGpsWatch();
      void releaseWakeLockSentinelOnly();
    };
  }, [
    clearGpsWatch,
    releaseAllMediaStreams,
    releaseWakeLockSentinelOnly,
    requestWakeLockSentinel,
    stopBleScan,
  ]);

  const value = useMemo<HardwareManagerContextValue>(
    () => ({
      wakeLockActive,
      bleScanActive,
      activeStreamOwners,
      registerMediaStream,
      releaseMediaStream,
      releaseAllMediaStreams,
      registerBleScan,
      stopBleScan,
      registerGpsWatch,
      clearGpsWatch,
      acquireWakeLock,
      releaseWakeLock,
      notifyTabChange,
      requestAudioFocus,
      releaseAudioFocus,
    }),
    [
      wakeLockActive,
      bleScanActive,
      activeStreamOwners,
      registerMediaStream,
      releaseMediaStream,
      releaseAllMediaStreams,
      registerBleScan,
      stopBleScan,
      registerGpsWatch,
      clearGpsWatch,
      acquireWakeLock,
      releaseWakeLock,
      notifyTabChange,
      requestAudioFocus,
      releaseAudioFocus,
    ],
  );

  return (
    <HardwareManagerContext.Provider value={value}>
      {children}
    </HardwareManagerContext.Provider>
  );
};

export function useHardwareManager(): HardwareManagerContextValue {
  const ctx = useContext(HardwareManagerContext);
  if (ctx) return ctx;
  return {
    wakeLockActive: false,
    bleScanActive: false,
    activeStreamOwners: [],
    registerMediaStream: () => {},
    releaseMediaStream: () => {},
    releaseAllMediaStreams: () => {},
    registerBleScan: () => {},
    stopBleScan: () => {},
    registerGpsWatch: () => {},
    clearGpsWatch: () => {},
    acquireWakeLock: async () => false,
    releaseWakeLock: async () => {},
    notifyTabChange: () => {},
    requestAudioFocus: (kind) => {
      if (kind === 'sleep_aid') emitAudioFocusStopMusic();
    },
    releaseAudioFocus: () => {},
  };
}
