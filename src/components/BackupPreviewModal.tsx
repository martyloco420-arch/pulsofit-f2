import React from 'react';
import { Check, Database, ShieldAlert, X } from 'lucide-react';
import type { BackupPreviewCounts } from '../lib/storage';

interface BackupPreviewModalProps {
  isOpen: boolean;
  fileName: string;
  targetProfileLabel: string;
  counts: BackupPreviewCounts | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export const BackupPreviewModal: React.FC<BackupPreviewModalProps> = ({
  isOpen,
  fileName,
  targetProfileLabel,
  counts,
  onCancel,
  onConfirm,
}) => {
  if (!isOpen || !counts) return null;

  const totalRecords =
    counts.workouts +
    counts.cardioSessions +
    counts.hiitSessions +
    counts.bodyScans +
    counts.bodyWeights +
    counts.foodLogs +
    counts.sleepSessions +
    counts.pulseHrvRecords +
    counts.bloodPressureRecords;

  const summaryRows: { label: string; value: number }[] = [
    { label: 'Rutinas de fuerza / ligas', value: counts.workouts },
    { label: 'Sesiones GPS / Cardio', value: counts.cardioSessions },
    { label: 'Sesiones HIIT', value: counts.hiitSessions },
    { label: 'Escaneos báscula BIA', value: counts.bodyScans },
    { label: 'Registros de peso', value: counts.bodyWeights },
    { label: 'Comidas registradas', value: counts.foodLogs },
    { label: 'Sesiones de sueño', value: counts.sleepSessions },
    { label: 'Registros Pulso PPG / HRV', value: counts.pulseHrvRecords },
    { label: 'Tomas presión arterial', value: counts.bloodPressureRecords },
    { label: 'Días con hidratación', value: counts.hydrationDays },
    { label: 'Días con pasos importados', value: counts.manualActivityDays },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vista previa de respaldo JSON"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4"
    >
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-[#282D3B] bg-[#12141A] shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]">
        <div className="w-10 h-1.5 bg-zinc-700 rounded-full mx-auto mt-3 sm:hidden" />

        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#D4FF33]/15 border border-[#D4FF33]/35 flex items-center justify-center shrink-0">
              <Database className="w-4 h-4 text-[#D4FF33]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-extrabold text-white truncate">
                Vista previa de respaldo JSON
              </h3>
              <p className="text-[11px] text-zinc-400 truncate">
                {fileName || 'respaldo.json'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancelar importación"
            className="min-h-[40px] min-w-[40px] rounded-xl text-zinc-400 hover:text-white flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="rounded-2xl border border-amber-400/35 bg-amber-500/10 p-3 flex items-start gap-2.5 text-xs text-amber-100">
            <ShieldAlert className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">
                Se restaurará en el perfil «{targetProfileLabel}»
              </p>
              <p className="text-amber-200/85 mt-0.5">
                Perfil en archivo: <span className="font-bold text-white">{counts.profileName}</span> ·{' '}
                {totalRecords} registros detectados.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-[#222631] bg-[#0B0C0F] divide-y divide-white/5">
            {summaryRows.map((row) => (
              <div
                key={row.label}
                className="px-3.5 py-2 flex items-center justify-between text-xs"
              >
                <span className="text-zinc-300">{row.label}</span>
                <span
                  className={`font-mono tabular-nums font-extrabold ${
                    row.value > 0 ? 'text-[#D4FF33]' : 'text-zinc-500'
                  }`}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-white/10 bg-[#0D0F14] grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[46px] rounded-2xl border border-[#2A2F3D] bg-[#161922] px-4 text-xs sm:text-sm font-bold text-zinc-200 hover:text-white"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-[46px] rounded-2xl bg-[#D4FF33] px-4 text-xs sm:text-sm font-extrabold text-[#0A0B0D] inline-flex items-center justify-center gap-1.5 active:scale-[0.98]"
          >
            <Check className="w-4 h-4" />
            Confirmar e importar
          </button>
        </div>
      </div>
    </div>
  );
};
