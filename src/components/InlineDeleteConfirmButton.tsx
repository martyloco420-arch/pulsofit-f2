import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';

export interface InlineDeleteConfirmButtonProps {
  onConfirm: () => void;
  ariaLabel: string;
  confirmLabel?: string;
  title?: string;
  size?: 'sm' | 'md';
  className?: string;
  disabled?: boolean;
}

export const InlineDeleteConfirmButton: React.FC<InlineDeleteConfirmButtonProps> = ({
  onConfirm,
  ariaLabel,
  confirmLabel = '¿Borrar?',
  title,
  size = 'sm',
  className = '',
  disabled = false,
}) => {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => {
      setArmed(false);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (disabled) return;

    if (!armed) {
      setArmed(true);
      return;
    }

    setArmed(false);
    onConfirm();
  };

  if (armed) {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={`Confirmar: ${ariaLabel}`}
        title="Toca de nuevo para confirmar eliminación"
        disabled={disabled}
        className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-rose-600 font-bold text-white shadow-sm shadow-rose-950/60 transition hover:bg-rose-500 active:scale-95 disabled:opacity-50 ${
          size === 'md'
            ? 'min-h-[40px] px-3 text-xs'
            : 'min-h-[34px] px-2.5 text-[11px]'
        } ${className}`}
      >
        {confirmLabel}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      disabled={disabled}
      className={`inline-flex shrink-0 items-center justify-center rounded-xl border border-transparent text-zinc-400 transition hover:border-rose-500/30 hover:bg-rose-500/15 hover:text-rose-400 active:scale-95 disabled:opacity-40 ${
        size === 'md' ? 'min-h-[40px] min-w-[40px] p-2' : 'min-h-[34px] min-w-[34px] p-1.5'
      } ${className}`}
    >
      <Trash2 className={size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
    </button>
  );
};

export default InlineDeleteConfirmButton;
