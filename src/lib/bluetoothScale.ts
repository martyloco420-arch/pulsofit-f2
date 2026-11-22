export const OKOK_REFERENCE_MAC = '80:F4:16:EF:23:77';

export const OKOK_SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';
export const OKOK_NOTIFY_CHAR_FFF1 = '0000fff1-0000-1000-8000-00805f9b34fb';
export const OKOK_WRITE_CHAR_FFF2 = '0000fff2-0000-1000-8000-00805f9b34fb';
export const OKOK_NOTIFY_CHAR_FFF3 = '0000fff3-0000-1000-8000-00805f9b34fb';
export const OKOK_NOTIFY_CHAR_FFB2 = '0000ffb2-0000-1000-8000-00805f9b34fb';

export interface BleReading {
  weightKg: number;
  impedanceOhm?: number;
  isStabilizedFlag: boolean;
  sourceProtocol?: 'gatt' | 'advertisement';
  rawHeaderHex?: string;
}

interface BluetoothRemoteGATTCharacteristicMinimal {
  uuid: string;
  properties: {
    notify: boolean;
    indicate: boolean;
    read: boolean;
    write?: boolean;
    writeWithoutResponse?: boolean;
  };
  startNotifications: () => Promise<BluetoothRemoteGATTCharacteristicMinimal>;
  stopNotifications: () => Promise<BluetoothRemoteGATTCharacteristicMinimal>;
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  readValue: () => Promise<DataView>;
  writeValue?: (value: BufferSource) => Promise<void>;
}

interface BluetoothRemoteGATTServiceMinimal {
  uuid: string;
  getCharacteristic?: (
    uuid: number | string,
  ) => Promise<BluetoothRemoteGATTCharacteristicMinimal>;
  getCharacteristics: () => Promise<BluetoothRemoteGATTCharacteristicMinimal[]>;
}

interface BluetoothRemoteGATTServerMinimal {
  connected: boolean;
  connect: () => Promise<BluetoothRemoteGATTServerMinimal>;
  disconnect: () => void;
  getPrimaryService?: (
    uuid: number | string,
  ) => Promise<BluetoothRemoteGATTServiceMinimal>;
  getPrimaryServices: () => Promise<BluetoothRemoteGATTServiceMinimal[]>;
}

interface BluetoothAdvertisingEventMinimal extends Event {
  device?: BluetoothDeviceMinimal;
  name?: string;
  manufacturerData?: Map<number, DataView>;
  serviceData?: Map<string, DataView>;
  rssi?: number;
}

export interface BluetoothDeviceMinimal {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServerMinimal;
  watchAdvertisements?: () => Promise<void>;
  unwatchAdvertisements?: () => void;
  watchingAdvertisements?: boolean;
  addEventListener?: (
    type: string,
    listener: (event: BluetoothAdvertisingEventMinimal) => void,
  ) => void;
  removeEventListener?: (
    type: string,
    listener: (event: BluetoothAdvertisingEventMinimal) => void,
  ) => void;
}

interface BluetoothLEScanMinimal {
  stop: () => void;
  active: boolean;
}

interface BluetoothRequestDeviceFilter {
  services?: (number | string)[];
  namePrefix?: string;
  manufacturerData?: { companyIdentifier: number }[];
}

interface NavigatorBluetooth {
  requestDevice: (options: {
    filters?: BluetoothRequestDeviceFilter[];
    optionalServices?: (number | string)[];
    acceptAllDevices?: boolean;
  }) => Promise<BluetoothDeviceMinimal>;
  requestLEScan?: (options: {
    filters?: BluetoothRequestDeviceFilter[];
    acceptAllAdvertisements?: boolean;
    keepRepeatedDevices?: boolean;
  }) => Promise<BluetoothLEScanMinimal>;
  addEventListener?: (
    type: string,
    listener: (event: BluetoothAdvertisingEventMinimal) => void,
  ) => void;
  removeEventListener?: (
    type: string,
    listener: (event: BluetoothAdvertisingEventMinimal) => void,
  ) => void;
}

