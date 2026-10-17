// Promoted to shared/forge/services/budgets.js (spec 305 / 328 kernel slice).
// This shim keeps VR Forge's imports, storage key and saved runs valid.
import { createBudgetStorage } from '../../shared/forge/services/budgets.js';

export {
  UNLIMITED_KEYS, OPEN_ENDED_KEYS, formatBudget, isUnlimitedBudget,
  createBudgetLedger,
  defaultBudgets,
  normalizeBudgets,
  utf8Bytes,
  validateBudgets,
} from '../../shared/forge/services/budgets.js';

const storage = createBudgetStorage('vr-forge-budgets');

export const BUDGET_STORAGE_KEY = storage.BUDGET_STORAGE_KEY;
export const loadBudgets = storage.loadBudgets;
export const saveBudgets = storage.saveBudgets;
