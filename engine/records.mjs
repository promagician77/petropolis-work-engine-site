// The four records the job asks to keep in AWS, built from a simulated day,
// plus the DynamoDB item shapes they are stored as.

import { clock } from './util.mjs';
import { QUALS, PILOT_DATE } from './day.mjs';
import { TASK_TYPES } from './tasks.mjs';

const nameOf = (staff, id) => staff.find((s) => s.id === id)?.name ?? '';

export function completedTasks(sim) {
  return sim.tasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => a.assignedAt - b.assignedAt)
    .map((t) => ({
      task_id: t.id,
      type: TASK_TYPES[t.type].label,
      title: t.title,
      pets: t.petNames.join('; '),
      where: t.where,
      completed_by: nameOf(sim.staff, t.doneBy),
      due: clock(t.dueAt),
      started: clock(t.assignedAt),
      finished: clock(t.doneAt),
      minutes: t.doneAt - t.assignedAt,
      outcome: t.outcome ?? '',
      late_minutes: Math.max(0, t.assignedAt - t.dueAt),
    }));
}

export function incompleteTasks(sim) {
  const rows = [];
  for (const t of sim.tasks) {
    for (const h of t.history ?? []) {
      rows.push({ task_id: t.id, title: t.title, status: h.status, reason: h.reason, by: nameOf(sim.staff, h.by), at: clock(h.at) });
    }
    if (t.status === 'cancelled' || t.status === 'missed') {
      rows.push({ task_id: t.id, title: t.title, status: t.status, reason: t.reason ?? '', by: t.status === 'cancelled' ? 'Goose' : '', at: t.closedAt != null ? clock(t.closedAt) : '' });
    }
  }
  return rows;
}

export function shifts(sim) {
  return sim.staff.map((s) => {
    const br = s.breaks[0];
    const breakMin = s.breaks.reduce((a, b) => a + (b.end - b.start), 0);
    return {
      employee: s.name,
      clock_in: s.clockIn != null ? clock(s.clockIn) : '',
      break_start: br ? clock(br.start) : '',
      break_end: br ? clock(br.end) : '',
      clock_out: s.clockOut != null ? clock(s.clockOut) : '',
      paid_minutes: s.clockIn != null && s.clockOut != null ? s.clockOut - s.clockIn - breakMin : '',
    };
  });
}

export function qualifications(staffList) {
  return staffList.map((s) => ({ employee: s.name, qualifications: s.quals.map((q) => QUALS[q]).join('; ') }));
}

export function toCSV(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

/**
 * Single-table DynamoDB design. One table, on-demand, point-in-time recovery on.
 * Open tasks carry GSI1 keys (a sparse index), so "what is waiting right now"
 * is one cheap query; closing a task removes the GSI keys.
 */
export const KEY_DESIGN = [
  { record: 'Task (open or closed)', pk: 'LOC#pilot#DAY#2026-11-18', sk: 'TASK#<task id>', gsi1: 'LOC#pilot#OPEN / <due>#<task id> (open tasks only)' },
  { record: 'Employee + qualifications', pk: 'STAFF#<id>', sk: 'PROFILE', gsi1: '—' },
  { record: 'Shift event (clock in/out, break)', pk: 'STAFF#<id>', sk: 'SHIFT#2026-11-18#<time>#<event>', gsi1: '—' },
  { record: 'Goose reservation (latest version)', pk: 'RES#<goose id>', sk: 'CURRENT', gsi1: '—' },
  { record: 'Action idempotency key (7-day TTL)', pk: 'ACTION#<action id>', sk: 'ACTION', gsi1: '—' },
  { record: 'Task template / checklist item', pk: 'LOC#pilot', sk: 'TEMPLATE#<id>', gsi1: '—' },
];

export function sampleItems(sim) {
  const done = sim.tasks.find((t) => t.status === 'done' && t.type === 'meds');
  const blocked = sim.tasks.find((t) => (t.history ?? []).length);
  const s = sim.staff[0];
  return {
    completedTask: done && {
      PK: `LOC#pilot#DAY#${PILOT_DATE}`, SK: `TASK#${done.id}`, type: done.type, title: done.title, status: 'done',
      dueAt: done.dueAt, startedAt: done.assignedAt, doneAt: done.doneAt, doneBy: done.doneBy, outcome: done.outcome,
      score: done.scoreAtAssign, reason: done.reason, version: 3,
    },
    blockedTask: blocked && {
      PK: `LOC#pilot#DAY#${PILOT_DATE}`, SK: `TASK#${blocked.id}`, status: blocked.status,
      history: blocked.history.map((h) => ({ ...h, at: h.at })), photos: ['s3://petropolis-work-engine-photos/2026/11/18/<task>/<file>.jpg'],
    },
    shiftEvent: { PK: `STAFF#${s.id}`, SK: `SHIFT#${PILOT_DATE}#${String(s.clockIn).padStart(4, '0')}#clock_in`, at: s.clockIn, source: 'slack_home', offline: false },
    staffProfile: { PK: `STAFF#${s.id}`, SK: 'PROFILE', name: s.name, slackUserId: 'U0XXXXXXX', quals: s.quals, active: true },
  };
}