export function isWebBluetoothSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'bluetooth' in navigator &&
    typeof (navigator as unknown as { bluetooth?: NavigatorBluetooth }).bluetooth
      ?.requestDevice === 'function'
  );
}

export function isBleAdvertisementScanSupported(): boolean {
  if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) return false;
  const bt = (navigator as unknown as { bluetooth?: NavigatorBluetooth }).bluetooth;
  return typeof bt?.requestLEScan === 'function';
}

const OPTIONAL_SCALE_SERVICES: (number | string)[] = [
  OKOK_SERVICE_UUID,
  '0000ffb0-0000-1000-8000-00805f9b34fb',
  0x181d, // Standard Weight Scale Service
  0x181b, // Standard Body Composition Service
  0x180a,
  0x180f,
];

const OKOK_NAME_PREFIXES = ['Chipsea', 'OKOK', 'KAYOFIT'];

function extractMacSuffixBytes(): number[] {
  return OKOK_REFERENCE_MAC.split(':').map((hex) => parseInt(hex, 16));
}

function bufferContainsReferenceMac(view: DataView): boolean {
  if (view.byteLength < 6) return false;
  const mac = extractMacSuffixBytes();
  const rev = [...mac].reverse();

  for (let i = 0; i <= view.byteLength - 6; i++) {
    let forwardMatch = true;
    let reverseMatch = true;
    for (let j = 0; j < 6; j++) {
      const b = view.getUint8(i + j);
      if (b !== mac[j]) forwardMatch = false;
      if (b !== rev[j]) reverseMatch = false;
    }
    if (forwardMatch || reverseMatch) return true;
  }
  return false;
}

/**
 * Converts a raw 16-bit OKOK / Chipsea weight integer to kilograms using the
 * property byte precision & unit bits:
 * - Precision bits ((props >> 1) & 0x03): 2 => /100, 0 => /10
 * - Unit bits ((props >> 3) & 0x03): 1 => jin (/20, or /200 if raw > 4000), 2 => lb
 * - Fallback heuristic: raw > 2000 ? raw / 100 : raw / 10
 */
export function convertOkokRawWeightToKg(rawWeight: number, propsByte: number): number {
  if (!Number.isFinite(rawWeight) || rawWeight <= 0) return 0;

  const precisionBits = (propsByte >> 1) & 0x03;
  const unitBits = (propsByte >> 3) & 0x03;

  // Unit reported by scale is jin (0.5 kg per jin)
  if (unitBits === 1) {
    const jinKg = precisionBits === 2 && rawWeight > 4000 ? rawWeight / 200 : rawWeight / 20;
    return Math.round(jinKg * 100) / 100;
  }

  let divisor: number;
  if (precisionBits === 2) {
    divisor = 100;
  } else if (precisionBits === 0) {
    divisor = 10;
  } else {
    divisor = rawWeight > 2000 ? 100 : 10;
  }

  let kg = rawWeight / divisor;

  // Unit reported by scale is lb
  if (unitBits === 2) {
    kg = kg * 0.45359237;
  }

  return Math.round(kg * 100) / 100;
}

/**
 * Decodes official OKOK / Chipsea GATT notification frames:
 * - byte[0]===0x02 (byte[1]===0x00) or byte[0]===0x06 (byte[1]===0x03 or 0x23):
 *   raw = getUint16(11, true), props = length > 15 ? byte[15] : 0x04
 * - byte[0]===0xC4, 0xC5, or 0xC8:
 *   raw = getUint16(6, true), props = byte[1]
 * - byte[0]===0xCB && (byte[1] & 0x03)===0:
 *   raw = getUint16(7, true), props = byte[2]
 */
