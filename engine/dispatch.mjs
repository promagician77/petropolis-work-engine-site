// Dispatch: give each free team member the highest-priority task they are qualified for.

import { rank, score, why } from './priority.mjs';
import { clock } from './util.mjs';

export const POLICIES = {
  priority: 'Work Engine priority',
  earliest: 'Earliest due first (like a paper checklist)',
};

export const qualified = (staff, task) => task.quals.every((q) => staff.quals.includes(q));

function order(tasks, now, policy, rules) {
  if (policy === 'priority') return rank(tasks, now, rules);
  if (policy === 'earliest') {
    return tasks
      .filter((t) => t.status === 'queued' && now >= t.availableAt)
      .map((t) => ({ task: t, score: score(t, now, rules) }))
      .sort((a, b) => a.task.dueAt - b.task.dueAt || a.task.availableAt - b.task.availableAt || (a.task.id < b.task.id ? -1 : 1));
  }
  throw new Error(`Unknown policy ${policy}`);
}

/**
 * Assign open tasks to free staff at minute `now`.
 * freeStaff: [{ id, name, quals, idleSince }]
 * Returns [{ taskId, staffId, score, reason, whyYou }] in assignment order.
 *
 * Tie-break between qualified people: the one with the FEWEST qualifications
 * gets it, so people with scarce skills (meds, large dogs) stay free for work
 * only they can do. Then whoever has been free longest.
 */
export function dispatch(tasks, freeStaff, now, { policy = 'priority', rules } = {}) {
  const free = [...freeStaff];
  const picks = [];
  for (const { task, score: s } of order(tasks, now, policy, rules)) {
    if (!free.length) break;
    const cands = free.filter((st) => qualified(st, task));
    if (!cands.length) continue;
    cands.sort((a, b) => a.quals.length - b.quals.length || a.idleSince - b.idleSince || (a.id < b.id ? -1 : 1));
    const st = cands[0];
    free.splice(free.indexOf(st), 1);
    picks.push({ taskId: task.id, staffId: st.id, score: s, reason: why(task, s), whyYou: whyYou(task, cands.length) });
  }
  return picks;
}

const SKILL = { meds: 'meds-certified', bigdog: 'large-dog', cats: 'cat-care', lobby: 'lobby', playgroup: 'playgroup', cleaning: 'cleaning', opening: 'opening', closing: 'closing' };
export const skillLabel = (q) => SKILL[q] ?? q;

function whyYou(task, candidates) {
  const needed = task.quals.filter((q) => q !== 'care').map(skillLabel);
  if (!needed.length) return candidates > 1 ? 'You were free first' : "You're free";
  return `Needs ${needed.join(' + ')}: ${candidates === 1 ? "you're the only one free" : 'you qualify'}`;
}

/** The next task for one person, e.g. right after they tap Done. */
export function nextFor(staff, tasks, now, opts) {
  return dispatch(tasks, [{ ...staff, idleSince: now }], now, opts)[0] ?? null;
}

/**
 * Morning coverage check: tasks that nobody on the rota can do inside their window.
 * Run at 5:00 AM by the day planner; results go to #floor-leads before the doors open.
 */
export function coverageGaps(tasks, staff) {
  const gaps = [];
  for (const t of [...tasks].sort((a, b) => a.dueAt - b.dueAt)) {
    if (t.status !== 'queued') continue;
    const able = staff.filter((s) => qualified(s, t));
    const inWindow = able.filter((s) => s.start <= t.dueAt && s.end >= t.availableAt);
    if (inWindow.length) continue;
    const first = able.filter((s) => s.start > t.dueAt).sort((a, b) => a.start - b.start)[0];
    const needs = t.quals.filter((q) => q !== 'care').map(skillLabel);
    gaps.push({
      taskId: t.id,
      title: t.title,
      due: t.dueAt,
      needs,
      firstAvailable: first ? { name: first.name, at: first.start } : null,
      text: `${t.title} (${clock(t.dueAt)}) needs ${needs.join(' + ') || 'basic care'}; ${first ? `first qualified person is ${first.name} at ${clock(first.start)}` : 'nobody on today’s rota is qualified'}.`,
    });
  }
  return gaps;
}
