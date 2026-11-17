// Asset 4 and the Measured section: filled from data/results.json, which tools/run-all.mjs writes.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (x) => Number(x).toLocaleString('en-US');
const money = (x) => `$${Number(x).toFixed(2)}`;

const DECISIONS = [
  { t: 'Slack’s free plan shows 90 days of history and deletes data older than a year.', d: 'So every task record, shift and photo is written to DynamoDB and S3; Slack is only the screen.', src: 'Slack Help: Feature limitations on the free version of Slack', url: 'https://slack.com/help/articles/27204752526611' },
  { t: 'The free plan allows up to 10 apps.', d: 'The Work Engine uses one slot; check how many Petropolis already uses.', src: 'Slack Help: Usage limits for free workspaces', url: 'https://slack.com/help/articles/115002422943' },
  { t: 'Slack needs an HTTP 200 within 3 seconds of a button tap.', d: 'The ingress Lambda only verifies, queues and answers. Slack API calls and database work happen in the worker.', src: 'Slack docs: Handling user interaction', url: 'https://docs.slack.dev/interactivity/handling-user-interaction' },
  { t: 'A trigger_id expires 3 seconds after it is sent and works once.', d: 'Buttons that open a modal (Can’t complete, Add photo, Who did not eat) open it inside the ingress call, not from the queue.', src: 'Slack docs: Modals', url: 'https://docs.slack.dev/surfaces/modals' },
  { t: 'Photo upload in Block Kit is the file_input element: it needs the files:read scope, sits in an input block, and takes 1 to 10 files.', d: 'Photos are a modal; the manifest asks for files:read.', src: 'Slack docs: File input element', url: 'https://docs.slack.dev/reference/block-kit/block-elements/file-input-element' },
  { t: 'Block Kit caps a message at 50 blocks and a group of tick boxes at 10 options.', d: 'Every card is checked against these limits; long feeding rounds split their tick boxes into groups of 10.', src: 'Slack docs: Blocks; Checkboxes element', url: 'https://docs.slack.dev/reference/block-kit/blocks' },
  { t: 'Slack signs every request; Slack recommends refusing timestamps more than 5 minutes old.', d: 'Verified on every request. Slack’s own worked example reproduces exactly in the tests.', src: 'Slack docs: Verifying requests from Slack', url: 'https://docs.slack.dev/authentication/verifying-requests-from-slack' },
  { t: 'Goose publishes no public API reference that I could find.', d: 'Week 1 confirms the webhook events and fields with Goose. The 2-minute poll fallback is built either way, and only one file reads Goose fields.', src: 'goose.pet', url: 'https://www.goose.pet/' },
  { t: 'DynamoDB on-demand costs $0.625 per million writes in US East.', d: 'At pilot volume that is cents a month, and conditional writes stop two people claiming one task. If Phase 2 scorecards need heavy reporting, export to S3 or add Postgres then.', src: 'Dynobase DynamoDB pricing (US East, Oct 2026)', url: 'https://dynobase.dev/dynamodb-cost-optimization/' },
  { t: 'Node.js 22 on Lambda (arm64).', d: 'The same engine files run in the Lambdas and in this page, so what you test here is what ships.', src: 'This kit: src/engine is copied to web/engine and checked byte for byte', url: null },
];

