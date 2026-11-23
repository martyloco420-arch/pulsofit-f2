import type { BarcodeProductLookup } from './aiClient';

const BARCODE_CACHE_DB_NAME = 'pulsofit_barcode_cache';
const BARCODE_CACHE_DB_VERSION = 1;
const BARCODE_CACHE_STORE = 'products';

export interface CachedBarcodeProduct extends BarcodeProductLookup {
  updatedAt: number;
}

let cachedDbPromise: Promise<IDBDatabase | null> | null = null;

function normalizeBarcodeKey(code: string): string {
  return code.replace(/[^0-9A-Za-z]/g, '').trim();
}

function openBarcodeCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (cachedDbPromise) {
    return cachedDbPromise;
  }

  cachedDbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(
        BARCODE_CACHE_DB_NAME,
        BARCODE_CACHE_DB_VERSION,
      );

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(BARCODE_CACHE_STORE)) {
          db.createObjectStore(BARCODE_CACHE_STORE, { keyPath: 'barcode' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          cachedDbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        cachedDbPromise = null;
        resolve(null);
      };

      request.onblocked = () => {
        resolve(null);
      };
    } catch {
      cachedDbPromise = null;
      resolve(null);
    }
  });

  return cachedDbPromise;
}

export async function getCachedBarcodeProduct(
  code: string,
): Promise<CachedBarcodeProduct | null> {
  const cleanCode = normalizeBarcodeKey(code);
  if (cleanCode.length < 4) return null;

  const db = await openBarcodeCacheDb();
  if (!db) return null;

  return new Promise<CachedBarcodeProduct | null>((resolve) => {
    try {
      const tx = db.transaction(BARCODE_CACHE_STORE, 'readonly');
      const store = tx.objectStore(BARCODE_CACHE_STORE);
      const req = store.get(cleanCode);
      req.onsuccess = () => {
        const result = req.result as CachedBarcodeProduct | undefined;
        if (result && typeof result.barcode === 'string' && result.per100g) {
          resolve(result);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveCachedBarcodeProduct(
  product: BarcodeProductLookup,
): Promise<void> {
  const cleanCode = normalizeBarcodeKey(product.barcode);
  if (cleanCode.length < 4) return;

  const db = await openBarcodeCacheDb();
  if (!db) return;

  const record: CachedBarcodeProduct = {
    ...product,
    barcode: cleanCode,
    updatedAt: Date.now(),
  };

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(BARCODE_CACHE_STORE, 'readwrite');
      const store = tx.objectStore(BARCODE_CACHE_STORE);
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
