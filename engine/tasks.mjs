// Turns reservations into the day's tasks, plus daily checklist items from templates.
// All times are minutes since local midnight.

import { toMin } from './util.mjs';

export const TASK_TYPES = {
  meds: { label: 'Meds', importance: 60, welfare: true, grace: 15 },
  assist: { label: 'Assist', importance: 55, welfare: true, grace: 5 },
  feeding: { label: 'Feeding', importance: 45, welfare: true, grace: 30 },
  water: { label: 'Water check', importance: 40, welfare: true, grace: 30 },
  lobby: { label: 'Lobby run', importance: 40, welfare: false, grace: 5, subtypes: { out: { importance: 55, overduePerMinute: 4 } } },
  potty: { label: 'Potty walk', importance: 35, welfare: true, grace: 30 },
  checklist: { label: 'Checklist', importance: 25, welfare: false, grace: 15 },
  play: { label: 'Play', importance: 20, welfare: false, grace: 0 },
  cleaning: { label: 'Cleaning', importance: 15, welfare: false, grace: 30 },
};

const SOP = (slug) => ({ sop: `https://docs.example.com/petropolis/sop/${slug}`, video: `https://video.example.com/petropolis/${slug}` });

// Potty rounds are staggered by row so one person is not asked to walk 30 dogs at 6:30.
export const POTTY_TIMES = ['06:30', '11:00', '15:00', '18:30'].map(toMin);
export const POTTY_ROW_OFFSET = { A: 0, B: 15, C: 30 };
export const WATER_ROW_TIMES = ['07:00', '09:00', '11:00', '13:00', '15:00', '17:00', '19:00'].map(toMin);
export const WATER_YARD_TIMES = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'].map(toMin);
export const DAYCARE_PLAY = [toMin('09:00'), toMin('15:00')];

/** Daily checklist templates. Managers edit these in the admin; this is the starting set. */
export const CHECKLIST_TEMPLATES = [
  { id: 'open-lights', group: 'Opening', title: 'Lights, HVAC and cameras on', at: '06:00', due: '06:30', minutes: 4, quals: ['opening'] },
  { id: 'open-log', group: 'Opening', title: 'Read the overnight log and incident board', at: '06:00', due: '06:30', minutes: 5, quals: ['opening'] },
  { id: 'open-laundry', group: 'Opening', title: 'Start the first laundry load', at: '06:00', due: '06:45', minutes: 4, quals: ['opening'] },
  { id: 'open-yards', group: 'Opening', title: 'Walk every yard: gates, fences, hazards', at: '06:00', due: '06:50', minutes: 8, quals: ['opening'], photo: 'optional' },
  { id: 'open-lobby', group: 'Opening', title: 'Lobby ready: lights, sign-in tablet, spare leashes', at: '06:15', due: '06:55', minutes: 4, quals: ['opening'] },
  ...['09:00', '12:00', '15:00', '18:00'].map((t) => ({ id: `rt-lobby-${t}`, group: 'Routine cleaning', title: 'Lobby floor and door glass', at: t, due: t, lead: 30, minutes: 10, quals: ['cleaning'] })),
  ...['10:00', '13:00', '16:00'].flatMap((t) => ['Big Yard', 'Small Yard', 'Puppy Yard'].map((y) => ({ id: `rt-scoop-${y}-${t}`, group: 'Routine cleaning', title: `Scoop and hose ${y}`, at: t, due: t, lead: 30, minutes: 8, quals: ['cleaning'], where: y }))),
  ...['10:30', '14:00', '18:00'].map((t) => ({ id: `rt-laundry-${t}`, group: 'Routine cleaning', title: 'Swap laundry', at: t, due: t, lead: 30, minutes: 6, quals: ['care'] })),
  { id: 'close-water', group: 'Closing', title: 'Final water and bedding check, all rows', at: '19:00', due: '19:30', minutes: 15, quals: ['care'], welfare: true },
  { id: 'close-yards', group: 'Closing', title: 'Lock every yard gate', at: '19:00', due: '19:45', minutes: 5, quals: ['closing'] },
  { id: 'close-laundry', group: 'Closing', title: 'Fold and shelve laundry', at: '19:00', due: '19:50', minutes: 10, quals: ['closing'] },
  { id: 'close-bowls', group: 'Closing', title: 'Wash and sanitize bowls', at: '19:00', due: '19:50', minutes: 12, quals: ['closing'] },
  { id: 'close-trash', group: 'Closing', title: 'Trash and recycling out', at: '19:10', due: '19:55', minutes: 6, quals: ['closing'] },
  { id: 'close-lobby', group: 'Closing', title: 'Lobby: tablet charging, door locked', at: '19:15', due: '19:58', minutes: 4, quals: ['closing'] },
];