export async function initBuild() {
  let r;
  try { r = await (await fetch('data/results.json', { cache: 'no-store' })).json(); } catch { return; }

  // Proof chips at the top
  const set = (k, text) => { const el = document.querySelector(`[data-r="${k}"]`); if (el) el.textContent = text; };
  set('tests', `${r.tests.pass} of ${r.tests.total} tests pass`);
  if (r.mutation) set('mutation', `${r.mutation.caught} of ${r.mutation.planted} planted bugs caught`);
  set('slack', `${n(r.slack.payloads)} Slack payloads inside Block Kit limits`);
  set('cost', `About ${money(r.cost.total)} a month on AWS at pilot volume`);

  // Records
  const counts = { completed: r.sim.runs.normal_priority.done };
  $('#records-body').innerHTML = [
    ['Completed tasks, with start and finish times and who did them', 'Task item, status done: startedAt, doneAt, doneBy, outcome, photos', `<a href="downloads/completed-tasks.csv" download>completed-tasks.csv</a> (${n(counts.completed)} rows)`],
    ['Incomplete, blocked and cancelled tasks, with reasons', 'Task item history: status, reason, by, at', '<a href="downloads/incomplete-tasks.csv" download>incomplete-tasks.csv</a>'],
    ['Shift start, end and breaks for each employee', '<span class="key">STAFF#id / SHIFT#date#time#event</span>', '<a href="downloads/shifts.csv" download>shifts.csv</a>'],
    ['Each employee’s qualifications, used for assignment', '<span class="key">STAFF#id / PROFILE</span>, quals list', '<a href="downloads/qualifications.csv" download>qualifications.csv</a>'],
  ].map(([a, b, c]) => `<tr><th scope="row">${a}</th><td>${b}</td><td>${c}</td></tr>`).join('');

  // Cost
  $('#cost-body').innerHTML = r.cost.lines.map((l) => `<tr><th scope="row">${esc(l.item)}</th><td>${esc(l.assumption)}</td><td class="num">${money(l.monthly)}</td></tr>`).join('');
  $('#cost-total').textContent = money(r.cost.total);
  if (r.template?.expandedResources) $('#dl-template').textContent = `SAM template: ${r.template.samResources} resources, expands to ${r.template.expandedResources}, 0 lint findings`;

  // Decisions
  $('#decisions').innerHTML = DECISIONS.map((x) => `<li><strong>${esc(x.t)}</strong>${esc(x.d)}<br><span class="src">Source: ${x.url ? `<a href="${x.url}" rel="noopener">${esc(x.src)}</a>` : esc(x.src)}</span></li>`).join('');

  // Measured
  const a = r.sim.runs;
  const items = [
    `${r.tests.pass} of ${r.tests.total} automated tests pass (Node ${esc(r.node)}): engine, Goose handling, Slack payloads, signatures, offline sync and all eight Lambda functions.`,
    r.mutation ? `${r.mutation.caught} of ${r.mutation.planted} deliberately planted bugs are caught by those tests.` : null,
    `${n(r.slack.payloads)} Slack payloads (every card, modal, alert and Home tab for the simulated day) pass ${n(r.slack.checks)} checks against Block Kit limits. Largest card: ${r.slack.maxBlocks} blocks of 50.`,
    'Slack’s published request-signing example verifies; a one-letter change, a 6-minute replay and a missing header are refused.',
    r.template?.expandedResources ? `The SAM template expands with the official SAM translator (${esc(r.template.samTranslator)}) to ${r.template.expandedResources} CloudFormation resources; cfn-lint ${esc(r.template.cfnLint)} reports ${r.template.findings} findings.` : null,
    `Simulated pilot day: ${r.sim.reservations} reservations, ${r.sim.staff} staff, ${r.sim.tasksPerDay} tasks, run in about ${Math.round(r.sim.msPerDay)} ms. Meds on time: ${a.normal_priority.medsOnTimePct}% (normal day) and ${a.callout_priority.medsOnTimePct}% (call-out) with Work Engine priority, against ${a.callout_earliest.medsOnTimePct}% for earliest due first on the call-out day.`,
    `Longest wait at a check-out: ${a.callout_priority.checkoutWaitMax} min with priority vs ${a.callout_earliest.checkoutWaitMax} min earliest-due (call-out day). Earliest-due starts more tasks on time overall: ${a.callout_earliest.allOnTimePct}% vs ${a.callout_priority.allOnTimePct}%.`,
    `Slack acknowledgement path, local Node with an in-memory store: ${r.ack.accepted} of ${r.ack.runs} signed taps accepted and queued; p50 ${r.ack.p50} ms, p99 ${r.ack.p99} ms. Not a Lambda measurement.`,
    `Estimated AWS cost at pilot volume: ${money(r.cost.total)} a month at list prices, no free tier.`,
  ].filter(Boolean);
  $('#measured-list').innerHTML = items.map((x) => `<li>${x}</li>`).join('');
}
