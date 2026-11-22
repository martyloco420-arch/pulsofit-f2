const MUSIC_DB_NAME = 'pulsofit_music_db';
const MUSIC_DB_VERSION = 1;
const TRACK_STORE_NAME = 'tracks';
const PREFS_LS_KEY = 'pulsofit_music_prefs_v1';

export type EqPresetId = 'flat' | 'gym_bass' | 'electronica' | 'rock' | 'vocal' | 'custom';

export interface StoredMusicTrack {
  id: string;
  title: string;
  artist: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  addedAt: string;
  blob: Blob;
}

export interface MusicEqPrefs {
  presetId: EqPresetId;
  bandsDb: [number, number, number, number, number]; // 60Hz, 230Hz, 910Hz, 3.6kHz, 14kHz (-12 to +12)
  bassBoostDb: number; // 0 to 12
  volume: number; // 0 to 1
  lastTrackId: string | null;
  repeatAll: boolean;
  shuffle: boolean;
}

export const EQ_BAND_FREQS: readonly { freq: number; label: string }[] = [
  { freq: 60, label: '60 Hz' },
  { freq: 230, label: '230 Hz' },
  { freq: 910, label: '910 Hz' },
  { freq: 3600, label: '3.6 kHz' },
  { freq: 14000, label: '14 kHz' },
];

export const EQ_PRESETS: Record<
  Exclude<EqPresetId, 'custom'>,
  { label: string; bandsDb: [number, number, number, number, number]; bassBoostDb: number }
> = {
  flat: {
    label: 'Flat',
    bandsDb: [0, 0, 0, 0, 0],
    bassBoostDb: 0,
  },
  gym_bass: {
    label: 'Gym Bass Boost',
    bandsDb: [6, 4, -1, 2, 4],
    bassBoostDb: 7,
  },
  electronica: {
    label: 'Electrónica',
    bandsDb: [5, 3, 0, 3, 5],
    bassBoostDb: 5,
  },
  rock: {
    label: 'Rock',
    bandsDb: [4, 2, -2, 3, 4],
    bassBoostDb: 2,
  },
  vocal: {
    label: 'Vocal',
    bandsDb: [-2, 1, 5, 4, 1],
    bassBoostDb: 0,
  },
};

export function getDefaultMusicPrefs(): MusicEqPrefs {
  return {
    presetId: 'gym_bass',
    bandsDb: [...EQ_PRESETS.gym_bass.bandsDb] as [number, number, number, number, number],
    bassBoostDb: EQ_PRESETS.gym_bass.bassBoostDb,
    volume: 0.85,
    lastTrackId: null,
    repeatAll: true,
    shuffle: false,
  };
}

export function loadMusicPrefs(): MusicEqPrefs {
  const defaults = getDefaultMusicPrefs();
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(PREFS_LS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<MusicEqPrefs>;
    return {
      presetId: parsed.presetId ?? defaults.presetId,
      bandsDb:
        Array.isArray(parsed.bandsDb) && parsed.bandsDb.length === 5
          ? (parsed.bandsDb.map((v) => Math.max(-12, Math.min(12, Number(v) || 0))) as [
              number,
              number,
              number,
              number,
              number,
            ])
          : defaults.bandsDb,
      bassBoostDb:
        typeof parsed.bassBoostDb === 'number'
          ? Math.max(0, Math.min(12, parsed.bassBoostDb))
          : defaults.bassBoostDb,
      volume:
        typeof parsed.volume === 'number'
          ? Math.max(0, Math.min(1, parsed.volume))
          : defaults.volume,
      lastTrackId: typeof parsed.lastTrackId === 'string' ? parsed.lastTrackId : null,
      repeatAll: parsed.repeatAll ?? true,
      shuffle: parsed.shuffle ?? false,
    };
  } catch {
    return defaults;
  }
}

export function saveMusicPrefs(prefs: MusicEqPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFS_LS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors
  }
}

function openMusicDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const req = indexedDB.open(MUSIC_DB_NAME, MUSIC_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TRACK_STORE_NAME)) {
        db.createObjectStore(TRACK_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir IndexedDB de música'));
  });
}

export async function loadAllMusicTracks(): Promise<StoredMusicTrack[]> {
  try {
    const db = await openMusicDb();
    const list = await new Promise<StoredMusicTrack[]>((resolve, reject) => {
      const tx = db.transaction(TRACK_STORE_NAME, 'readonly');
      const store = tx.objectStore(TRACK_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as StoredMusicTrack[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return list.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  } catch {
    return [];
  }
}

export function parseTrackMetadataFromFileName(fileName: string): {
  title: string;
  artist: string;
} {
  const withoutExt = fileName.replace(/\.(mp3|m4a|flac|wav|ogg|aac|opus)$/i, '').trim();
  const dashIdx = withoutExt.indexOf(' - ');
  if (dashIdx > 0 && dashIdx < withoutExt.length - 3) {
    return {
      artist: withoutExt.slice(0, dashIdx).trim(),
      title: withoutExt.slice(dashIdx + 3).trim(),
    };
  }
  return {
    title: withoutExt || 'Pista local',
    artist: 'Archivo local',
  };
}

export async function saveMusicFiles(files: FileList | File[]): Promise<StoredMusicTrack[]> {
  const arr = Array.from(files);
  if (arr.length === 0) return [];
  const db = await openMusicDb();
  const created: StoredMusicTrack[] = [];

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TRACK_STORE_NAME, 'readwrite');
    const store = tx.objectStore(TRACK_STORE_NAME);
    arr.forEach((file, idx) => {
      const meta = parseTrackMetadataFromFileName(file.name);
      const track: StoredMusicTrack = {
        id: `trk_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
        title: meta.title,
        artist: meta.artist,
        fileName: file.name,
        mimeType: file.type || 'audio/mpeg',
        sizeBytes: file.size,
        addedAt: new Date(Date.now() + idx).toISOString(),
        blob: file,
      };
      created.push(track);
      store.put(track);
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Error guardando pistas de audio'));
  });
  db.close();
  return created;
}

export async function deleteMusicTrack(trackId: string): Promise<void> {
  try {
    const db = await openMusicDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TRACK_STORE_NAME, 'readwrite');
      const store = tx.objectStore(TRACK_STORE_NAME);
      const req = store.delete(trackId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch {
    // Ignore errors
  }
}

export async function clearAllMusicTracks(): Promise<void> {
  try {
    const db = await openMusicDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TRACK_STORE_NAME, 'readwrite');
      const store = tx.objectStore(TRACK_STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch {
    // Ignore errors
  }
}
