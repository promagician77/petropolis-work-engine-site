// Rule-based priority. Every score is a sum of named parts so a manager can read
// exactly why a task is on top. No machine learning, no hidden weights.
//
//   score = importance + how-soon + overdue + pet-welfare + manager
//
// "How soon" and "overdue" are measured against each task's late line:
// its due time plus the grace that type allows (meds 15 min, lobby 5, cleaning 30...).

import { TASK_TYPES } from './tasks.mjs';
import { clamp, clock } from './util.mjs';

export const RULES = {
  importanceScale: 1, // multiplies the per-type importance
  dueSoonWindow: 60, // minutes before the late line when "how soon" starts to climb (0 -> 60 points)
  overduePerMinute: 2, // points per minute past the late line (check-outs use 4: a customer is waiting)
  overdueCap: 60, // so one forgotten chore cannot bury everything else
  welfareFlat: 10, // pet-welfare tasks always get this
  welfareMultiplier: 0.5, // ...plus half again of their how-soon and overdue points
  pinBoost: 1000, // manager "do this next"
};

export const lateLine = (task) => task.dueAt + TASK_TYPES[task.type].grace;

/** Score a task at minute `now`. Returns null if the task cannot start yet. */
export function score(task, now, rules = RULES) {
  if (now < task.availableAt) return null;
  const type = TASK_TYPES[task.type];
  const sub = (task.subtype && type.subtypes?.[task.subtype]) || {};
  const importance = (task.importance ?? sub.importance ?? type.importance) * rules.importanceScale;
  const perMinute = sub.overduePerMinute ?? rules.overduePerMinute;
  const minsToLate = lateLine(task) - now;
  const dueSoon = clamp(rules.dueSoonWindow - minsToLate, 0, rules.dueSoonWindow);
  const late = Math.max(0, -minsToLate);
  const overdue = Math.min(rules.overdueCap, late * perMinute);
  const welfare = task.welfare ? rules.welfareFlat + rules.welfareMultiplier * (dueSoon + overdue) : 0;
  const manager = task.pinned ? rules.pinBoost : task.override ?? 0;
  const r1 = (x) => Math.round(x * 10) / 10;
  return {
    total: r1(importance + dueSoon + overdue + welfare + manager),
    parts: { importance: r1(importance), dueSoon: r1(dueSoon), overdue: r1(overdue), welfare: r1(welfare), manager },
    late,
    minsToDue: task.dueAt - now,
    minsToLate,
  };
}

/** Plain-English reason, e.g. "Meds · due 8:00 AM · pet welfare". */
export function why(task, s) {
  const bits = [TASK_TYPES[task.type].label];
  if (s.late > 0) bits.push(`${s.late} min past its late line`);
  else if (s.minsToDue <= 0) bits.push(`due now, late after ${clock(lateLine(task))}`);
  else bits.push(`due ${clock(task.dueAt)}`);
  if (task.welfare) bits.push('pet welfare');
  if (task.pinned) bits.push('pinned by a manager');
  else if (s.parts.manager > 0) bits.push('raised by a manager');
  else if (s.parts.manager < 0) bits.push('lowered by a manager');
  return bits.join(' · ');
}

/** Rank open tasks at `now`, highest first; ties by due time then id, so runs are repeatable. */
export function rank(tasks, now, rules = RULES) {
  const out = [];
  for (const t of tasks) {
    if (t.status !== 'queued') continue;
    const s = score(t, now, rules);
    if (s) out.push({ task: t, score: s });
  }
  out.sort((a, b) => b.score.total - a.score.total || a.task.dueAt - b.task.dueAt || (a.task.id < b.task.id ? -1 : 1));
  return out;
}
