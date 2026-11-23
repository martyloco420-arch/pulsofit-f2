import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronUp,
  FolderPlus,
  ListMusic,
  Music2,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import {
  EQ_BAND_FREQS,
  EQ_PRESETS,
  clearAllMusicTracks,
  deleteMusicTrack,
  loadAllMusicTracks,
  loadMusicPrefs,
  saveMusicFiles,
  saveMusicPrefs,
  type EqPresetId,
  type MusicEqPrefs,
  type StoredMusicTrack,
} from '../lib/musicStorage';
import {
  LOW_POWER_FPS_INTERVAL_MS,
  useLowPowerMode,
} from '../lib/lowPowerMode';
import { subscribeAudioDucking } from '../lib/voiceCoach';
import { subscribeAudioFocusStop } from '../hooks/useHardwareManager';

export interface MusicPlayerBarProps {
  openModalSignal?: number;
  onMiniPlayerVisibleChange?: (visible: boolean) => void;
  onPlayingStateChange?: (playing: boolean, hasTracks: boolean) => void;
}

function formatAudioTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export const MusicPlayerBar: React.FC<MusicPlayerBarProps> = ({
  openModalSignal = 0,
  onMiniPlayerVisibleChange,
  onPlayingStateChange,
}) => {
  const [tracks, setTracks] = useState<StoredMusicTrack[]>([]);
  const [prefs, setPrefs] = useState<MusicEqPrefs>(() => loadMusicPrefs());
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMiniDismissed, setIsMiniDismissed] = useState(false);
  const [activeDrawerTab, setActiveDrawerTab] = useState<'eq' | 'playlist'>('eq');
  const [isImporting, setIsImporting] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [duckFactor, setDuckFactor] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeObjectUrlRef = useRef<string | null>(null);
  const duckFactorRef = useRef<number | null>(null);
  const lastPositionReportSecRef = useRef<number>(-1);
  const prevOpenSignalRef = useRef(openModalSignal);
  duckFactorRef.current = duckFactor;

  // Web Audio API graph refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const bassBoostFilterRef = useRef<BiquadFilterNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const eqCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const lowPower = useLowPowerMode();
  const isLowPowerRef = useRef(lowPower.isLowPower);
  isLowPowerRef.current = lowPower.isLowPower;

  // Latest state refs for MediaSession / ended callbacks
  const tracksRef = useRef<StoredMusicTrack[]>([]);
  const currentTrackIdRef = useRef<string | null>(null);
  const prefsRef = useRef<MusicEqPrefs>(prefs);
  tracksRef.current = tracks;
  currentTrackIdRef.current = currentTrackId;
  prefsRef.current = prefs;

  // Open expanded player modal when triggered from header music icon
  useEffect(() => {
    if (openModalSignal > prevOpenSignalRef.current) {
      prevOpenSignalRef.current = openModalSignal;
      setIsMiniDismissed(false);
      setIsExpanded(true);
    }
  }, [openModalSignal]);

  // Subscribe to Voice Coach audio ducking (reduces music to 20% while coach speaks)
  useEffect(() => {
    return subscribeAudioDucking((factor) => {
      setDuckFactor(factor);
    });
  }, []);

  // Stop music playback cleanly when Sleep Aid or Night Monitor requests audio focus
  useEffect(() => {
    return subscribeAudioFocusStop(() => {
      const audioEl = audioRef.current;
      if (audioEl && !audioEl.paused) {
        audioEl.pause();
      }
      setIsPlaying(false);
    });
  }, []);

  const currentTrack = useMemo(
    () => tracks.find((t) => t.id === currentTrackId) ?? tracks[0] ?? null,
    [tracks, currentTrackId],
  );

  // Mini-player renders above bottom nav when a track is loaded/active and not manually hidden
  const isMiniBarVisible = currentTrack !== null && !isMiniDismissed;

  useEffect(() => {
    onMiniPlayerVisibleChange?.(isMiniBarVisible);
  }, [isMiniBarVisible, onMiniPlayerVisibleChange]);

  useEffect(() => {
    onPlayingStateChange?.(isPlaying, tracks.length > 0);
  }, [isPlaying, tracks.length, onPlayingStateChange]);

  // Persist prefs changes
  useEffect(() => {
    saveMusicPrefs(prefs);
  }, [prefs]);

  // Load persisted offline music tracks from IndexedDB on mount
  useEffect(() => {
    let mounted = true;
    loadAllMusicTracks().then((loaded) => {
      if (!mounted) return;
      setTracks(loaded);
      if (loaded.length > 0) {
        const savedId = prefsRef.current.lastTrackId;
        const found = loaded.find((t) => t.id === savedId);
        setCurrentTrackId(found ? found.id : loaded[0].id);
      }
    });
    return () => {
      mounted = false;
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        void audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  // Initialize Web Audio API 5-band Equalizer + Bass Boost graph lazily on gesture
  const ensureAudioGraph = useCallback(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    if (!audioCtxRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      const source = ctx.createMediaElementSource(audioEl);

      const filters = EQ_BAND_FREQS.map(({ freq }, idx) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1.1;
        filter.gain.value = prefsRef.current.bandsDb[idx] ?? 0;
        return filter;
      });

      const bassBoost = ctx.createBiquadFilter();
      bassBoost.type = 'lowshelf';
      bassBoost.frequency.value = 80;
      bassBoost.gain.value = prefsRef.current.bassBoostDb;

      const gain = ctx.createGain();
      gain.gain.value = prefsRef.current.volume * (duckFactorRef.current ?? 1);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.78;

      let prevNode: AudioNode = source;
      for (const f of filters) {
        prevNode.connect(f);
        prevNode = f;
      }
      prevNode.connect(bassBoost);
      bassBoost.connect(gain);
      gain.connect(analyser);
      analyser.connect(ctx.destination);

      audioCtxRef.current = ctx;
      sourceNodeRef.current = source;
      eqFiltersRef.current = filters;
      bassBoostFilterRef.current = bassBoost;
      gainNodeRef.current = gain;
      analyserRef.current = analyser;
    }

    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      void audioCtxRef.current.resume().catch(() => {});
    }
  }, []);

  // Sync EQ filter gains + bass boost + volume (including 20% ducking while coach speaks)
  useEffect(() => {
    const effectiveVolume = Math.max(0, Math.min(1, prefs.volume * (duckFactor ?? 1)));
    const ctx = audioCtxRef.current;
    if (ctx) {
      eqFiltersRef.current.forEach((filter, idx) => {
        filter.gain.setTargetAtTime(prefs.bandsDb[idx] ?? 0, ctx.currentTime, 0.02);
      });
      if (bassBoostFilterRef.current) {
        bassBoostFilterRef.current.gain.setTargetAtTime(
          prefs.bassBoostDb,
          ctx.currentTime,
          0.02,
        );
      }
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.setTargetAtTime(effectiveVolume, ctx.currentTime, 0.12);
      }
    }
    if (audioRef.current) {
      audioRef.current.volume = gainNodeRef.current ? 1 : effectiveVolume;
    }
  }, [prefs.bandsDb, prefs.bassBoostDb, prefs.volume, duckFactor]);

  // Live EQ Spectrum Canvas (60fps normal, throttled to ~15fps in Low Power Mode)
  useEffect(() => {
    if (!isExpanded || activeDrawerTab !== 'eq') return undefined;
    const canvas = eqCanvasRef.current;
    if (!canvas) return undefined;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return undefined;

    const barCount = 16;
    const dataArray = analyserRef.current
      ? new Uint8Array(analyserRef.current.frequencyBinCount)
      : new Uint8Array(32);

    const drawBars = (playingNow: boolean) => {
      const w = canvas.width;
      const h = canvas.height;
      ctx2d.clearRect(0, 0, w, h);

      if (playingNow && analyserRef.current) {
        analyserRef.current.getByteFrequencyData(dataArray);
      }

      const gap = 4;
      const barW = (w - gap * (barCount - 1)) / barCount;
      for (let i = 0; i < barCount; i += 1) {
        const binIdx = Math.min(dataArray.length - 1, i);
        const norm = playingNow ? dataArray[binIdx] / 255 : 0.08;
        const barH = Math.max(4, Math.round(norm * (h - 10)));
        const x = i * (barW + gap);
        const y = h - barH - 4;
        ctx2d.fillStyle = norm > 0.72 ? '#D4FF33' : norm > 0.35 ? '#34D399' : '#2E3648';
        ctx2d.fillRect(x, y, barW, barH);
      }
    };

    if (!isPlaying) {
      drawBars(false);
      return undefined;
    }

    let rafId = 0;
    let lastDrawMs = 0;
    const renderLoop = (nowMs: number) => {
      const minInterval = isLowPowerRef.current ? LOW_POWER_FPS_INTERVAL_MS : 0;
      if (minInterval === 0 || nowMs - lastDrawMs >= minInterval) {
        lastDrawMs = nowMs;
        drawBars(true);
      }
      rafId = requestAnimationFrame(renderLoop);
    };

    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [isExpanded, activeDrawerTab, isPlaying, lowPower.isLowPower]);

  // Load current track Blob URL into <audio> whenever currentTrack changes
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    if (!currentTrack) {
      audioEl.pause();
      audioEl.removeAttribute('src');
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(false);
      return;
    }

    const nextUrl = URL.createObjectURL(currentTrack.blob);
    if (activeObjectUrlRef.current) {
      URL.revokeObjectURL(activeObjectUrlRef.current);
    }
    activeObjectUrlRef.current = nextUrl;

    const shouldAutoPlay = isPlaying;
    audioEl.src = nextUrl;
    audioEl.load();
    setCurrentTime(0);
    setAudioError(null);

    setPrefs((prev) =>
      prev.lastTrackId === currentTrack.id
        ? prev
        : { ...prev, lastTrackId: currentTrack.id },
    );

    if (shouldAutoPlay) {
      ensureAudioGraph();
      void audioEl.play().catch(() => {
        setIsPlaying(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  const playTrackById = useCallback(
    async (trackId: string) => {
      const audioEl = audioRef.current;
      const target = tracksRef.current.find((t) => t.id === trackId);
      if (!target || !audioEl) return;

      setIsMiniDismissed(false);
      ensureAudioGraph();
      if (currentTrackIdRef.current === trackId && audioEl.src) {
        try {
          await audioEl.play();
          setIsPlaying(true);
          setAudioError(null);
        } catch {
          setAudioError('Toca reproducir nuevamente para activar el audio.');
        }
        return;
      }

      setIsPlaying(true);
      setCurrentTrackId(trackId);
    },
    [ensureAudioGraph],
  );

  const handleTogglePlay = useCallback(async () => {
    const audioEl = audioRef.current;
    if (!audioEl || tracksRef.current.length === 0) {
      fileInputRef.current?.click();
      return;
    }

    setIsMiniDismissed(false);
    ensureAudioGraph();
    if (!audioEl.paused) {
      audioEl.pause();
      setIsPlaying(false);
      return;
    }

    if (!currentTrackIdRef.current && tracksRef.current[0]) {
      setCurrentTrackId(tracksRef.current[0].id);
      setIsPlaying(true);
      return;
    }

    try {
      await audioEl.play();
      setIsPlaying(true);
      setAudioError(null);
    } catch {
      setAudioError('No se pudo reproducir esta pista.');
    }
  }, [ensureAudioGraph]);

  const handleStepTrack = useCallback(
    (direction: 1 | -1) => {
      const list = tracksRef.current;
      if (list.length === 0) return;

      if (prefsRef.current.shuffle && list.length > 1) {
        const candidates = list.filter((t) => t.id !== currentTrackIdRef.current);
        const pick = candidates[Math.floor(Math.random() * candidates.length)] ?? list[0];
        void playTrackById(pick.id);
        return;
      }

      const idx = list.findIndex((t) => t.id === currentTrackIdRef.current);
      const baseIdx = idx >= 0 ? idx : 0;
      const nextIdx = (baseIdx + direction + list.length) % list.length;
      void playTrackById(list[nextIdx].id);
    },
    [playTrackById],
  );

  const updateMediaPositionState = useCallback((posSec?: number, durSec?: number) => {
    if (
      typeof navigator === 'undefined' ||
      !('mediaSession' in navigator) ||
      typeof navigator.mediaSession.setPositionState !== 'function'
    ) {
      return;
    }
    const audioEl = audioRef.current;
    const rawDuration = typeof durSec === 'number' ? durSec : audioEl?.duration ?? 0;
    const rawPosition = typeof posSec === 'number' ? posSec : audioEl?.currentTime ?? 0;
    if (
      !Number.isFinite(rawDuration) ||
      rawDuration <= 0 ||
      !Number.isFinite(rawPosition) ||
      rawPosition < 0 ||
      rawPosition > rawDuration
    ) {
      return;
    }
    const playbackRate =
      audioEl?.playbackRate &&
      Number.isFinite(audioEl.playbackRate) &&
      audioEl.playbackRate > 0
        ? audioEl.playbackRate
        : 1;
    try {
      navigator.mediaSession.setPositionState({
        duration: rawDuration,
        playbackRate,
        position: rawPosition,
      });
    } catch {
      // Ignore invalid position state on unsupported platforms
    }
  }, []);

  const handleMediaPlay = useCallback(async () => {
    const audioEl = audioRef.current;
    if (!audioEl || tracksRef.current.length === 0) return;

    ensureAudioGraph();
    if (!currentTrackIdRef.current && tracksRef.current[0]) {
      setCurrentTrackId(tracksRef.current[0].id);
      setIsPlaying(true);
      return;
    }
    try {
      await audioEl.play();
      setIsPlaying(true);
      setAudioError(null);
      updateMediaPositionState(audioEl.currentTime, audioEl.duration);
    } catch {
      setAudioError('No se pudo reproducir esta pista.');
    }
  }, [ensureAudioGraph, updateMediaPositionState]);

  // MediaSession API integration for Bluetooth headphones & Android lock screen
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    if (currentTrack) {
      if (typeof MediaMetadata !== 'undefined') {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: currentTrack.title,
            artist: currentTrack.artist,
            album: 'PulsoFit',
            artwork: [
              {
                src: '/pwa-512x512.png',
                sizes: '512x512',
                type: 'image/png',
              },
            ],
          });
        } catch {
          // Ignore MediaMetadata errors on older browsers
        }
      }
    } else {
      try {
        navigator.mediaSession.metadata = null;
      } catch {
        // Ignore clear metadata errors
      }
    }

    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch {
      // Ignore playbackState errors on unsupported platforms
    }

    try {
      navigator.mediaSession.setActionHandler('play', () => {
        void handleMediaPlay();
      });
    } catch {
      // Unsupported 'play' action handler on platform
    }

    try {
      navigator.mediaSession.setActionHandler('pause', () => {
        audioRef.current?.pause();
        setIsPlaying(false);
      });
    } catch {
      // Unsupported 'pause' action handler on platform
    }

    try {
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        handleStepTrack(-1);
      });
    } catch {
      // Unsupported 'previoustrack' action handler on platform
    }

    try {
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        handleStepTrack(1);
      });
    } catch {
      // Unsupported 'nexttrack' action handler on platform
    }

    try {
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        const audioEl = audioRef.current;
        if (
          !audioEl ||
          typeof details.seekTime !== 'number' ||
          !Number.isFinite(details.seekTime)
        ) {
          return;
        }
        const boundedMax =
          Number.isFinite(audioEl.duration) && audioEl.duration > 0
            ? audioEl.duration
            : details.seekTime;
        const nextPos = Math.max(0, Math.min(boundedMax, details.seekTime));
        audioEl.currentTime = nextPos;
        setCurrentTime(nextPos);
        updateMediaPositionState(nextPos, audioEl.duration);
      });
    } catch {
      // Unsupported 'seekto' action handler on platform
    }
  }, [currentTrack, isPlaying, handleMediaPlay, handleStepTrack, updateMediaPositionState]);

  const handleImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsImporting(true);
    setAudioError(null);
    try {
      const created = await saveMusicFiles(files);
      if (created.length > 0) {
        setIsMiniDismissed(false);
        setTracks((prev) => [...prev, ...created]);
        if (!currentTrackIdRef.current) {
          setCurrentTrackId(created[0].id);
        }
        setActiveDrawerTab('playlist');
      }
    } catch {
      setAudioError('No se pudieron importar algunos archivos de audio.');
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  };

  const handleDeleteTrack = async (trackId: string) => {
    await deleteMusicTrack(trackId);
    setTracks((prev) => {
      const next = prev.filter((t) => t.id !== trackId);
      if (currentTrackId === trackId) {
        setIsPlaying(false);
        setCurrentTrackId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const handleClearLibrary = async () => {
    audioRef.current?.pause();
    await clearAllMusicTracks();
    setTracks([]);
    setCurrentTrackId(null);
    setIsPlaying(false);
  };

  const applyEqPreset = (presetId: Exclude<EqPresetId, 'custom'>) => {
    const preset = EQ_PRESETS[presetId];
    setPrefs((prev) => ({
      ...prev,
      presetId,
      bandsDb: [...preset.bandsDb] as [number, number, number, number, number],
      bassBoostDb: preset.bassBoostDb,
    }));
  };

  const handleBandChange = (index: number, db: number) => {
    setPrefs((prev) => {
      const nextBands = [...prev.bandsDb] as [number, number, number, number, number];
      nextBands[index] = db;
      return {
        ...prev,
        presetId: 'custom',
        bandsDb: nextBands,
      };
    });
  };

  const expandedModal = isExpanded ? (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-t-3xl sm:rounded-3xl border border-[#262B36] bg-[#0E1015] max-h-[92dvh] flex flex-col overflow-hidden">
        {/* Drawer Header */}
        <div className="px-5 pt-4 pb-3 border-b border-white/10 flex items-center justify-between gap-3 bg-[#12141C]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#D4FF33] text-[#0A0B0D] flex items-center justify-center shrink-0">
              <Music2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#D4FF33]">
                Reproductor Offline · Motor Audio EQ
              </p>
              <p className="text-sm font-extrabold text-white truncate">
                {currentTrack ? currentTrack.title : 'Sin pista cargada'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            aria-label="Minimizar reproductor"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Now Playing Controls & Scrubber */}
          <div className="rounded-3xl border border-[#222631] bg-[#13161F] p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-extrabold text-white truncate">
                  {currentTrack ? currentTrack.title : 'Carga tu música local'}
                </p>
                <p className="text-xs text-zinc-400 truncate mt-0.5">
                  {currentTrack
                    ? `${currentTrack.artist} · ${currentTrack.fileName}`
                    : 'MP3, M4A, FLAC, WAV o OGG guardados en el dispositivo'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                className="min-h-[44px] shrink-0 inline-flex items-center gap-1.5 rounded-2xl bg-[#D4FF33] px-3.5 text-xs font-extrabold text-[#0A0B0D] active:scale-95"
              >
                <FolderPlus className="w-4 h-4" />
                {isImporting ? 'Cargando...' : 'Cargar audio'}
              </button>
            </div>

            {audioError && (
              <p role="alert" className="text-xs font-semibold text-rose-400">
                {audioError}
              </p>
            )}

            {/* Scrubber */}
            <div className="space-y-1">
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.floor(duration))}
                value={Math.min(Math.floor(currentTime), Math.floor(duration || 1))}
                disabled={!currentTrack || duration <= 0}
                onChange={(e) => {
                  const nextTime = Number(e.target.value);
                  if (audioRef.current) {
                    audioRef.current.currentTime = nextTime;
                    updateMediaPositionState(nextTime, audioRef.current.duration);
                  }
                  setCurrentTime(nextTime);
                }}
                aria-label="Posición de la pista"
                className="w-full accent-[#D4FF33]"
              />
              <div className="flex justify-between text-[11px] font-mono tabular-nums text-zinc-400">
                <span>{formatAudioTime(currentTime)}</span>
                <span>{formatAudioTime(duration)}</span>
              </div>
            </div>

            {/* Transport Buttons */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  setPrefs((p) => ({ ...p, shuffle: !p.shuffle }))
                }
                aria-label="Modo aleatorio"
                aria-pressed={prefs.shuffle}
                className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border ${
                  prefs.shuffle
                    ? 'border-[#D4FF33] bg-[#D4FF33]/15 text-[#D4FF33]'
                    : 'border-[#252A36] bg-[#0D0F14] text-zinc-400'
                }`}
              >
                <Shuffle className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleStepTrack(-1)}
                  disabled={tracks.length === 0}
                  aria-label="Pista anterior"
                  className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-2xl border border-[#272C38] bg-[#181C26] text-white disabled:opacity-40 active:scale-95"
                >
                  <SkipBack className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleTogglePlay()}
                  aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
                  className="min-h-[56px] min-w-[64px] flex items-center justify-center rounded-2xl bg-[#D4FF33] text-[#0A0B0D] active:scale-95"
                >
                  {isPlaying ? (
                    <Pause className="w-6 h-6 fill-current" />
                  ) : (
                    <Play className="w-6 h-6 fill-current" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleStepTrack(1)}
                  disabled={tracks.length === 0}
                  aria-label="Pista siguiente"
                  className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-2xl border border-[#272C38] bg-[#181C26] text-white disabled:opacity-40 active:scale-95"
                >
                  <SkipForward className="w-5 h-5" />
                </button>
              </div>

              <button
                type="button"
                onClick={() =>
                  setPrefs((p) => ({ ...p, repeatAll: !p.repeatAll }))
                }
                aria-label="Repetir lista"
                aria-pressed={prefs.repeatAll}
                className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border ${
                  prefs.repeatAll
                    ? 'border-[#D4FF33] bg-[#D4FF33]/15 text-[#D4FF33]'
                    : 'border-[#252A36] bg-[#0D0F14] text-zinc-400'
                }`}
              >
                <Repeat className="w-4 h-4" />
              </button>
            </div>

            {/* Master Volume */}
            <div className="flex items-center gap-3 pt-1">
              <Volume2 className="w-4 h-4 text-zinc-400 shrink-0" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={prefs.volume}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, volume: Number(e.target.value) }))
                }
                aria-label="Volumen maestro"
                className="flex-1 accent-[#D4FF33]"
              />
              <span className="text-xs font-mono tabular-nums text-zinc-300 w-9 text-right">
                {Math.round(prefs.volume * 100)}%
              </span>
            </div>
          </div>

          {/* Drawer Sub-Tabs: EQ vs Playlist */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-[#161922] border border-[#242936]">
            <button
              type="button"
              onClick={() => setActiveDrawerTab('eq')}
              className={`min-h-[44px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                activeDrawerTab === 'eq'
                  ? 'bg-[#D4FF33] text-[#0A0B0D]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Sliders className="w-4 h-4" />
              Ecualizador 5 bandas
            </button>
            <button
              type="button"
              onClick={() => setActiveDrawerTab('playlist')}
              className={`min-h-[44px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                activeDrawerTab === 'playlist'
                  ? 'bg-[#D4FF33] text-[#0A0B0D]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <ListMusic className="w-4 h-4" />
              Lista offline ({tracks.length})
            </button>
          </div>

          {activeDrawerTab === 'eq' ? (
            <div className="rounded-3xl border border-[#222631] bg-[#13161F] p-4 space-y-4">
              {/* Presets */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-300">
                    Presets de sonido
                  </span>
                  <span className="text-[11px] font-mono text-[#D4FF33]">
                    {prefs.presetId === 'custom'
                      ? 'Personalizado'
                      : EQ_PRESETS[prefs.presetId].label}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    Object.keys(EQ_PRESETS) as Exclude<EqPresetId, 'custom'>[]
                  ).map((id) => {
                    const active = prefs.presetId === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => applyEqPreset(id)}
                        className={`min-h-[38px] px-3 rounded-xl text-xs font-bold border transition-colors ${
                          active
                            ? 'border-[#D4FF33] bg-[#D4FF33] text-[#0A0B0D]'
                            : 'border-[#272C38] bg-[#0E1015] text-zinc-300 hover:text-white'
                        }`}
                      >
                        {EQ_PRESETS[id].label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live Audio Spectrum Visualizer Canvas */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                  <span>Espectro en tiempo real</span>
                  <span>
                    {lowPower.isLowPower ? 'Bajo consumo (~15 fps)' : '60 fps'}
                  </span>
                </div>
                <canvas
                  ref={eqCanvasRef}
                  width={360}
                  height={56}
                  aria-label="Visualizador de espectro del ecualizador"
                  className="w-full h-14 rounded-2xl border border-[#20242F] bg-[#0B0D12]"
                />
              </div>

              {/* 5-Band Graphic Equalizer Sliders */}
              <div className="grid grid-cols-5 gap-2 pt-1">
                {EQ_BAND_FREQS.map((band, idx) => {
                  const val = prefs.bandsDb[idx] ?? 0;
                  return (
                    <div
                      key={band.freq}
                      className="flex flex-col items-center gap-2 rounded-2xl border border-[#20242F] bg-[#0D0F14] py-3 px-1.5"
                    >
                      <span className="text-[11px] font-mono font-bold text-[#D4FF33]">
                        {val > 0 ? `+${val}` : val} dB
                      </span>
                      <div className="h-28 flex items-center justify-center">
                        <input
                          type="range"
                          min={-12}
                          max={12}
                          step={1}
                          value={val}
                          onChange={(e) =>
                            handleBandChange(idx, Number(e.target.value))
                          }
                          aria-label={`Banda ${band.label}`}
                          style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                          className="h-24 w-6 accent-[#D4FF33] cursor-pointer"
                        />
                      </div>
                      <span className="text-[10px] font-mono text-zinc-400">
                        {band.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Bass Boost Knob / Slider */}
              <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white">
                    Bass Boost (Sub-graves 80 Hz)
                  </span>
                  <span className="font-mono font-extrabold text-[#D4FF33]">
                    +{prefs.bassBoostDb} dB
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={12}
                  step={1}
                  value={prefs.bassBoostDb}
                  onChange={(e) =>
                    setPrefs((p) => ({
                      ...p,
                      presetId: 'custom',
                      bassBoostDb: Number(e.target.value),
                    }))
                  }
                  aria-label="Bass Boost"
                  className="w-full accent-[#D4FF33]"
                />
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-[#222631] bg-[#13161F] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-zinc-300">
                  Biblioteca guardada sin internet
                </p>
                {tracks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleClearLibrary()}
                    className="min-h-[36px] inline-flex items-center gap-1 rounded-xl px-2.5 text-[11px] font-semibold text-zinc-400 hover:text-rose-400"
                  >
                    <X className="w-3.5 h-3.5" />
                    Vaciar lista
                  </button>
                )}
              </div>

              {tracks.length === 0 ? (
                <div className="py-8 text-center space-y-3">
                  <p className="text-sm text-zinc-400">
                    Aún no has cargado archivos de audio desde tu dispositivo.
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[46px] inline-flex items-center gap-2 rounded-2xl bg-[#D4FF33] px-5 text-xs font-extrabold text-[#0A0B0D]"
                  >
                    <FolderPlus className="w-4 h-4" />
                    Seleccionar MP3 / M4A / FLAC / WAV
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-white/5 max-h-64 overflow-y-auto pr-1">
                  {tracks.map((track) => {
                    const active = currentTrack?.id === track.id;
                    return (
                      <div
                        key={track.id}
                        className="py-2.5 flex items-center justify-between gap-2"
                      >
                        <button
                          type="button"
                          onClick={() => void playTrackById(track.id)}
                          className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                        >
                          <div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                              active
                                ? 'bg-[#D4FF33] text-[#0A0B0D]'
                                : 'bg-[#1B1F2A] text-zinc-400'
                            }`}
                          >
                            {active && isPlaying ? (
                              <Pause className="w-3.5 h-3.5 fill-current" />
                            ) : (
                              <Play className="w-3.5 h-3.5 fill-current" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p
                              className={`text-sm font-bold truncate ${
                                active ? 'text-[#D4FF33]' : 'text-white'
                              }`}
                            >
                              {track.title}
                            </p>
                            <p className="text-[11px] text-zinc-400 truncate">
                              {track.artist} · {(track.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                            </p>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleDeleteTrack(track.id)}
                          aria-label={`Eliminar ${track.title}`}
                          className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-500 hover:text-rose-400 shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {/* Hidden audio element & file input */}
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={() => {
          if (audioRef.current) {
            const t = audioRef.current.currentTime;
            setCurrentTime(t);
            const whole = Math.floor(t);
            if (whole !== lastPositionReportSecRef.current) {
              lastPositionReportSecRef.current = whole;
              updateMediaPositionState(t, audioRef.current.duration);
            }
          }
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) {
            const d = audioRef.current.duration || 0;
            setDuration(d);
            lastPositionReportSecRef.current = -1;
            updateMediaPositionState(audioRef.current.currentTime, d);
          }
        }}
        onEnded={() => {
          if (prefsRef.current.repeatAll || tracksRef.current.length > 1) {
            handleStepTrack(1);
          } else {
            setIsPlaying(false);
          }
        }}
        onPlay={() => {
          setIsPlaying(true);
          if (audioRef.current) {
            updateMediaPositionState(
              audioRef.current.currentTime,
              audioRef.current.duration,
            );
          }
        }}
        onPause={() => setIsPlaying(false)}
        onError={() => {
          setIsPlaying(false);
          setAudioError('Formato no soportado por el navegador en esta pista.');
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,.m4a,.flac,.wav,.ogg,.aac,audio/*"
        multiple
        onChange={handleImportFiles}
        className="hidden"
      />

      {/* Unified Flow Mini-Player Bar inside bottom container (never fixed independently) */}
      {isMiniBarVisible && (
        <div
          role="region"
          aria-label="Reproductor local de música"
          className="w-full border-t border-[#1E222B] bg-[#111319]/95"
        >
          <div className="max-w-5xl mx-auto px-3 sm:px-6 h-[54px] flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="flex items-center gap-2.5 min-w-0 flex-1 text-left py-1"
            >
              <div className="w-8 h-8 rounded-xl bg-[#D4FF33]/15 border border-[#D4FF33]/35 flex items-center justify-center shrink-0">
                <Music2 className="w-4 h-4 text-[#D4FF33]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-white truncate">
                  {currentTrack ? currentTrack.title : 'Música Offline (EQ)'}
                </p>
                <p className="text-[10px] text-zinc-400 truncate">
                  {duckFactor !== null && isPlaying
                    ? 'Audio al 20% · Coach hablando'
                    : currentTrack
                      ? `${currentTrack.artist} · ${
                          prefs.presetId === 'custom'
                            ? 'EQ Custom'
                            : EQ_PRESETS[prefs.presetId].label
                        }`
                      : 'Toca para cargar MP3/FLAC/WAV locales'}
                </p>
              </div>
            </button>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => handleStepTrack(-1)}
                disabled={tracks.length === 0}
                aria-label="Pista anterior"
                className="min-h-[40px] min-w-[34px] flex items-center justify-center rounded-xl text-zinc-300 hover:text-white disabled:opacity-35 active:scale-95"
              >
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => void handleTogglePlay()}
                aria-label={isPlaying ? 'Pausar música' : 'Reproducir música'}
                className="min-h-[38px] min-w-[40px] flex items-center justify-center rounded-xl bg-[#D4FF33] text-[#0A0B0D] active:scale-95"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current" />
                )}
              </button>
              <button
                type="button"
                onClick={() => handleStepTrack(1)}
                disabled={tracks.length === 0}
                aria-label="Pista siguiente"
                className="min-h-[40px] min-w-[34px] flex items-center justify-center rounded-xl text-zinc-300 hover:text-white disabled:opacity-35 active:scale-95"
              >
                <SkipForward className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                aria-label="Expandir reproductor y ecualizador"
                className="min-h-[40px] min-w-[34px] flex items-center justify-center rounded-xl border border-[#252A36] bg-[#171A23] text-zinc-200 hover:text-[#D4FF33]"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsMiniDismissed(true)}
                aria-label="Ocultar mini-reproductor"
                title="Ocultar barra"
                className="min-h-[40px] min-w-[30px] flex items-center justify-center rounded-xl text-zinc-500 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expanded z-50 modal rendered into document.body so it sits above z-40 dock */}
      {expandedModal &&
        (typeof document !== 'undefined'
          ? createPortal(expandedModal, document.body)
          : expandedModal)}
    </>
  );
};
