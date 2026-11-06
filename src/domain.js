export const DAY_MS = 24 * 60 * 60 * 1000;

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromDateKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function addDays(key, amount) {
  const date = fromDateKey(key);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

export function startOfWeek(key) {
  const date = fromDateKey(key);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return localDateKey(date);
}

export function dateRange(from, to) {
  const dates = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) dates.push(cursor);
  return dates;
}

export function createInitialState() {
  return {
    version: 1,
    habits: [],
    completions: [],
    categories: [
      { id: 'wellbeing', name: 'Wellbeing', color: '#318b72', icon: 'leaf' },
      { id: 'learning', name: 'Learning', color: '#d88745', icon: 'book' },
      { id: 'movement', name: 'Movement', color: '#4578a8', icon: 'bolt' }
    ],
    focusSessions: [],
    focus: {
      mode: 'pomodoro', status: 'idle', durationSeconds: 1500,
      remainingSeconds: 1500, endsAt: null, startedAt: null,
      activity: '', habitId: null
    },
    xpLedger: [],
    unlockedAchievements: [],
    settings: { weekStartsOn: 1, soundEnabled: false },
    createdAt: localDateKey()
  };
}

export function completionFor(state, habitId, date) {
  return state.completions.find(item => item.habitId === habitId && item.date === date);
}

export function isCompletionDone(habit, completion) {
  if (!completion) return false;
  const target = habit.type === 'done' ? 1 : Math.max(1, Number(habit.target) || 1);
  return Number(completion.value) >= target;
}

function pausedOn(habit, date) {
  return (habit.pausedRanges || []).some(range => range.from <= date && (!range.to || date <= range.to));
}

function dateOrdinal(key) {
  const [year, month, day] = key.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function getScheduledWeekdays(habit) {
  if (habit.schedule?.type === 'weekdays') return [...(habit.schedule.weekdays || [])];
  if (habit.schedule?.type !== 'weeklyCount') return [];
  const count = Math.max(1, Math.min(7, Number(habit.schedule.daysPerWeek) || 1));
  return {
    1: [3], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5],
    5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6]
  }[count];
}

export function isScheduled(habit, date) {
  if (!habit || date < habit.startDate || (habit.endDate && date > habit.endDate) || pausedOn(habit, date)) return false;
  if (habit.status === 'archived' && (!habit.archivedAt || date >= habit.archivedAt)) return false;
  const day = fromDateKey(date).getDay();
  if (['weekdays', 'weeklyCount'].includes(habit.schedule?.type)) return getScheduledWeekdays(habit).includes(day);
  if (habit.schedule?.type === 'custom') {
    const interval = Math.max(1, Number(habit.schedule.intervalDays) || 1);
    return (dateOrdinal(date) - dateOrdinal(habit.startDate)) % interval === 0;
  }
  return habit.schedule?.type === 'daily';
}

function scheduledDates(habit, from, to) {
  return dateRange(from, to).filter(date => isScheduled(habit, date));
}

export function getPeriodStats(state, from, to) {
  const habits = state.habits.filter(habit => habit.status !== 'archived');
  const due = [];
  for (const date of dateRange(from, to)) {
    for (const habit of habits) if (isScheduled(habit, date)) due.push({ habit, date });
  }
  const done = due.filter(({ habit, date }) => isCompletionDone(habit, completionFor(state, habit.id, date)));
  const durationMinutes = state.completions
    .filter(item => item.date >= from && item.date <= to)
    .reduce((sum, item) => {
      const habit = state.habits.find(entry => entry.id === item.habitId && entry.type === 'duration');
      const value = Math.max(0, Number(item.value) || 0);
      return sum + (habit ? value * (/^hours?$/i.test(habit.unit) ? 60 : 1) : 0);
    }, 0);
  return {
    due: due.length,
    done: done.length,
    rate: due.length ? Math.round((done.length / due.length) * 100) : 0,
    durationMinutes
  };
}

