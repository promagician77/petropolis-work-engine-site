// Slack Block Kit payloads for the Work Engine, plus a checker for Slack's published limits.
// Every card here is plain JSON: paste it into Slack's Block Kit Builder to see it render.

import { TASK_TYPES } from './tasks.mjs';
import { clock } from './util.mjs';

export const ICON = { meds: '💊', assist: '🆘', feeding: '🍽️', water: '💧', lobby: '🚪', potty: '🐾', checklist: '✅', play: '🎾', cleaning: '🧽' };

const pt = (text) => ({ type: 'plain_text', text, emoji: true });
const md = (text) => ({ type: 'mrkdwn', text });
const val = (task, extra = {}) => JSON.stringify({ t: task.id, v: task.version ?? 1, ...extra });
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const trim = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

function dueText(task, now) {
  const mins = task.dueAt - now;
  const rel = mins > 0 ? `in ${mins} min` : mins === 0 ? 'now' : `${-mins} min ago`;
  return `${clock(task.dueAt)} (${rel})`;
}

function header(task) {
  return { type: 'header', text: pt(trim(`${ICON[task.type]} ${task.title}`, 150)) };
}

function facts(task, now) {
  const fields = [md(`*Where*\n${task.where}`), md(`*Due*\n${dueText(task, now)}`)];
  if (task.petNames.length === 1) fields.push(md(`*Pet*\n${task.petNames[0]}`));
  fields.push(md(`*About*\n${task.estMinutes} min`));
  return { type: 'section', fields };
}

function linksRow(task) {
  if (!task.links) return null;
  return {
    type: 'actions',
    block_id: `links:${task.id}`,
    elements: [
      { type: 'button', text: pt('Open the SOP'), url: task.links.sop, action_id: 'open_sop' },
      { type: 'button', text: pt('Watch the video'), url: task.links.video, action_id: 'open_video' },
    ],
  };
}

/** The card a team member gets in their Slack DM. state: 'assigned' | 'started' | 'done' */
export function taskCard(task, { now, state = 'assigned', reason = '', whyYou = '', staffName = '', outcome = '', doneAt = null } = {}) {
  const text = `${TASK_TYPES[task.type].label}: ${task.title} at ${task.where}, due ${clock(task.dueAt)}`;
  if (state === 'done') {
    return {
      text: `Done: ${task.title}`,
      blocks: [
        header(task),
        { type: 'context', elements: [md(`✓ Done by ${staffName} at ${clock(doneAt ?? now)}${outcome ? ` · ${outcome}` : ''}`)] },
      ],
    };
  }
  const blocks = [header(task), facts(task, now)];
  if (reason || whyYou) blocks.push({ type: 'context', elements: [md(`*Why this, why you:* ${[reason, whyYou].filter(Boolean).join(' · ')}`)] });

  if (state === 'assigned') {
    blocks.push({ type: 'section', text: md(`*Steps*\n${task.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`.slice(0, 3000)) });
    blocks.push({
      type: 'actions',
      block_id: `task:${task.id}:a`,
      elements: [
        { type: 'button', text: pt('Start'), style: 'primary', action_id: 'task_start', value: val(task) },
        { type: 'button', text: pt('Need help'), action_id: 'task_help', value: val(task) },
        { type: 'button', text: pt("Can't complete"), action_id: 'task_cant', value: val(task) },
      ],
    });
  } else {
    // started: steps become tick boxes (max 10 per group, so long rounds are split)
    chunk(task.steps, 10).forEach((group, gi) => {
      blocks.push({
        type: 'actions',
        block_id: `steps:${task.id}:${gi}`,
        elements: [{
          type: 'checkboxes',
          action_id: `step_tick_${gi}`,
          options: group.map((s, i) => ({ text: md(trim(s, 75)), value: `${gi * 10 + i}` })),
        }],
      });
    });
    const done = [];
    if (task.type === 'potty') {
      done.push({
        type: 'static_select',
        action_id: 'task_done_outcome',
        placeholder: pt('Done: what happened?'),
        options: ['Pee', 'Poop', 'Both', 'Nothing'].map((o) => ({ text: pt(o), value: JSON.stringify({ t: task.id, o }) })),
      });
    } else if (task.type === 'meds') {
      done.push({ type: 'button', text: pt('Given'), style: 'primary', action_id: 'task_done', value: val(task, { o: 'Given' }) });
      done.push({ type: 'button', text: pt('Refused'), action_id: 'task_refused', value: val(task) });
    } else if (task.perPetOutcome) {
      done.push({ type: 'button', text: pt('Done: all ate'), style: 'primary', action_id: 'task_done', value: val(task, { o: 'All ate' }) });
      done.push({ type: 'button', text: pt('Some did not eat'), action_id: 'task_refusals', value: val(task) });
    } else {
      done.push({ type: 'button', text: pt('Done'), style: 'primary', action_id: 'task_done', value: val(task) });
    }
    if (task.photo) done.push({ type: 'button', text: pt(task.photo === 'required' ? 'Add photo (required)' : 'Add photo'), action_id: 'task_photo', value: val(task) });
    done.push({ type: 'button', text: pt('Need help'), action_id: 'task_help', value: val(task) });
    done.push({ type: 'button', text: pt("Can't complete"), action_id: 'task_cant', value: val(task) });
    blocks.push({ type: 'actions', block_id: `task:${task.id}:s`, elements: done });
  }
  const links = linksRow(task);
  if (links) blocks.push(links);
  return { text, blocks };
}