export function decodeChipseaOkokFrame(
  view: DataView,
  sourceProtocol: 'gatt' | 'advertisement' = 'gatt',
): BleReading | null {
  if (view.byteLength < 4) return null;
  const b0 = view.getUint8(0);
  const b1 = view.getUint8(1);

  let rawWeight: number | null = null;
  let props = 0x04;
  let isStabilizedFlag = false;
  let impedanceOhm: number | undefined;

  // 1) Frame 0x02 (b1===0x00) or 0x06 (b1===0x03 or 0x23)
  if (
    ((b0 === 0x02 && b1 === 0x00) ||
      (b0 === 0x06 && (b1 === 0x03 || b1 === 0x23))) &&
    view.byteLength >= 13
  ) {
    rawWeight = view.getUint16(11, true);
    props = view.byteLength > 15 ? view.getUint8(15) : 0x04;
    isStabilizedFlag =
      (props & 0x01) !== 0 ||
      (props & 0x20) !== 0 ||
      (b0 === 0x06 && b1 === 0x23);

    if (view.byteLength >= 11) {
      const impCandidate = view.getUint16(9, true);
      if (impCandidate >= 150 && impCandidate <= 1500) {
        impedanceOhm = impCandidate;
      }
    }
  }
  // 2) Frame 0xC4, 0xC5, or 0xC8
  else if ((b0 === 0xc4 || b0 === 0xc5 || b0 === 0xc8) && view.byteLength >= 8) {
    rawWeight = view.getUint16(6, true);
    props = b1;
    isStabilizedFlag =
      (props & 0x01) !== 0 ||
      (props & 0x20) !== 0 ||
      b0 === 0xc5 ||
      b0 === 0xc8;

    if (view.byteLength >= 10) {
      const impCandidate = view.getUint16(8, true);
      if (impCandidate >= 150 && impCandidate <= 1500) {
        impedanceOhm = impCandidate;
      }
    }
  }
  // 3) Frame 0xCB with (byte[1] & 0x03) === 0
  else if (b0 === 0xcb && (b1 & 0x03) === 0 && view.byteLength >= 9) {
    rawWeight = view.getUint16(7, true);
    props = view.getUint8(2);
    isStabilizedFlag = (props & 0x01) !== 0 || (props & 0x20) !== 0;

    if (view.byteLength >= 11) {
      const impCandidate = view.getUint16(9, true);
      if (impCandidate >= 150 && impCandidate <= 1500) {
        impedanceOhm = impCandidate;
      }
    }
  }

  if (rawWeight === null) return null;

  const weightKg = convertOkokRawWeightToKg(rawWeight, props);
  if (weightKg < 10 || weightKg > 300) return null;

  return {
    weightKg,
    impedanceOhm,
    isStabilizedFlag,
    sourceProtocol,
    rawHeaderHex: `0x${b0.toString(16).padStart(2, '0').toUpperCase()}`,
  };
}

/**
 * Decodes OKOK / Chipsea BLE advertising manufacturerData packets,
 * prioritizing 0xCA and 0xFF manufacturer frame headers (optional watchAdvertisements fallback).
 */
