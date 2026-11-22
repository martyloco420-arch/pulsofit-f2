import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { HardwareManagerProvider } from './hooks/useHardwareManager.tsx';
import './index.css';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <HardwareManagerProvider>
    <App />
  </HardwareManagerProvider>,
);
