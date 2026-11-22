import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, HeartPulse, Plus, Ruler } from 'lucide-react';
import { InlineDeleteConfirmButton } from './InlineDeleteConfirmButton';
import {
  compressImageFileToJpegBlob,
  deleteProgressPhotoBlob,
  loadProgressPhotoBlob,
  saveProgressPhotoBlob,
} from '../lib/photoStorage';
import { getTodayIsoDate } from '../lib/storage';
import { formatWeight, getWeightUnit } from '../lib/units';
import type {
  BodyMeasurementEntry,
  DailyReadinessEntry,
  ProgressPhotoMeta,
  ProgressPhotoPose,
  UserProfile,
} from '../types/fitness';

interface ProgressPhotosSectionProps {
  profile: UserProfile;
  bodyMeasurements: BodyMeasurementEntry[];
  progressPhotos: ProgressPhotoMeta[];
  readinessByDate: Record<string, DailyReadinessEntry>;
  onAddMeasurement: (entry: BodyMeasurementEntry) => void;
  onDeleteMeasurement: (id: string) => void;
  onAddProgressPhoto: (meta: ProgressPhotoMeta) => void;
  onDeleteProgressPhoto: (id: string) => void;
}

const POSES: { id: ProgressPhotoPose; label: string }[] = [
  { id: 'frente', label: 'Frente' },
  { id: 'perfil', label: 'Perfil' },
  { id: 'espalda', label: 'Espalda' },
];