export function decodeOkokAdvertisementData(
  manufacturerData?: Map<number, DataView>,
  deviceName?: string,
): BleReading | null {
  if (!manufacturerData || manufacturerData.size === 0) return null;
  const upperName = (deviceName || '').toUpperCase();
  const isKnownName = OKOK_NAME_PREFIXES.some((p) =>
    upperName.includes(p.toUpperCase()),
  );

  for (const [companyId, view] of manufacturerData.entries()) {
    if (view.byteLength < 4) continue;

    // First check if manufacturerData directly embeds an exact Chipsea/OKOK frame (0x02/0x06/0xC4/0xC5/0xC8/0xCB)
    const directChipsea = decodeChipseaOkokFrame(view, 'advertisement');
    if (directChipsea) {
      return directChipsea;
    }

    const b0 = view.getUint8(0);
    const b1 = view.getUint8(1);
    const matchesRefMac = bufferContainsReferenceMac(view);
    const hasCaOrFfHeader =
      b0 === 0xca ||
      b0 === 0xff ||
      (companyId & 0xff) === 0xca ||
      (companyId & 0xff) === 0xff ||
      ((companyId >> 8) & 0xff) === 0xca ||
      ((companyId >> 8) & 0xff) === 0xff;

    const isOkokPacket =
      hasCaOrFfHeader ||
      companyId === 0x0010 ||
      companyId === 0xff01 ||
      companyId === 0xc000 ||
      matchesRefMac ||
      isKnownName;

    if (!isOkokPacket) continue;

    const isFinalFlag =
      (b1 & 0x01) !== 0 ||
      (b1 & 0x20) !== 0 ||
      (view.byteLength > 2 && (view.getUint8(2) & 0x20) !== 0);

    // Check embedded Chipsea frame offset by 1-2 bytes after 0xCA / 0xFF prefix
    for (const shift of [1, 2]) {
      if (view.byteLength >= shift + 8) {
        const subView = new DataView(
          view.buffer,
          view.byteOffset + shift,
          view.byteLength - shift,
        );
        const embedded = decodeChipseaOkokFrame(subView, 'advertisement');
        if (embedded) return embedded;
      }
    }

    // Standard 0xCA / 0xFF OKOK broadcast payload weight extraction
    const candidateOffsets: { raw: number; props: number }[] = [];
    if (view.byteLength >= 4) {
      candidateOffsets.push({
        raw: view.getUint16(2, false),
        props: view.byteLength > 4 ? view.getUint8(4) : 0x04,
      });
      candidateOffsets.push({
        raw: view.getUint16(2, true),
        props: view.byteLength > 4 ? view.getUint8(4) : 0x04,
      });
    }
    if (view.byteLength >= 8) {
      candidateOffsets.push({
        raw: view.getUint16(6, true),
        props: b1,
      });
    }
    if (view.byteLength >= 13) {
      candidateOffsets.push({
        raw: view.getUint16(11, true),
        props: view.byteLength > 15 ? view.getUint8(15) : 0x04,
      });
    }

    for (const cand of candidateOffsets) {
      const kgByProps = convertOkokRawWeightToKg(cand.raw, cand.props);
      const kgHeuristic =
        cand.raw > 2000
          ? Math.round((cand.raw / 100) * 100) / 100
          : Math.round((cand.raw / 10) * 100) / 100;
      const weightKg =
        kgByProps >= 20 && kgByProps <= 250 ? kgByProps : kgHeuristic;

      if (weightKg >= 20 && weightKg <= 250) {
        let impedanceOhm: number | undefined;
        for (const off of [4, 6, 8]) {
          if (view.byteLength >= off + 2) {
            const impBe = view.getUint16(off, false);
            const impLe = view.getUint16(off, true);
            if (impBe >= 150 && impBe <= 1500) {
              impedanceOhm = impBe;
              break;
            }
            if (impLe >= 150 && impLe <= 1500) {
              impedanceOhm = impLe;
              break;
            }
          }
        }
        return {
          weightKg,
          impedanceOhm,
          isStabilizedFlag: isFinalFlag,
          sourceProtocol: 'advertisement',
          rawHeaderHex: `0x${b0.toString(16).padStart(2, '0').toUpperCase()}`,
        };
      }
    }
  }
  return null;
}

