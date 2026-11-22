import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Flame,
  HeartHandshake,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useHardwareManager } from '../hooks/useHardwareManager';
import {
  type PersonalCoachContext,
  askPersonalCoachAi,
  generateOfflinePersonalCoachReply,
} from '../lib/aiClient';
import {
  cancelCoachSpeech,
  speakCoachCue,
} from '../lib/voiceCoach';
import type { CoachChatMessage, CoachPersonality } from '../types/fitness';

interface PersonalCoachCardProps {
  profileKey: string;
  personality: CoachPersonality;
  chatHistory: CoachChatMessage[];
  preferredVoiceUri?: string;
  context: PersonalCoachContext;
  onUpdateCoachState: (
    personality: CoachPersonality,
    nextHistory: CoachChatMessage[],
  ) => void;
}

const QUICK_PROMPTS = [
  'Tuve cambio de turno hoy',
  'Estoy muy cansado',
  '¿Qué priorizo hoy?',
];

export const PersonalCoachCard: React.FC<PersonalCoachCardProps> = ({
  profileKey,
  personality,
  chatHistory,
  preferredVoiceUri,
  context,
  onUpdateCoachState,
}) => {
  const hardware = useHardwareManager();
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [localPreviewReply, setLocalPreviewReply] = useState<CoachChatMessage | null>(null);
  const speechCheckTimerRef = useRef<number | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const lastCoachMessage = useMemo(() => {
    for (let i = chatHistory.length - 1; i >= 0; i -= 1) {
      if (chatHistory[i].role === 'coach') return chatHistory[i];
    }
    return null;
  }, [chatHistory]);

  // Instant deterministic briefing whenever history is empty or personality changes before querying Gemini
  const activeBriefing = useMemo<CoachChatMessage>(() => {
    if (localPreviewReply && localPreviewReply.personality === personality) {
      return localPreviewReply;
    }
    if (lastCoachMessage && lastCoachMessage.personality === personality) {
      return lastCoachMessage;
    }
    const offline = generateOfflinePersonalCoachReply(context, chatHistory);
    return {
      id: `preview_${profileKey}_${personality}`,
      role: 'coach',
      text: offline.reply,
      headline: offline.headline,
      goodBullets: offline.goodBullets,
      weakBullets: offline.weakBullets,
      actionTip: offline.actionTip,
      personality,
      source: offline.source,
      createdAt: new Date().toISOString(),
    };
  }, [localPreviewReply, lastCoachMessage, personality, context, chatHistory, profileKey]);

  // Reset transient preview when switching profile
  useEffect(() => {
    setLocalPreviewReply(null);
    setInputText('');
    cancelCoachSpeech();
    hardware.releaseAudioFocus('tts');
    setIsSpeaking(false);
  }, [profileKey, hardware]);

  // Cleanup speech monitor timer on unmount
  useEffect(() => {
    return () => {
      if (speechCheckTimerRef.current !== null) {
        window.clearInterval(speechCheckTimerRef.current);
        speechCheckTimerRef.current = null;
      }
      cancelCoachSpeech();
      hardware.releaseAudioFocus('tts');
    };
  }, [hardware]);

  // Auto-scroll mini-chat to newest message
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatHistory.length]);

  const stopCoachVoice = () => {
    if (speechCheckTimerRef.current !== null) {
      window.clearInterval(speechCheckTimerRef.current);
      speechCheckTimerRef.current = null;
    }
    cancelCoachSpeech();
    hardware.releaseAudioFocus('tts');
    setIsSpeaking(false);
  };

  const handleToggleSpeak = () => {
    if (isSpeaking) {
      stopCoachVoice();
      return;
    }

    const speechBody = [
      activeBriefing.headline ? `${activeBriefing.headline}.` : '',
      activeBriefing.text,
      activeBriefing.actionTip ? `Acción de hoy: ${activeBriefing.actionTip}` : '',
    ]
      .filter(Boolean)
      .join(' ');

    hardware.requestAudioFocus('tts');
    const started = speakCoachCue(speechBody, {
      enabled: true,
      muted: false,
      preferredVoiceUri,
    });

    if (!started) {
      hardware.releaseAudioFocus('tts');
      setIsSpeaking(false);
      return;
    }

    setIsSpeaking(true);
    if (speechCheckTimerRef.current !== null) {
      window.clearInterval(speechCheckTimerRef.current);
    }
    const startedAt = Date.now();
    speechCheckTimerRef.current = window.setInterval(() => {
      const synthSpeaking =
        typeof window !== 'undefined' && 'speechSynthesis' in window
          ? window.speechSynthesis.speaking
          : false;
      const elapsed = Date.now() - startedAt;
      if ((!synthSpeaking && elapsed > 900) || elapsed > 25000) {
        if (speechCheckTimerRef.current !== null) {
          window.clearInterval(speechCheckTimerRef.current);
          speechCheckTimerRef.current = null;
        }
        hardware.releaseAudioFocus('tts');
        setIsSpeaking(false);
      }
    }, 350);
  };

  const requestCoachBriefing = async (
    targetPersonality: CoachPersonality,
    userMessage?: string,
  ) => {
    const cleanMsg = userMessage?.trim();
    setIsLoading(true);
    setCoachError(null);
    stopCoachVoice();

    const nowIso = new Date().toISOString();
    let workingHistory = [...chatHistory];

    if (cleanMsg) {
      const userEntry: CoachChatMessage = {
        id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        text: cleanMsg,
        personality: targetPersonality,
        createdAt: nowIso,
      };
      workingHistory = [...workingHistory, userEntry].slice(-6);
      setInputText('');
      onUpdateCoachState(targetPersonality, workingHistory);
    }

    try {
      const result = await askPersonalCoachAi({
        context: {
          ...context,
          personality: targetPersonality,
        },
        personality: targetPersonality,
        history: workingHistory,
        userMessage: cleanMsg,
      });

      const coachEntry: CoachChatMessage = {
        id: `coach_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'coach',
        text: result.reply,
        headline: result.headline,
        goodBullets: result.goodBullets,
        weakBullets: result.weakBullets,
        actionTip: result.actionTip,
        personality: targetPersonality,
        source: result.source,
        createdAt: new Date().toISOString(),
      };

      setLocalPreviewReply(coachEntry);
      const nextHistory = [...workingHistory, coachEntry].slice(-6);
      onUpdateCoachState(targetPersonality, nextHistory);
    } catch (err) {
      setCoachError(
        err instanceof Error
          ? err.message
          : 'No se pudo consultar al Coach IA en el servidor.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectPersonality = (nextPersonality: CoachPersonality) => {
    if (nextPersonality === personality) return;
    stopCoachVoice();
    const immediate = generateOfflinePersonalCoachReply(
      { ...context, personality: nextPersonality },
      chatHistory,
    );
    setLocalPreviewReply({
      id: `switch_${Date.now()}`,
      role: 'coach',
      text: immediate.reply,
      headline: immediate.headline,
      goodBullets: immediate.goodBullets,
      weakBullets: immediate.weakBullets,
      actionTip: immediate.actionTip,
      personality: nextPersonality,
      source: immediate.source,
      createdAt: new Date().toISOString(),
    });
    onUpdateCoachState(nextPersonality, chatHistory);
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    void requestCoachBriefing(personality, inputText);
  };

  const isSargento = personality === 'sargento';

  return (
    <section
      aria-label="Coach IA Personal"
      className={`rounded-3xl border p-4 sm:p-5 space-y-4 transition-colors ${
        isSargento
          ? 'border-amber-400/35 bg-gradient-to-br from-[#171412] via-[#12141A] to-[#101218]'
          : 'border-emerald-400/35 bg-gradient-to-br from-[#101916] via-[#12141A] to-[#101218]'
      }`}
    >
      {/* Top Header + Personality Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-10 h-10 rounded-2xl border flex items-center justify-center shrink-0 ${
              isSargento
                ? 'border-amber-400/45 bg-amber-500/15 text-amber-300'
                : 'border-emerald-400/45 bg-emerald-500/15 text-emerald-300'
            }`}
          >
            {isSargento ? <Flame className="w-5 h-5" /> : <HeartHandshake className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-base sm:text-lg font-extrabold font-display text-white">
                Coach IA Personal
              </h2>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                  activeBriefing.source === 'gemini'
                    ? 'bg-[#D4FF33]/15 text-[#D4FF33] border border-[#D4FF33]/35'
                    : 'bg-zinc-800 text-zinc-300 border border-white/10'
                }`}
              >
                {activeBriefing.source === 'gemini' ? 'Gemini IA' : 'Modo Local'}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 truncate">
              {isSargento
                ? 'Sargento sin filtros · Cero excusas y carrilla directa'
                : 'Modo Motivador · Acompañamiento firme y adaptado'}
            </p>
          </div>
        </div>

        {/* Personality Toggle */}
        <div
          role="group"
          aria-label="Personalidad del Coach IA"
          className="grid grid-cols-2 gap-1 rounded-2xl border border-[#262B38] bg-[#0B0D12] p-1 shrink-0"
        >
          <button
            type="button"
            onClick={() => handleSelectPersonality('sargento')}
            className={`min-h-[34px] px-3 rounded-xl text-[11px] font-extrabold transition-colors whitespace-nowrap ${
              isSargento
                ? 'bg-amber-400 text-[#0A0B0D]'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Sargento
          </button>
          <button
            type="button"
            onClick={() => handleSelectPersonality('motivador')}
            className={`min-h-[34px] px-3 rounded-xl text-[11px] font-extrabold transition-colors whitespace-nowrap ${
              !isSargento
                ? 'bg-emerald-400 text-[#0A0B0D]'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Motivador
          </button>
        </div>
      </div>

      {/* Live Context Snapshot Pills */}
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className="rounded-lg border border-white/10 bg-[#0B0D12] px-2.5 py-1 font-mono tabular-nums text-zinc-300">
          {context.trainedToday
            ? 'Entrenó hoy ✓'
            : context.isTodayRestShield
              ? 'Descanso Escudo ✓'
              : context.daysSinceLastWorkout === null
                ? 'Sin rutinas aún'
                : `Sin entrenar: ${context.daysSinceLastWorkout}d`}
        </span>
        {context.latestWeightDisplay && (
          <span className="rounded-lg border border-white/10 bg-[#0B0D12] px-2.5 py-1 font-mono tabular-nums text-zinc-300">
            Peso: {context.latestWeightDisplay}
            {context.weightDelta7dDisplay ? ` (${context.weightDelta7dDisplay} 7d)` : ''}
          </span>
        )}
        <span className="rounded-lg border border-white/10 bg-[#0B0D12] px-2.5 py-1 font-mono tabular-nums text-sky-300">
          Agua: {context.waterPct}%
        </span>
        <span className="rounded-lg border border-white/10 bg-[#0B0D12] px-2.5 py-1 font-mono tabular-nums text-indigo-300">
          Recup: {context.recoveryIndexScore}/100
        </span>
        {context.pulseBpm !== null && (
          <span className="rounded-lg border border-white/10 bg-[#0B0D12] px-2.5 py-1 font-mono tabular-nums text-rose-300">
            {context.pulseBpm} BPM · {context.stressLabel}
          </span>
        )}
      </div>

      {/* Active Coach Message Card */}
      <div className="rounded-2xl border border-[#262B38] bg-[#0B0D12]/90 p-4 space-y-3">
        <div className="space-y-1 min-w-0">
          {activeBriefing.headline && (
            <p
              className={`text-sm font-extrabold leading-snug ${
                isSargento ? 'text-amber-300' : 'text-emerald-300'
              }`}
            >
              {activeBriefing.headline}
            </p>
          )}
          <p className="text-xs sm:text-sm text-zinc-100 leading-relaxed">
            {activeBriefing.text}
          </p>
        </div>

        {/* Multi-Tab Bullets: Qué va bien / Qué va flojo */}
        {((activeBriefing.goodBullets && activeBriefing.goodBullets.length > 0) ||
          (activeBriefing.weakBullets && activeBriefing.weakBullets.length > 0)) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {activeBriefing.goodBullets && activeBriefing.goodBullets.length > 0 && (
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-2.5 space-y-1">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400">
                  Qué va bien
                </p>
                <ul className="space-y-1 text-[11px] text-zinc-200">
                  {activeBriefing.goodBullets.map((item, idx) => (
                    <li key={`g_${idx}`} className="flex items-start gap-1.5 leading-snug">
                      <span className="text-emerald-400 font-bold shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {activeBriefing.weakBullets && activeBriefing.weakBullets.length > 0 && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-2.5 space-y-1">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-300">
                  Qué va flojo
                </p>
                <ul className="space-y-1 text-[11px] text-zinc-200">
                  {activeBriefing.weakBullets.map((item, idx) => (
                    <li key={`w_${idx}`} className="flex items-start gap-1.5 leading-snug">
                      <span className="text-amber-300 font-bold shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {activeBriefing.actionTip && (
          <div className="rounded-xl border border-[#D4FF33]/25 bg-[#141720] px-3 py-2 flex items-start gap-2 text-xs">
            <Sparkles className="w-3.5 h-3.5 text-[#D4FF33] shrink-0 mt-0.5" />
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#D4FF33] mr-1.5">
                Siguiente acción:
              </span>
              <span className="text-zinc-100 font-semibold">{activeBriefing.actionTip}</span>
            </div>
          </div>
        )}

        {/* Voice Playback (es-MX + Audio Ducking) & Refresh Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={handleToggleSpeak}
            className={`min-h-[38px] inline-flex items-center gap-1.5 rounded-xl px-3.5 text-xs font-extrabold transition-colors active:scale-[0.98] ${
              isSpeaking
                ? 'bg-rose-500/20 border border-rose-400/50 text-rose-200'
                : 'bg-[#D4FF33] text-[#0A0B0D]'
            }`}
          >
            {isSpeaking ? (
              <>
                <VolumeX className="w-4 h-4 shrink-0" />
                Detener voz
              </>
            ) : (
              <>
                <Volume2 className="w-4 h-4 shrink-0" />
                Escuchar (es-MX)
              </>
            )}
          </button>

          <button
            type="button"
            disabled={isLoading}
            onClick={() => void requestCoachBriefing(personality)}
            className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-[#2A2F3D] bg-[#151821] px-3 text-xs font-bold text-zinc-200 hover:border-[#D4FF33]/50 disabled:opacity-60"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D4FF33]" />
                Analizando...
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5 text-[#D4FF33]" />
                Nuevo análisis
              </>
            )}
          </button>
        </div>

        {coachError && (
          <p
            role="alert"
            className="rounded-xl border border-rose-500/35 bg-rose-950/25 px-3 py-2 text-xs font-semibold text-rose-300"
          >
            {coachError}
          </p>
        )}
      </div>

      {/* Mini-Chat Memory (Last 6 messages persisted per profile in IndexedDB) */}
      <div className="space-y-2.5">
        {chatHistory.length > 0 && (
          <div
            ref={chatScrollRef}
            className="max-h-44 overflow-y-auto space-y-2 pr-1"
            aria-label="Historial reciente con el Coach"
          >
            {chatHistory.slice(-6).map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-[#D4FF33] text-[#0A0B0D] font-bold'
                      : 'border border-[#262B38] bg-[#141720] text-zinc-200'
                  }`}
                >
                  {msg.role === 'coach' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-zinc-400 mr-1.5">
                      <Bot className="w-3 h-3 text-[#D4FF33]" />
                      {msg.personality === 'sargento' ? 'Sargento' : 'Coach'}:
                    </span>
                  )}
                  <span>{msg.text}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Quick Context Reply Chips */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={isLoading}
              onClick={() => void requestCoachBriefing(personality, chip)}
              className="min-h-[30px] rounded-xl border border-[#262B38] bg-[#0B0D12] px-2.5 text-[11px] font-semibold text-zinc-300 hover:border-[#D4FF33]/50 hover:text-white disabled:opacity-50 transition-colors"
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Mini-Chat Input */}
        <form onSubmit={handleSendChat} className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Cuéntale al Coach (ej. cambié de turno o dormí poco)..."
            maxLength={220}
            className="flex-1 min-w-0 min-h-[42px] rounded-2xl border border-[#262B38] bg-[#0B0D12] px-3.5 text-xs text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isLoading}
            aria-label="Enviar mensaje al Coach"
            className="min-h-[42px] min-w-[44px] rounded-2xl bg-[#D4FF33] text-[#0A0B0D] flex items-center justify-center disabled:opacity-40 active:scale-[0.98] transition-transform"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
      </div>
    </section>
  );
};
