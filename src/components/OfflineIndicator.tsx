import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed top-14 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-[#1B1E26] px-3.5 py-2 text-xs font-semibold text-amber-300 shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Modo sin conexión · Datos guardados en el dispositivo</span>
    </div>
  );
};