export function decodeScalePayload(uuid: string, view: DataView): BleReading | null {
  if (view.byteLength < 3) return null;
  const lowerUuid = uuid.toLowerCase();

  // 1. Exact OKOK / Chipsea vendor frames (0x02/0x06/0xC4/0xC5/0xC8/0xCB)
  const chipseaReading = decodeChipseaOkokFrame(view, 'gatt');
  if (chipseaReading) {
    return chipseaReading;
  }

  // 2. Standard GATT Weight Measurement (0x2A9D)
  if (lowerUuid.includes('2a9d')) {
    const flags = view.getUint8(0);
    const isImperial = (flags & 0x01) !== 0;
    const rawWeight = view.getUint16(1, true);
    const weightKg = isImperial ? rawWeight * 0.01 * 0.453592 : rawWeight * 0.005;
    if (weightKg >= 10 && weightKg <= 300) {
      return {
        weightKg: Math.round(weightKg * 100) / 100,
        isStabilizedFlag: true,
        sourceProtocol: 'gatt',
      };
    }
  }

  // 3. Standard GATT Body Composition Measurement (0x2A9C)
  if (lowerUuid.includes('2a9c') && view.byteLength >= 4) {
    const flags = view.getUint16(0, true);
    const isImperial = (flags & 0x01) !== 0;
    const hasWeight = (flags & 0x0200) !== 0;
    const hasImpedance = (flags & 0x0100) !== 0;
    let offset = 4;
    if (flags & 0x0002) offset += 7;
    if (flags & 0x0004) offset += 1;
    if (flags & 0x0008) offset += 2;
    if (flags & 0x0010) offset += 2;
    if (flags & 0x0020) offset += 2;
    if (flags & 0x0040) offset += 2;
    if (flags & 0x0080) offset += 2;
    let impedanceOhm: number | undefined;
    if (hasImpedance && view.byteLength >= offset + 2) {
      impedanceOhm = view.getUint16(offset, true) * 0.1;
      offset += 2;
    }
    if (hasWeight && view.byteLength >= offset + 2) {
      const rawW = view.getUint16(offset, true);
      const weightKg = isImperial ? rawW * 0.01 * 0.453592 : rawW * 0.005;
      if (weightKg >= 10 && weightKg <= 300) {
        return {
          weightKg: Math.round(weightKg * 100) / 100,
          impedanceOhm,
          isStabilizedFlag: true,
          sourceProtocol: 'gatt',
        };
      }
    }
  }

  // 4. Generic fallback for non-standard 16-bit LE vendor weight frames
  for (let offset = 0; offset <= view.byteLength - 2; offset++) {
    const raw = view.getUint16(offset, true);
    const kg = raw > 2000 ? raw / 100 : raw / 10;
    if (kg >= 25 && kg <= 250) {
      return {
        weightKg: Math.round(kg * 100) / 100,
        isStabilizedFlag: false,
        sourceProtocol: 'gatt',
      };
    }
  }

  return null;
}

export interface BluetoothScaleConnection {
  deviceName: string;
  writeCharacteristic: BluetoothRemoteGATTCharacteristicMinimal | null;
  disconnect: () => void;
}

async function resolveCharacteristicByUuid(
  service: BluetoothRemoteGATTServiceMinimal,
  chars: BluetoothRemoteGATTCharacteristicMinimal[],
  targetUuid: string,
): Promise<BluetoothRemoteGATTCharacteristicMinimal | null> {
  const lower = targetUuid.toLowerCase();
  const shortHex = lower.slice(4, 8);
  const matched = chars.find(
    (c) =>
      c.uuid.toLowerCase() === lower || c.uuid.toLowerCase().includes(shortHex),
  );
  if (matched) return matched;
  if (typeof service.getCharacteristic === 'function') {
    try {
      return await service.getCharacteristic(targetUuid);
    } catch {
      return null;
    }
  }
  return null;
}

