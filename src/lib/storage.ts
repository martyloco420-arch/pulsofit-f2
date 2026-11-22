export {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_PROFILE_SLOTS,
  flushPendingAppDatabaseSaves,
  getLocalDateKey,
  getTodayIsoDate,
  isDatabaseHydrated,
  markProfileHydrated,
  persistProfileDatabaseImmediate,
  saveAppDatabase,
  scheduleSaveAppDatabase,
} from './storage/dbCore';

export type {
  BackupPreviewCounts,
  CategorySummaryItem,
  CleanupCategoryId,
  DataModuleRecordType,
  DayRecordBreakdown,
  HeavyHistoryPayload,
  LightweightPrefsPayload,
  RecordDeleteTarget,
} from './storage/dbCore';

export {
  createDefaultProfile,
  deleteProfileStorage,
  getActiveProfileId,
  loadProfileRegistry,
  normalizeCoachChatHistory,
  normalizeManualActivityMap,
  normalizeReadinessMap,
  normalizeScheduledRestDates,
  normalizeUserProfile,
  recalculateLatestWeightAndAdaptiveNutrition,
  saveProfileRegistry,
  setActiveProfileId,
} from './storage/profileRepo';

export {
  countWorkoutDomainByDate,
  deleteCardioRecord,
  deleteHiitRecord,
  deleteShoeRecord,
  deleteWorkoutRecord,
  filterWorkoutDomainByDate,
  normalizeCardioSession,
  normalizeHiitSession,
  normalizeMuscleFatigue,
  normalizeShoes,
  normalizeWorkoutDomain,
  normalizeWorkoutSession,
} from './storage/workoutRepo';

export {
  countBiometricsDomainByDate,
  deleteBloodPressureRecord,
  deleteMeasurementRecord,
  deleteProgressPhotoRecord,
  deletePulseRecord,
  deleteSleepRecord,
  filterBiometricsDomainByDate,
  normalizeBiometricsDomain,
  normalizeBloodPressureRecord,
  normalizeBodyScan,
  normalizeBodyWeights,
  normalizePulseRecord,
  normalizeSleepSession,
  removeBodyScanAndSyncWeights,
  removeBodyWeightRecord,
} from './storage/biometricsRepo';

export {
  countNutritionDomainByDate,
  createDefaultHydrationSettings,
  deleteFastingRecord,
  deleteFoodRecord,
  deleteHydrationLogRecord,
  filterNutritionDomainByDate,
  normalizeFoodLogs,
  normalizeHydrationSettings,
  normalizeNutritionDomain,
} from './storage/nutritionRepo';

export {
  clearCategoryInDb,
  clearProfileHistoryPreserveProfile,
  countRecordsByDate,
  createInitialDatabase,
  deleteDayRecordsInDb,
  deleteModuleRecordInDb,
  exportDatabaseToCsv,
  exportDatabaseToJson,
  getBackupAgeInfo,
  getLastJsonBackupAt,
  loadAppDatabase,
  normalizeDatabase,
  parseAndValidateBackupJson,
  summarizeBackupCounts,
  summarizeCategoryCounts,
  wipeAllPulsoFitStorage,
} from './storage/backupRepo';
