import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as webpush from 'web-push';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

function getGeminiClient(): {
  ai: GoogleGenAI;
  keySource: 'server';
} {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Falta configurar GEMINI_API_KEY en el servidor (Settings > Secrets).',
    );
  }

  return {
    ai: new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    }),
    keySource: 'server',
  };
}

const MUSCLE_ENUM = [
  'pecho',
  'espalda',
  'hombros',
  'biceps',
  'triceps',
  'cuadriceps',
  'isquiotibiales',
  'gluteos',
  'pantorrillas',
  'abdomen',
];

interface PushPreferences {
  smartRemindersEnabled: boolean;
  waterEnabled: boolean;
  waterIntervalMin: number;
  waterStartTime: string;
  waterEndTime: string;
  workoutEnabled: boolean;
  workoutDays: number[];
  workoutTime: string;
  timeZone?: string;
}

interface SerializedPushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface StoredPushSubscription {
  id: string;
  profileId: string;
  endpoint: string;
  subscription: SerializedPushSubscription;
  preferences: PushPreferences;
  lastWaterTimestamp: number;
  lastWaterNotifiedAt: number;
  lastWorkoutDate: string | null;
  lastWorkoutNotifiedDate: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PushStoreData {
  vapidKeys: {
    publicKey: string;
    privateKey: string;
  };
  subscriptions: StoredPushSubscription[];
}

const PUSH_DATA_DIR = path.resolve(__dirname, 'data');
const PUSH_STORE_FILE = path.join(PUSH_DATA_DIR, 'push-store.json');

const DEFAULT_PUSH_PREFERENCES: PushPreferences = {
  smartRemindersEnabled: false,
  waterEnabled: false,
  waterIntervalMin: 90,
  waterStartTime: '08:00',
  waterEndTime: '22:00',
  workoutEnabled: false,
  workoutDays: [1, 2, 3, 4, 5],
  workoutTime: '18:00',
};

function sanitizeTimeHHMM(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const match = /^(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!match) return fallback;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function parseHHMMToMinutes(hhmm: string, fallbackMin: number): number {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return fallbackMin;
  return Number(match[1]) * 60 + Number(match[2]);
}

function sanitizeTimeZone(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const candidate = raw.trim().slice(0, 80);
  try {
    Intl.DateTimeFormat('en-CA', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return undefined;
  }
}

function sanitizeProfileId(raw: unknown): string {
  if (typeof raw !== 'string') return 'main';
  const cleaned = raw.trim().slice(0, 64);
  return cleaned || 'main';
}

function sanitizePushPreferences(raw: unknown): PushPreferences {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const intervalRaw = Number(obj.waterIntervalMin);
  const waterIntervalMin = Number.isFinite(intervalRaw)
    ? Math.max(15, Math.min(360, Math.round(intervalRaw)))
    : DEFAULT_PUSH_PREFERENCES.waterIntervalMin;

  const daysRaw = Array.isArray(obj.workoutDays)
    ? obj.workoutDays
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : DEFAULT_PUSH_PREFERENCES.workoutDays;
  const workoutDays = Array.from(new Set(daysRaw)).sort((a, b) => a - b);

  const smartRemindersEnabled =
    typeof obj.smartRemindersEnabled === 'boolean'
      ? obj.smartRemindersEnabled
      : Boolean(obj.waterEnabled);
  const waterEnabled =
    typeof obj.waterEnabled === 'boolean' ? obj.waterEnabled : smartRemindersEnabled;

  return {
    smartRemindersEnabled,
    waterEnabled,
    waterIntervalMin,
    waterStartTime: sanitizeTimeHHMM(obj.waterStartTime, DEFAULT_PUSH_PREFERENCES.waterStartTime),
    waterEndTime: sanitizeTimeHHMM(obj.waterEndTime, DEFAULT_PUSH_PREFERENCES.waterEndTime),
    workoutEnabled: Boolean(obj.workoutEnabled),
    workoutDays: workoutDays.length > 0 ? workoutDays : DEFAULT_PUSH_PREFERENCES.workoutDays,
    workoutTime: sanitizeTimeHHMM(obj.workoutTime, DEFAULT_PUSH_PREFERENCES.workoutTime),
    timeZone: sanitizeTimeZone(obj.timeZone),
  };
}

function validatePushSubscription(raw: unknown): SerializedPushSubscription | null {
  if (!raw || typeof raw !== 'object') return null;
  const sub = raw as Record<string, unknown>;
  if (typeof sub.endpoint !== 'string' || !sub.endpoint.trim()) return null;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sub.endpoint.trim());
  } catch {
    return null;
  }
  const isLocalHttp =
    parsedUrl.protocol === 'http:' &&
    (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1');
  if (parsedUrl.protocol !== 'https:' && !isLocalHttp) {
    return null;
  }
  const keys =
    sub.keys && typeof sub.keys === 'object' ? (sub.keys as Record<string, unknown>) : null;
  if (
    !keys ||
    typeof keys.p256dh !== 'string' ||
    !keys.p256dh.trim() ||
    typeof keys.auth !== 'string' ||
    !keys.auth.trim()
  ) {
    return null;
  }
  return {
    endpoint: parsedUrl.toString(),
    expirationTime:
      typeof sub.expirationTime === 'number' || sub.expirationTime === null
        ? sub.expirationTime
        : null,
    keys: {
      p256dh: keys.p256dh.trim(),
      auth: keys.auth.trim(),
    },
  };
}

function getLocalClockParts(
  nowMs: number,
  timeZone?: string,
): { localDate: string; weekday: number; minutesFromMidnight: number } {
  const dt = new Date(nowMs);
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false,
      }).formatToParts(dt);
      const map: Record<string, string> = {};
      for (const p of parts) {
        if (p.type !== 'literal') map[p.type] = p.value;
      }
      const weekdayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const hour = Number(map.hour) % 24;
      const minute = Number(map.minute);
      const localDate = `${map.year}-${map.month}-${map.day}`;
      const weekday = weekdayMap[map.weekday];
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(localDate) &&
        Number.isFinite(hour) &&
        Number.isFinite(minute) &&
        typeof weekday === 'number'
      ) {
        return {
          localDate,
          weekday,
          minutesFromMidnight: hour * 60 + minute,
        };
      }
    } catch {
      // Fallback to server local time below
    }
  }

  return {
    localDate: dt.toLocaleDateString('en-CA'),
    weekday: dt.getDay(),
    minutesFromMidnight: dt.getHours() * 60 + dt.getMinutes(),
  };
}