export async function connectBluetoothScale(
  broadScan: boolean,
  onReading: (reading: BleReading) => void,
  onStatus: (msg: string) => void,
): Promise<BluetoothScaleConnection> {
  const bluetooth = (navigator as unknown as { bluetooth?: NavigatorBluetooth }).bluetooth;
  if (!bluetooth) {
    throw new Error('Tu navegador no soporta Web Bluetooth.');
  }

  onStatus('Abriendo selector BLE (protocolo OKOK / Chipsea 0xFFF0)...');

  const okokFilters: BluetoothRequestDeviceFilter[] = [
    { services: [OKOK_SERVICE_UUID] },
    ...OKOK_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
  ];

  const device = await bluetooth.requestDevice(
    broadScan
      ? {
          acceptAllDevices: true,
          optionalServices: OPTIONAL_SCALE_SERVICES,
        }
      : {
          filters: okokFilters,
          optionalServices: OPTIONAL_SCALE_SERVICES,
        },
  );

  // Optional backup: watch BLE advertisements when supported (0xCA / 0xFF manufacturerData)
  let watchingAd = false;
  const adListener = (ev: BluetoothAdvertisingEventMinimal) => {
    const decoded = decodeOkokAdvertisementData(ev.manufacturerData, ev.name || device.name);
    if (decoded) {
      onReading(decoded);
    }
  };
  if (typeof device.watchAdvertisements === 'function' && device.addEventListener) {
    try {
      device.addEventListener('advertisementreceived', adListener);
      await device.watchAdvertisements();
      watchingAd = true;
    } catch {
      // Advertisement watching is optional backup alongside GATT notifications
    }
  }

  if (!device.gatt) {
    if (watchingAd) {
      onStatus('Escuchando anuncios BLE (0xCA/0xFF). Súbete a la báscula...');
      return {
        deviceName: device.name || 'Báscula OKOK / Chipsea',
        writeCharacteristic: null,
        disconnect: () => {
          device.removeEventListener?.('advertisementreceived', adListener);
          device.unwatchAdvertisements?.();
        },
      };
    }
    throw new Error('El dispositivo seleccionado no expone servicios GATT.');
  }

  onStatus(`Conectando con ${device.name || 'báscula OKOK / Chipsea'}...`);
  const server = await device.gatt.connect();

  const subscribedChars: BluetoothRemoteGATTCharacteristicMinimal[] = [];
  let writeCharacteristic: BluetoothRemoteGATTCharacteristicMinimal | null = null;

  const subscribeChar = async (ch: BluetoothRemoteGATTCharacteristicMinimal) => {
    ch.addEventListener('characteristicvaluechanged', (ev: Event) => {
      const target = ev.target as unknown as { value?: DataView };
      if (!target?.value) return;
      const parsed = decodeScalePayload(ch.uuid, target.value);
      if (parsed) {
        onReading(parsed);
      }
    });
    await ch.startNotifications();
    subscribedChars.push(ch);
  };

  // 1) Try exact OKOK / Chipsea primary service 0000fff0-0000-1000-8000-00805f9b34fb
  let fff0Service: BluetoothRemoteGATTServiceMinimal | null = null;
  if (typeof server.getPrimaryService === 'function') {
    try {
      fff0Service = await server.getPrimaryService(OKOK_SERVICE_UUID);
    } catch {
      fff0Service = null;
    }
  }

  const allServices = await server.getPrimaryServices().catch(() => [] as BluetoothRemoteGATTServiceMinimal[]);
  if (!fff0Service) {
    fff0Service =
      allServices.find(
        (s) =>
          s.uuid.toLowerCase() === OKOK_SERVICE_UUID ||
          s.uuid.toLowerCase().includes('fff0'),
      ) ?? null;
  }

  if (fff0Service) {
    try {
      const fff0Chars = await fff0Service.getCharacteristics();

      // Save write characteristic 0000fff2-0000-1000-8000-00805f9b34fb if available
      writeCharacteristic = await resolveCharacteristicByUuid(
        fff0Service,
        fff0Chars,
        OKOK_WRITE_CHAR_FFF2,
      );

      // Prefer fff1, fallback to fff3 or ffb2
      const fff1 = await resolveCharacteristicByUuid(
        fff0Service,
        fff0Chars,
        OKOK_NOTIFY_CHAR_FFF1,
      );
      if (fff1 && (fff1.properties.notify || fff1.properties.indicate)) {
        await subscribeChar(fff1);
      } else {
        const fff3 = await resolveCharacteristicByUuid(
          fff0Service,
          fff0Chars,
          OKOK_NOTIFY_CHAR_FFF3,
        );
        if (fff3 && (fff3.properties.notify || fff3.properties.indicate)) {
          await subscribeChar(fff3);
        }
      }
    } catch {
      // Fallback to general characteristic discovery below
    }
  }

  // Try 0000ffb2 across services if fff1/fff3 not subscribed yet
  if (subscribedChars.length === 0) {
    for (const service of allServices) {
      try {
        const chars = await service.getCharacteristics();
        const ffb2 = await resolveCharacteristicByUuid(
          service,
          chars,
          OKOK_NOTIFY_CHAR_FFB2,
        );
        if (ffb2 && (ffb2.properties.notify || ffb2.properties.indicate)) {
          await subscribeChar(ffb2);
          break;
        }
      } catch {
        // Ignore unavailable service
      }
    }
  }

  // Fallback to any standard notify/indicate scale characteristic (e.g., 0x2A9D / 0x2A9C)
  if (subscribedChars.length === 0) {
    for (const service of allServices) {
      try {
        const chars = await service.getCharacteristics();
        for (const ch of chars) {
          if (ch.properties.notify || ch.properties.indicate) {
            await subscribeChar(ch);
          }
        }
      } catch {
        // Skip protected characteristics
      }
    }
  }

  if (subscribedChars.length === 0 && !watchingAd) {
    throw new Error(
      'Conectado, pero la báscula no publicó notificaciones compatibles (fff1/fff3/ffb2). Usa captura manual o importa una captura.',
    );
  }

  onStatus('Conectado · Súbete a la báscula para medir en tiempo real...');

  return {
    deviceName: device.name || 'Báscula OKOK / Chipsea',
    writeCharacteristic,
    disconnect: () => {
      if (watchingAd) {
        device.removeEventListener?.('advertisementreceived', adListener);
        device.unwatchAdvertisements?.();
      }
      for (const ch of subscribedChars) {
        ch.stopNotifications().catch(() => {});
      }
      if (device.gatt?.connected) {
        device.gatt.disconnect();
      }
    },
  };
}