export function getHabitStreak(state, habit, today = localDateKey()) {
  let current = 0;
  let longest = 0;
  let run = 0;
  const from = habit.startDate || addDays(today, -3650);
  for (const date of scheduledDates(habit, from, today)) {
    if (isCompletionDone(habit, completionFor(state, habit.id, date))) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  longest = Math.max(longest, run);

  let cursor = today;
  const todayCompletion = completionFor(state, habit.id, today);
  if (!isCompletionDone(habit, todayCompletion)) {
    do { cursor = addDays(cursor, -1); }
    while (cursor >= from && !isScheduled(habit, cursor));
  }
  while (cursor >= from && isScheduled(habit, cursor)) {
    if (!isCompletionDone(habit, completionFor(state, habit.id, cursor))) break;
    current += 1;
    cursor = addDays(cursor, -1);
    while (cursor >= from && !isScheduled(habit, cursor)) cursor = addDays(cursor, -1);
  }
  return { current, longest };
}

export function totalXp(state) {
  return state.xpLedger.reduce((sum, entry) => sum + (entry.reversed ? 0 : entry.amount), 0);
}

export function getLevel(xp) {
  const level = Math.floor(Math.max(0, xp) / 100) + 1;
  return { level, current: xp % 100, next: 100 };
}

const achievementRules = [
  { id: 'first-step', name: 'First step', group: 'Beginner', description: 'Complete your first habit.', target: 1, xp: 20, value: s => s.completions.filter(item => s.habits.some(h => h.id === item.habitId && isCompletionDone(h, item))).length },
  { id: 'five-days', name: 'Finding rhythm', group: 'Consistency', description: 'Build a 5-day streak.', target: 5, xp: 30, value: (s, today) => Math.max(0, ...s.habits.map(h => getHabitStreak(s, h, today).longest)) },
  { id: 'fourteen-days', name: 'Two steady weeks', group: 'Consistency', description: 'Build a 14-day streak.', target: 14, xp: 65, value: (s, today) => Math.max(0, ...s.habits.map(h => getHabitStreak(s, h, today).longest)) },
  { id: 'thirty-days', name: 'A month of momentum', group: 'Long game', description: 'Build a 30-day streak.', target: 30, xp: 120, value: (s, today) => Math.max(0, ...s.habits.map(h => getHabitStreak(s, h, today).longest)) },
  { id: 'twenty-five', name: 'Quarter century', group: 'Beginner', description: 'Log 25 completed habits.', target: 25, xp: 45, value: s => s.completions.filter(item => s.habits.some(h => h.id === item.habitId && isCompletionDone(h, item))).length },
  { id: 'weekly-ten', name: 'A strong week', group: 'Weekly', description: 'Complete 10 habits this week.', target: 10, xp: 35, value: (s, today) => countCompleted(s, startOfWeek(today), today) },
  { id: 'monthly-sixty', name: 'Month in motion', group: 'Monthly', description: 'Complete 60 habits this month.', target: 60, xp: 75, value: (s, today) => countCompleted(s, `${today.slice(0, 7)}-01`, today) },
  { id: 'hundred', name: 'One hundred', group: 'Long game', description: 'Log 100 completed habits.', target: 100, xp: 100, value: s => s.completions.filter(item => s.habits.some(h => h.id === item.habitId && isCompletionDone(h, item))).length },
  { id: 'focus-five', name: 'Focus in', group: 'Focus', description: 'Finish 5 focus sessions.', target: 5, xp: 40, value: s => s.focusSessions.filter(session => session.outcome === 'completed').length }
];

function countCompleted(state, from, to) {
  return state.completions.filter(item => item.date >= from && item.date <= to)
    .filter(item => state.habits.some(habit => habit.id === item.habitId && isCompletionDone(habit, item))).length;
}

export function getAchievements(state, today = localDateKey()) {
  return achievementRules.map(rule => {
    const progress = Math.min(rule.target, rule.value(state, today));
    const difficulty = rule.xp >= 100 ? 'Ambitious' : rule.xp >= 50 ? 'Steady' : 'Starter';
    return { ...rule, difficulty, progress, unlocked: state.unlockedAchievements.includes(rule.id), ratio: progress / rule.target };
  });
}

export function closestAchievement(state, today = localDateKey()) {
  return getAchievements(state, today)
    .filter(item => !item.unlocked)
    .sort((a, b) => b.ratio - a.ratio)[0] || null;
}

function awardXp(state, id, amount) {
  if (state.xpLedger.some(entry => entry.id === id)) return;
  state.xpLedger.push({ id, amount, reversed: false, at: new Date().toISOString() });
}

function reverseXp(state, id) {
  const entry = state.xpLedger.find(item => item.id === id);
  if (entry) entry.reversed = true;
}

export function reconcileAchievements(previousState, nextState, today = localDateKey()) {
  const previousProgress = new Map(getAchievements(previousState, today).map(item => [item.id, item.progress >= item.target]));
  for (const achievement of getAchievements(nextState, today)) {
    const wasUnlocked = nextState.unlockedAchievements.includes(achievement.id);
    const isEarned = achievement.progress >= achievement.target;
    if (isEarned && !wasUnlocked) {
      nextState.unlockedAchievements.push(achievement.id);
      awardXp(nextState, `achievement:${achievement.id}`, achievement.xp);
    } else if (!isEarned && wasUnlocked && previousProgress.get(achievement.id)) {
      nextState.unlockedAchievements = nextState.unlockedAchievements.filter(id => id !== achievement.id);
      reverseXp(nextState, `achievement:${achievement.id}`);
    }
  }
  return nextState;
}

export function setCompletion(state, habitId, date, value, today = localDateKey()) {
  const habit = state.habits.find(item => item.id === habitId);
  if (!habit || !isScheduled(habit, date)) throw new Error('This habit is not scheduled for that date.');
  const next = structuredClone(state);
  const existingIndex = next.completions.findIndex(item => item.habitId === habitId && item.date === date);
  const existing = existingIndex >= 0 ? next.completions[existingIndex] : null;
  const target = habit.type === 'done' ? 1 : Math.max(1, Number(habit.target) || 1);
  const nextValue = Math.max(0, Math.min(Number(value) || 0, target));
  const wasDone = isCompletionDone(habit, existing);
  const isDone = nextValue >= target;

  if (nextValue === 0) {
    if (existingIndex >= 0) next.completions.splice(existingIndex, 1);
  } else {
    const record = { habitId, date, value: nextValue, updatedAt: new Date().toISOString() };
    if (existingIndex >= 0) next.completions[existingIndex] = record;
    else next.completions.push(record);
  }

  const rewardId = `completion:${habitId}:${date}`;
  if (!wasDone && isDone) awardXp(next, rewardId, 10);
  if (wasDone && !isDone) reverseXp(next, rewardId);
  return reconcileAchievements(state, next, today);
}

export function recordFocusSession(state, session, today = localDateKey()) {
  const next = structuredClone(state);
  if (next.focusSessions.some(item => item.id === session.id)) return next;
  next.focusSessions.unshift(session);
  if (session.outcome === 'completed' && session.mode === 'pomodoro') {
    awardXp(next, `focus:${session.id}`, 15);
  }
  return reconcileAchievements(state, next, today);
}

export function normalizeImportedState(data) {
  if (!data || typeof data !== 'object' || data.version !== 1) throw new Error('Unsupported or invalid backup format.');
  const requiredArrays = ['habits', 'completions', 'categories', 'focusSessions', 'xpLedger', 'unlockedAchievements'];
  for (const key of requiredArrays) if (!Array.isArray(data[key])) throw new Error(`Backup is missing a valid ${key} list.`);
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && localDateKey(fromDateKey(value)) === value;
  const normalized = structuredClone({ ...createInitialState(), ...data, focus: { ...createInitialState().focus, ...data.focus }, settings: { ...createInitialState().settings, ...data.settings } });
  const categoryIds = new Set();
  for (const category of normalized.categories) {
    if (!category.id || !category.name?.trim() || !/^#[\da-f]{6}$/i.test(category.color || '')) throw new Error('Backup contains an invalid category.');
    if (categoryIds.has(category.id)) throw new Error('Backup contains duplicate category IDs.');
    categoryIds.add(category.id);
  }
  const habitIds = new Set();
  for (const habit of normalized.habits) {
    const schedule = habit.schedule;
    if (!habit.id || !habit.name?.trim() || !validDate(habit.startDate) || !['done', 'quantity', 'duration'].includes(habit.type)) throw new Error('Backup contains an invalid habit.');
    if (habitIds.has(habit.id)) throw new Error('Backup contains duplicate habit IDs.');
    if (!['active', 'paused', 'archived'].includes(habit.status) || !schedule || !['daily', 'weekdays', 'weeklyCount', 'custom'].includes(schedule.type)) throw new Error('Backup contains an invalid habit schedule or status.');
    if (habit.type !== 'done' && (!Number.isFinite(habit.target) || habit.target < 1 || habit.target > 100000 || !habit.unit?.trim())) throw new Error('Backup contains an invalid habit target.');
    if (habit.endDate && (!validDate(habit.endDate) || habit.endDate < habit.startDate)) throw new Error('Backup contains an invalid habit end date.');
    if (habit.categoryId && !categoryIds.has(habit.categoryId)) throw new Error('Backup refers to a missing habit category.');
    if (habit.color && !/^#[\da-f]{6}$/i.test(habit.color)) throw new Error('Backup contains an invalid habit color.');
    if (['weekdays', 'custom'].includes(schedule.type) && (!Array.isArray(schedule.weekdays) || schedule.weekdays.length < 1 || schedule.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(schedule.weekdays).size !== schedule.weekdays.length)) throw new Error('Backup contains invalid scheduled weekdays.');
    if (schedule.type === 'weeklyCount' && (!Number.isInteger(schedule.daysPerWeek) || schedule.daysPerWeek < 1 || schedule.daysPerWeek > 7)) throw new Error('Backup contains an invalid weekly target.');
    if (schedule.type === 'custom' && (!Number.isInteger(schedule.intervalDays) || schedule.intervalDays < 1 || schedule.intervalDays > 30)) throw new Error('Backup contains an invalid custom interval.');
    if (!Array.isArray(habit.pausedRanges || []) || (habit.pausedRanges || []).some(range => !validDate(range.from) || (range.to && !validDate(range.to)) || (range.to && range.to < range.from))) throw new Error('Backup contains an invalid paused period.');
    if (habit.archivedAt && !validDate(habit.archivedAt)) throw new Error('Backup contains an invalid archive date.');
    habitIds.add(habit.id);
  }
  const completionKeys = new Set();
  for (const item of normalized.completions) {
    const habit = normalized.habits.find(entry => entry.id === item.habitId);
    const target = habit?.type === 'done' ? 1 : Number(habit?.target);
    if (!habit || !validDate(item.date) || !Number.isFinite(item.value) || item.value < 0 || item.value > target) throw new Error('Backup contains an invalid completion record.');
    const key = `${item.habitId}:${item.date}`;
    if (completionKeys.has(key)) throw new Error('Backup contains duplicate completion records.');
    completionKeys.add(key);
  }
  const sessionIds = new Set();
  for (const session of normalized.focusSessions) {
    if (!session.id || sessionIds.has(session.id) || !['pomodoro', 'stopwatch', 'countdown'].includes(session.mode) || !['completed', 'skipped', 'stopped'].includes(session.outcome) || !Number.isFinite(session.elapsedSeconds) || session.elapsedSeconds < 0 || !Number.isFinite(Date.parse(session.startedAt)) || !Number.isFinite(Date.parse(session.endedAt))) throw new Error('Backup contains an invalid focus session.');
    sessionIds.add(session.id);
  }
  const ledgerIds = new Set();
  for (const entry of normalized.xpLedger) {
    if (!entry.id || ledgerIds.has(entry.id) || !Number.isFinite(entry.amount) || entry.amount < 0 || typeof entry.reversed !== 'boolean') throw new Error('Backup contains an invalid XP record.');
    ledgerIds.add(entry.id);
  }
  if (new Set(normalized.unlockedAchievements).size !== normalized.unlockedAchievements.length || normalized.unlockedAchievements.some(id => typeof id !== 'string')) throw new Error('Backup contains invalid achievement records.');
  const focus = normalized.focus;
  if (!['pomodoro', 'stopwatch', 'countdown'].includes(focus.mode) || !['idle', 'running', 'paused'].includes(focus.status) || !Number.isFinite(focus.durationSeconds) || focus.durationSeconds < 0 || !Number.isFinite(focus.remainingSeconds) || focus.remainingSeconds < 0 || (focus.endsAt !== null && !Number.isFinite(focus.endsAt)) || (focus.startedAt !== null && !Number.isFinite(focus.startedAt))) throw new Error('Backup contains an invalid timer state.');
  return normalized;
}