export const ProgressPhotosSection: React.FC<ProgressPhotosSectionProps> = ({
  profile,
  bodyMeasurements,
  progressPhotos,
  readinessByDate,
  onAddMeasurement,
  onDeleteMeasurement,
  onAddProgressPhoto,
  onDeleteProgressPhoto,
}) => {
  const weightUnit = getWeightUnit(profile.weightUnit);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Body measurements state (stored internally in cm)
  const [waistText, setWaistText] = useState('');
  const [chestText, setChestText] = useState('');
  const [armText, setArmText] = useState('');
  const [thighText, setThighText] = useState('');
  const [hipsText, setHipsText] = useState('');
  const [measSavedBanner, setMeasSavedBanner] = useState(false);

  // Progress Photos & Before/After slider
  const [uploadPose, setUploadPose] = useState<ProgressPhotoPose>('frente');
  const [comparePose, setComparePose] = useState<ProgressPhotoPose>('frente');
  const [beforePhotoId, setBeforePhotoId] = useState<string>('');
  const [afterPhotoId, setAfterPhotoId] = useState<string>('');
  const [sliderPct, setSliderPct] = useState(50);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);

  const sortedMeasurements = useMemo(
    () => [...bodyMeasurements].sort((a, b) => b.date.localeCompare(a.date)),
    [bodyMeasurements],
  );
  const latestMeasurement = sortedMeasurements[0] ?? null;
  const previousMeasurement = sortedMeasurements[1] ?? null;

  const sortedReadiness = useMemo(
    () =>
      Object.values(readinessByDate)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 7),
    [readinessByDate],
  );

  const photosOfPose = useMemo(
    () =>
      progressPhotos
        .filter((p) => p.pose === comparePose)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [progressPhotos, comparePose],
  );

  useEffect(() => {
    if (photosOfPose.length >= 2) {
      setBeforePhotoId((prev) =>
        photosOfPose.some((p) => p.id === prev) ? prev : photosOfPose[0].id,
      );
      setAfterPhotoId((prev) =>
        photosOfPose.some((p) => p.id === prev)
          ? prev
          : photosOfPose[photosOfPose.length - 1].id,
      );
    } else if (photosOfPose.length === 1) {
      setBeforePhotoId(photosOfPose[0].id);
      setAfterPhotoId(photosOfPose[0].id);
    } else {
      setBeforePhotoId('');
      setAfterPhotoId('');
    }
  }, [photosOfPose]);

  // Load IndexedDB blobs into object URLs for displayed photos
  useEffect(() => {
    let active = true;
    const createdUrls: string[] = [];

    const loadAll = async () => {
      const next: Record<string, string> = {};
      for (const meta of progressPhotos) {
        const blob = await loadProgressPhotoBlob(meta.id);
        if (blob && active) {
          const url = URL.createObjectURL(blob);
          createdUrls.push(url);
          next[meta.id] = url;
        }
      }
      if (active) {
        setPhotoUrls(next);
      }
    };
    void loadAll();

    return () => {
      active = false;
      createdUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [progressPhotos]);

  const handleSaveMeasurements = (e: React.FormEvent) => {
    e.preventDefault();
    const parseCm = (txt: string) => {
      const n = parseFloat(txt.replace(',', '.').trim());
      return Number.isFinite(n) && n > 10 && n < 250 ? Math.round(n * 10) / 10 : undefined;
    };
    const entry: BodyMeasurementEntry = {
      id: `meas_${Date.now()}`,
      date: getTodayIsoDate(),
      waistCm: parseCm(waistText),
      chestCm: parseCm(chestText),
      armCm: parseCm(armText),
      thighCm: parseCm(thighText),
      hipsCm: parseCm(hipsText),
    };
    if (
      !entry.waistCm &&
      !entry.chestCm &&
      !entry.armCm &&
      !entry.thighCm &&
      !entry.hipsCm
    ) {
      return;
    }
    onAddMeasurement(entry);
    setWaistText('');
    setChestText('');
    setArmText('');
    setThighText('');
    setHipsText('');
    setMeasSavedBanner(true);
    window.setTimeout(() => setMeasSavedBanner(false), 2500);
  };

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsSavingPhoto(true);
    try {
      const blob = await compressImageFileToJpegBlob(file);
      const id = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await saveProgressPhotoBlob(id, blob);
      onAddProgressPhoto({
        id,
        date: getTodayIsoDate(),
        pose: uploadPose,
        weightKgAtCapture: profile.weightKg,
        createdAt: new Date().toISOString(),
      });
      setComparePose(uploadPose);
    } finally {
      setIsSavingPhoto(false);
      e.target.value = '';
    }
  };

  const handleRemovePhoto = async (id: string) => {
    await deleteProgressPhotoBlob(id);
    onDeleteProgressPhoto(id);
  };

  const beforeMeta = photosOfPose.find((p) => p.id === beforePhotoId) ?? null;
  const afterMeta = photosOfPose.find((p) => p.id === afterPhotoId) ?? null;

  return (
    <div className="space-y-6">
      {/* 1. READINESS HISTORY (LAST 7 CHECK-INS) */}
      {sortedReadiness.length > 0 && (
        <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HeartPulse className="w-5 h-5 text-[#D4FF33]" />
              <h2 className="text-xl font-bold font-display text-white">
                Historial de recuperación diaria
              </h2>
            </div>
            <span className="text-xs font-mono text-zinc-400">Últimos 7 registros</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {sortedReadiness.map((r) => (
              <div
                key={r.date}
                className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-2.5 text-center"
              >
                <span className="block text-[10px] font-mono text-zinc-400">
                  {r.date.slice(5)}
                </span>
                <span
                  className={`block text-lg font-extrabold font-mono tabular-nums ${
                    r.score >= 78
                      ? 'text-emerald-400'
                      : r.score >= 55
                        ? 'text-[#D4FF33]'
                        : 'text-amber-400'
                  }`}
                >
                  {r.score}%
                </span>
                <span className="block text-[10px] text-zinc-400">{r.sleepHours}h sueño</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 2. BODY MEASUREMENTS TRACKER (cm) */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Ruler className="w-5 h-5 text-[#D4FF33]" />
              <h2 className="text-2xl font-bold font-display text-white">
                Medidas corporales (cm)
              </h2>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Registra cintura, pecho, brazo, muslo o cadera para evaluar recomposición real
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveMeasurements} className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {[
              { label: 'Cintura (cm)', val: waistText, set: setWaistText },
              { label: 'Pecho (cm)', val: chestText, set: setChestText },
              { label: 'Brazo (cm)', val: armText, set: setArmText },
              { label: 'Muslo (cm)', val: thighText, set: setThighText },
              { label: 'Cadera (cm)', val: hipsText, set: setHipsText },
            ].map((f) => (
              <label key={f.label} className="block">
                <span className="block text-[11px] font-semibold text-zinc-400 mb-1">
                  {f.label}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={f.val}
                  onChange={(e) => f.set(e.target.value)}
                  placeholder="—"
                  className="w-full min-h-[44px] rounded-xl border border-[#2A2F3D] bg-[#0B0C0F] px-3 text-sm font-mono font-bold text-white focus:border-[#D4FF33] focus:outline-none"
                />
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            {measSavedBanner ? (
              <span className="text-xs font-semibold text-[#D4FF33]">
                Medidas guardadas correctamente.
              </span>
            ) : (
              <span className="text-[11px] text-zinc-500">
                Puedes llenar solo las medidas que tomaste hoy.
              </span>
            )}
            <button
              type="submit"
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-[#D4FF33] px-4 text-xs font-extrabold text-[#0A0B0D]"
            >
              <Plus className="w-4 h-4" />
              Guardar medidas
            </button>
          </div>
        </form>

        {latestMeasurement && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-white/5">
            {(
              [
                ['Cintura', 'waistCm'],
                ['Pecho', 'chestCm'],
                ['Brazo', 'armCm'],
                ['Muslo', 'thighCm'],
                ['Cadera', 'hipsCm'],
              ] as const
            ).map(([label, key]) => {
              const cur = latestMeasurement[key];
              const prev = previousMeasurement?.[key];
              const delta =
                cur !== undefined && prev !== undefined
                  ? Math.round((cur - prev) * 10) / 10
                  : null;
              return (
                <div key={key} className="rounded-xl bg-[#0D0F14] p-2.5">
                  <span className="text-[11px] text-zinc-400 block">{label}</span>
                  <span className="text-base font-extrabold font-mono text-white">
                    {cur !== undefined ? `${cur} cm` : '—'}
                  </span>
                  {delta !== null && (
                    <span className="block text-[10px] font-mono text-[#D4FF33]">
                      {delta >= 0 ? '+' : ''}
                      {delta} cm
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {sortedMeasurements.length > 0 && (
          <div className="divide-y divide-white/5 max-h-40 overflow-y-auto">
            {sortedMeasurements.slice(0, 6).map((m) => (
              <div
                key={m.id}
                className="py-2 flex items-center justify-between gap-2 text-xs font-mono text-zinc-300"
              >
                <span>
                  {m.date} ·{' '}
                  {[
                    m.waistCm ? `Cin ${m.waistCm}` : '',
                    m.chestCm ? `Pec ${m.chestCm}` : '',
                    m.armCm ? `Bra ${m.armCm}` : '',
                    m.thighCm ? `Mus ${m.thighCm}` : '',
                    m.hipsCm ? `Cad ${m.hipsCm}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}{' '}
                  cm
                </span>
                <InlineDeleteConfirmButton
                  onConfirm={() => onDeleteMeasurement(m.id)}
                  ariaLabel="Eliminar medida"
                  size="sm"
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 3. PRIVATE PROGRESS PHOTOS + BEFORE/AFTER COMPARISON SLIDER */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-[#D4FF33]" />
              <h2 className="text-2xl font-bold font-display text-white">
                Fotos de progreso privadas
              </h2>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Guardadas localmente en IndexedDB privado (no se suben ni ocupan espacio en el JSON)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="grid grid-cols-3 gap-1.5 flex-1 min-w-[200px]">
            {POSES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setUploadPose(p.id)}
                className={`min-h-[42px] rounded-xl text-xs font-bold ${
                  uploadPose === p.id
                    ? 'bg-[#D4FF33] text-[#0A0B0D]'
                    : 'bg-[#181B23] text-zinc-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={isSavingPhoto}
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#D4FF33] px-4 text-xs font-extrabold text-[#0A0B0D] shrink-0"
          >
            <Camera className="w-4 h-4" />
            {isSavingPhoto ? 'Guardando...' : `Subir foto (${uploadPose})`}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoFileChange}
            className="hidden"
          />
        </div>

        {/* Comparison Slider View */}
        {progressPhotos.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-white/5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-[#D4FF33]">
                Comparador Antes / Después
              </span>
              <div className="flex items-center gap-1">
                {POSES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setComparePose(p.id)}
                    className={`min-h-[34px] px-3 rounded-lg text-xs font-bold ${
                      comparePose === p.id
                        ? 'bg-white text-[#0A0B0D]'
                        : 'bg-[#181B23] text-zinc-400'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {photosOfPose.length >= 2 &&
            beforeMeta &&
            afterMeta &&
            photoUrls[beforeMeta.id] &&
            photoUrls[afterMeta.id] ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="text-zinc-400">
                    Antes
                    <select
                      value={beforePhotoId}
                      onChange={(e) => setBeforePhotoId(e.target.value)}
                      className="mt-1 w-full min-h-[38px] rounded-xl border border-[#2A2F3D] bg-[#0D0F14] px-2 text-xs text-white"
                    >
                      {photosOfPose.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.date}{' '}
                          {p.weightKgAtCapture
                            ? `(${formatWeight(p.weightKgAtCapture, weightUnit)})`
                            : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-zinc-400">
                    Después
                    <select
                      value={afterPhotoId}
                      onChange={(e) => setAfterPhotoId(e.target.value)}
                      className="mt-1 w-full min-h-[38px] rounded-xl border border-[#2A2F3D] bg-[#0D0F14] px-2 text-xs text-white"
                    >
                      {photosOfPose.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.date}{' '}
                          {p.weightKgAtCapture
                            ? `(${formatWeight(p.weightKgAtCapture, weightUnit)})`
                            : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="relative w-full max-w-md mx-auto aspect-[3/4] rounded-2xl overflow-hidden border border-[#2B303C] bg-black select-none">
                  <img
                    src={photoUrls[afterMeta.id]}
                    alt="Después"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <div
                    className="absolute inset-0 overflow-hidden"
                    style={{ clipPath: `inset(0 ${100 - sliderPct}% 0 0)` }}
                  >
                    <img
                      src={photoUrls[beforeMeta.id]}
                      alt="Antes"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-[#D4FF33]"
                    style={{ left: `${sliderPct}%` }}
                  />
                  <span className="absolute top-2.5 left-2.5 rounded-lg bg-black/75 px-2 py-1 text-[10px] font-mono font-bold text-white">
                    ANTES · {beforeMeta.date}
                  </span>
                  <span className="absolute top-2.5 right-2.5 rounded-lg bg-black/75 px-2 py-1 text-[10px] font-mono font-bold text-[#D4FF33]">
                    DESPUÉS · {afterMeta.date}
                  </span>
                </div>

                <input
                  type="range"
                  min={0}
                  max={100}
                  value={sliderPct}
                  onChange={(e) => setSliderPct(Number(e.target.value))}
                  aria-label="Deslizador comparativo antes y después"
                  className="w-full max-w-md mx-auto block accent-[#D4FF33]"
                />
              </div>
            ) : (
              <p className="text-xs text-zinc-400">
                Sube al menos 2 fotos en pose "{comparePose}" para activar el deslizador Antes / Después.
              </p>
            )}

            {/* Photo Gallery Grid */}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 pt-2">
              {progressPhotos.map((meta) => (
                <div
                  key={meta.id}
                  className="relative rounded-2xl overflow-hidden border border-[#222631] bg-[#0D0F14] aspect-[3/4]"
                >
                  {photoUrls[meta.id] && (
                    <img
                      src={photoUrls[meta.id]}
                      alt={`${meta.pose} ${meta.date}`}
                      className="w-full h-full object-cover"
                    />
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2">
                    <p className="text-[10px] font-mono text-white">
                      {meta.date} · {meta.pose}
                    </p>
                    {meta.weightKgAtCapture && (
                      <p className="text-[10px] font-mono text-[#D4FF33]">
                        {formatWeight(meta.weightKgAtCapture, weightUnit)}
                      </p>
                    )}
                  </div>
                  <div className="absolute top-1.5 right-1.5">
                    <InlineDeleteConfirmButton
                      onConfirm={() => void handleRemovePhoto(meta.id)}
                      ariaLabel="Eliminar foto"
                      size="sm"
                      className="bg-black/75 backdrop-blur-sm"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