/**
 * Passive BLE Advertisement scan for 0xCA / 0xFF OKOK broadcasts (unpaired reading).
 * Preserves the exact OKOK / Chipsea manufacturerData decoder above.
 */
export async function scanOkokAdvertisements(
  onReading: (reading: BleReading, deviceLabel: string) => void,
  onStatus: (msg: string) => void,
): Promise<{ disconnect: () => void; scan: BluetoothLEScanMinimal }> {
  const bluetooth =
    typeof navigator !== 'undefined'
      ? (navigator as unknown as { bluetooth?: NavigatorBluetooth }).bluetooth
      : undefined;

  if (!bluetooth || typeof bluetooth.requestLEScan !== 'function') {
    throw new Error(
      'Tu navegador no tiene habilitado el escaneo BLE sin emparejar (requestLEScan). En Android Chrome activa la bandera chrome://flags/#enable-experimental-web-platform-features, o usa el emparejamiento tradicional (requestDevice) / captura manual.',
    );
  }

  onStatus('Buscando báscula...');

  let scan: BluetoothLEScanMinimal;
  try {
    scan = await bluetooth.requestLEScan({
      acceptAllAdvertisements: true,
      keepRepeatedDevices: true,
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : '';
    const isCancelledOrBlocked =
      rawMsg.toLowerCase().includes('cancel') ||
      rawMsg.toLowerCase().includes('denied') ||
      rawMsg.toLowerCase().includes('permission') ||
      rawMsg.toLowerCase().includes('feature') ||
      rawMsg.toLowerCase().includes('support');

    throw new Error(
      isCancelledOrBlocked
        ? 'El navegador o el usuario bloqueó el escaneo BLE pasivo. Si estás en Android Chrome, verifica que esté activa la bandera chrome://flags/#enable-experimental-web-platform-features, o usa el emparejamiento tradicional (requestDevice) o captura manual.'
        : rawMsg ||
          'No se pudo iniciar el escaneo BLE pasivo. Activa chrome://flags/#enable-experimental-web-platform-features en Android Chrome o usa requestDevice / captura manual.',
    );
  }

  onStatus('Súbete a la báscula...');

  const handler = (ev: BluetoothAdvertisingEventMinimal) => {
    const devName = ev.device?.name || ev.name || '';
    const decoded = decodeOkokAdvertisementData(ev.manufacturerData, devName);
    if (decoded) {
      onReading(decoded, devName || `OKOK (${OKOK_REFERENCE_MAC})`);
    }
  };

  bluetooth.addEventListener?.('advertisementreceived', handler);

  let stopped = false;
  return {
    scan,
    disconnect: () => {
      if (stopped) return;
      stopped = true;
      try {
        if (typeof scan.stop === 'function') {
          scan.stop();
        }
      } catch {
        // Ignore stop errors
      }
      bluetooth.removeEventListener?.('advertisementreceived', handler);
    },
  };
}