const zoneOf = (unit) => (unit ? unit[0] : null);
const present = (res, t) => (res.arriveAt ?? -1) <= t && t <= (res.departAt ?? 1441);

function task(fields) {
  const type = TASK_TYPES[fields.type];
  if (!type) throw new Error(`Unknown task type ${fields.type}`);
  return {
    subtype: null,
    petNames: [],
    reservationIds: [],
    steps: [],
    photo: null,
    links: null,
    source: 'goose',
    welfare: type.welfare,
    override: 0,
    status: 'queued',
    ...fields,
    petCount: fields.petCount ?? (fields.petNames ? fields.petNames.length : 0),
  };
}

/** Tasks that belong to one reservation (not grouped). `from` skips times already past. */
export function reservationTasks(res, { from = 0 } = {}) {
  const out = [];
  const big = res.bigDog;
  const cat = res.species === 'cat';
  const where = res.unit ?? res.playgroup ?? 'Lobby';
  // Meds: one task per pet per dose time. Available 30 min early.
  res.meds.forEach((med, mi) => {
    for (const t of med.at) {
      if (t < from || !present(res, t)) continue;
      out.push(task({
        id: `meds:${res.id}:${mi}:${t}`,
        type: 'meds',
        title: `${med.name} for ${res.petName}`,
        petNames: [res.petName],
        reservationIds: [res.id],
        where,
        zone: zoneOf(res.unit),
        availableAt: t - 30,
        dueAt: t,
        estMinutes: 4,
        quals: cat ? ['meds', 'cats'] : ['meds'],
        steps: [
          `Confirm ${res.petName} by collar tag at ${where}`,
          `Match the label to the card: ${med.name}, ${med.dose}`,
          med.withFood ? 'Give with food' : 'Give on an empty stomach',
          'Watch it go down; check bowl and floor',
          'Tap Done, or Refused with a note',
        ],
        photo: 'optional',
        links: SOP('meds'),
      }));
    }
  });
  // Potty walks: boarding dogs only. Dogs in daycare play are in a yard 9:00-15:00.
  if (res.service === 'boarding' && !cat) {
    for (const base of POTTY_TIMES) {
      const t = base + (POTTY_ROW_OFFSET[zoneOf(res.unit)] ?? 0);
      if (t < from || !present(res, t)) continue;
      if (res.addons.includes('daycare_play') && t > DAYCARE_PLAY[0] && t < DAYCARE_PLAY[1]) continue;
      out.push(task({
        id: `potty:${res.id}:${t}`,
        type: 'potty',
        title: `Potty walk: ${res.petName}`,
        petNames: [res.petName],
        reservationIds: [res.id],
        where,
        zone: zoneOf(res.unit),
        availableAt: t - 20,
        dueAt: t,
        estMinutes: 6,
        quals: big ? ['care', 'bigdog'] : ['care'],
        bigdog: big,
        steps: [
          `Leash at the suite door: ${res.petName}, ${res.weight} lb${big ? ' (large-dog handling)' : ''}`,
          'Relief area, about 5 minutes',
          'Pick Pee / Poop / Both / Nothing as the outcome',
          'Return and latch the suite',
        ],
        links: SOP('potty-walk'),
      }));
    }
  }
  // Individual play for the extra-play add-on: a morning and an afternoon session.
  if (res.addons.includes('extra_play')) {
    [[toMin('09:00'), toMin('12:00')], [toMin('13:00'), toMin('16:30')]].forEach(([a, b0], i) => {
      const b = Math.min(b0, res.departAt ?? b0);
      if (b < from || !present(res, a) || b - Math.max(a, from) < 15) return;
      out.push(task({
        id: `play:${res.id}:${i}`,
        type: 'play',
        title: `Play session: ${res.petName}`,
        petNames: [res.petName],
        reservationIds: [res.id],
        where: big ? 'Big Yard' : 'Small Yard',
        zone: zoneOf(res.unit),
        availableAt: Math.max(a, from),
        dueAt: b,
        estMinutes: 15,
        quals: big ? ['playgroup', 'bigdog'] : ['playgroup'],
        steps: ['15 minutes of fetch or enrichment', 'Note energy and behaviour', 'Return and latch the suite'],
        links: SOP('play'),
      }));
    });
  }
  return out;
}

