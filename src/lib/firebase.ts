import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { normalizeDatabase } from './storage';
import type { AppDatabase } from '../types/fitness';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export function subscribeFirebaseAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogleCloudSync(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutCloudSync(): Promise<void> {
  await signOut(auth);
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

export interface CloudBackupMeta {
  localUpdatedAt: string;
  summary: {
    workoutsCount: number;
    foodLogsCount: number;
    cardioCount: number;
    weightKg: number;
  };
  database: AppDatabase;
}

export async function uploadDatabaseToCloud(
  user: User,
  database: AppDatabase,
): Promise<void> {
  const uid = user.uid;
  const docPath = `userBackups/${uid}`;
  const docRef = doc(db, 'userBackups', uid);

  // Strip progressPhoto binary references? Keep lightweight metadata but ensure clean Firestore map
  const cleanedPayload = stripUndefinedDeep({
    ...database,
    // Ensure required keys strictly exist for security rules
    schemaVersion: Number(database.schemaVersion || 1),
    updatedAt: String(database.updatedAt || new Date().toISOString()),
    profile: database.profile,
  });

  const summary = {
    workoutsCount: database.workouts.length,
    foodLogsCount: database.foodLogs.length,
    cardioCount: (database.cardioSessions ?? []).length,
    weightKg: Math.max(20, Math.min(400, Number(database.profile.weightKg || 75))),
  };

  const localUpdatedAt = String(database.updatedAt || new Date().toISOString()).slice(0, 40);

  try {
    const existingSnap = await getDoc(docRef);
    if (existingSnap.exists()) {
      await updateDoc(docRef, {
        schemaVersion: Number(database.schemaVersion || 1),
        localUpdatedAt,
        summary,
        payload: cleanedPayload,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(docRef, {
        ownerId: uid,
        appName: 'PulsoFit',
        schemaVersion: Number(database.schemaVersion || 1),
        localUpdatedAt,
        summary,
        payload: cleanedPayload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }
}

export async function downloadDatabaseFromCloud(
  user: User,
): Promise<CloudBackupMeta | null> {
  const uid = user.uid;
  const docPath = `userBackups/${uid}`;
  const docRef = doc(db, 'userBackups', uid);

  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    const data = snap.data() as {
      localUpdatedAt?: string;
      summary?: CloudBackupMeta['summary'];
      payload?: Partial<AppDatabase>;
    };
    if (!data?.payload) return null;
    return {
      localUpdatedAt: data.localUpdatedAt || '',
      summary: data.summary ?? {
        workoutsCount: 0,
        foodLogsCount: 0,
        cardioCount: 0,
        weightKg: 75,
      },
      database: normalizeDatabase(data.payload),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, docPath);
  }
}

export async function deleteCloudBackup(user: User): Promise<void> {
  const uid = user.uid;
  const docPath = `userBackups/${uid}`;
  const docRef = doc(db, 'userBackups', uid);
  try {
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}
