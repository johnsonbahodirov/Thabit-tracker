import {
  addDays, closestAchievement, completionFor, createInitialState, dateRange,
  fromDateKey, getAchievements, getHabitStreak, getLevel, getPeriodStats,
  getScheduledWeekdays, isCompletionDone, isScheduled, localDateKey, normalizeImportedState,
  reconcileAchievements, recordFocusSession, setCompletion, startOfWeek, totalXp
} from './domain.js';
import { readState, STORAGE_KEY, writeState } from './storage.js';

const navItems = [
  { id: 'home', title: 'Home', icon: 'home' },
  { id: 'habits', title: 'Habits', icon: 'grid' },
  { id: 'focus', title: 'Focus', icon: 'timer' },
  { id: 'calendar', title: 'Calendar', icon: 'calendar' },
  { id: 'profile', title: 'Profile', icon: 'user' }
];
const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayLong = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const emojis = ['', '📚', '💧', '🏃', '🧘', '✍️', '🌱', '🎯', '☀️', '🎨', '💤', '🥗'];
const emojiOptions = emojis.slice(1);
const $ = selector => document.querySelector(selector);
const app = $('#app');
const modalRoot = $('#modal-root');
const toastEl = $('#toast');

let loaded = readState();
let state = loaded.state;
let readOnly = loaded.readOnly;
let storageError = loaded.error;
let page = 'home';
let selectedDate = localDateKey();
let calendarCursor = fromDateKey(`${selectedDate.slice(0, 7)}-01`);
let calendarMode = 'month';
let habitQuery = '';
let categoryFilter = 'all';
let statusFilter = 'active';
let wizard = null;
let detailHabitId = null;
let toastTimer = null;
let activitySaveTimer = null;
let undoAction = null;
let installPrompt = null;
let focusCompletionHandled = false;

if (loaded.isNew) {
  try { writeState(state); } catch (error) { storageError = `Local storage is unavailable: ${error.message}`; readOnly = true; }
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function icon(name, className = '') {
  return `<span class="icon ${className}" aria-hidden="true"><svg><use href="./icons.svg#${name}"></use></svg></span>`;
}

function formatDate(key, options = { weekday: 'long', month: 'long', day: 'numeric' }) {
  return new Intl.DateTimeFormat(undefined, options).format(fromDateKey(key));
}

function formatShortDate(key) {
  return formatDate(key, { month: 'short', day: 'numeric' });
}

function activeHabits() {
  return state.habits.filter(habit => habit.status === 'active');
}

function habitCategory(habit) {
  return state.categories.find(category => category.id === habit.categoryId) || { name: 'Unsorted', color: '#758279', icon: 'leaf' };
}

function habitProgress(habit, date = localDateKey()) {
  const record = completionFor(state, habit.id, date);
  const value = Number(record?.value) || 0;
  const target = habit.type === 'done' ? 1 : Math.max(1, Number(habit.target) || 1);
  return { value, target, ratio: Math.min(1, value / target), done: isCompletionDone(habit, record) };
}

function allTimeCompleted() {
  return state.completions.filter(item => {
    const habit = state.habits.find(entry => entry.id === item.habitId);
    return habit && isCompletionDone(habit, item);
  }).length;
}

function commit(updater, successMessage = '') {
  if (readOnly) {
    showToast('Saved data is read-only. Import a valid backup to restore editing.');
    return false;
  }
  try {
    const next = typeof updater === 'function' ? updater(structuredClone(state)) : updater;
    writeState(next);
    state = next;
    render();
    if (successMessage) showToast(successMessage);
    return true;
  } catch (error) {
    showToast(`Could not save your changes: ${error.message}`);
    return false;
  }
}

function showToast(message, action = null) {
  clearTimeout(toastTimer);
  undoAction = action;
  toastEl.innerHTML = `${escapeHtml(message)}${action ? ' <button class="toast-undo" data-action="toast-undo">Undo</button>' : ''}`;
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    undoAction = null;
  }, 5000);
}

function navButton(item) {
  return `<button class="nav-item" data-action="navigate" data-page="${item.id}" aria-current="${page === item.id ? 'page' : 'false'}">${icon(item.icon)}<span class="nav-text">${item.title}</span></button>`;
}

function pageHeading(title, subtitle, eyebrow) {
  return `<div class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subhead">${subtitle}</p></div></div>`;
}