/** Feeding rounds: one task per row per meal, listing every pet present at that time. */
export function feedingTasks(reservations, { from = 0 } = {}) {
  const groups = new Map();
  for (const res of reservations) {
    for (const f of res.feedings) {
      if (f.at < from || !present(res, f.at)) continue;
      const zone = res.service === 'daycare' ? res.playgroup : zoneOf(res.unit);
      const key = `${zone}|${f.meal}|${f.at}`;
      if (!groups.has(key)) groups.set(key, { zone, meal: f.meal, at: f.at, pets: [] });
      groups.get(key).pets.push({ res, amount: f.amount });
    }
  }
  const out = [];
  for (const g of groups.values()) {
    g.pets.sort((x, y) => (x.res.unit ?? x.res.petName).localeCompare(y.res.unit ?? y.res.petName, 'en', { numeric: true }));
    const cats = g.zone === 'K';
    const label = cats ? 'Cat condos' : g.zone.length === 1 ? `Row ${g.zone}` : g.zone;
    const meal = g.meal[0].toUpperCase() + g.meal.slice(1);
    out.push(feedingTask(g, label, meal, cats));
  }
  return out;
}

export function feedingTitle(meal, label, n, cats) {
  const noun = cats ? (n === 1 ? 'cat' : 'cats') : n === 1 ? 'dog' : 'dogs';
  return `${meal}: ${label} (${n} ${noun})`;
}

function feedingTask(g, label, meal, cats) {
  return task({
    id: `feed:${g.zone}:${g.meal}:${g.at}`,
    type: 'feeding',
    subtype: g.meal,
    title: feedingTitle(meal, label, g.pets.length, cats),
    label,
    mealLabel: meal,
    cats,
    petNames: g.pets.map((p) => p.res.petName),
    reservationIds: g.pets.map((p) => p.res.id),
    where: label,
    zone: g.zone,
    meal: g.meal,
    availableAt: g.at - 15,
    dueAt: g.at,
    estMinutes: 3 + 2 * g.pets.length,
    quals: cats ? ['care', 'cats'] : ['care'],
    steps: g.pets.map((p) => `${p.res.unit ?? p.res.playgroup} ${p.res.petName}: ${p.amount}`),
    perPetOutcome: true,
    links: SOP('feeding'),
  });
}

