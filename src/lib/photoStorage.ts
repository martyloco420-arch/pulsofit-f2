const PHOTO_DB_NAME = 'pulsofit_photos_db';
const PHOTO_DB_VERSION = 1;
const PHOTO_STORE_NAME = 'progress_photos';

function openPhotoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible en este navegador.'));
      return;
    }
    const req = indexedDB.open(PHOTO_DB_NAME, PHOTO_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE_NAME)) {
        db.createObjectStore(PHOTO_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir la base de fotos.'));
  });
}

export async function compressImageFileToJpegBlob(
  file: File,
  maxDimension = 1280,
  quality = 0.82,
): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo procesar la imagen seleccionada.'));
      el.src = objectUrl;
    });

    const ratio = Math.min(1, maxDimension / Math.max(img.width, img.height, 1));
    const width = Math.max(1, Math.round(img.width * ratio));
    const height = Math.max(1, Math.round(img.height * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('No se pudo inicializar el lienzo de imagen.');
    }
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) resolve(result);
          else reject(new Error('No se pudo comprimir la fotografía.'));
        },
        'image/jpeg',
        quality,
      );
    });
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function saveProgressPhotoBlob(id: string, blob: Blob): Promise<void> {
  const db = await openPhotoDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE_NAME, 'readwrite');
      const store = tx.objectStore(PHOTO_STORE_NAME);
      const req = store.put(blob, id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('Error al guardar foto.'));
    });
  } finally {
    db.close();
  }
}

export async function loadProgressPhotoBlob(id: string): Promise<Blob | null> {
  try {
    const db = await openPhotoDb();
    try {
      return await new Promise<Blob | null>((resolve, reject) => {
        const tx = db.transaction(PHOTO_STORE_NAME, 'readonly');
        const store = tx.objectStore(PHOTO_STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve((req.result as Blob) ?? null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function deleteProgressPhotoBlob(id: string): Promise<void> {
  try {
    const db = await openPhotoDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(PHOTO_STORE_NAME, 'readwrite');
        const store = tx.objectStore(PHOTO_STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Ignore deletion errors
  }
}

export async function deleteProgressPhotoBlobs(ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  try {
    const db = await openPhotoDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(PHOTO_STORE_NAME, 'readwrite');
        const store = tx.objectStore(PHOTO_STORE_NAME);
        for (const id of ids) {
          if (id) store.delete(id);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Ignore batch photo deletion errors
  }
}

export async function clearAllProgressPhotoBlobs(): Promise<void> {
  try {
    const db = await openPhotoDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(PHOTO_STORE_NAME, 'readwrite');
        const store = tx.objectStore(PHOTO_STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Ignore clear photo DB errors
  }
}