const CANT_REASONS = {
  common: ['Pet is not where the card says', 'Needs a second person', 'Supplies missing', 'Pet seems unwell (alerts a manager)', 'Something else'],
  meds: ['Pet refused the dose', 'Medication or label does not match'],
  cleaning: ['Suite still occupied'],
};

/** Modal for "Can't complete": a reason is required so the record says why. */
export function cantCompleteModal(task) {
  const reasons = [...(CANT_REASONS[task.type] ?? []), ...CANT_REASONS.common];
  return {
    type: 'modal',
    callback_id: 'cant_complete',
    private_metadata: val(task),
    title: pt("Can't complete"),
    submit: pt('Send'),
    close: pt('Back'),
    blocks: [
      { type: 'section', text: md(`*${trim(task.title, 200)}*\n${task.where} · due ${clock(task.dueAt)}`) },
      {
        type: 'input',
        block_id: 'reason',
        label: pt('What stopped you?'),
        element: { type: 'radio_buttons', action_id: 'reason', options: reasons.slice(0, 10).map((r, i) => ({ text: pt(r), value: `r${i}` })) },
      },
      { type: 'input', block_id: 'note', optional: true, label: pt('Anything the next person should know?'), element: { type: 'plain_text_input', action_id: 'note', multiline: true, max_length: 500 } },
      { type: 'context', elements: [md('A manager sees this in #floor-leads. The task goes back in the queue unless they cancel it.')] },
    ],
  };
}

/** Modal for photos. Slack's file_input needs the files:read scope and lives in an input block. */
export function photoModal(task) {
  return {
    type: 'modal',
    callback_id: 'task_photo',
    private_metadata: val(task),
    title: pt('Add photo'),
    submit: pt('Upload'),
    close: pt('Back'),
    blocks: [
      { type: 'section', text: md(`*${trim(task.title, 200)}*`) },
      {
        type: 'input',
        block_id: 'photo',
        label: pt(task.photo === 'required' ? 'Photo of the finished job' : 'Photo (optional)'),
        element: { type: 'file_input', action_id: 'photo', filetypes: ['jpg', 'jpeg', 'png', 'heic'], max_files: 3 },
      },
      { type: 'context', elements: [md('Photos are copied to Petropolis storage in AWS, so they outlive Slack’s free-plan history limit.')] },
    ],
  };
}

