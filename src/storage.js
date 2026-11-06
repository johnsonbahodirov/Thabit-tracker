import { createInitialState, normalizeImportedState } from './domain.js';

export const STORAGE_KEY = 'thabit-tracker-data';

export function readState(storage) {
  try {
    const raw = (storage || globalThis.localStorage).getItem(STORAGE_KEY);
    if (!raw) return { state: createInitialState(), readOnly: false, error: null, isNew: true };
    return { state: normalizeImportedState(JSON.parse(raw)), readOnly: false, error: null, isNew: false };
  } catch (error) {
    return {
      state: createInitialState(),
      readOnly: true,
      error: `Local data could not be read safely: ${error.message} Your original data has not been changed.`,
      isNew: false
    };
  }
}

export function writeState(state, storage) {
  (storage || globalThis.localStorage).setItem(STORAGE_KEY, JSON.stringify(state));
}