/** Location-level care: water checks, spot cleans, litter. Not tied to one reservation. */
export function locationTasks(reservations, { from = 0 } = {}) {
  const out = [];
  const rows = ['A', 'B', 'C', 'K'];
  for (const row of rows) {
    const label = row === 'K' ? 'Cat condos' : `Row ${row}`;
    for (const t of WATER_ROW_TIMES) {
      if (t < from) continue;
      const pets = reservations.filter((r) => r.unit?.startsWith(row) && present(r, t));
      if (!pets.length) continue;
      out.push(task({
        id: `water:${row}:${t}`, type: 'water', title: `Water check: ${label}`, where: label, zone: row, source: 'goose', petCount: pets.length,
        availableAt: t - 30, dueAt: t, estMinutes: 5, quals: row === 'K' ? ['care', 'cats'] : ['care'],
        steps: [`Every bowl in ${label}: full, clean, not tipped`, 'Swap any dirty bowl', 'Report a pet not drinking'],
        links: SOP('water'),
      }));
    }
  }
  for (const yard of ['Big Yard', 'Small Yard', 'Puppy Yard']) {
    for (const t of WATER_YARD_TIMES) {
      if (t < from) continue;
      const pets = reservations.filter((r) => r.playgroup === yard && present(r, t) && (r.service === 'daycare' || (t > DAYCARE_PLAY[0] && t < DAYCARE_PLAY[1])));
      if (!pets.length) continue;
      out.push(task({
        id: `water:${yard}:${t}`, type: 'water', title: `Water check: ${yard}`, where: yard, zone: yard, petCount: pets.length,
        availableAt: t - 20, dueAt: t, estMinutes: 3, quals: ['care'],
        steps: ['Buckets full and in the shade', 'Dump and refill any with debris'], links: SOP('water'),
      }));
    }
  }
  for (const row of ['A', 'B', 'C']) {
    for (const t of [toMin('10:00'), toMin('16:00')]) {
      if (t < from) continue;
      out.push(task({
        id: `clean:spot:${row}:${t}`, type: 'cleaning', subtype: 'spot', title: `Spot clean: Row ${row}`, where: `Row ${row}`, zone: row,
        availableAt: t - 60, dueAt: t, estMinutes: 18, quals: ['cleaning'],
        steps: ['Pick up waste in every occupied suite', 'Spot-disinfect floors', 'Swap wet bedding'], links: SOP('spot-clean'),
      }));
    }
  }
  for (const t of [toMin('08:30'), toMin('15:30')]) {
    if (t < from) continue;
    out.push(task({
      id: `clean:litter:${t}`, type: 'cleaning', subtype: 'litter', title: 'Litter boxes: cat condos', where: 'Cat condos', zone: 'K',
      availableAt: t - 60, dueAt: t, estMinutes: 8, quals: ['cleaning', 'cats'],
      steps: ['Scoop every box', 'Top up litter', 'Note anything unusual'], links: SOP('litter'),
    }));
  }
  return out;
}

export function checklistTasks(templates = CHECKLIST_TEMPLATES, { from = 0 } = {}) {
  return templates
    .filter((tpl) => toMin(tpl.due) >= from)
    .map((tpl) => task({
      id: `chk:${tpl.id}`,
      type: 'checklist',
      subtype: tpl.group,
      title: tpl.title,
      where: tpl.where ?? tpl.group,
      zone: null,
      source: 'checklist',
      availableAt: tpl.lead ? toMin(tpl.at) - tpl.lead : toMin(tpl.at),
      dueAt: toMin(tpl.due),
      estMinutes: tpl.minutes,
      quals: tpl.quals,
      welfare: Boolean(tpl.welfare),
      photo: tpl.photo ?? null,
      steps: [tpl.title],
      links: SOP(`checklist-${tpl.group.toLowerCase().replace(/\s+/g, '-')}`),
    }));
}

/** Lobby run created the moment Goose says a check-in or check-out is happening. */
export function lobbyTask(res, direction, at) {
  const where = res.unit ?? res.playgroup ?? 'Lobby';
  const inbound = direction === 'in';
  return task({
    id: `lobby:${direction}:${res.id}`,
    type: 'lobby',
    subtype: direction,
    title: inbound ? `Check-in: bring ${res.petName} from the lobby to ${where}` : `Check-out: bring ${res.petName} to the lobby`,
    petNames: [res.petName],
    reservationIds: [res.id],
    where: 'Lobby',
    zone: null,
    source: 'event',
    createdAt: at,
    availableAt: at,
    dueAt: at + (inbound ? 10 : 5),
    estMinutes: 5,
    quals: res.bigDog ? ['lobby', 'bigdog'] : ['lobby'],
    steps: inbound
      ? [`Collect ${res.petName} at the front desk; check collar tag`, `Walk to ${where}`, 'Settle, latch, and note belongings']
      : [`Collect ${res.petName} from ${where}`, 'Gather belongings: leash, food, meds', 'Hand over at the front desk'],
    links: SOP(inbound ? 'check-in' : 'check-out'),
  });
}