/** Feeding round: tick who did not eat. Groups of 10 because Slack caps checkboxes at 10 options. */
export function refusalsModal(task) {
  const groups = chunk(task.petNames, 10);
  return {
    type: 'modal',
    callback_id: 'feeding_refusals',
    private_metadata: val(task),
    title: pt('Who did not eat?'),
    submit: pt('Save'),
    close: pt('Back'),
    blocks: [
      { type: 'section', text: md(`*${trim(task.title, 200)}*\nTick every pet that left food. Each gets a re-offer task in 45 minutes.`) },
      ...groups.map((g, gi) => ({
        type: 'input',
        block_id: `pets_${gi}`,
        optional: true,
        label: pt(groups.length > 1 ? `Pets ${gi * 10 + 1}–${gi * 10 + g.length}` : 'Pets'),
        element: { type: 'checkboxes', action_id: `pets_${gi}`, options: g.map((p) => ({ text: pt(p), value: p.slice(0, 150) })) },
      })),
    ],
  };
}

/** Posted to the #floor-leads channel when someone taps Need help. */
export function helpAlert(task, staffName, now) {
  return {
    text: `${staffName} needs a second person: ${task.title}`,
    blocks: [
      { type: 'section', text: md(`🆘 *${staffName} needs a second person*\n${task.title} · ${task.where} · ${clock(now)}`) },
      {
        type: 'actions',
        block_id: `help:${task.id}`,
        elements: [{ type: 'button', text: pt("I'm on my way"), style: 'primary', action_id: 'help_accept', value: val(task) }],
      },
      { type: 'context', elements: [md('If nobody taps within 2 minutes, the engine sends an Assist task to the nearest qualified person.')] },
    ],
  };
}

/** App Home tab: clock in, breaks, current task and the offline list link. */
export function homeTab(staff, { now, onShift, onBreak, shiftStart, current = null, doneToday = 0, lateToday = 0, offlineUrl }) {
  const status = !onShift ? 'Not clocked in' : onBreak ? `On break since ${clock(onBreak)}` : `On shift since ${clock(shiftStart)}`;
  const buttons = !onShift
    ? [{ type: 'button', text: pt('Clock in'), style: 'primary', action_id: 'clock_in', value: staff.id }]
    : onBreak
      ? [{ type: 'button', text: pt('End break'), style: 'primary', action_id: 'break_end', value: staff.id }]
      : [
        { type: 'button', text: pt('Start break'), action_id: 'break_start', value: staff.id },
        {
          type: 'button', text: pt('Clock out'), style: 'danger', action_id: 'clock_out', value: staff.id,
          confirm: { title: pt('Clock out?'), text: md('Your current task goes back in the queue.'), confirm: pt('Clock out'), deny: pt('Stay on') },
        },
      ];
  const blocks = [
    { type: 'header', text: pt(`${staff.name} · Work Engine`) },
    { type: 'section', text: md(`*${status}*\nToday: ${doneToday} done${lateToday ? `, ${lateToday} late` : ''}`) },
    { type: 'actions', block_id: 'shift', elements: buttons },
    { type: 'divider' },
  ];
  if (current) {
    blocks.push({ type: 'section', text: md(`*Right now*\n${ICON[current.type]} ${current.title}\n${current.where} · due ${clock(current.dueAt)}`) });
  } else if (onShift && !onBreak) {
    blocks.push({ type: 'section', text: md('*Right now*\nNothing assigned. The next task arrives here and in your DMs.') });
  }
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'section',
    text: md('*Weak signal?* The offline list keeps working without a connection and syncs your taps, with their real times, when you are back.'),
    accessory: { type: 'button', text: pt('Open offline list'), url: offlineUrl, action_id: 'open_offline' },
  });
  return { type: 'home', blocks };
}

// ---------------------------------------------------------------------------
// Limits, from Slack's Block Kit reference. Checked on every payload we build.
// ---------------------------------------------------------------------------
export const LIMITS = {
  blocks: { message: 50, modal: 100, home: 100 },
  blockId: 255,
  actionId: 255,
  headerText: 150,
  sectionText: 3000,
  fields: 10,
  fieldText: 2000,
  contextElements: 10,
  actionsElements: 25,
  buttonText: 75,
  buttonValue: 2000,
  url: 3000,
  optionText: 75,
  optionValue: 150,
  choiceOptions: 10, // checkboxes and radio buttons
  inputLabel: 2000,
  modalTitle: 24,
  privateMetadata: 3000,
  fileInputMaxFiles: [1, 10],
};

