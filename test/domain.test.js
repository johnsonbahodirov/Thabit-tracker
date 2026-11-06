import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, closestAchievement, createInitialState, getHabitStreak,
  getPeriodStats, getScheduledWeekdays, isScheduled, localDateKey, normalizeImportedState,
  recordFocusSession, setCompletion, startOfWeek, totalXp
} from '../src/domain.js';

function habit(overrides = {}) {
  return {
    id: 'read', name: 'Read', type: 'done', target: 1, startDate: '2026-01-01',
    endDate: '', status: 'active', pausedRanges: [], schedule: { type: 'weekdays', weekdays: [1, 2, 3, 4, 5] },
    ...overrides
  };
}

test('date helpers use local calendar days without UTC conversion', () => {
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(startOfWeek('2026-11-06'), '2026-11-02');
  assert.match(localDateKey(new Date(2026, 10, 6, 0)), /^2026-11-06$/);
});

test('weekday schedule excludes unscheduled days, end dates, and paused ranges', () => {
  const item = habit({ endDate: '2026-01-09', pausedRanges: [{ from: '2026-01-07', to: '2026-01-08' }] });
  assert.equal(isScheduled(item, '2026-01-05'), true);
  assert.equal(isScheduled(item, '2026-01-10'), false);
  assert.equal(isScheduled(item, '2026-01-07'), false);
  assert.equal(isScheduled(item, '2026-01-12'), false);
});

test('weekly-count schedules have deterministic calendar days', () => {
  const item = habit({ schedule: { type: 'weeklyCount', daysPerWeek: 3 } });
  assert.deepEqual(getScheduledWeekdays(item), [1, 3, 5]);
  assert.equal(isScheduled(item, '2026-01-05'), true);
  assert.equal(isScheduled(item, '2026-01-06'), false);
  assert.equal(isScheduled(item, '2026-01-07'), true);
  assert.equal(isScheduled(item, '2026-01-09'), true);
});

test('custom schedules repeat from the habit start date', () => {
  const item = habit({ schedule: { type: 'custom', intervalDays: 3 } });
  assert.equal(isScheduled(item, '2026-01-01'), true);
  assert.equal(isScheduled(item, '2026-01-04'), true);
  assert.equal(isScheduled(item, '2026-01-03'), false);
});

test('archived habits retain their past schedule but are not scheduled after archiving', () => {
  const item = habit({ status: 'archived', archivedAt: '2026-01-08' });
  assert.equal(isScheduled(item, '2026-01-07'), true);
  assert.equal(isScheduled(item, '2026-01-08'), false);
});

test('inactive archive ranges do not break a streak when a habit is restored', () => {
  const item = habit({ schedule: { type: 'daily' }, pausedRanges: [{ from: '2026-01-05', to: '2026-01-07' }] });
  const state = createInitialState();
  state.habits.push(item);
  state.completions.push(
    { habitId: item.id, date: '2026-01-04', value: 1 },
    { habitId: item.id, date: '2026-01-08', value: 1 }
  );
  assert.deepEqual(getHabitStreak(state, item, '2026-01-08'), { current: 2, longest: 2 });
});

test('completion updates one record and awards XP only once, including undo and redo', () => {
  const state = createInitialState();
  state.habits.push(habit());
  const completed = setCompletion(state, 'read', '2026-01-05', 1, '2026-01-05');
  const undone = setCompletion(completed, 'read', '2026-01-05', 0, '2026-01-05');
  const redone = setCompletion(undone, 'read', '2026-01-05', 1, '2026-01-05');
  assert.equal(completed.completions.length, 1);
  assert.equal(redone.completions.length, 1);
  assert.equal(totalXp(completed), 30);
  assert.equal(undone.unlockedAchievements.includes('first-step'), false);
  assert.equal(redone.unlockedAchievements.includes('first-step'), true);
  assert.equal(totalXp(undone), 0);
  assert.equal(totalXp(redone), 0);
});

test('streaks skip unscheduled days and stop at missed scheduled dates', () => {
  const state = createInitialState();
  const item = habit();
  state.habits.push(item);
  state.completions.push(
    { habitId: item.id, date: '2026-01-05', value: 1 },
    { habitId: item.id, date: '2026-01-06', value: 1 },
    { habitId: item.id, date: '2026-01-08', value: 1 },
    { habitId: item.id, date: '2026-01-09', value: 1 }
  );
  assert.deepEqual(getHabitStreak(state, item, '2026-01-09'), { current: 2, longest: 2 });
});

test('period statistics count only scheduled habit dates', () => {
  const state = createInitialState();
  const item = habit();
  state.habits.push(item);
  state.completions.push({ habitId: item.id, date: '2026-01-05', value: 1 });
  assert.deepEqual(getPeriodStats(state, '2026-01-05', '2026-01-11'), {
    due: 5, done: 1, rate: 20, durationMinutes: 0
  });
});

test('duration totals normalize hours to minutes', () => {
  const state = createInitialState();
  const item = habit({ id: 'stretch', type: 'duration', target: 1, unit: 'hours', schedule: { type: 'daily' } });
  state.habits.push(item);
  state.completions.push({ habitId: item.id, date: '2026-01-05', value: 0.5 });
  assert.equal(getPeriodStats(state, '2026-01-05', '2026-01-05').durationMinutes, 30);
});

test('closest achievement reflects actual progress and backup validation rejects duplicates', () => {
  const state = createInitialState();
  const item = habit();
  state.habits.push(item);
  for (const date of ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08']) {
    state.completions.push({ habitId: item.id, date, value: 1 });
  }
  state.unlockedAchievements.push('first-step');
  assert.equal(closestAchievement(state, '2026-01-08').id, 'five-days');
  const invalid = { ...state, completions: [...state.completions, state.completions[0]] };
  assert.throws(() => normalizeImportedState(invalid), /duplicate completion/i);
  assert.throws(() => normalizeImportedState({ ...state, habits: [habit({ schedule: { type: 'custom', weekdays: [] } })] }), /scheduled weekdays/i);
});

test('skipped focus sessions do not earn XP and a completed Pomodoro is idempotent', () => {
  const state = createInitialState();
  const skipped = recordFocusSession(state, { id: 'skip-1', mode: 'pomodoro', outcome: 'skipped', elapsedSeconds: 30 });
  const completed = recordFocusSession(skipped, { id: 'focus-1', mode: 'pomodoro', outcome: 'completed', elapsedSeconds: 1500 });
  const duplicate = recordFocusSession(completed, { id: 'focus-1', mode: 'pomodoro', outcome: 'completed', elapsedSeconds: 1500 });
  assert.equal(totalXp(skipped), 0);
  assert.equal(totalXp(completed), 15);
  assert.equal(totalXp(duplicate), 15);
  assert.equal(duplicate.focusSessions.length, 2);
});