/** Deep clean of a suite after a boarding check-out. */
export function checkoutCleanTask(res, at) {
  return task({
    id: `clean:checkout:${res.unit}`,
    type: 'cleaning',
    subtype: 'checkout',
    title: `Deep clean suite ${res.unit} after check-out`,
    petNames: [res.petName],
    reservationIds: [res.id],
    where: res.unit,
    zone: zoneOf(res.unit),
    source: 'event',
    createdAt: at,
    availableAt: at + 5,
    dueAt: at + 120,
    estMinutes: 15,
    quals: ['cleaning'],
    photo: 'required',
    steps: ['Bedding and bowls to laundry', 'Scrub and disinfect (10-minute contact time)', 'Squeegee, dry, fresh bedding', 'Photo of the finished suite'],
    links: SOP('deep-clean'),
  });
}

/** Everything known at the start of the day. Lobby runs and check-out cleans arrive as events. */
export function generateDayTasks(reservations, { templates = CHECKLIST_TEMPLATES } = {}) {
  const tasks = [
    ...checklistTasks(templates),
    ...feedingTasks(reservations),
    ...locationTasks(reservations),
    ...reservations.flatMap((r) => reservationTasks(r)),
  ];
  const ids = new Set();
  for (const t of tasks) {
    if (ids.has(t.id)) throw new Error(`Duplicate task id ${t.id}`);
    ids.add(t.id);
    t.createdAt ??= 0;
  }
  return tasks;
}

/** Lobby runs Goose will trigger later today, for the 5:00 AM coverage check. */
export function forecastFrontDesk(reservations, opts) {
  const out = [];
  for (const ev of dayEvents(reservations, opts)) {
    const res = reservations.find((r) => r.id === ev.resId);
    out.push({ ...lobbyTask(res, ev.kind === 'check_in' ? 'in' : 'out', ev.at), forecast: true });
  }
  return out;
}

/** Floor events implied by the reservations (check-ins, check-outs). */
export function dayEvents(reservations, { opensAt = 360, closesAt = 1200 } = {}) {
  const events = [];
  for (const r of reservations) {
    if (r.arriveAt != null && r.arriveAt >= opensAt && r.arriveAt <= closesAt) events.push({ at: r.arriveAt, kind: 'check_in', resId: r.id });
    if (r.departAt != null && r.departAt >= opensAt && r.departAt <= closesAt) events.push({ at: r.departAt, kind: 'check_out', resId: r.id });
  }
  return events.sort((a, b) => a.at - b.at || a.resId.localeCompare(b.resId));
}

/**
 * A booking that arrives during the day. Joins a feeding round that has not
 * started yet; otherwise gets its own feeding task. Returns { added, updated }.
 */
export function addSameDayReservation(tasks, res, now) {
  const added = reservationTasks(res, { from: now });
  const updated = [];
  const zone = res.service === 'daycare' ? res.playgroup : zoneOf(res.unit);
  for (const f of res.feedings) {
    if (f.at < now || !present(res, f.at)) continue;
    const round = tasks.find((t) => t.type === 'feeding' && t.zone === zone && t.meal === f.meal && t.dueAt === f.at && t.status === 'queued');
    if (round) {
      round.petNames = [...round.petNames, res.petName];
      round.reservationIds = [...round.reservationIds, res.id];
      round.steps = [...round.steps, `${res.unit ?? res.playgroup} ${res.petName}: ${f.amount}`];
      round.estMinutes += 2;
      round.petCount = round.petNames.length;
      round.title = feedingTitle(round.mealLabel, round.label, round.petNames.length, round.cats);
      updated.push(round);
    } else {
      added.push(feedingTask({ zone, meal: f.meal, at: f.at, pets: [{ res, amount: f.amount }] }, res.petName, f.meal[0].toUpperCase() + f.meal.slice(1), res.species === 'cat'));
      added.at(-1).id = `feed:${res.id}:${f.meal}:${f.at}`;
    }
  }
  for (const t of added) t.createdAt = now;
  return { added, updated };
}
