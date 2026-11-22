export interface HeartRateZone {
  zone: 1 | 2 | 3 | 4 | 5;
  label: string;
  shortLabel: string;
  colorClass: string;
  bgClass: string;
  pctMax: number;
}

export interface HeartRateDeviceHandle {
  deviceName: string;
  disconnect: () => void;
}

export function isBluetoothHeartRateSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'bluetooth' in navigator &&
    typeof (navigator as unknown as { bluetooth?: { requestDevice?: unknown } }).bluetooth
      ?.requestDevice === 'function'
  );
}

export function computeHeartRateZone(bpm: number, age: number): HeartRateZone {
  const maxHr = Math.max(130, 220 - Math.max(14, Math.min(95, age || 28)));
  const pct = Math.min(100, Math.max(0, Math.round((bpm / maxHr) * 100)));

  if (pct < 60) {
    return {
      zone: 1,
      label: 'Z1 · Recuperación',
      shortLabel: 'Z1',
      colorClass: 'text-sky-300',
      bgClass: 'bg-sky-500/20 border-sky-400/40',
      pctMax: pct,
    };
  }
  if (pct < 70) {
    return {
      zone: 2,
      label: 'Z2 · Base Aeróbica',
      shortLabel: 'Z2',
      colorClass: 'text-emerald-300',
      bgClass: 'bg-emerald-500/20 border-emerald-400/40',
      pctMax: pct,
    };
  }
  if (pct < 80) {
    return {
      zone: 3,
      label: 'Z3 · Tempo',
      shortLabel: 'Z3',
      colorClass: 'text-[#D4FF33]',
      bgClass: 'bg-[#D4FF33]/15 border-[#D4FF33]/40',
      pctMax: pct,
    };
  }
  if (pct < 90) {
    return {
      zone: 4,
      label: 'Z4 · Umbral',
      shortLabel: 'Z4',
      colorClass: 'text-amber-300',
      bgClass: 'bg-amber-500/20 border-amber-400/40',
      pctMax: pct,
    };
  }
  return {
    zone: 5,
    label: 'Z5 · Máximo',
    shortLabel: 'Z5',
    colorClass: 'text-rose-300',
    bgClass: 'bg-rose-500/20 border-rose-400/40',
    pctMax: pct,
  };
}

export function parseHeartRateMeasurement(value: DataView): number {
  const flags = value.getUint8(0);
  const is16Bit = (flags & 0x01) !== 0;
  return is16Bit ? value.getUint16(1, true) : value.getUint8(1);
}

export async function connectBluetoothHeartRateMonitor(
  onBpm: (bpm: number) => void,
  onDisconnect: () => void,
): Promise<HeartRateDeviceHandle> {
  if (!isBluetoothHeartRateSupported()) {
    throw new Error(
      'Web Bluetooth no está disponible en este navegador. Usa Chrome en Android o escritorio por HTTPS.',
    );
  }

  const navBle = navigator as unknown as {
    bluetooth: {
      requestDevice: (opts: { filters: { services: number[] }[] }) => Promise<{
        name?: string;
        addEventListener: (ev: string, fn: () => void) => void;
        gatt?: {
          connected: boolean;
          disconnect: () => void;
          connect: () => Promise<{
            getPrimaryService: (uuid: number) => Promise<{
              getCharacteristic: (uuid: number) => Promise<{
                startNotifications: () => Promise<unknown>;
                addEventListener: (
                  ev: string,
                  fn: (e: { target: { value: DataView | null } }) => void,
                ) => void;
              }>;
            }>;
          }>;
        };
      }>;
    };
  };

  const device = await navBle.bluetooth.requestDevice({
    filters: [{ services: [0x180d] }],
  });

  if (!device.gatt) {
    throw new Error('El dispositivo seleccionado no expone perfil GATT de pulso.');
  }

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(0x180d);
  const characteristic = await service.getCharacteristic(0x2a37);

  characteristic.addEventListener('characteristicvaluechanged', (event) => {
    const dv = event.target?.value;
    if (!dv) return;
    const bpm = parseHeartRateMeasurement(dv);
    if (bpm > 25 && bpm < 245) {
      onBpm(bpm);
    }
  });

  device.addEventListener('gattserverdisconnected', () => {
    onDisconnect();
  });

  await characteristic.startNotifications();

  return {
    deviceName: device.name || 'Sensor de Pulso BLE',
    disconnect: () => {
      try {
        if (device.gatt?.connected) {
          device.gatt.disconnect();
        }
      } catch {
        // Ignore disconnect errors
      }
    },
  };
}