function render() {
  const xp = totalXp(state);
  const level = getLevel(xp);
  const weekly = getPeriodStats(state, startOfWeek(localDateKey()), localDateKey());
  const online = navigator.onLine;
  const title = navItems.find(item => item.id === page)?.title || 'Home';
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">${icon('check')}</div><div class="brand-copy"><div class="brand-name">Thabit</div><div class="brand-note">Small steps, kept</div></div></div>
        <div class="nav-label">Workspace</div>
        <nav class="nav-list" aria-label="Main navigation">${navItems.map(navButton).join('')}</nav>
        <div class="sidebar-spacer"></div>
        <div class="sidebar-summary"><div class="summary-line"><span>This week</span><strong>${weekly.done}/${weekly.due}</strong></div><div class="mini-track"><span style="width:${weekly.rate}%"></span></div></div>
        <div class="sidebar-foot"><span class="status-dot ${online ? '' : 'offline'}"></span><span>${online ? 'Saved on this device' : 'Offline - data stays here'}</span></div>
      </aside>
      <div class="workspace">
        <header class="topbar"><div class="topbar-date">${formatDate(localDateKey())}</div><div class="topbar-actions"><span class="offline-label"><span class="status-dot ${online ? '' : 'offline'}"></span>${online ? 'Local data' : 'Offline'}</span><span class="level-chip">${icon('spark')}<span>Level ${level.level}</span></span></div></header>
        <main class="content">${storageError ? `<div class="notice error read-only-banner">${escapeHtml(storageError)} Use Profile to restore a validated backup.</div>` : ''}${renderPage()}</main>
      </div>
    </div>
    <nav class="mobile-nav" aria-label="Main navigation">${navItems.map(navButton).join('')}</nav>`;
  renderModal();
}

function renderPage() {
  if (page === 'habits') return renderHabitsPage();
  if (page === 'focus') return renderFocusPage();
  if (page === 'calendar') return renderCalendarPage();
  if (page === 'profile') return renderProfilePage();
  return renderHomePage();
}

function renderHomePage() {
  const today = localDateKey();
  const due = activeHabits().filter(habit => isScheduled(habit, today));
  const completed = due.filter(habit => habitProgress(habit, today).done).length;
  const rate = due.length ? Math.round(completed / due.length * 100) : 0;
  const streak = Math.max(0, ...state.habits.map(habit => getHabitStreak(state, habit, today).current));
  const totalDone = allTimeCompleted();
  const weekly = getPeriodStats(state, startOfWeek(today), today);
  const xp = totalXp(state);
  const level = getLevel(xp);
  const closest = closestAchievement(state, today);
  const ringOffset = 339.3 * (1 - rate / 100);
  return `${pageHeading('Good ${dayPart()},', 'A little consistency goes a long way. Your progress stays on this device.', 'Your space')}
    <section class="welcome"><div class="welcome-copy"><p class="eyebrow">${formatDate(today, { weekday: 'long', month: 'long', day: 'numeric' })}</p><h2>Make today count, one habit at a time.</h2><p>${due.length ? `${completed} of ${due.length} habits completed today. Keep your pace comfortable.` : 'No habits are scheduled today. Use the space to reset or get ahead.'}</p><button class="button" data-action="navigate" data-page="habits">${icon('plus')} Add or review habits</button></div><div class="progress-ring-wrap"><div class="progress-ring" style="--ring-offset:${ringOffset}"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54"/><circle class="progress" cx="60" cy="60" r="54"/></svg><div class="ring-label"><strong>${rate}%</strong><span>today's progress</span></div></div></div></section>
    <div class="section-row"><h2>At a glance</h2><span class="subhead">Your activity, not estimates</span></div>
    <section class="stat-grid" aria-label="Habit statistics">
      ${statCard('This week', `${weekly.done}/${weekly.due}`, 'completed', 'calendar')}
      ${statCard('Current streak', `${streak}`, 'days', 'flame', 'orange')}
      ${statCard('Habits completed', `${totalDone}`, 'all time', 'check')}
      ${statCard('Experience', `${xp}`, `Level ${level.level}`, 'spark', 'blue')}
    </section>
    <div class="section-row"><h2>Today's habits</h2><button class="text-link" data-action="navigate" data-page="habits">View all ${icon('chevron')}</button></div>
    <section class="dashboard-lower" style="margin-top:0">
      <div class="card panel"><div class="panel-head"><div><h3>Due today</h3><p>${formatDate(today)}</p></div><span class="tag">${completed} / ${due.length} done</span></div>${due.length ? `<div class="habit-stack">${due.map(habit => habitRow(habit, today)).join('')}</div>` : emptyState('A clear day', state.habits.length ? 'No active habits are scheduled today.' : 'Add a habit to start building your rhythm.', '<button class="button small" data-action="new-habit">Create a habit</button>')}</div>
      <div class="card panel achievement-near"><p class="eyebrow">Closest achievement</p>${closest ? `<h3>${escapeHtml(closest.name)}</h3><p>${escapeHtml(closest.description)}</p><div class="achievement-progress"><span>${closest.progress} of ${closest.target}</span><span>${Math.round(closest.ratio * 100)}%</span></div><div class="progress-track"><span style="width:${closest.ratio * 100}%"></span></div><button class="text-link" style="margin-top:15px" data-action="navigate" data-page="profile">View achievements ${icon('chevron')}</button>` : '<h3>Everything unlocked</h3><p>You have reached every current milestone. Keep going at your own pace.</p>'}</div>
    </section>`;
}

function dayPart() {
  const hour = new Date().getHours();
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}

function statCard(label, value, suffix, symbol, tone = '') {
  return `<article class="card stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${tone}">${icon(symbol)}</span></div><div class="stat-value">${value}<small>${suffix}</small></div></article>`;
}

function emptyState(title, message, action = '') {
  return `<div class="empty-state"><strong>${title}</strong><p>${message}</p>${action ? `<div style="margin-top:13px">${action}</div>` : ''}</div>`;
}

function habitRow(habit, date) {
  const progress = habitProgress(habit, date);
  const streak = getHabitStreak(state, habit, date).current;
  const category = habitCategory(habit);
  const color = habit.color || category.color;
  let action;
  if (habit.type === 'done') {
    action = `<button class="check-button ${progress.done ? 'done' : ''}" data-action="complete" data-id="${escapeHtml(habit.id)}" data-date="${date}" aria-label="${progress.done ? 'Undo' : 'Complete'} ${escapeHtml(habit.name)}">${icon('check')}</button>`;
  } else {
    const increment = habit.type === 'duration' ? (/^hours?$/i.test(habit.unit) ? 0.25 : 15) : 1;
    action = progress.done
      ? `<button class="check-button done" data-action="complete" data-id="${escapeHtml(habit.id)}" data-date="${date}" aria-label="Undo ${escapeHtml(habit.name)}">${icon('check')}</button>`
      : `<button class="quantity-button" data-action="increment" data-id="${escapeHtml(habit.id)}" data-date="${date}" aria-label="Add ${increment} to ${escapeHtml(habit.name)}">+${increment} ${escapeHtml(habit.unit || (habit.type === 'duration' ? 'min' : ''))}</button>`;
  }
  return `<article class="habit-row"><div class="habit-avatar" style="background:${escapeHtml(color)}18;color:${escapeHtml(color)}">${escapeHtml(habit.icon || '✦')}</div><div><p class="habit-title">${escapeHtml(habit.name)}</p><div class="habit-meta"><span>${escapeHtml(category.name)}</span><span>${icon('flame')} ${streak} day${streak === 1 ? '' : 's'}</span>${habit.type !== 'done' ? `<span>${progress.value}/${progress.target} ${escapeHtml(habit.unit || '')}</span>` : ''}</div></div><div class="habit-actions">${action}</div></article>`;
}

function renderHabitsPage() {
  const filtered = state.habits.filter(habit => {
    const matchesText = `${habit.name} ${habit.description || ''}`.toLowerCase().includes(habitQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || habit.categoryId === categoryFilter;
    const matchesStatus = statusFilter === 'all' || habit.status === statusFilter;
    return matchesText && matchesCategory && matchesStatus;
  });
  const dueNow = activeHabits().filter(habit => isScheduled(habit, localDateKey())).length;
  return `${pageHeading('Your habits', `${activeHabits().length} active habit${activeHabits().length === 1 ? '' : 's'} · ${dueNow} scheduled today`, 'Build a rhythm')}
    <div class="toolbar"><label class="search-field">${icon('search')}<input id="habit-search" type="search" value="${escapeHtml(habitQuery)}" placeholder="Search habits" aria-label="Search habits"></label><select class="select" id="category-filter" aria-label="Filter by category"><option value="all">All categories</option>${state.categories.map(category => `<option value="${escapeHtml(category.id)}" ${categoryFilter === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select><select class="select" id="status-filter" aria-label="Filter by status"><option value="active" ${statusFilter === 'active' ? 'selected' : ''}>Active</option><option value="paused" ${statusFilter === 'paused' ? 'selected' : ''}>Paused</option><option value="archived" ${statusFilter === 'archived' ? 'selected' : ''}>Archived</option><option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All statuses</option></select><button class="button" data-action="new-habit">${icon('plus')} New habit</button></div>
    ${filtered.length ? `<section class="habit-grid">${filtered.map(habitCard).join('')}</section>` : emptyState(state.habits.length ? 'No matching habits' : 'Start with one small thing', state.habits.length ? 'Try another search or filter.' : 'Create a habit that fits your day. You can change its schedule any time.', state.habits.length ? '' : '<button class="button" data-action="new-habit">Create a habit</button>')}`;
}

function scheduleLabel(habit) {
  const schedule = habit.schedule || { type: 'daily' };
  if (schedule.type === 'daily') return 'Every day';
  if (schedule.type === 'weeklyCount') return `${getScheduledWeekdays(habit).map(day => weekdayNames[day]).join(', ')} (${schedule.daysPerWeek}/week)`;
  if (schedule.type === 'custom') return `Every ${schedule.intervalDays} days`;
  if (schedule.type === 'weekdays') return (schedule.weekdays || []).map(day => weekdayNames[day]).join(', ') || 'No days selected';
  return 'Every day';
}

function habitCard(habit) {
  const today = localDateKey();
  const category = habitCategory(habit);
  const color = habit.color || category.color;
  const progress = habitProgress(habit, today);
  const streak = getHabitStreak(state, habit, today);
  const last30 = dateRange(addDays(today, -29), today);
  const heat = last30.map(date => {
    const record = completionFor(state, habit.id, date);
    const ratio = record ? Math.min(1, Number(record.value) / (habit.type === 'done' ? 1 : Math.max(1, Number(habit.target) || 1))) : 0;
    const level = ratio === 0 ? 0 : ratio >= 1 ? 4 : ratio > .5 ? 3 : ratio > .2 ? 2 : 1;
    return `<span class="heat-cell level-${level}" title="${formatShortDate(date)}: ${record ? record.value : 0}"></span>`;
  }).join('');
  return `<article class="card habit-card"><div class="habit-card-top"><div class="habit-avatar" style="background:${escapeHtml(color)}18;color:${escapeHtml(color)}">${escapeHtml(habit.icon || '✦')}</div><div class="habit-card-main"><h3>${escapeHtml(habit.name)}</h3><div class="habit-meta"><span>${escapeHtml(category.name)}</span><span>${escapeHtml(scheduleLabel(habit))}</span></div></div><button class="icon-button" data-action="details" data-id="${escapeHtml(habit.id)}" aria-label="Habit details">${icon('dots')}</button></div>${habit.description ? `<p class="habit-description">${escapeHtml(habit.description)}</p>` : ''}<div class="habit-progress-line"><span>${habit.status === 'paused' ? 'Paused' : habit.status === 'archived' ? 'Archived' : progress.done && isScheduled(habit, today) ? 'Today complete' : isScheduled(habit, today) ? 'Today in progress' : 'Next: ' + escapeHtml(scheduleLabel(habit))}</span><strong>${streak.current} day streak</strong></div><div class="progress-track"><span style="width:${progress.ratio * 100}%"></span></div><div style="margin-top:14px"><div class="field-hint" style="margin-bottom:7px">LAST 30 DAYS</div><div class="heatmap" aria-label="30-day activity">${heat}</div></div><div class="card-bottom"><span class="tag ${habit.status === 'archived' ? 'archived' : ''}">${habit.type === 'done' ? 'Simple' : `${habit.target} ${escapeHtml(habit.unit || (habit.type === 'duration' ? 'min' : 'reps'))}`}</span><button class="text-link" data-action="details" data-id="${escapeHtml(habit.id)}">Details ${icon('chevron')}</button></div></article>`;
}

function renderCalendarPage() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(calendarCursor);
  let dates;
  if (calendarMode === 'week') dates = dateRange(startOfWeek(selectedDate), addDays(startOfWeek(selectedDate), 6));
  else {
    const first = localDateKey(new Date(year, month, 1, 12));
    const last = localDateKey(new Date(year, month + 1, 0, 12));
    const start = addDays(first, -((fromDateKey(first).getDay() + 6) % 7));
    dates = dateRange(start, addDays(start, 41));
    if (last < dates[dates.length - 7]) dates = dates.slice(0, 35);
  }
  const cells = dates.map(date => {
    const dayHabits = state.habits.filter(habit => isScheduled(habit, date));
    const completed = dayHabits.filter(habit => habitProgress(habit, date).done).length;
    const isCurrentMonth = fromDateKey(date).getMonth() === month;
    const classes = ['calendar-day', !isCurrentMonth && calendarMode === 'month' ? 'other' : '', date === selectedDate ? 'selected' : '', date === localDateKey() ? 'today' : ''].filter(Boolean).join(' ');
    return `<button class="${classes}" data-action="calendar-day" data-date="${date}" aria-label="${formatDate(date)}${dayHabits.length ? `, ${completed} of ${dayHabits.length} complete` : ', no habits scheduled'}"><span class="day-number">${fromDateKey(date).getDate()}</span><span class="day-dots">${dayHabits.slice(0, 5).map(habit => `<i class="${habitProgress(habit, date).done ? 'done' : ''}" title="${escapeHtml(habit.name)}"></i>`).join('')}</span></button>`;
  }).join('');
  const period = calendarMode === 'week' ? `${formatShortDate(dates[0])} - ${formatShortDate(dates[6])}` : monthLabel;
  return `${pageHeading('Your calendar', 'A clear view of scheduled habits and real activity.', 'Look back')}
    <div class="calendar-toolbar"><div class="calendar-controls"><button class="icon-button" data-action="calendar-shift" data-direction="-1" aria-label="Previous ${calendarMode}">${icon('back')}</button><h2 class="calendar-title">${period}</h2><button class="icon-button" data-action="calendar-shift" data-direction="1" aria-label="Next ${calendarMode}">${icon('chevron')}</button></div><div class="calendar-controls"><button class="button secondary small" data-action="calendar-today">Today</button><div class="segmented"><button data-action="calendar-mode" data-mode="month" aria-pressed="${calendarMode === 'month'}">Month</button><button data-action="calendar-mode" data-mode="week" aria-pressed="${calendarMode === 'week'}">Week</button></div></div></div>
    <div class="calendar-layout"><section class="card calendar-panel"><div class="weekday-labels">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => `<span>${day}</span>`).join('')}</div><div class="calendar-grid">${cells}</div></section><aside class="card day-panel">${renderDayPanel(selectedDate)}</aside></div>`;
}

function renderDayPanel(date) {
  const due = state.habits.filter(habit => isScheduled(habit, date));
  const completed = due.filter(habit => habitProgress(habit, date).done).length;
  const minutes = state.focusSessions.filter(session => session.startedAt && localDateKey(new Date(session.startedAt)) === date && session.outcome === 'completed').reduce((sum, session) => sum + session.elapsedSeconds, 0);
  return `<div class="panel-head"><div><p class="eyebrow">Selected day</p><h2>${formatDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}</h2><p>${completed} of ${due.length} scheduled habits done</p></div><span class="tag">${minutes ? `${Math.round(minutes / 60 * 10) / 10}h focus` : 'No focus time'}</span></div>${due.length ? due.map(habit => {
    const progress = habitProgress(habit, date);
    const category = habitCategory(habit);
    const color = habit.color || category.color;
    return `<div class="day-habit"><div class="habit-avatar" style="background:${escapeHtml(color)}18;color:${escapeHtml(color)}">${escapeHtml(habit.icon || '✦')}</div><div class="day-habit-info"><strong>${escapeHtml(habit.name)}</strong><span>${progress.value}/${progress.target} ${escapeHtml(habit.unit || '')}</span></div>${progress.done ? `<span class="tag">Done</span>` : `<span class="tag">Open</span>`}</div>`;
  }).join('') : emptyState('Nothing scheduled', 'This day has no scheduled habits. Past and future dates stay available for review.')}`;
}

function focusSeconds() {
  const focus = state.focus;
  if (focus.mode === 'stopwatch') {
    return Math.max(0, Number(focus.remainingSeconds) || 0) + (focus.status === 'running' && focus.startedAt ? Math.floor((Date.now() - focus.startedAt) / 1000) : 0);
  }
  if (focus.status === 'running' && focus.endsAt) return Math.max(0, Math.ceil((focus.endsAt - Date.now()) / 1000));
  return Math.max(0, Number(focus.remainingSeconds) || 0);
}

function clockText(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const secs = seconds % 60;
  return hours ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function renderFocusPage() {
  const focus = state.focus;
  const seconds = focusSeconds();
  const isStopwatch = focus.mode === 'stopwatch';
  const ratio = isStopwatch ? ((seconds % 60) / 60) : 1 - seconds / Math.max(1, focus.durationSeconds);
  const modeLabel = { pomodoro: 'Pomodoro', stopwatch: 'Stopwatch', countdown: 'Countdown' }[focus.mode];
  const sessions = state.focusSessions.slice(0, 8);
  const selectedHabit = focus.habitId || '';
  return `${pageHeading('Focus on one thing', 'Keep a session connected to a habit or simply to the work in front of you.', 'Make room for focus')}
    <div class="focus-layout"><section class="card timer-panel"><div class="segmented"><button data-action="focus-mode" data-mode="pomodoro" aria-pressed="${focus.mode === 'pomodoro'}">Pomodoro</button><button data-action="focus-mode" data-mode="stopwatch" aria-pressed="${focus.mode === 'stopwatch'}">Stopwatch</button><button data-action="focus-mode" data-mode="countdown" aria-pressed="${focus.mode === 'countdown'}">Countdown</button></div>
      <div class="timer-face" id="timer-face" style="--timer-angle:${ratio * 360}deg"><div class="timer-inner"><strong class="timer-time" id="timer-time">${clockText(seconds)}</strong><span class="timer-mode-label">${focus.status === 'running' ? 'In progress' : focus.status === 'paused' ? 'Paused' : modeLabel}</span></div></div>
      <div class="timer-controls">${focus.status === 'running' ? `<button class="button secondary" data-action="focus-pause">Pause</button><button class="button" data-action="focus-finish">Finish</button>` : `<button class="button" data-action="focus-start">${focus.status === 'paused' ? 'Resume' : 'Start session'}</button>`}${focus.status !== 'idle' ? `<button class="button ghost" data-action="focus-reset">Reset</button>` : ''}${focus.mode === 'pomodoro' && focus.status !== 'idle' ? `<button class="button ghost" data-action="focus-skip">Skip</button>` : ''}</div>
      <div class="timer-settings"><div class="field-group"><label for="focus-activity">Session label</label><input class="field" id="focus-activity" data-action="focus-activity" value="${escapeHtml(focus.activity || '')}" placeholder="e.g. Morning pages" ${focus.status === 'running' ? 'disabled' : ''}></div><div class="field-group"><label for="focus-habit">Linked habit</label><select class="select" id="focus-habit" data-action="focus-habit" ${focus.status === 'running' ? 'disabled' : ''}><option value="">No habit</option>${state.habits.filter(habit => habit.status !== 'archived').map(habit => `<option value="${escapeHtml(habit.id)}" ${selectedHabit === habit.id ? 'selected' : ''}>${escapeHtml(habit.name)}</option>`).join('')}</select></div>${focus.mode !== 'stopwatch' ? `<div class="field-group"><label for="focus-duration">Duration in minutes</label><input class="field" type="number" id="focus-duration" data-action="focus-duration" min="1" max="180" value="${Math.round(focus.durationSeconds / 60)}" ${focus.status === 'running' ? 'disabled' : ''}></div>` : ''}<p class="field-hint">A running session survives refreshes. Focus XP is awarded only when a Pomodoro timer finishes naturally.</p></div>
    </section><aside class="card panel"><div class="panel-head"><div><h2>Recent sessions</h2><p>Completed and skipped sessions</p></div><span class="tag">${state.focusSessions.filter(session => session.outcome === 'completed').length} completed</span></div>${sessions.length ? `<div class="session-list">${sessions.map(sessionRow).join('')}</div>` : emptyState('No sessions yet', 'Start a timer when you are ready to focus.')}</aside></div>`;
}

function sessionRow(session) {
  const mode = session.mode === 'pomodoro' ? 'Pomodoro' : session.mode === 'stopwatch' ? 'Stopwatch' : 'Countdown';
  const date = session.startedAt ? localDateKey(new Date(session.startedAt)) : '';
  const outcome = session.outcome === 'completed' ? 'Finished' : session.outcome === 'skipped' ? 'Skipped' : 'Stopped';
  const habit = state.habits.find(item => item.id === session.habitId);
  return `<div class="session-item"><div><strong>${escapeHtml(session.activity || habit?.name || mode)}</strong><span>${mode} · ${date ? formatShortDate(date) : ''} · ${outcome}</span></div><strong>${Math.round(session.elapsedSeconds / 60)}m</strong></div>`;
}

function habitPeriodStats(habit, from, to) {
  const scheduled = dateRange(from, to).filter(date => isScheduled(habit, date));
  const done = scheduled.filter(date => isCompletionDone(habit, completionFor(state, habit.id, date))).length;
  return { due: scheduled.length, done, missed: scheduled.length - done, rate: scheduled.length ? Math.round(done / scheduled.length * 100) : 0 };
}

function renderActivityChart(today) {
  const dates = dateRange(addDays(today, -13), today);
  const columns = dates.map(date => {
    const stats = getPeriodStats(state, date, date);
    const height = stats.due ? Math.max(5, stats.rate) : 3;
    return `<div class="chart-column" title="${formatDate(date)}: ${stats.done}/${stats.due} habits"><div class="chart-rail"><span class="chart-bar ${stats.due ? '' : 'no-data'}" style="height:${height}%"></span></div><span class="chart-label">${fromDateKey(date).getDate()}</span></div>`;
  }).join('');
  return `<section class="card panel"><div class="panel-head"><div><h2>Daily activity</h2><p>Scheduled completions over the last 14 days</p></div><span class="tag">14 days</span></div><div class="activity-chart" role="img" aria-label="Daily habit completion rate chart for the past 14 days">${columns}</div></section>`;
}

function renderHabitRankings(today) {
  const from = addDays(today, -29);
  const ranked = activeHabits().map(habit => ({ habit, stats: habitPeriodStats(habit, from, today) })).filter(item => item.stats.due > 0);
  const consistent = [...ranked].sort((a, b) => b.stats.rate - a.stats.rate || b.stats.done - a.stats.done).slice(0, 3);
  const missed = [...ranked].filter(item => item.stats.missed > 0).sort((a, b) => b.stats.missed - a.stats.missed || a.stats.rate - b.stats.rate).slice(0, 3);
  const trackedMinutes = state.completions.reduce((sum, record) => {
    const habit = state.habits.find(item => item.id === record.habitId);
    if (habit?.type !== 'duration' || record.date < from || record.date > today) return sum;
    const value = Number(record.value) || 0;
    return sum + value * (/^hours?$/i.test(habit.unit) ? 60 : 1);
  }, 0);
  const rankRows = (items, missedView = false) => items.length ? items.map(({ habit, stats }) => `<div class="rank-row"><span class="rank-icon">${escapeHtml(habit.icon || '✦')}</span><div class="rank-main"><strong>${escapeHtml(habit.name)}</strong><div class="progress-track"><span style="width:${stats.rate}%"></span></div></div><span class="rank-value">${missedView ? `${stats.missed} missed` : `${stats.rate}%`}</span></div>`).join('') : emptyState(missedView ? 'Nothing missed' : 'Not enough history yet', missedView ? 'Every scheduled habit is currently on track.' : 'Your habit rankings will appear after you have scheduled activity.');
  return `<div class="section-row"><div><h2>Habit insights</h2><p class="subhead">Last 30 days, based on scheduled dates</p></div><span class="tag">${trackedMinutes >= 60 ? `${(trackedMinutes / 60).toFixed(1)} hours` : `${trackedMinutes} minutes`} tracked</span></div><div class="insight-layout">${renderActivityChart(today)}<div class="card panel"><div class="panel-head"><div><h2>Most consistent</h2><p>Habits with the strongest completion rate</p></div></div>${rankRows(consistent)}</div><div class="card panel"><div class="panel-head"><div><h2>Often missed</h2><p>Scheduled days still open</p></div></div>${rankRows(missed, true)}</div></div>`;
}

function renderProfilePage() {
  const today = localDateKey();
  const xp = totalXp(state);
  const level = getLevel(xp);
  const week = getPeriodStats(state, startOfWeek(today), today);
  const month = getPeriodStats(state, `${today.slice(0, 7)}-01`, today);
  const longest = Math.max(0, ...state.habits.map(habit => getHabitStreak(state, habit, today).longest));
  const focusMinutes = state.focusSessions.filter(session => session.outcome === 'completed').reduce((sum, session) => sum + session.elapsedSeconds, 0) / 60;
  const achievements = getAchievements(state, today);
  return `${pageHeading('Your progress', 'A record of effort built from your own activity.', 'Profile')}
    <div class="profile-grid"><div><section class="card profile-hero"><div class="level-badge">${level.level}</div><div style="flex:1"><p class="eyebrow" style="color:var(--lime)">Level ${level.level} · ${xp} XP</p><h2 style="margin:0;color:white">Keep your own pace.</h2><p>${level.next - level.current} XP to level ${level.level + 1}</p><div class="progress-track"><span style="width:${level.current}%"></span></div></div></section>
      <div class="section-row"><h2>Milestones</h2><span class="subhead">${state.unlockedAchievements.length} / ${achievements.length} unlocked</span></div><section class="achievement-grid">${achievements.map(achievementCard).join('')}</section>
      <div class="section-row"><h2>Personal statistics</h2><span class="subhead">Calculated from your records</span></div><section class="stat-grid">${statCard('This week', `${week.rate}%`, `${week.done}/${week.due} scheduled`, 'calendar')}${statCard('This month', `${month.rate}%`, `${month.done}/${month.due} scheduled`, 'grid', 'blue')}${statCard('Longest streak', `${longest}`, 'days', 'flame', 'orange')}${statCard('Focus time', `${(focusMinutes / 60).toFixed(1)}`, 'hours total', 'timer')}</section>
      ${renderHabitRankings(today)}</div>
      <aside><section class="card panel"><div class="panel-head"><div><h2>Data & settings</h2><p>Your records stay on this device</p></div></div><div class="settings-list"><div class="settings-row"><div><strong>Export backup</strong><span>Download all habits, history, timers, and achievements as JSON.</span></div><button class="icon-button" data-action="export-json" aria-label="Export JSON backup">${icon('download')}</button></div><div class="settings-row"><div><strong>Export completion CSV</strong><span>Open your completion history in a spreadsheet.</span></div><button class="icon-button" data-action="export-csv" aria-label="Export CSV">${icon('download')}</button></div><div class="settings-row"><div><strong>Restore backup</strong><span>Validate a JSON file before replacing this device's data.</span></div><button class="button secondary small" data-action="import">Choose file</button></div><input id="import-file" type="file" accept="application/json,.json" hidden><div class="settings-row"><div><strong>Install app</strong><span>Available when this browser supports PWA installation.</span></div><button class="button secondary small" data-action="install">Install</button></div></div></section>
      <section class="card panel" style="margin-top:14px"><div class="panel-head"><div><h2>Reminders</h2><p>Optional and local to this device</p></div>${icon('bell')}</div><p class="subhead">Reminder times are checked while Thabit is open. Browser notifications may be unavailable in the background; no reminder is claimed as scheduled unless the platform confirms it.</p><div class="notice" style="margin-top:14px">No account or network sync is used. Back up your data regularly if you may clear this browser's storage.</div></section></aside></div>`;
}

function achievementCard(item) {
  const done = item.unlocked;
  const percent = Math.min(100, Math.round(item.progress / item.target * 100));
  return `<article class="achievement-item ${done ? 'unlocked' : ''}"><div class="achievement-item-top"><h3>${escapeHtml(item.name)}</h3><span class="tag">${escapeHtml(item.difficulty)} · ${item.xp} XP</span></div><p>${escapeHtml(item.description)}</p><div class="progress-track"><span style="width:${done ? 100 : percent}%"></span></div><small>${done ? 'Unlocked' : `${item.progress} / ${item.target} · ${percent}%`}</small></article>`;
}

function beginWizard(habit = null) {
  const source = habit ? structuredClone(habit) : {
    name: '', description: '', icon: '📚', type: 'done', target: 1, unit: 'pages',
    schedule: { type: 'daily', weekdays: [1, 2, 3, 4, 5], daysPerWeek: 3, intervalDays: 2 },
    startDate: localDateKey(), endDate: '', categoryId: state.categories[0]?.id || '', color: state.categories[0]?.color || '#318b72'
  };
  wizard = { step: 1, editingId: habit?.id || null, draft: source };
  detailHabitId = null;
  renderModal();
}

function syncWizardForm() {
  const form = $('#habit-wizard');
  if (!form || !wizard) return;
  const data = new FormData(form);
  const draft = wizard.draft;
  draft.name = String(data.get('name') || '').trim();
  draft.description = String(data.get('description') || '').trim();
  const targetValue = data.get('target');
  draft.target = targetValue === null || targetValue === '' ? 1 : Number(targetValue);
  draft.unit = String(data.get('unit') || '').trim();
  draft.startDate = String(data.get('startDate') || '');
  draft.endDate = String(data.get('endDate') || '');
  draft.categoryId = String(data.get('categoryId') || '');
  draft.color = String(data.get('color') || draft.color || '#318b72');
  const dayChoices = form.querySelector('input[name="weekdays"]');
  const days = dayChoices ? data.getAll('weekdays').map(Number) : draft.schedule.weekdays;
  const daysPerWeek = data.get('daysPerWeek');
  const intervalDays = data.get('intervalDays');
  draft.schedule = {
    ...draft.schedule,
    daysPerWeek: daysPerWeek === null ? draft.schedule.daysPerWeek || 3 : Number(daysPerWeek),
    intervalDays: intervalDays === null ? draft.schedule.intervalDays || 2 : Number(intervalDays),
    weekdays: days
  };
}

function wizardError() {
  const draft = wizard.draft;
  if (wizard.step === 1 && !draft.name) return 'Give this habit a name to continue.';
  if (wizard.step === 2 && draft.type !== 'done' && (!Number.isFinite(draft.target) || draft.target <= 0 || draft.target > 100000 || !draft.unit)) return 'Enter a positive target and its unit.';
  if (wizard.step === 3) {
    if (!draft.startDate) return 'Choose a start date.';
    if (draft.endDate && draft.endDate < draft.startDate) return 'The end date must be on or after the start date.';
    if (draft.schedule.type === 'weekdays' && !draft.schedule.weekdays.length) return 'Choose at least one weekday.';
    if (draft.schedule.type === 'weeklyCount' && !(Number.isInteger(draft.schedule.daysPerWeek) && draft.schedule.daysPerWeek >= 1 && draft.schedule.daysPerWeek <= 7)) return 'Choose from 1 to 7 days per week.';
    if (draft.schedule.type === 'custom' && !(Number.isInteger(draft.schedule.intervalDays) && draft.schedule.intervalDays >= 1 && draft.schedule.intervalDays <= 30)) return 'Choose an interval from 1 to 30 days.';
  }
  if (wizard.step === 4 && !draft.categoryId) return 'Choose a category before saving.';
  return '';
}

function renderModal() {
  if (wizard) {
    modalRoot.innerHTML = renderWizardModal();
    const colorLabel = modalRoot.querySelector('label[for="habit-color"]');
    if (colorLabel) colorLabel.textContent = 'Habit color';
    modalRoot.querySelectorAll('.day-choice').forEach(button => {
      const day = Number(button.dataset.day);
      button.textContent = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][day];
      button.setAttribute('aria-label', weekdayLong[day]);
    });
    return;
  }
  if (detailHabitId) {
    const habit = state.habits.find(item => item.id === detailHabitId);
    modalRoot.innerHTML = habit ? renderDetailModal(habit).replace('overall scheduled completion', 'scheduled days completed') : '';
    if (habit?.status === 'archived') modalRoot.querySelector('[data-action="toggle-pause"]')?.remove();
    return;
  }
  modalRoot.innerHTML = '';
}

function renderWizardModal() {
  const draft = wizard.draft;
  const editing = Boolean(wizard.editingId);
  const step = wizard.step;
  let content = '';
  if (step === 1) content = `<div class="form-grid"><div class="field-group full"><label for="habit-name">Habit name</label><input id="habit-name" name="name" maxlength="60" required value="${escapeHtml(draft.name)}" placeholder="e.g. Read before bed"></div><div class="field-group full"><label>Icon</label><div class="emoji-row">${emojiOptions.map(emoji => `<button type="button" class="emoji-choice" data-action="wizard-icon" data-icon="${emoji}" aria-pressed="${draft.icon === emoji}">${emoji}</button>`).join('')}</div></div><div class="field-group full"><label for="habit-description">Description <span class="field-hint">Optional</span></label><textarea id="habit-description" name="description" maxlength="240" placeholder="What does this habit mean to you?">${escapeHtml(draft.description || '')}</textarea></div></div>`;
  if (step === 2) content = `<div class="choice-grid">${[['done', 'Done', 'A simple yes or no completion.'], ['quantity', 'Quantity', 'Track a measurable amount.'], ['duration', 'Duration', 'Build progress in minutes or hours.']].map(([type, title, copy]) => `<button type="button" class="choice ${draft.type === type ? 'selected' : ''}" data-action="wizard-type" data-type="${type}" aria-pressed="${draft.type === type}"><strong>${title}</strong><span>${copy}</span></button>`).join('')}</div>${draft.type !== 'done' ? `<div class="form-grid" style="margin-top:16px"><div class="field-group"><label for="habit-target">Daily target</label><input id="habit-target" name="target" type="number" min="1" max="100000" value="${Number(draft.target) || 1}"></div><div class="field-group"><label for="habit-unit">Unit</label><input id="habit-unit" name="unit" maxlength="20" value="${escapeHtml(draft.unit || (draft.type === 'duration' ? 'minutes' : 'reps'))}" placeholder="pages, glasses, minutes"></div></div>` : ''}`;
  if (step === 3) content = `<div class="field-group"><label for="schedule-type">Schedule</label><select id="schedule-type" name="scheduleType" data-action="wizard-schedule"><option value="daily" ${draft.schedule.type === 'daily' ? 'selected' : ''}>Every day</option><option value="weekdays" ${draft.schedule.type === 'weekdays' ? 'selected' : ''}>Selected weekdays</option><option value="weeklyCount" ${draft.schedule.type === 'weeklyCount' ? 'selected' : ''}>Specific days per week</option><option value="custom" ${draft.schedule.type === 'custom' ? 'selected' : ''}>Repeat every N days</option></select></div>${draft.schedule.type === 'weekdays' ? `<div class="field-group" style="margin-top:15px"><label>Choose days</label><div class="day-choice-row">${weekdayNames.map((day, index) => `<label><input name="weekdays" type="checkbox" value="${index}" ${draft.schedule.weekdays.includes(index) ? 'checked' : ''} hidden><button type="button" class="day-choice" data-action="wizard-day" data-day="${index}" aria-pressed="${draft.schedule.weekdays.includes(index)}">${day[0]}</button></label>`).join('')}</div></div>` : ''}${draft.schedule.type === 'weeklyCount' ? `<div class="field-group" style="margin-top:15px"><label for="days-per-week">Target days per week</label><input id="days-per-week" name="daysPerWeek" type="number" min="1" max="7" value="${draft.schedule.daysPerWeek || 3}"></div>` : ''}${draft.schedule.type === 'custom' ? `<div class="field-group" style="margin-top:15px"><label for="custom-interval">Repeat every (days)</label><input id="custom-interval" name="intervalDays" type="number" min="1" max="30" value="${draft.schedule.intervalDays || 2}"><span class="field-hint">The first scheduled day is the habit start date.</span></div>` : ''}<div class="form-grid" style="margin-top:16px"><div class="field-group"><label for="habit-start">Start date</label><input id="habit-start" name="startDate" type="date" value="${escapeHtml(draft.startDate || localDateKey())}"></div><div class="field-group"><label for="habit-end">End date <span class="field-hint">Optional</span></label><input id="habit-end" name="endDate" type="date" value="${escapeHtml(draft.endDate || '')}"></div></div>`;
  if (step === 4) {
    const category = state.categories.find(item => item.id === draft.categoryId) || state.categories[0];
    const scheduleText = scheduleLabel({ ...draft, schedule: draft.schedule });
    content = `<div class="form-grid"><div class="field-group full"><label for="habit-category">Category</label><div style="display:flex;gap:8px"><select id="habit-category" name="categoryId" style="flex:1"><option value="">Choose a category</option>${state.categories.map(item => `<option value="${escapeHtml(item.id)}" ${draft.categoryId === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select><button type="button" class="button secondary" data-action="create-category">New category</button></div></div><div class="field-group"><label for="habit-color">Category color</label><input id="habit-color" name="color" type="color" value="${escapeHtml(draft.color || category?.color || '#318b72')}"></div></div><div class="section-row" style="margin-top:22px"><h3>Review before saving</h3><span class="tag">Step 4 of 4</span></div><div class="review-list"><div class="review-row"><span>Habit</span><strong>${escapeHtml(draft.icon || '')} ${escapeHtml(draft.name || 'Untitled')}</strong></div><div class="review-row"><span>Completion</span><strong>${draft.type === 'done' ? 'Done' : `${Number(draft.target) || 1} ${escapeHtml(draft.unit || '')}`}</strong></div><div class="review-row"><span>Schedule</span><strong>${escapeHtml(scheduleText)}</strong></div><div class="review-row"><span>Starts</span><strong>${escapeHtml(draft.startDate || 'Choose a date')}</strong></div><div class="review-row"><span>Category</span><strong>${escapeHtml(category?.name || 'Choose a category')}</strong></div></div>`;
  }
  return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="wizard-title"><div class="modal-head"><div><p class="eyebrow">${editing ? 'Edit habit' : 'Create a habit'}</p><h2 id="wizard-title">${['Identity', 'Completion type', 'Schedule', 'Category & review'][step - 1]}</h2><p>Step ${step} of 4</p></div><button class="icon-button" data-action="close-modal" aria-label="Close">${icon('close')}</button></div><div class="modal-body"><div class="wizard-progress">${[1, 2, 3, 4].map(number => `<span class="${number <= step ? 'active' : ''}"></span>`).join('')}</div><form id="habit-wizard" novalidate>${content}<p class="field-hint" id="wizard-error" role="alert" style="margin-top:12px"></p><div class="modal-actions">${step > 1 ? '<button type="button" class="button secondary" data-action="wizard-back">Back</button>' : '<span></span>'}${step < 4 ? '<button type="button" class="button" data-action="wizard-next">Continue</button>' : `<button type="button" class="button" data-action="wizard-save">${editing ? 'Save changes' : 'Create habit'}</button>`}</div></form></div></section></div>`;
}

function renderDetailModal(habit) {
  const category = habitCategory(habit);
  const today = localDateKey();
  const streak = getHabitStreak(state, habit, today);
  const scheduledDays = dateRange(addDays(today, -29), today).filter(date => isScheduled(habit, date));
  const monthDone = scheduledDays.filter(date => isCompletionDone(habit, completionFor(state, habit.id, date))).length;
  const month = { rate: scheduledDays.length ? Math.round(monthDone / scheduledDays.length * 100) : 0 };
  const habitDone = state.completions.filter(item => item.habitId === habit.id && isCompletionDone(habit, item)).length;
  const reminder = habit.reminder || { enabled: false, time: '09:00' };
  const heat = dateRange(addDays(today, -29), today).map(date => {
    const record = completionFor(state, habit.id, date);
    return `<span class="heat-cell ${record && isCompletionDone(habit, record) ? 'level-4' : record ? 'level-2' : ''}" title="${formatShortDate(date)}"></span>`;
  }).join('');
  return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="modal wide" role="dialog" aria-modal="true" aria-labelledby="detail-title"><div class="modal-head"><div><p class="eyebrow">${escapeHtml(category.name)} · ${escapeHtml(scheduleLabel(habit))}</p><h2 id="detail-title">${escapeHtml(habit.icon || '')} ${escapeHtml(habit.name)}</h2><p>${escapeHtml(habit.description || 'No description added.')}</p></div><button class="icon-button" data-action="close-modal" aria-label="Close">${icon('close')}</button></div><div class="modal-body"><div class="detail-stats"><div class="detail-stat"><strong>${streak.current}</strong><span>Current streak</span></div><div class="detail-stat"><strong>${streak.longest}</strong><span>Longest streak</span></div><div class="detail-stat"><strong>${habitDone}</strong><span>Total completions</span></div></div><div class="section-row" style="margin-top:10px"><h3>30-day activity</h3><span class="subhead">${month.rate}% overall scheduled completion</span></div><div class="heatmap">${heat}</div><div class="form-grid" style="margin-top:20px"><div class="field-group"><label>Reminder time</label><input type="time" data-action="reminder-time" data-id="${escapeHtml(habit.id)}" value="${escapeHtml(reminder.time || '09:00')}" ${readOnly ? 'disabled' : ''}><span class="field-hint">Checked while this app is open. Background delivery depends on the browser.</span></div><div class="field-group"><label>Reminder</label><div style="display:flex;align-items:center;gap:10px;min-height:39px"><input class="switch" type="checkbox" data-action="reminder-toggle" data-id="${escapeHtml(habit.id)}" ${reminder.enabled ? 'checked' : ''} ${readOnly ? 'disabled' : ''}><span class="field-hint">${reminder.enabled ? 'Enabled' : 'Disabled'}</span></div></div></div><div class="modal-actions"><div style="display:flex;gap:7px;flex-wrap:wrap"><button class="button secondary small" data-action="edit-habit" data-id="${escapeHtml(habit.id)}">Edit</button><button class="button secondary small" data-action="toggle-pause" data-id="${escapeHtml(habit.id)}">${habit.status === 'paused' ? 'Resume' : 'Pause'}</button><button class="button secondary small" data-action="archive-habit" data-id="${escapeHtml(habit.id)}">${habit.status === 'archived' ? 'Restore' : 'Archive'}</button></div><button class="button danger small" data-action="delete-habit" data-id="${escapeHtml(habit.id)}">Delete</button></div></div></section></div>`;
}

function saveWizard() {
  syncWizardForm();
  const error = wizardError();
  if (error) { $('#wizard-error').textContent = error; return; }
  const draft = structuredClone(wizard.draft);
  const editingId = wizard.editingId;
  const saved = commit(current => {
    const index = current.habits.findIndex(item => item.id === editingId);
    if (index >= 0) {
      current.habits[index] = { ...current.habits[index], ...draft, schedule: { ...draft.schedule } };
      reconcileAchievements(state, current, localDateKey());
    }
    else current.habits.unshift({ ...draft, id: crypto.randomUUID(), status: 'active', pausedRanges: [], reminder: { enabled: false, time: '09:00' } });
    return current;
  });
  if (saved) {
    wizard = null;
    renderModal();
    showToast(editingId ? 'Habit updated.' : 'Habit created. You are ready to begin.');
  }
}

function toggleCompletion(habitId, date, nextValue) {
  const habit = state.habits.find(item => item.id === habitId);
  if (!habit) return;
  const previous = Number(completionFor(state, habitId, date)?.value) || 0;
  const succeeded = commit(current => setCompletion(current, habitId, date, nextValue, localDateKey()));
  if (succeeded) showToast(nextValue > 0 ? 'Progress saved.' : 'Completion removed.', () => {
    commit(current => setCompletion(current, habitId, date, previous, localDateKey()), 'Change undone.');
  });
}

function focusDefaults(mode) {
  if (mode === 'pomodoro') return 25 * 60;
  if (mode === 'countdown') return 5 * 60;
  return 0;
}

function updateFocus(updates, message = '') {
  return commit(current => {
    current.focus = { ...current.focus, ...updates };
    return current;
  }, message);
}

function startFocus() {
  const focus = state.focus;
  const remaining = focus.mode === 'stopwatch' ? focusSeconds() : (focus.status === 'paused' ? focusSeconds() : focus.durationSeconds);
  if (focus.mode !== 'stopwatch' && remaining <= 0) {
    updateFocus({ status: 'idle', remainingSeconds: focus.durationSeconds, endsAt: null, startedAt: null });
    return;
  }
  focusCompletionHandled = false;
  const now = Date.now();
  updateFocus({
    status: 'running',
    remainingSeconds: remaining,
    startedAt: now,
    endsAt: focus.mode === 'stopwatch' ? null : now + remaining * 1000
  });
}

function pauseFocus() {
  const remaining = focusSeconds();
  updateFocus({ status: 'paused', remainingSeconds: remaining, endsAt: null, startedAt: null });
}

function finishFocus(outcome) {
  if (focusCompletionHandled) return;
  focusCompletionHandled = true;
  const focus = state.focus;
  const now = Date.now();
  const remaining = focusSeconds();
  const naturallyDone = outcome === 'completed' && focus.mode !== 'stopwatch' && remaining <= 0;
  const complete = focus.mode === 'stopwatch' ? outcome === 'completed' : naturallyDone;
  const elapsedSeconds = focus.mode === 'stopwatch'
    ? remaining
    : complete ? focus.durationSeconds : Math.max(0, focus.durationSeconds - remaining);
  const session = {
    id: crypto.randomUUID(), mode: focus.mode,
    startedAt: new Date(focus.startedAt || (now - elapsedSeconds * 1000)).toISOString(),
    endedAt: new Date(now).toISOString(), elapsedSeconds,
    outcome: complete ? 'completed' : outcome === 'skipped' ? 'skipped' : 'stopped',
    activity: focus.activity || '', habitId: focus.habitId || null
  };
  commit(current => {
    const next = recordFocusSession(current, session, localDateKey());
    next.focus = { ...next.focus, status: 'idle', remainingSeconds: next.focus.mode === 'stopwatch' ? 0 : next.focus.durationSeconds, endsAt: null, startedAt: null };
    return next;
  }, complete ? 'Focus session saved.' : session.outcome === 'skipped' ? 'Session skipped. No XP awarded.' : 'Session stopped.');
  focusCompletionHandled = false;
}

function resetFocus() {
  const duration = state.focus.mode === 'stopwatch' ? 0 : state.focus.durationSeconds;
  updateFocus({ status: 'idle', remainingSeconds: duration, endsAt: null, startedAt: null });
  focusCompletionHandled = false;
}

function checkTimer() {
  const focus = state.focus;
  if (focus.status !== 'running') return;
  const seconds = focusSeconds();
  const timeEl = $('#timer-time');
  const face = $('#timer-face');
  if (timeEl) timeEl.textContent = clockText(seconds);
  if (face) {
    const ratio = focus.mode === 'stopwatch' ? seconds % 60 / 60 : 1 - seconds / Math.max(1, focus.durationSeconds);
    face.style.setProperty('--timer-angle', `${ratio * 360}deg`);
  }
  if (focus.mode !== 'stopwatch' && seconds <= 0) finishFocus('completed');
}

function pauseHabit(habitId) {
  const today = localDateKey();
  if (state.habits.find(item => item.id === habitId)?.status === 'archived') {
    showToast('Restore the archived habit before pausing it.');
    return;
  }
  commit(current => {
    const habit = current.habits.find(item => item.id === habitId);
    if (!habit) return current;
    habit.pausedRanges ||= [];
    if (habit.status === 'paused') {
      const open = [...habit.pausedRanges].reverse().find(range => !range.to);
      if (open) open.to = addDays(today, -1);
      habit.status = 'active';
    } else {
      habit.pausedRanges.push({ from: today, to: '' });
      habit.status = 'paused';
    }
    return current;
  }, 'Habit status updated.');
  renderModal();
}

function archiveHabit(habitId) {
  const habit = state.habits.find(item => item.id === habitId);
  if (!habit) return;
  const restore = habit.status === 'archived';
  if (!restore && !confirm(`Archive "${habit.name}"? Its history will remain available.`)) return;
  commit(current => {
    const target = current.habits.find(item => item.id === habitId);
    target.pausedRanges ||= [];
    const openPause = [...(target.pausedRanges || [])].reverse().find(range => !range.to);
    if (restore) {
      target.status = 'active';
      target.archivedAt = '';
      if (openPause) openPause.to = addDays(localDateKey(), -1);
    } else {
      if (target.status === 'paused' && openPause) openPause.to = addDays(localDateKey(), -1);
      target.pausedRanges.push({ from: localDateKey(), to: '' });
      target.status = 'archived';
      target.archivedAt = localDateKey();
    }
    return current;
  }, restore ? 'Habit restored.' : 'Habit archived. History preserved.');
  if (!restore) detailHabitId = null;
  renderModal();
}

function deleteHabit(habitId) {
  const habit = state.habits.find(item => item.id === habitId);
  if (!habit || !confirm(`Permanently delete "${habit.name}" and its completion history? This cannot be undone. Export a backup first if you may need it.`)) return;
  commit(current => {
    for (const record of current.completions.filter(item => item.habitId === habitId)) {
      const xp = current.xpLedger.find(entry => entry.id === `completion:${habitId}:${record.date}`);
      if (xp) xp.reversed = true;
    }
    current.habits = current.habits.filter(item => item.id !== habitId);
    current.completions = current.completions.filter(item => item.habitId !== habitId);
    reconcileAchievements(state, current, localDateKey());
    return current;
  }, 'Habit and its history deleted.');
  detailHabitId = null;
  renderModal();
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportJson() {
  download(`thabit-backup-${localDateKey()}.json`, JSON.stringify(state, null, 2), 'application/json');
  showToast('Backup downloaded. Keep it somewhere safe.');
}

function exportCsv() {
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['date', 'habit', 'type', 'value', 'unit', 'target', 'completed']];
  for (const item of [...state.completions].sort((a, b) => a.date.localeCompare(b.date))) {
    const habit = state.habits.find(entry => entry.id === item.habitId);
    if (habit) rows.push([item.date, habit.name, habit.type, item.value, habit.unit || '', habit.type === 'done' ? 1 : habit.target, isCompletionDone(habit, item)]);
  }
  download(`thabit-completions-${localDateKey()}.csv`, rows.map(row => row.map(quote).join(',')).join('\n'), 'text/csv');
  showToast('Completion history downloaded as CSV.');
}

async function importJson(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const restored = normalizeImportedState(parsed);
    if (!confirm(`This backup contains ${restored.habits.length} habits and ${restored.completions.length} completion records. Replace the data on this device? Export a backup first if needed.`)) return;
    writeState(restored);
    state = restored;
    readOnly = false;
    storageError = null;
    render();
    showToast('Backup restored successfully.');
  } catch (error) {
    showToast(`Backup was not restored: ${error.message}`);
  }
}

async function enableReminder(habitId, enabled) {
  if (enabled && !('Notification' in window)) {
    showToast('This browser does not support notifications.');
    renderModal();
    return;
  }
  if (enabled && Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast(permission === 'denied' ? 'Notifications are blocked in browser settings.' : 'Notification permission was not granted.');
      renderModal();
      return;
    }
  }
  commit(current => {
    const habit = current.habits.find(item => item.id === habitId);
    if (habit) habit.reminder = { ...(habit.reminder || { time: '09:00' }), enabled };
    return current;
  }, enabled ? 'Reminder enabled while the app is open.' : 'Reminder disabled.');
  renderModal();
}

function checkReminders() {
  if (document.visibilityState !== 'visible') return;
  const now = new Date();
  const date = localDateKey(now);
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const due = activeHabits().filter(habit => habit.reminder?.enabled && habit.reminder.time === time && isScheduled(habit, date));
  for (const habit of due) {
    const key = `${habit.id}:${date}:${time}`;
    if ((state.settings.reminderFired || []).includes(key)) continue;
    const saved = commit(current => {
      current.settings.reminderFired = [...(current.settings.reminderFired || []), key].slice(-60);
      return current;
    });
    if (!saved) return;
    if ('Notification' in window && Notification.permission === 'granted') new Notification(`Time for ${habit.name}`, { body: habit.description || 'A small step is enough.' });
    showToast(`Reminder: ${habit.name}`);
  }
}

function handleClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'navigate') { page = button.dataset.page; render(); return; }
  if (action === 'new-habit') { beginWizard(); return; }
  if (action === 'details') { detailHabitId = button.dataset.id; renderModal(); return; }
  if (action === 'close-modal') { wizard = null; detailHabitId = null; renderModal(); return; }
  if (action === 'modal-backdrop' && event.target === button) { wizard = null; detailHabitId = null; renderModal(); return; }
  if (action === 'complete') {
    const habit = state.habits.find(item => item.id === button.dataset.id);
    const date = button.dataset.date;
    const progress = habitProgress(habit, date);
    toggleCompletion(habit.id, date, progress.done ? 0 : progress.target);
    return;
  }
  if (action === 'increment') {
    const habit = state.habits.find(item => item.id === button.dataset.id);
    const progress = habitProgress(habit, button.dataset.date);
    const step = habit.type === 'duration' ? (/^hours?$/i.test(habit.unit) ? 0.25 : 15) : 1;
    toggleCompletion(habit.id, button.dataset.date, Math.min(progress.target, progress.value + step));
    return;
  }
  if (action === 'wizard-next' || action === 'wizard-back') {
    syncWizardForm();
    const error = action === 'wizard-next' ? wizardError() : '';
    if (error) { $('#wizard-error').textContent = error; return; }
    wizard.step += action === 'wizard-next' ? 1 : -1;
    renderModal();
    return;
  }
  if (action === 'wizard-save') { saveWizard(); return; }
  if (action === 'wizard-type') {
    syncWizardForm();
    wizard.draft.type = button.dataset.type;
    if (wizard.draft.type === 'duration') wizard.draft.unit = 'minutes';
    if (wizard.draft.type === 'quantity') wizard.draft.unit = wizard.draft.unit || 'reps';
    renderModal();
    return;
  }
  if (action === 'wizard-icon') { syncWizardForm(); wizard.draft.icon = button.dataset.icon; renderModal(); return; }
  if (action === 'wizard-day') {
    syncWizardForm();
    const day = Number(button.dataset.day);
    const selected = new Set(wizard.draft.schedule.weekdays);
    selected.has(day) ? selected.delete(day) : selected.add(day);
    wizard.draft.schedule.weekdays = [...selected].sort((a, b) => a - b);
    renderModal();
    return;
  }
  if (action === 'create-category') {
    syncWizardForm();
    const name = prompt('Name this category:');
    if (!name?.trim()) return;
    const category = { id: crypto.randomUUID(), name: name.trim().slice(0, 32), color: wizard.draft.color || '#318b72', icon: 'leaf' };
    const saved = commit(current => { current.categories.push(category); return current; });
    if (saved) { wizard.draft.categoryId = category.id; renderModal(); }
    return;
  }
  if (action === 'edit-habit') { beginWizard(state.habits.find(item => item.id === button.dataset.id)); return; }
  if (action === 'toggle-pause') { pauseHabit(button.dataset.id); return; }
  if (action === 'archive-habit') { archiveHabit(button.dataset.id); return; }
  if (action === 'delete-habit') { deleteHabit(button.dataset.id); return; }
  if (action === 'calendar-day') { selectedDate = button.dataset.date; render(); return; }
  if (action === 'calendar-mode') { calendarMode = button.dataset.mode; render(); return; }
  if (action === 'calendar-today') { selectedDate = localDateKey(); calendarCursor = fromDateKey(`${selectedDate.slice(0, 7)}-01`); render(); return; }
  if (action === 'calendar-shift') {
    const direction = Number(button.dataset.direction);
    if (calendarMode === 'month') calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + direction, 1, 12);
    else selectedDate = addDays(selectedDate, direction * 7);
    render();
    return;
  }
  if (action === 'focus-mode') {
    if (state.focus.status === 'running') { showToast('Pause or finish the running session before changing modes.'); return; }
    const mode = button.dataset.mode;
    const duration = focusDefaults(mode);
    updateFocus({ mode, durationSeconds: duration, remainingSeconds: duration, status: 'idle', endsAt: null, startedAt: null });
    return;
  }
  if (action === 'focus-start') { startFocus(); return; }
  if (action === 'focus-pause') { pauseFocus(); return; }
  if (action === 'focus-reset') { resetFocus(); return; }
  if (action === 'focus-skip') { finishFocus('skipped'); return; }
  if (action === 'focus-finish') { finishFocus(state.focus.mode === 'stopwatch' ? 'completed' : 'stopped'); return; }
  if (action === 'export-json') { exportJson(); return; }
  if (action === 'export-csv') { exportCsv(); return; }
  if (action === 'import') { $('#import-file')?.click(); return; }
  if (action === 'toast-undo' && undoAction) { const undo = undoAction; undoAction = null; clearTimeout(toastTimer); toastEl.classList.remove('show'); undo(); return; }
  if (action === 'install') {
    if (installPrompt) { installPrompt.prompt(); installPrompt = null; }
    else showToast('Use your browser menu to install Thabit when installation is available.');
  }
}

function handleChange(event) {
  const target = event.target;
  if (target.id === 'category-filter') { categoryFilter = target.value; render(); return; }
  if (target.id === 'status-filter') { statusFilter = target.value; render(); return; }
  if (target.id === 'import-file') { importJson(target.files?.[0]); target.value = ''; return; }
  if (target.dataset.action === 'wizard-schedule') { syncWizardForm(); wizard.draft.schedule.type = target.value; renderModal(); return; }
  if (target.dataset.action === 'reminder-toggle') { enableReminder(target.dataset.id, target.checked); return; }
  if (target.dataset.action === 'reminder-time') {
    commit(current => { const habit = current.habits.find(item => item.id === target.dataset.id); if (habit) habit.reminder = { ...(habit.reminder || { enabled: false }), time: target.value }; return current; }, 'Reminder time saved.');
    renderModal();
    return;
  }
  if (target.dataset.action === 'focus-habit') { updateFocus({ habitId: target.value || null }); return; }
  if (target.dataset.action === 'focus-duration') {
    const minutes = Math.max(1, Math.min(180, Number(target.value) || 1));
    updateFocus({ durationSeconds: minutes * 60, remainingSeconds: minutes * 60 });
    return;
  }
}

function handleInput(event) {
  const target = event.target;
  if (target.id === 'habit-search') {
    habitQuery = target.value;
    const selection = target.selectionStart;
    render();
    const input = $('#habit-search');
    input?.focus();
    input?.setSelectionRange(selection, selection);
    return;
  }
  if (target.dataset.action === 'focus-activity') {
    if (readOnly) return;
    state.focus.activity = target.value;
    clearTimeout(activitySaveTimer);
    activitySaveTimer = setTimeout(() => {
      try { writeState(state); } catch { showToast('Could not save the session label.'); }
    }, 350);
  }
}

document.addEventListener('click', handleClick);
document.addEventListener('change', handleChange);
document.addEventListener('input', handleInput);
window.addEventListener('online', render);
window.addEventListener('offline', render);
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });

render();
setInterval(checkTimer, 250);
setInterval(checkReminders, 15000);

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(() => showToast('Offline caching could not be enabled in this browser.'));
}