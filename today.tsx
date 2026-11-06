import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Award, Clock3, Flame, Plus, Target } from "lucide-react";
import { HabitList, SessionList, TimerCard } from "@/components/app-widgets";
import { XpProgressCard } from "@/components/progress-widgets";
import { DatabaseErrorNotice } from "@/components/database-error-notice";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dayKey, formatMinutes, minutesByDay } from "@/lib/balance";
import {
  useAchievements,
  useAddHabit,
  useHabitLogs,
  useHabits,
  useSessions,
  useSettings,
} from "@/lib/data";
import { isHabitScheduledOnDay, scheduledStreakStats } from "@/lib/gamification";
import { dayPart } from "@/lib/time-of-day";

export const Route = createFileRoute("/_authenticated/today")({
  head: () => ({ meta: [{ title: "Today — Balance" }] }),
  component: Today,
});

function useCurrentTime(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Today() {
  const now = useCurrentTime();
  const date = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const sessionsQuery = useSessions();
  const settingsQuery = useSettings();
  const habitsQuery = useHabits();
  const logsQuery = useHabitLogs();
  const achievementsQuery = useAchievements();
  const addHabit = useAddHabit();
  const [quickHabit, setQuickHabit] = useState("");
  const sessions = sessionsQuery.data ?? [];
  const habits = habitsQuery.data ?? [];
  const logs = logsQuery.data ?? [];
  const unlocked = new Set(
    (achievementsQuery.data?.unlocked ?? []).map((item) => item.achievement_key),
  );
  const nextAchievement = achievementsQuery.data?.catalog.find((item) => !unlocked.has(item.key));
  const settings = settingsQuery.data;
  const timeByDay = minutesByDay(sessions, now);
  const todayMinutes = timeByDay.get(dayKey(now)) ?? 0;
  const dailyGoal = Math.max(1, settings?.daily_goal_minutes ?? 60);
  const scheduledHabits = habits.filter(
    (habit) => !habit.is_paused && !habit.archived_at && isHabitScheduledOnDay(habit, dayKey(now)),
  );
  const completedHabitIds = new Set(
    logs
      .filter((log) => {
        const habit = habits.find((item) => item.id === log.habit_id);
        return habit && log.day === dayKey(now) && log.count >= (habit.daily_goal_count ?? 1);
      })
      .map((log) => log.habit_id),
  );
  const completedToday = scheduledHabits.filter((habit) => completedHabitIds.has(habit.id)).length;
  const completionRate = scheduledHabits.length
    ? Math.round((completedToday / scheduledHabits.length) * 100)
    : 0;
  const currentStreak = Math.max(
    0,
    ...habits
      .filter((habit) => !habit.archived_at && !habit.is_paused)
      .map(
        (habit) =>
          scheduledStreakStats(
            logs
              .filter((log) => {
                const matches = log.habit_id === habit.id;
                return matches && log.count >= (habit.daily_goal_count ?? 1);
              })
              .map((log) => log.day),
            dayKey(now),
            habit,
          ).current,
      ),
  );
  const motivation =
    scheduledHabits.length === 0
      ? "No habits are scheduled today. Take a well-earned rest or add a new habit."
      : completionRate === 100
        ? "You showed up for everything today. Take a moment to celebrate your progress."
        : completionRate >= 50
          ? "You’re making good progress. One more small step can keep the momentum going."
          : completedToday > 0
            ? "Every completed habit counts. Keep going at your own pace."
            : "Start with one small action. You can build momentum from there.";
  return (
    <div className="today-dashboard space-y-6">
      <header className="dashboard-heading">
        <div>
          <p className="dashboard-date">{date}</p>
          <h1>Good {dayPart(now)},</h1>
          <p className="dashboard-subtitle">A little consistency goes a long way.</p>
        </div>
        <Button asChild variant="outline" className="dashboard-heading-action">
          <Link to="/stats" viewTransition preload="intent" preloadDelay={0}>
            View progress <ArrowRight />
          </Link>
        </Button>
      </header>
      <section className="dashboard-hero" aria-labelledby="dashboard-hero-title">
        <div className="dashboard-hero-copy">
          <p className="dashboard-hero-kicker">YOUR DAY, AT YOUR PACE</p>
          <h2 id="dashboard-hero-title">Make room for what matters.</h2>
          <p>{motivation}</p>
          <div className="dashboard-hero-summary">
            <span>{completedToday} of {scheduledHabits.length} habits complete</span>
            <span aria-hidden="true" className="dashboard-summary-divider" />
            <span>{formatMinutes(todayMinutes)} focused</span>
          </div>
          <Button asChild variant="amber">
            <Link to="/habits" viewTransition preload="intent" preloadDelay={0}>
              <Plus /> Build your routine
            </Link>
          </Button>
        </div>
        <div className="dashboard-hero-progress">
          <div
            className="dashboard-progress-ring"
            role="progressbar"
            aria-label="Today's habit completion"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={completionRate}
          >
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle className="dashboard-ring-track" cx="60" cy="60" r="50" />
              <circle
                className="dashboard-ring-value"
                cx="60"
                cy="60"
                r="50"
                strokeDasharray={Math.PI * 100}
                strokeDashoffset={Math.PI * 100 * (1 - completionRate / 100)}
              />
            </svg>
            <div className="dashboard-ring-label">
              <strong>{completionRate}%</strong>
              <span>habits done</span>
            </div>
          </div>
        </div>
      </section>
      {(sessionsQuery.isError ||
        settingsQuery.isError ||
        habitsQuery.isError ||
        logsQuery.isError ||
        achievementsQuery.isError) && (
        <DatabaseErrorNotice
          title="Today’s progress could not be fully loaded"
          error={
            sessionsQuery.error ??
            settingsQuery.error ??
            habitsQuery.error ??
            logsQuery.error ??
            achievementsQuery.error
          }
          onRetry={() => {
            void Promise.all([
              sessionsQuery.refetch(),
              settingsQuery.refetch(),
              habitsQuery.refetch(),
              logsQuery.refetch(),
              achievementsQuery.refetch(),
            ]);
          }}
        />
      )}
      <section className="dashboard-stats" aria-label="Today's overview">
        <article className="dashboard-stat-card">
          <span className="dashboard-stat-icon">
            <Target />
          </span>
          <div>
            <p>Habits completed</p>
            <strong>
              {completedToday}
              <span> / {scheduledHabits.length}</span>
            </strong>
          </div>
        </article>
        <article className="dashboard-stat-card dashboard-stat-card-warm">
          <span className="dashboard-stat-icon">
            <Clock3 />
          </span>
          <div>
            <p>Focus time</p>
            <strong>{formatMinutes(todayMinutes)}</strong>
          </div>
        </article>
        <article className="dashboard-stat-card dashboard-stat-card-soft">
          <span className="dashboard-stat-icon">
            <Flame />
          </span>
          <div>
            <p>Current streak</p>
            <strong>
              {currentStreak}
              <span> days</span>
            </strong>
          </div>
        </article>
      </section>
      <div className="dashboard-content-grid">
        <div className="dashboard-main-column">
          <section className="dashboard-panel">
            <div className="dashboard-section-heading">
              <div>
                <p className="dashboard-section-kicker">A LITTLE, OFTEN</p>
                <h2>Today’s habits</h2>
              </div>
              <Link to="/habits" viewTransition preload="intent" preloadDelay={0}>
                Manage <ArrowRight />
              </Link>
            </div>
            <HabitList showGrid={false} />
          </section>
          <form
            className="dashboard-quick-add"
            onSubmit={(event) => {
              event.preventDefault();
              const habitName = quickHabit.trim();
              if (!habitName) return;
              addHabit.mutate(
                {
                  name: habitName,
                  color: "green",
                  category: "Health",
                  icon: "sparkles",
                  description: "",
                  frequency: "daily",
                  schedule_days: [0, 1, 2, 3, 4, 5, 6],
                  difficulty: "medium",
                  reminder_enabled: false,
                  reminder_time: "09:00",
                  tracking_type: "yes_no",
                  daily_goal_count: 1,
                  daily_goal_minutes: 30,
                },
                { onSuccess: () => setQuickHabit("") },
              );
            }}
          >
            <div className="dashboard-quick-add-copy">
              <Plus className="size-5 text-primary" />
              <div>
                <p>Start a new habit</p>
                <span>Keep it small and make it yours.</span>
              </div>
            </div>
            <div className="dashboard-quick-add-controls">
              <Input
                value={quickHabit}
                onChange={(event) => setQuickHabit(event.target.value)}
                placeholder="e.g. Read for 10 minutes"
                aria-label="Quick add a habit"
                maxLength={120}
                className="h-11 min-w-0 rounded-full bg-cell"
              />
              <Button type="submit" disabled={!quickHabit.trim() || addHabit.isPending}>
                <Plus /> Add
              </Button>
            </div>
          </form>
        </div>
        <aside className="dashboard-aside">
          <section className="dashboard-goal-card">
            <div className="dashboard-section-heading">
              <div>
                <p className="dashboard-section-kicker">MAKE TIME FOR YOU</p>
                <h2>Daily focus goal</h2>
              </div>
              <Clock3 className="size-5 text-primary" />
            </div>
            <div className="dashboard-goal-summary">
              <strong>{formatMinutes(todayMinutes)}</strong>
              <span>of {formatMinutes(dailyGoal)}</span>
              <span className="dashboard-goal-percent">
                {Math.min(100, Math.round((todayMinutes / dailyGoal) * 100))}%
              </span>
            </div>
            <Progress value={Math.min(100, (todayMinutes / dailyGoal) * 100)} className="h-2.5" />
          </section>
          <TimerCard />
          <details className="dashboard-panel dashboard-sessions">
            <summary>Recent focus sessions</summary>
            <div className="mt-4"><SessionList /></div>
          </details>
          <XpProgressCard compact />
          {nextAchievement && (
            <section className="dashboard-next-achievement">
              <span className="dashboard-achievement-icon"><Award /></span>
              <div className="min-w-0 flex-1">
                <p>Next achievement</p>
                <strong>{nextAchievement.name}</strong>
              </div>
              <span className="dashboard-achievement-xp">+{nextAchievement.reward_xp} XP</span>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
