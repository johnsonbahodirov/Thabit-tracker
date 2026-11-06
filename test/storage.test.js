import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, normalizeImportedState } from '../src/domain.js';
import { readState, STORAGE_KEY, writeState } from '../src/storage.js';

test('a corrupt saved file is read-only and is never silently overwritten', () => {
  let writes = 0;
  const storage = {
    getItem: key => key === STORAGE_KEY ? '{broken json' : null,
    setItem: () => { writes += 1; }
  };
  const result = readState(storage);
  assert.equal(result.readOnly, true);
  assert.match(result.error, /original data has not been changed/i);
  assert.equal(writes, 0);
});

test('a valid backup round-trips through the application schema', () => {
  const state = createInitialState();
  const storage = {
    value: null,
    getItem() { return this.value; },
    setItem(key, value) { assert.equal(key, STORAGE_KEY); this.value = value; }
  };
  writeState(state, storage);
  assert.deepEqual(normalizeImportedState(JSON.parse(storage.value)).version, 1);
});

test('unavailable browser storage leaves the app in safe read-only mode', () => {
  const result = readState({ getItem() { throw new Error('blocked'); } });
  assert.equal(result.readOnly, true);
  assert.match(result.error, /could not be read safely/i);
  assert.equal(result.state.version, 1);
});