function isWithinTimeWindow(
  minutesFromMidnight: number,
  startHHMM: string,
  endHHMM: string,
): boolean {
  const startMin = parseHHMMToMinutes(startHHMM, 8 * 60);
  const endMin = parseHHMMToMinutes(endHHMM, 22 * 60);
  if (startMin <= endMin) {
    return minutesFromMidnight >= startMin && minutesFromMidnight <= endMin;
  }
  return minutesFromMidnight >= startMin || minutesFromMidnight <= endMin;
}

function ensurePushDataDir(): void {
  if (!fs.existsSync(PUSH_DATA_DIR)) {
    fs.mkdirSync(PUSH_DATA_DIR, { recursive: true });
  }
}

function savePushStore(store: PushStoreData): void {
  ensurePushDataDir();
  const tempPath = `${PUSH_STORE_FILE}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tempPath, PUSH_STORE_FILE);
}

function loadPushStore(): PushStoreData {
  ensurePushDataDir();
  let parsed: Partial<PushStoreData> | null = null;
  if (fs.existsSync(PUSH_STORE_FILE)) {
    try {
      const raw = fs.readFileSync(PUSH_STORE_FILE, 'utf8');
      parsed = JSON.parse(raw) as Partial<PushStoreData>;
    } catch {
      parsed = null;
    }
  }

  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  const hasStoredKeys =
    Boolean(parsed?.vapidKeys?.publicKey?.trim()) &&
    Boolean(parsed?.vapidKeys?.privateKey?.trim());

  const vapidKeys =
    envPub && envPriv
      ? { publicKey: envPub, privateKey: envPriv }
      : hasStoredKeys
        ? {
            publicKey: parsed!.vapidKeys!.publicKey.trim(),
            privateKey: parsed!.vapidKeys!.privateKey.trim(),
          }
        : webpush.generateVAPIDKeys();

  const subscriptions = Array.isArray(parsed?.subscriptions)
    ? parsed!.subscriptions
        .filter(
          (item): item is StoredPushSubscription =>
            Boolean(item && typeof item.endpoint === 'string' && item.subscription?.keys?.p256dh),
        )
        .map((item) => ({
          ...item,
          profileId: sanitizeProfileId((item as Partial<StoredPushSubscription>).profileId),
          preferences: sanitizePushPreferences(item.preferences),
        }))
    : [];

  const store: PushStoreData = {
    vapidKeys,
    subscriptions,
  };
  savePushStore(store);
  return store;
}

function hashEndpoint(endpoint: string): string {
  return crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const pushStore = loadPushStore();
  const vapidSubject = process.env.VAPID_SUBJECT?.trim() || 'mailto:soporte@pulsofit.app';
  webpush.setVapidDetails(
    vapidSubject,
    pushStore.vapidKeys.publicKey,
    pushStore.vapidKeys.privateKey,
  );

  const sendPushWithCleanup = async (
    sub: StoredPushSubscription,
    payload: { title: string; body: string; tab: string; tag: string },
  ): Promise<'sent' | 'removed' | 'error'> => {
    try {
      await webpush.sendNotification(
        sub.subscription,
        JSON.stringify({
          title: payload.title,
          body: payload.body,
          tab: payload.tab,
          tag: payload.tag,
          url: `/?tab=${encodeURIComponent(payload.tab)}`,
        }),
        { TTL: 3600 },
      );
      return 'sent';
    } catch (err) {
      const statusCode =
        err && typeof err === 'object' && 'statusCode' in err
          ? Number((err as { statusCode?: number }).statusCode)
          : 0;
      if (statusCode === 404 || statusCode === 410) {
        pushStore.subscriptions = pushStore.subscriptions.filter(
          (item) => item.endpoint !== sub.endpoint,
        );
        savePushStore(pushStore);
        return 'removed';
      }
      return 'error';
    }
  };

  app.get('/api/push/vapid-public-key', (_req, res) => {
    res.json({ publicKey: pushStore.vapidKeys.publicKey });
  });

  app.post('/api/push/subscribe', (req, res) => {
    const {
      subscription,
      preferences,
      profileId,
      lastWaterTimestamp,
      lastWorkoutDate,
    } = req.body ?? {};
    const validSub = validatePushSubscription(subscription);
    if (!validSub) {
      res.status(400).json({ error: 'Suscripción Push inválida o incompleta.' });
      return;
    }

    const resolvedProfileId = sanitizeProfileId(profileId);
    const sanitizedPrefs = sanitizePushPreferences(preferences);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const validWorkoutDate =
      typeof lastWorkoutDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(lastWorkoutDate)
        ? lastWorkoutDate
        : null;
    const incomingWaterTs =
      typeof lastWaterTimestamp === 'number' && Number.isFinite(lastWaterTimestamp)
        ? lastWaterTimestamp
        : null;

    const idx = pushStore.subscriptions.findIndex(
      (item) => item.endpoint === validSub.endpoint,
    );

    if (idx >= 0) {
      const existing = pushStore.subscriptions[idx];
      pushStore.subscriptions[idx] = {
        ...existing,
        profileId: resolvedProfileId,
        subscription: validSub,
        preferences: sanitizedPrefs,
        lastWaterTimestamp:
          incomingWaterTs !== null
            ? Math.max(existing.lastWaterTimestamp || 0, incomingWaterTs)
            : existing.lastWaterTimestamp || nowMs,
        lastWorkoutDate: validWorkoutDate ?? existing.lastWorkoutDate,
        updatedAt: nowIso,
      };
    } else {
      pushStore.subscriptions.push({
        id: hashEndpoint(validSub.endpoint),
        profileId: resolvedProfileId,
        endpoint: validSub.endpoint,
        subscription: validSub,
        preferences: sanitizedPrefs,
        lastWaterTimestamp: incomingWaterTs ?? nowMs,
        lastWaterNotifiedAt: 0,
        lastWorkoutDate: validWorkoutDate,
        lastWorkoutNotifiedDate: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }

    savePushStore(pushStore);
    res.json({
      ok: true,
      id: hashEndpoint(validSub.endpoint),
      profileId: resolvedProfileId,
      preferences: sanitizedPrefs,
    });
  });

  app.post('/api/push/unsubscribe', (req, res) => {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
    const profileId =
      typeof req.body?.profileId === 'string' && req.body.profileId.trim()
        ? sanitizeProfileId(req.body.profileId)
        : null;
    if (!endpoint && !profileId) {
      res.status(400).json({ error: 'Falta el endpoint o profileId de suscripción.' });
      return;
    }
    const before = pushStore.subscriptions.length;
    pushStore.subscriptions = pushStore.subscriptions.filter((item) => {
      if (endpoint && item.endpoint === endpoint) return false;
      if (!endpoint && profileId && item.profileId === profileId) return false;
      return true;
    });
    const removed = before - pushStore.subscriptions.length;
    if (removed > 0) {
      savePushStore(pushStore);
    }
    res.json({ ok: true, removed });
  });

  app.post('/api/push/activity-ping', (req, res) => {
    const action = req.body?.action;
    const endpoint =
      typeof req.body?.endpoint === 'string' && req.body.endpoint.trim()
        ? req.body.endpoint.trim()
        : null;
    const profileId =
      typeof req.body?.profileId === 'string' && req.body.profileId.trim()
        ? sanitizeProfileId(req.body.profileId)
        : null;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    if (action === 'reconcile') {
      const rawWaterTs = req.body?.lastWaterTimestamp;
      const nextWaterTs =
        typeof rawWaterTs === 'number' && Number.isFinite(rawWaterTs) && rawWaterTs > 0
          ? rawWaterTs
          : 0;
      const rawWorkoutDate =
        typeof req.body?.lastWorkoutDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(req.body.lastWorkoutDate.trim())
          ? req.body.lastWorkoutDate.trim()
          : undefined;

      let updated = 0;
      for (const sub of pushStore.subscriptions) {
        if (endpoint && sub.endpoint !== endpoint) continue;
        if (!endpoint && profileId && sub.profileId !== profileId) continue;
        sub.lastWaterTimestamp = nextWaterTs;
        sub.lastWorkoutDate = rawWorkoutDate ?? null;
        sub.updatedAt = nowIso;
        updated += 1;
      }
      if (updated > 0) {
        savePushStore(pushStore);
      }
      res.json({ ok: true, updated, reconciled: true });
      return;
    }

    const type = req.body?.type;
    if (type !== 'water' && type !== 'workout') {
      res.status(400).json({ error: 'Tipo de actividad inválido (water | workout).' });
      return;
    }

    const rawDate = typeof req.body?.date === 'string' ? req.body.date.trim() : '';

    let updated = 0;
    for (const sub of pushStore.subscriptions) {
      if (endpoint && sub.endpoint !== endpoint) continue;
      if (!endpoint && profileId && sub.profileId !== profileId) continue;
      if (type === 'water') {
        sub.lastWaterTimestamp = nowMs;
      } else {
        const localClock = getLocalClockParts(nowMs, sub.preferences.timeZone);
        sub.lastWorkoutDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
          ? rawDate
          : localClock.localDate;
      }
      sub.updatedAt = nowIso;
      updated += 1;
    }

    if (updated > 0) {
      savePushStore(pushStore);
    }

    res.json({ ok: true, updated });
  });

  app.post('/api/push/test', async (req, res) => {
    const endpoint =
      typeof req.body?.endpoint === 'string' && req.body.endpoint.trim()
        ? req.body.endpoint.trim()
        : null;
    const profileId =
      typeof req.body?.profileId === 'string' && req.body.profileId.trim()
        ? sanitizeProfileId(req.body.profileId)
        : null;
    const kind = req.body?.kind === 'workout' ? 'workout' : req.body?.kind === 'water' ? 'water' : 'test';

    const targets = endpoint
      ? pushStore.subscriptions.filter((item) => item.endpoint === endpoint)
      : profileId
        ? pushStore.subscriptions.filter((item) => item.profileId === profileId)
        : pushStore.subscriptions;

    if (targets.length === 0) {
      res.status(404).json({
        error: 'No hay una suscripción push activa registrada. Activa los recordatorios primero.',
      });
      return;
    }

    const payload =
      kind === 'workout'
        ? {
            title: 'PulsoFit · Hora de entrenar',
            body: 'Prueba de recordatorio de entrenamiento. Al tocar abrirás tu rutina en Entrenar.',
            tab: 'entrenar',
            tag: 'pulsofit-test-workout',
          }
        : kind === 'water'
          ? {
              title: 'PulsoFit · Hora de tomar agua',
              body: 'Prueba de recordatorio de hidratación. Al tocar irás directo a Hidratación.',
              tab: 'hidratacion',
              tag: 'pulsofit-test-water',
            }
          : {
              title: 'PulsoFit · Notificación Push activa',
              body: 'Tus recordatorios funcionarán incluso con la aplicación cerrada.',
              tab: 'hidratacion',
              tag: 'pulsofit-test-push',
            };

    let sent = 0;
    let removed = 0;
    let failed = 0;
    for (const target of [...targets]) {
      const outcome = await sendPushWithCleanup(target, payload);
      if (outcome === 'sent') sent += 1;
      else if (outcome === 'removed') removed += 1;
      else failed += 1;
    }

    if (sent === 0 && failed > 0) {
      res.status(502).json({ error: 'No se pudo entregar la notificación push al servicio del navegador.' });
      return;
    }

    res.json({ ok: true, sent, removed, failed });
  });

  let isSchedulerTickRunning = false;
  const runPushSchedulerTick = async () => {
    if (isSchedulerTickRunning || pushStore.subscriptions.length === 0) return;
    isSchedulerTickRunning = true;
    try {
      const nowMs = Date.now();
      let dirty = false;

      for (const sub of [...pushStore.subscriptions]) {
        const prefs = sub.preferences;
        const clock = getLocalClockParts(nowMs, prefs.timeZone);

        // 1. Recordatorios inteligentes (hidratación, inactividad o check-in diario)
        if (
          (prefs.smartRemindersEnabled || prefs.waterEnabled) &&
          isWithinTimeWindow(clock.minutesFromMidnight, prefs.waterStartTime, prefs.waterEndTime)
        ) {
          const minSinceWater = (nowMs - (sub.lastWaterTimestamp || 0)) / 60_000;
          const minSincePush = (nowMs - (sub.lastWaterNotifiedAt || 0)) / 60_000;
          if (
            minSinceWater >= prefs.waterIntervalMin &&
            minSincePush >= prefs.waterIntervalMin
          ) {
            const outcome = await sendPushWithCleanup(sub, {
              title: 'PulsoFit · Hora de hidratarte',
              body: `Han pasado ${Math.round(minSinceWater)} min sin registrar agua. Toma un vaso para mantener tu meta.`,
              tab: 'hidratacion',
              tag: 'pulsofit-water-reminder',
            });
            if (outcome === 'sent') {
              sub.lastWaterNotifiedAt = nowMs;
              sub.updatedAt = new Date(nowMs).toISOString();
              dirty = true;
            }
          }
        }

        // 2. Recordatorio de entrenamiento (evita notificar si ya entrenó hoy)
        if (
          prefs.workoutEnabled &&
          prefs.workoutDays.includes(clock.weekday) &&
          sub.lastWorkoutDate !== clock.localDate &&
          sub.lastWorkoutNotifiedDate !== clock.localDate
        ) {
          const targetMinutes = parseHHMMToMinutes(prefs.workoutTime, 18 * 60);
          if (
            clock.minutesFromMidnight >= targetMinutes &&
            clock.minutesFromMidnight <= targetMinutes + 45
          ) {
            const outcome = await sendPushWithCleanup(sub, {
              title: 'PulsoFit · Toca entrenar hoy',
              body: 'Aún no registras tu entrenamiento de hoy. Abre Entrenar y completa tu sesión.',
              tab: 'entrenar',
              tag: 'pulsofit-workout-reminder',
            });
            if (outcome === 'sent') {
              sub.lastWorkoutNotifiedDate = clock.localDate;
              sub.updatedAt = new Date(nowMs).toISOString();
              dirty = true;
            }
          }
        }
      }

      if (dirty) {
        savePushStore(pushStore);
      }
    } finally {
      isSchedulerTickRunning = false;
    }
  };

  setInterval(() => {
    void runPushSchedulerTick();
  }, 60_000);

  app.post('/api/ai/test', async (_req, res) => {
    try {
      const { ai, keySource } = getGeminiClient();

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: 'Responde únicamente con la palabra: OK',
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      const reply = (response.text ?? '').trim();
      if (!reply) {
        res.status(502).json({ error: 'Gemini respondió vacío durante la prueba.' });
        return;
      }

      res.json({
        ok: true,
        model: 'gemini-4-hydrogen',
        source: keySource,
        reply,
      });
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Error al probar conexión con Gemini.';
      const lower = rawMsg.toLowerCase();
      const friendly =
        lower.includes('api_key_invalid') || lower.includes('api key not valid')
          ? 'La API Key de Google Gemini configurada en el servidor no es válida.'
          : lower.includes('permission_denied') || lower.includes('403')
            ? 'Permiso denegado para la API Key de Gemini en el servidor.'
            : rawMsg;
      res.status(lower.includes('falta configurar') ? 500 : 502).json({ error: friendly });
    }
  });

  app.post('/api/coach/tts', async (req, res) => {
    try {
      const { text } = req.body ?? {};
      if (!text || typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ error: 'Se requiere texto para sintetizar voz.' });
        return;
      }

      const { ai } = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: text.trim().slice(0, 600),
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const audioPart = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!audioPart?.data) {
        res.status(502).json({ error: 'Gemini TTS no devolvió audio.' });
        return;
      }

      res.json({
        audioBase64: audioPart.data,
        mimeType: audioPart.mimeType || 'audio/wav',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al sintetizar voz con Gemini.';
      res.status(message.includes('GEMINI_API_KEY') ? 400 : 502).json({ error: message });
    }
  });

  app.post('/api/workout/generate', async (req, res) => {
    try {
      const { profile, fatigueMap, recentLoads, readiness } = req.body ?? {};
      if (!profile || !fatigueMap) {
        res.status(400).json({ error: 'Se requieren los datos de perfil y recuperación muscular.' });
        return;
      }

      const { ai } = getGeminiClient();

      const weightUnit = profile.weightUnit === 'lb' ? 'lb' : 'kg';
      const distanceUnit = profile.distanceUnit === 'mi' ? 'mi' : 'km';
      const liquidUnit = profile.liquidUnit === 'oz' ? 'oz' : 'ml';
      const displayWeight =
        weightUnit === 'lb'
          ? `${Math.round(Number(profile.weightKg || 75) * 2.20462 * 2) / 2} lb`
          : `${profile.weightKg} kg`;

      const readinessNote = readiness
        ? `Recuperación / Check-in de hoy: índice ${readiness.score}/100, sueño ${readiness.sleepHours}h (calidad ${readiness.sleepQuality}/5), energía ${readiness.energyLevel}/5, dolor muscular ${readiness.sorenessLevel}/5.`
        : '';

      const prompt = [
        'Eres un entrenador experto en fuerza, hipertrofia y periodización (estilo Fitbod).',
        'Genera una rutina de entrenamiento completa para HOY en español, priorizando los grupos musculares más recuperados (menor porcentaje de fatiga) y respetando estrictamente el equipo disponible del usuario.',
        '',
        `Preferencias de unidades del usuario: peso en ${weightUnit}, distancia en ${distanceUnit}, líquidos en ${liquidUnit}.`,
        `Perfil del atleta: ${JSON.stringify({
          pesoActual: displayWeight,
          pesoKgInterno: profile.weightKg,
          alturaCm: profile.heightCm,
          edad: profile.age,
          sexo: profile.sex,
          objetivo: profile.goal,
          diasPorSemana: profile.trainingDaysPerWeek,
          equipoDisponible: profile.equipment,
        })}`,
        '',
        `Fatiga muscular actual (0% = totalmente descansado, 100% = fatiga máxima): ${JSON.stringify(fatigueMap)}`,
        ...(readinessNote ? ['', readinessNote] : []),
        '',
        recentLoads && Object.keys(recentLoads).length > 0
          ? `Cargas recientes del usuario (úsalas para sugerir sobrecarga progresiva realista): ${JSON.stringify(recentLoads)}`
          : 'El usuario aún no tiene historial previo de cargas; sugiere pesos iniciales seguros y acordes a su peso corporal y sexo.',
        '',
        'Reglas obligatorias:',
        '1. Incluye 3 ejercicios breves de calentamiento específico (movilidad + activación) antes de la sesión principal.',
        '2. Incluye entre 4 y 6 ejercicios principales adaptados al equipo disponible. Si solo tiene peso corporal o ligas, suggestedWeightKg debe ser 0.',
        '3. Evita trabajar como músculo primario los grupos que tengan >= 70% de fatiga, salvo que todos estén fatigados.',
        '4. Cada ejercicio debe incluir primaryMuscles y secondaryMuscles usando únicamente valores del enum permitido.',
        `5. En las explicaciones (rationale, notes) menciona siempre las cargas o recomendaciones usando la unidad preferida del usuario (${weightUnit}). El campo numérico suggestedWeightKg debe expresarse siempre en kilogramos (kg) para almacenamiento interno.`,
        '6. Responde siempre en español natural de México (usa vocabulario y tono propio de México; evita expresiones o conjugaciones de España).',
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: {
                type: Type.STRING,
                description: 'Título corto y descriptivo de la sesión, ej: Empuje Superior y Core',
              },
              rationale: {
                type: Type.STRING,
                description: 'Explicación breve (1-2 frases) de por qué se eligieron estos músculos según la recuperación y meta.',
              },
              warmup: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    durationOrReps: { type: Type.STRING, description: 'Ej: 2 min o 12 reps por lado' },
                  },
                  required: ['name', 'durationOrReps'],
                },
              },
              exercises: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    primaryMuscles: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING, enum: MUSCLE_ENUM },
                    },
                    secondaryMuscles: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING, enum: MUSCLE_ENUM },
                    },
                    sets: { type: Type.INTEGER },
                    reps: { type: Type.INTEGER },
                    suggestedWeightKg: { type: Type.NUMBER },
                    restSec: { type: Type.INTEGER },
                    notes: { type: Type.STRING },
                  },
                  required: [
                    'name',
                    'primaryMuscles',
                    'secondaryMuscles',
                    'sets',
                    'reps',
                    'suggestedWeightKg',
                    'restSec',
                  ],
                },
              },
            },
            required: ['title', 'rationale', 'warmup', 'exercises'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini devolvió una respuesta vacía.' });
        return;
      }

      const generated = JSON.parse(rawText);
      res.json(generated);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al generar rutina con Gemini.';
      const status = message.includes('GEMINI_API_KEY') ? 500 : 502;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/workout/alternatives', async (req, res) => {
    try {
      const { exerciseName, primaryMuscles, equipment, weightUnit } = req.body ?? {};
      if (!exerciseName || !Array.isArray(primaryMuscles)) {
        res.status(400).json({ error: 'Faltan datos del ejercicio a reemplazar.' });
        return;
      }

      const preferredUnit = weightUnit === 'lb' ? 'lb' : 'kg';
      const { ai } = getGeminiClient();

      const prompt = [
        `El usuario está entrenando y quiere REEMPLAZAR el ejercicio "${exerciseName}".`,
        `Músculos principales objetivo: ${primaryMuscles.join(', ')}.`,
        `Equipo disponible: ${Array.isArray(equipment) ? equipment.join(', ') : 'peso_corporal'}.`,
        `Unidad preferida del usuario para textos/razones: ${preferredUnit} (mantén el campo numérico suggestedWeightKg en kg).`,
        'Sugiere exactamente 4 variantes biomecánicamente equivalentes para el mismo grupo muscular y compatibles con su equipo disponible.',
        'No repitas el ejercicio actual. Responde siempre en español natural de México (vocabulario y tono de México; evita expresiones o conjugaciones de España).',
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              alternatives: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    primaryMuscles: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING, enum: MUSCLE_ENUM },
                    },
                    secondaryMuscles: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING, enum: MUSCLE_ENUM },
                    },
                    suggestedWeightKg: { type: Type.NUMBER },
                    reps: { type: Type.INTEGER },
                    restSec: { type: Type.INTEGER },
                    reason: { type: Type.STRING },
                  },
                  required: [
                    'name',
                    'primaryMuscles',
                    'secondaryMuscles',
                    'suggestedWeightKg',
                    'reps',
                    'restSec',
                    'reason',
                  ],
                },
              },
            },
            required: ['alternatives'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini devolvió una respuesta vacía.' });
        return;
      }

      res.json(JSON.parse(rawText));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al buscar variantes con Gemini.';
      const status = message.includes('GEMINI_API_KEY') ? 500 : 502;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/nutrition/estimate', async (req, res) => {
    try {
      const { description } = req.body ?? {};
      if (!description || typeof description !== 'string' || !description.trim()) {
        res.status(400).json({ error: 'Describe qué comiste para calcular los macronutrientes.' });
        return;
      }

      const { ai } = getGeminiClient();

      const prompt = [
        'Eres un nutricionista deportivo experto.',
        'El usuario describe una comida o lista de alimentos en lenguaje natural.',
        'Calcula con precisión realista las calorías (kcal), proteína (g), carbohidratos (g) y grasas (g) de cada alimento mencionado y el nombre limpio en español.',
        `Descripción del usuario: "${description.trim()}"`,
        'Si el usuario no especifica gramaje, asume una porción estándar realista e indícalo brevemente en el nombre.',
        'Responde siempre en español natural de México (vocabulario común en México; evita expresiones o conjugaciones de España).',
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    calories: { type: Type.INTEGER },
                    proteinG: { type: Type.NUMBER },
                    carbsG: { type: Type.NUMBER },
                    fatG: { type: Type.NUMBER },
                  },
                  required: ['name', 'calories', 'proteinG', 'carbsG', 'fatG'],
                },
              },
            },
            required: ['items'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini devolvió una respuesta vacía.' });
        return;
      }

      res.json(JSON.parse(rawText));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al estimar macros con Gemini.';
      const status = message.includes('GEMINI_API_KEY') ? 500 : 502;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/nutrition/scan-plate', async (req, res) => {
    try {
      const { imageBase64, mimeType, contextText, mealScope, dailyContext } = req.body ?? {};
      const hasImage = typeof imageBase64 === 'string' && imageBase64.trim().length > 0;
      const cleanText = typeof contextText === 'string' ? contextText.trim() : '';

      if (!hasImage && !cleanText) {
        res.status(400).json({
          error: 'Sube una fotografía del plato o describe tu comida por voz/texto para analizarla.',
        });
        return;
      }

      const { ai } = getGeminiClient();

      const parts: Array<
        | { inlineData: { mimeType: string; data: string } }
        | { text: string }
      > = [];

      if (hasImage) {
        parts.push({
          inlineData: {
            mimeType: typeof mimeType === 'string' && mimeType ? mimeType : 'image/jpeg',
            data: imageBase64,
          },
        });
      }

      const validScope =
        mealScope === 'desayuno' ||
        mealScope === 'almuerzo' ||
        mealScope === 'cena' ||
        mealScope === 'snack' ||
        mealScope === 'dia_completo'
          ? mealScope
          : 'almuerzo';

      const scopeLabel =
        validScope === 'dia_completo'
          ? 'Día completo (pueden ser varias comidas del día; asigna a cada alimento su mealSlot más lógico: desayuno, almuerzo, cena o snack)'
          : validScope === 'almuerzo'
            ? 'Comida (almuerzo)'
            : validScope;

      const ctx =
        dailyContext && typeof dailyContext === 'object'
          ? (dailyContext as {
              calorieTarget?: number;
              consumedCalories?: number;
              proteinTargetG?: number;
              consumedProteinG?: number;
              carbsTargetG?: number;
              consumedCarbsG?: number;
              fatTargetG?: number;
              consumedFatG?: number;
              goal?: string;
            })
          : null;

      const dailyGoalText = ctx
        ? [
            `Meta diaria del usuario: ${Math.round(ctx.calorieTarget || 2200)} kcal, ${Math.round(ctx.proteinTargetG || 150)}g proteína, ${Math.round(ctx.carbsTargetG || 220)}g carbohidratos, ${Math.round(ctx.fatTargetG || 70)}g grasas (objetivo: ${ctx.goal || 'mantener'}).`,
            `Consumido hoy ANTES de esta comida: ${Math.round(ctx.consumedCalories || 0)} kcal y ${Math.round(ctx.consumedProteinG || 0)}g proteína.`,
            'Después de sumar los alimentos que detectes en este análisis, calcula cuánto faltará hoy para completar la meta de proteína y calorías y sugiere de 2 a 4 alimentos concretos en suggestedAdditions para cerrar esa brecha (o una recomendación ligera de hidratación/verduras si ya alcanzó la meta).',
          ].join('\n')
        : 'Sugiere de 2 a 3 complementos saludables en suggestedAdditions que equilibren proteína y energía en español de México.';

      const promptLines = [
        'Eres un Nutriólogo IA deportivo experto en análisis visual y nutricional.',
        `Tiempo de comida seleccionado por el usuario: ${scopeLabel}.`,
        hasImage
          ? 'Analiza la fotografía adjunta (y el texto/dictado del usuario si existe):'
          : 'Analiza la descripción por voz/texto del usuario:',
        '1. Identifica cada alimento o ingrediente individual. Si el usuario eligió "Día completo", separa o agrupa los alimentos asignando el mealSlot correspondiente (desayuno, almuerzo, cena o snack). Si eligió un tiempo específico, asigna ese mismo mealSlot a todos los alimentos.',
        '2. Estima el peso realista en gramos usando referencias visuales o porciones estándar en México.',
        '3. Calcula las calorías (kcal), proteína (g), carbohidratos (g) y grasas (g) de cada alimento.',
        cleanText
          ? `Descripción o dictado por voz del usuario (inclúyelo con precisión aunque algún ingrediente no se distinga en la foto): "${cleanText}".`
          : 'No se incluyó texto adicional; estima aceites, tortillas, pan o aderezos visibles.',
        dailyGoalText,
        '4. Redacta dishSummary (nombre breve de la comida) y nutritionistFeedback (1 o 2 frases prácticas evaluando la densidad proteica y calórica del plato).',
        'Responde SIEMPRE en español natural de México (ej. aguacate, frijoles, pechuga de pollo, tortilla de maíz, yogur griego, huevo; evita expresiones de España).',
      ];

      parts.push({ text: promptLines.join('\n') });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              dishSummary: {
                type: Type.STRING,
                description: 'Resumen breve del plato o comidas detectadas en español de México.',
              },
              nutritionistFeedback: {
                type: Type.STRING,
                description: 'Evaluación breve de 1-2 frases del Nutriólogo IA en español de México.',
              },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    grams: { type: Type.INTEGER },
                    calories: { type: Type.INTEGER },
                    proteinG: { type: Type.NUMBER },
                    carbsG: { type: Type.NUMBER },
                    fatG: { type: Type.NUMBER },
                    mealSlot: {
                      type: Type.STRING,
                      enum: ['desayuno', 'almuerzo', 'cena', 'snack'],
                    },
                  },
                  required: ['name', 'grams', 'calories', 'proteinG', 'carbsG', 'fatG', 'mealSlot'],
                },
              },
              suggestedAdditions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    portion: { type: Type.STRING },
                    calories: { type: Type.INTEGER },
                    proteinG: { type: Type.NUMBER },
                    carbsG: { type: Type.NUMBER },
                    fatG: { type: Type.NUMBER },
                    reason: { type: Type.STRING },
                  },
                  required: ['name', 'portion', 'calories', 'proteinG', 'carbsG', 'fatG', 'reason'],
                },
              },
            },
            required: ['dishSummary', 'nutritionistFeedback', 'items', 'suggestedAdditions'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini devolvió una respuesta vacía.' });
        return;
      }

      const parsed = JSON.parse(rawText);
      if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
        res.status(422).json({
          error:
            'No se pudieron identificar alimentos claros. Intenta con mejor iluminación o agrega una descripción por voz/texto.',
        });
        return;
      }

      res.json(parsed);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al analizar la comida con Nutriólogo IA.';
      const status = message.includes('GEMINI_API_KEY') ? 400 : 502;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/scale/parse-screenshot', async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body ?? {};
      if (!imageBase64 || typeof imageBase64 !== 'string') {
        res.status(400).json({ error: 'Se requiere la imagen de captura de la báscula.' });
        return;
      }

      const { ai } = getGeminiClient();

      const imagePart = {
        inlineData: {
          mimeType: typeof mimeType === 'string' && mimeType ? mimeType : 'image/png',
          data: imageBase64,
        },
      };

      const textPart = {
        text: [
          'Analiza esta captura de pantalla de una aplicación de báscula inteligente (ej. OKOK, Zepp Life, Fitdays, Renpho, Xiaomi, Eufy).',
          'Extrae todos los valores numéricos visibles de composición corporal con exactitud.',
          'Si alguna métrica no aparece en la imagen, devuélvela como null o no la incluyas, pero weightKg es obligatorio si aparece en la captura.',
          'Responde siempre en español natural de México en cualquier texto o campo descriptivo.',
        ].join('\n'),
      };

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts: [imagePart, textPart] },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              weightKg: { type: Type.NUMBER, description: 'Peso en kilogramos' },
              bmi: { type: Type.NUMBER },
              bodyFatPct: { type: Type.NUMBER, description: 'Porcentaje de grasa corporal' },
              skeletalMusclePct: { type: Type.NUMBER, description: 'Porcentaje de músculo esquelético' },
              totalMusclePct: { type: Type.NUMBER, description: 'Porcentaje de músculo total' },
              bodyWaterPct: { type: Type.NUMBER, description: 'Porcentaje de agua corporal' },
              visceralFatLevel: { type: Type.NUMBER },
              boneMassKg: { type: Type.NUMBER },
              bmrKcal: { type: Type.INTEGER },
              proteinPct: { type: Type.NUMBER },
              bodyAge: { type: Type.INTEGER },
              leanMassKg: { type: Type.NUMBER },
            },
            required: ['weightKg'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini Vision devolvió una respuesta vacía.' });
        return;
      }

      const parsed = JSON.parse(rawText);
      if (typeof parsed.weightKg !== 'number' || parsed.weightKg <= 0) {
        res.status(422).json({
          error: 'No se pudo identificar el peso en la captura subida. Intenta con otra imagen más nítida.',
        });
        return;
      }

      res.json(parsed);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al procesar la captura con Gemini Vision.';
      const status = message.includes('GEMINI_API_KEY') ? 500 : 502;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/scale/interpret', async (req, res) => {
    try {
      const { profile, scans } = req.body ?? {};
      if (!profile || !Array.isArray(scans) || scans.length === 0) {
        res.status(400).json({ error: 'Se requiere al menos un pesaje para generar la interpretación.' });
        return;
      }

      const { ai } = getGeminiClient();

      const weightUnit = profile.weightUnit === 'lb' ? 'lb' : 'kg';
      const liquidUnit = profile.liquidUnit === 'oz' ? 'oz' : 'ml';
      const toDisplayW = (kg: number) =>
        weightUnit === 'lb' ? Math.round(kg * 2.20462 * 2) / 2 : kg;

      const compactScans = scans.slice(-10).map((s) => ({
        fecha: s.date,
        peso: `${toDisplayW(s.weightKg)} ${weightUnit}`,
        grasaPct: s.bodyFatPct,
        masaGrasa: `${toDisplayW(s.bodyFatMassKg)} ${weightUnit}`,
        musculoEsqueleticoPct: s.skeletalMusclePct,
        musculoEsqueletico: `${toDisplayW(s.skeletalMuscleMassKg)} ${weightUnit}`,
        masaMagra: `${toDisplayW(s.leanMassKg)} ${weightUnit}`,
        aguaPct: s.bodyWaterPct,
        grasaVisceral: s.visceralFatLevel,
        edadCorporal: s.bodyAge,
      }));

      const prompt = [
        'Eres un especialista en fisiología del ejercicio y composición corporal.',
        'Analiza los registros históricos de báscula inteligente del usuario y determina con claridad si está perdiendo grasa, ganando masa muscular, haciendo recomposición corporal o estancado.',
        `Unidades preferidas del usuario: peso en ${weightUnit}, hidratación en ${liquidUnit}. Expresa todos los pesos y recomendaciones en esas unidades.`,
        `Perfil: ${JSON.stringify({
          edad: profile.age,
          sexo: profile.sex,
          alturaCm: profile.heightCm,
          objetivo: profile.goal,
          diasEntreno: profile.trainingDaysPerWeek,
        })}`,
        `Historial cronológico de escaneos: ${JSON.stringify(compactScans)}`,
        'Responde siempre en español natural de México (vocabulario y tono de México, claro, directo y práctico; evita expresiones o conjugaciones de España).',
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              verdict: {
                type: Type.STRING,
                description: 'Diagnóstico corto, ej: Recomposición corporal favorable, Pérdida de grasa activa, Ganancia muscular limpia',
              },
              summary: {
                type: Type.STRING,
                description: 'Análisis detallado (2-3 frases) explicando cambios en kg de grasa vs kg de músculo y agua.',
              },
              recommendations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '2 a 3 acciones concretas de entrenamiento o nutrición basadas en estos datos.',
              },
            },
            required: ['verdict', 'summary', 'recommendations'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini devolvió una respuesta vacía.' });
        return;
      }

      res.json(JSON.parse(rawText));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al interpretar composición corporal con Gemini.';
      const status = message.includes('GEMINI_API_KEY') ? 500 : 502;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/nutrition/weekly-plan', async (req, res) => {
    try {
      const { profile, calorieTarget, proteinTargetG, mealsPerDay, preferencesNote } =
        req.body ?? {};
      if (!profile || !calorieTarget || !proteinTargetG) {
        res.status(400).json({ error: 'Se requieren las metas nutricionales y el perfil.' });
        return;
      }

      const { ai } = getGeminiClient();
      const goalText =
        profile.goal === 'perder_grasa'
          ? 'perder grasa'
          : profile.goal === 'ganar_musculo'
            ? 'ganar músculo'
            : 'mantener peso';
      const prompt = [
        'Eres un nutricionista deportivo experto en planificación semanal.',
        'Crea un menú semanal de 7 días (Lunes a Domingo) adaptado exactamente a las metas de calorías y proteína del perfil del atleta, más su lista de compras semanal consolidada y agrupada por categoría.',
        `Meta diaria objetivo: ${calorieTarget} kcal, ${proteinTargetG}g proteína.`,
        `Comidas por día: ${mealsPerDay || 3} (distribuye usando mealType válidos: desayuno, almuerzo, cena, snack).`,
        `Perfil: sexo ${profile.sex}, edad ${profile.age}, peso ${profile.weightKg}kg, altura ${profile.heightCm}cm, objetivo ${goalText}, días de entreno/semana: ${profile.trainingDaysPerWeek || 4}.`,
        'La suma de calorías y proteína de las comidas de CADA día debe acercarse con precisión (±5%) a la meta diaria objetivo.',
        'En shoppingList consolida los ingredientes de toda la semana con cantidades prácticas de supermercado (ej. kg, g, piezas, litros).',
        preferencesNote && typeof preferencesNote === 'string' && preferencesNote.trim()
          ? `Preferencias / restricciones del usuario: "${preferencesNote.trim()}"`
          : 'Sin restricciones adicionales; prioriza platillos prácticos, accesibles y ricos en proteína.',
        'Responde siempre en español natural de México (nombres de ingredientes y platillos usados en México; evita expresiones o conjugaciones de España).',
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              notes: { type: Type.STRING },
              days: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    dayName: { type: Type.STRING },
                    meals: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          mealType: {
                            type: Type.STRING,
                            enum: ['desayuno', 'almuerzo', 'cena', 'snack'],
                          },
                          title: { type: Type.STRING },
                          description: { type: Type.STRING },
                          calories: { type: Type.INTEGER },
                          proteinG: { type: Type.NUMBER },
                          carbsG: { type: Type.NUMBER },
                          fatG: { type: Type.NUMBER },
                        },
                        required: [
                          'mealType',
                          'title',
                          'description',
                          'calories',
                          'proteinG',
                          'carbsG',
                          'fatG',
                        ],
                      },
                    },
                  },
                  required: ['dayName', 'meals'],
                },
              },
              shoppingList: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: {
                      type: Type.STRING,
                      enum: [
                        'Proteínas',
                        'Carbohidratos',
                        'Verduras y Frutas',
                        'Despensa y Grasas',
                      ],
                    },
                    name: { type: Type.STRING },
                    quantity: { type: Type.STRING },
                  },
                  required: ['category', 'name', 'quantity'],
                },
              },
            },
            required: ['notes', 'days', 'shoppingList'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini devolvió una respuesta vacía.' });
        return;
      }

      res.json(JSON.parse(rawText));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al generar el menú semanal con Gemini.';
      const status = message.includes('GEMINI_API_KEY') ? 500 : 502;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/coach/personal-chat', async (req, res) => {
    try {
      const { context, personality, history, userMessage } = req.body ?? {};
      if (!context || typeof context !== 'object') {
        res.status(400).json({ error: 'Se requiere el contexto del atleta.' });
        return;
      }

      const { ai } = getGeminiClient();
      const effectivePersonality = personality === 'motivador' ? 'motivador' : 'sargento';

      const sargentoRules = [
        'Eres el "Sargento PulsoFit" en modo SIN FILTROS.',
        'Habla con jerga mexicana directa, carrilla pesada pero deportiva (ej. "qué onda campeón de sillón", "órale mi estimado", "ponte las pilas", "cero excusas", "vas con todo", "eso sí es disciplina"), sin insultos discriminatorios ni groserías extremas.',
        'Si el atleta falló en entrenar varios días (sin descanso programado), tomó poca agua o comió de más/muy poco: dale carrilla directa y mándalo a accionar hoy.',
        'Si el atleta SÍ cumplió hoy o lleva buena racha o activó su Descanso Programado por turno laboral (isTodayRestShield: true): NO lo regañes injustamente; dale reconocimiento firme y enfócate en recuperación, sueño e hidratación.',
      ].join(' ');

      const motivadorRules = [
        'Eres el "Coach Motivador PulsoFit", entrenador deportivo mexicano cercano, empático y firme.',
        'Habla en español natural de México con tono positivo, claro y práctico. Reconoce logros, adapta expectativas si reporta turno pesado o cansancio, y da una instrucción concreta para hoy.',
      ].join(' ');

      const systemInstruction = [
        effectivePersonality === 'sargento' ? sargentoRules : motivadorRules,
        'Reglas de salida obligatorias:',
        '1. Analiza el estado omnisciente de TODO el perfil: Objetivo actual persistente (context.customGoal y context.goal), equipo disponible (context.equipment), días de descanso programados/Modo Turno, Biometría 7d/30d (peso, delta, cintura, % grasa, presión arterial promedio, BPM y HRV RMSSD), Entrenamientos (fuerza, HIIT, cardio GPS, RPE promedio, récords personales PRs recientes) y Recuperación, Nutrición (calorías y proteína vs meta), Hidratación, Sueño y Racha.',
        '2. Alinea siempre tu consejo con context.customGoal si el atleta definió uno.',
        '3. Si el usuario escribió un mensaje nuevo (ej. cambio de turno, cansancio, molestia), responde directamente ajustando el plan de hoy.',
        '4. Sé breve y contundente:',
        '   - headline: máx 7 palabras.',
        '   - goodBullets: exactamente 2 viñetas cortas de "Qué va bien" basadas en datos reales (máx 11 palabras cada una).',
        '   - weakBullets: exactamente 2 viñetas cortas de "Qué va flojo o pendiente" basadas en datos reales (máx 11 palabras cada una).',
        '   - reply: diagnóstico breve en 1-2 frases (máx 45 palabras).',
        '   - actionTip: 1 siguiente acción concreta y medible para hoy (máx 16 palabras).',
      ].join('\n');

      const trimmedHistory = Array.isArray(history)
        ? history
            .slice(-6)
            .map((m: { role?: string; text?: string }) =>
              `${m.role === 'user' ? 'Atleta' : 'Coach'}: ${String(m.text || '').trim()}`,
            )
            .join('\n')
        : '';

      const prompt = [
        `DATOS CONSOLIDADOS DEL ATLETA (8 PESTAÑAS):\n${JSON.stringify(context)}`,
        trimmedHistory ? `\nMEMORIA DE CONVERSACIÓN RECIENTE:\n${trimmedHistory}` : '',
        userMessage && typeof userMessage === 'string' && userMessage.trim()
          ? `\nMENSAJE DEL ATLETA AHORA: "${userMessage.trim()}"`
          : '\nINSTRUCCIÓN: Evalúa el estado multi-pestaña de hoy y entrega qué va bien, qué va flojo y la siguiente acción.',
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              goodBullets: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              weakBullets: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              reply: { type: Type.STRING },
              actionTip: { type: Type.STRING },
            },
            required: ['headline', 'goodBullets', 'weakBullets', 'reply', 'actionTip'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini devolvió una respuesta vacía.' });
        return;
      }

      res.json(JSON.parse(rawText));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al consultar al Coach IA con Gemini.';
      const status = message.includes('GEMINI_API_KEY') ? 500 : 502;
      res.status(status).json({ error: message });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Ruta API no encontrada' });
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: false,
        ws: false,
        watch: process.env.DISABLE_HMR === 'true' ? null : undefined,
      },
      plugins: [
        {
          name: 'disable-vite-client-ws',
          transform(code, id) {
            if (id.endsWith('/vite/dist/client/client.mjs') || id.endsWith('@vite/client')) {
              return {
                code: code.replace(
                  'transport.connect(createHMRHandler(handleMessage));',
                  '/* HMR WebSocket disabled */',
                ),
                map: null,
              };
            }
          },
        },
      ],
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PulsoFit server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