/** Check a message ({text, blocks}), modal or home view. Returns { ok, checked, errors }. */
export function validateSurface(surface, kind) {
  const errors = [];
  let checked = 0;
  const check = (cond, msg) => { checked++; if (!cond) errors.push(msg); };
  const blocks = surface.blocks ?? [];
  check(blocks.length <= LIMITS.blocks[kind], `${blocks.length} blocks > ${LIMITS.blocks[kind]} allowed in a ${kind}`);
  if (kind === 'message') check(typeof surface.text === 'string' && surface.text.length > 0, 'message needs fallback text for notifications');
  if (kind === 'modal') {
    for (const k of ['title', 'submit', 'close']) if (surface[k]) check(surface[k].text.length <= LIMITS.modalTitle, `modal ${k} over ${LIMITS.modalTitle} chars`);
    if (surface.private_metadata) check(surface.private_metadata.length <= LIMITS.privateMetadata, 'private_metadata too long');
  }
  const blockIds = new Set();
  blocks.forEach((b, bi) => {
    const at = `block ${bi} (${b.type})`;
    if (b.block_id) {
      check(b.block_id.length <= LIMITS.blockId, `${at}: block_id too long`);
      check(!blockIds.has(b.block_id), `${at}: duplicate block_id ${b.block_id}`);
      blockIds.add(b.block_id);
    }
    if (b.type === 'header') check(b.text.type === 'plain_text' && b.text.text.length <= LIMITS.headerText, `${at}: header over ${LIMITS.headerText} chars or not plain_text`);
    if (b.type === 'section') {
      if (b.text) check(b.text.text.length >= 1 && b.text.text.length <= LIMITS.sectionText, `${at}: text length ${b.text.text.length}`);
      if (b.fields) {
        check(b.fields.length <= LIMITS.fields, `${at}: ${b.fields.length} fields`);
        b.fields.forEach((f) => check(f.text.length <= LIMITS.fieldText, `${at}: field too long`));
      }
      check(Boolean(b.text || b.fields), `${at}: section needs text or fields`);
      if (b.accessory) checkElement(b.accessory, at, check);
    }
    if (b.type === 'context') check(b.elements.length <= LIMITS.contextElements, `${at}: ${b.elements.length} elements`);
    if (b.type === 'actions') {
      check(b.elements.length <= LIMITS.actionsElements, `${at}: ${b.elements.length} elements`);
      const ids = new Set();
      b.elements.forEach((el) => {
        if (el.action_id) { check(!ids.has(el.action_id), `${at}: duplicate action_id ${el.action_id}`); ids.add(el.action_id); }
        checkElement(el, at, check);
      });
    }
    if (b.type === 'input') {
      check(kind !== 'message', `${at}: input blocks belong in modals`);
      check(b.label.text.length <= LIMITS.inputLabel, `${at}: label too long`);
      checkElement(b.element, at, check);
    }
  });
  return { ok: errors.length === 0, checked, errors };
}

function checkElement(el, at, check) {
  if (el.action_id) check(el.action_id.length <= LIMITS.actionId, `${at}: action_id too long`);
  if (el.type === 'button') {
    check(el.text.text.length <= LIMITS.buttonText, `${at}: button text "${el.text.text}" too long`);
    if (el.value) check(el.value.length <= LIMITS.buttonValue, `${at}: button value too long`);
    if (el.url) check(el.url.length <= LIMITS.url, `${at}: url too long`);
  }
  if (el.options) {
    if (el.type === 'checkboxes' || el.type === 'radio_buttons') check(el.options.length <= LIMITS.choiceOptions, `${at}: ${el.options.length} options > ${LIMITS.choiceOptions}`);
    el.options.forEach((o) => {
      check(o.text.text.length <= LIMITS.optionText, `${at}: option text too long`);
      check(o.value.length <= LIMITS.optionValue, `${at}: option value "${o.value}" over ${LIMITS.optionValue}`);
    });
  }
  if (el.type === 'file_input') {
    const [lo, hi] = LIMITS.fileInputMaxFiles;
    check(el.max_files == null || (el.max_files >= lo && el.max_files <= hi), `${at}: max_files out of range`);
  }
}
