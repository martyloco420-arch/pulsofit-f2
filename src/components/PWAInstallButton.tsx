import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'compact' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={
          variant === 'card'
            ? 'w-full min-h-[52px] flex items-center justify-center gap-2.5 rounded-2xl bg-[#D4FF33] px-5 py-3.5 text-sm font-bold text-[#0A0B0D] active:scale-[0.98] transition-transform whitespace-nowrap'
            : 'min-h-[44px] flex items-center gap-2 rounded-xl bg-[#D4FF33] px-3.5 py-2 text-xs font-bold text-[#0A0B0D] active:scale-[0.98] transition-transform whitespace-nowrap shrink-0'
        }
      >
        <Download className="w-4 h-4 shrink-0" />
        Instalar app
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={
            variant === 'card'
              ? 'w-full min-h-[52px] flex items-center justify-center gap-2.5 rounded-2xl border border-[#2B303C] bg-[#161920] px-5 py-3.5 text-sm font-semibold text-[#F4F5F7] active:scale-[0.98] transition-transform whitespace-nowrap'
              : 'min-h-[44px] flex items-center gap-2 rounded-xl border border-[#2B303C] bg-[#161920] px-3.5 py-2 text-xs font-semibold text-[#F4F5F7] active:scale-[0.98] transition-transform whitespace-nowrap shrink-0'
          }
        >
          <Smartphone className="w-4 h-4 text-[#D4FF33] shrink-0" />
          Instalar en iOS
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-3xl border border-[#242934] bg-[#13151A] p-6 shadow-2xl">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-white font-display tracking-wide">
                  Instalar en iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Cerrar guía"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <ol className="mt-4 space-y-3 text-sm text-zinc-300 leading-relaxed">
                <li>
                  1. Toca el botón <strong className="text-white">Compartir</strong> en la barra inferior de Safari.
                </li>
                <li>
                  2. Desliza hacia abajo y selecciona <strong className="text-white">Agregar a inicio</strong>.
                </li>
                <li>
                  3. Confirma tocando <strong className="text-[#D4FF33]">Agregar</strong> arriba a la derecha.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-6 w-full min-h-[48px] rounded-2xl bg-[#D4FF33] text-sm font-bold text-[#0A0B0D] active:scale-[0.98] transition-transform"
              >
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
