import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, ShieldAlert, X } from 'lucide-react';

export interface DataCleanupConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  details?: string[];
  confirmButtonLabel: string;
  cancelButtonLabel?: string;
  dangerLevel?: 'warning' | 'destructive' | 'factory';
  requireKeyword?: string;
  isProcessing?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const DataCleanupConfirmModal: React.FC<DataCleanupConfirmModalProps> = ({
  isOpen,
  title,
  description,
  details = [],
  confirmButtonLabel,
  cancelButtonLabel = 'Cancelar',
  dangerLevel = 'destructive',
  requireKeyword,
  isProcessing = false,
  onConfirm,
  onCancel,
}) => {
  const [typedKeyword, setTypedKeyword] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTypedKeyword('');
    }
  }, [isOpen, title]);

  if (!isOpen) return null;

  const normalizedRequired = requireKeyword ? requireKeyword.trim().toUpperCase() : '';
  const keywordValid =
    !normalizedRequired || typedKeyword.trim().toUpperCase() === normalizedRequired;

  const isFactory = dangerLevel === 'factory';
  const isWarning = dangerLevel === 'warning';

  const borderClass = isFactory
    ? 'border-rose-500/60 shadow-2xl shadow-rose-950/60'
    : isWarning
    ? 'border-amber-500/40 shadow-2xl shadow-black/70'
    : 'border-rose-500/40 shadow-2xl shadow-black/70';

  const iconBgClass = isFactory
    ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
    : isWarning
    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    : 'bg-rose-500/15 text-rose-400 border-rose-500/30';

  const confirmBtnClass = isWarning
    ? 'bg-amber-500 text-black hover:bg-amber-400'
    : 'bg-rose-600 text-white hover:bg-rose-500';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="data-cleanup-modal-title"
      onClick={() => {
        if (!isProcessing) onCancel();
      }}
    >
      <div
        className={`w-full max-w-md rounded-2xl border bg-[#12141A] p-5 text-zinc-100 ${borderClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${iconBgClass}`}
            >
              {isFactory ? (
                <ShieldAlert className="h-5 w-5" />
              ) : (
                <AlertTriangle className="h-5 w-5" />
              )}
            </div>
            <div>
              <h3
                id="data-cleanup-modal-title"
                className="text-base font-bold text-white"
              >
                {title}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-300">
                {description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            aria-label="Cerrar diálogo"
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {details.length > 0 && (
          <div className="mt-4 rounded-xl border border-zinc-800 bg-[#0D0F14] p-3">
            <ul className="space-y-1.5 text-xs text-zinc-300">
              {details.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {normalizedRequired && (
          <div className="mt-4 space-y-2 rounded-xl border border-rose-500/30 bg-rose-950/20 p-3">
            <label
              htmlFor="cleanup-confirm-keyword"
              className="block text-xs font-medium text-rose-200"
            >
              Escribe <span className="font-mono font-bold text-white">{normalizedRequired}</span> para habilitar esta acción:
            </label>
            <input
              id="cleanup-confirm-keyword"
              type="text"
              value={typedKeyword}
              onChange={(e) => setTypedKeyword(e.target.value)}
              placeholder={normalizedRequired}
              disabled={isProcessing}
              autoComplete="off"
              className="w-full rounded-xl border border-rose-500/40 bg-[#0A0B0D] px-3 py-2 text-sm font-mono text-white placeholder:text-zinc-600 focus:border-rose-400 focus:outline-none"
            />
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="min-h-[42px] rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-40"
          >
            {cancelButtonLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!keywordValid || isProcessing) return;
              void onConfirm();
            }}
            disabled={!keywordValid || isProcessing}
            className={`inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${confirmBtnClass}`}
          >
            {isProcessing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DataCleanupConfirmModal;
