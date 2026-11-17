// Sample pilot day: one location, seven team members, and a Goose-shaped reservation feed.
//
// IMPORTANT: Goose publishes no public API reference we could find, so the raw
// record shape below is a placeholder. Every Goose field is read in ONE place
// (fromGoose in goose.mjs); mapping Petropolis's real feed is Milestone 1 work.

import { rng, toMin } from './util.mjs';

export const PILOT_DATE = '2026-11-18';

export const LOCATION = {
  id: 'pilot',
  name: 'Pilot location',
  timezone: 'America/Chicago',
  opensAt: toMin('06:00'),
  closesAt: toMin('20:00'),
  rows: {
    A: { label: 'Row A suites', units: 14 },
    B: { label: 'Row B suites', units: 12 },
    C: { label: 'Row C large suites', units: 10 },
    K: { label: 'Cat condos', units: 6 },
  },
  yards: ['Big Yard', 'Small Yard', 'Puppy Yard'],
};

export const QUALS = {
  care: 'Basic pet care',
  meds: 'Meds certified',
  bigdog: 'Large dogs (60 lb+)',
  cats: 'Cat care',
  lobby: 'Lobby runs',
  playgroup: 'Playgroup monitor',
  cleaning: 'Cleaning',
  opening: 'Opening',
  closing: 'Closing',
};

// Shift times are minutes since midnight. One 30-minute meal break each.
export const STAFF = [
  { id: 's1', name: 'Maya', quals: ['care', 'meds', 'opening', 'lobby', 'cleaning'], shift: ['06:00', '14:30'], breakAt: '10:30' },
  { id: 's2', name: 'Jonah', quals: ['care', 'cleaning', 'bigdog', 'opening'], shift: ['06:00', '14:30'], breakAt: '11:00' },
  { id: 's3', name: 'Sam', quals: ['care', 'lobby', 'bigdog'], shift: ['06:30', '15:00'], breakAt: '11:30' },
  { id: 's4', name: 'Priya', quals: ['care', 'meds', 'cats', 'playgroup'], shift: ['07:00', '15:30'], breakAt: '12:00' },
  { id: 's5', name: 'Leo', quals: ['care', 'lobby', 'cleaning', 'bigdog'], shift: ['08:00', '16:30'], breakAt: '12:30' },
  { id: 's6', name: 'Tess', quals: ['care', 'playgroup', 'bigdog', 'lobby'], shift: ['11:00', '19:30'], breakAt: '14:30' },
  { id: 's7', name: 'Omar', quals: ['care', 'meds', 'closing', 'cleaning', 'cats'], shift: ['11:30', '20:00'], breakAt: '15:00' },
  { id: 's8', name: 'Rosa', quals: ['care', 'lobby', 'cleaning', 'closing', 'bigdog'], shift: ['12:00', '20:00'], breakAt: '15:30' },
].map((s) => ({ ...s, start: toMin(s.shift[0]), end: toMin(s.shift[1]), breakStart: toMin(s.breakAt), breakMinutes: 30 }));

const DOG_NAMES = [
  'Biscuit', 'Luna', 'Bruno', 'Pepper', 'Milo', 'Rosie', 'Tucker', 'Daisy', 'Bear', 'Hazel', 'Rocco', 'Willow',
  'Moose', 'Olive', 'Penny', 'Murphy', 'Juniper', 'Gus', 'Maple', 'Diesel', 'Clover', 'Otis', 'Nala', 'Beau',
  'Poppy', 'Ranger', 'Winnie', 'Koda', 'Sadie', 'Finn', 'Ruby', 'Duke', 'Mabel', 'Louie', 'Stella', 'Cooper',
  'Lola', 'Jasper', 'Ivy', 'Rufus', 'Coco', 'Scout', 'Lily', 'Toby', 'Honey', 'Archie', 'Pearl', 'Bandit',
  'Harley', 'Opal', 'Riley', 'Sage', 'Waffles', 'Nova', 'Chief', 'Theo', 'Apollo', 'Copper', 'Zoe', 'Oscar',
];
const CAT_NAMES = ['Mochi', 'Pickles', 'Dot', 'Kiwi', 'Bean'];
const MEDS = [
  { name: 'Apoquel 16 mg', dose: '1 tablet', withFood: true },
  { name: 'Carprofen 75 mg', dose: '1 caplet', withFood: true },
  { name: 'Gabapentin 100 mg', dose: '1 capsule', withFood: false },
  { name: 'Thyroid (levothyroxine) 0.5 mg', dose: '1 tablet', withFood: false },
  { name: 'Fish oil', dose: '1 pump on food', withFood: true },
];

const iso = (date, hhmm) => `${date}T${hhmm}`;
const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Build the Goose-shaped feed for the pilot day. Deterministic for a given seed.
 * Returns { records, sameDayBooking, incidents }.
 */
export function sampleGooseFeed(seed = 18) {
  const r = rng(seed);
  const pickIn = (arr) => arr[Math.floor(r() * arr.length)];
  const records = [];
  let n = 0;
  const nextId = () => `gs_res_${10400 + ++n}`;
  const updated = `${PILOT_DATE}T05:0${n % 10}:00-06:00`;

  // Boarding dogs. 21 staying all day, 7 leaving today, 6 arriving today.
  const freeUnits = [];
  for (const [row, def] of Object.entries(LOCATION.rows)) {
    if (row === 'K') continue;
    for (let i = 1; i <= def.units; i++) freeUnits.push(`${row}${i}`);
  }
  const takeUnit = (big) => {
    const pool = freeUnits.filter((u) => (big ? u.startsWith('C') : !u.startsWith('C')));
    const unit = (pool.length ? pool : freeUnits)[0];
    freeUnits.splice(freeUnits.indexOf(unit), 1);
    return unit;
  };

  const boardingPlan = [
    ...Array(21).fill('stay'),
    ...Array(7).fill('depart'),
    ...Array(6).fill('arrive'),
  ];
  const departTimes = ['10:00', '10:30', '11:15', '12:30', '14:00', '16:15', '17:30'];
  const arriveTimes = ['07:40', '08:10', '08:45', '09:30', '10:20', '11:00'];
  let d = 0;
  let a = 0;
  boardingPlan.forEach((plan, i) => {
    const name = DOG_NAMES[i];
    const weight = Math.round(12 + r() * 88);
    const big = weight >= 60;
    const unit = takeUnit(big);
    const start = plan === 'arrive' ? iso(PILOT_DATE, arriveTimes[a++]) : iso('2026-11-15', '15:00');
    const end = plan === 'depart' ? iso(PILOT_DATE, departTimes[d++]) : iso('2026-11-21', '11:00');
    const senior = r() < 0.2;
    const feeding = [
      { at: '07:00', meal: 'breakfast', amount: `${(0.5 + Math.round(r() * 5) / 2).toFixed(1)} cups ${r() < 0.6 ? 'own kibble' : 'house kibble'}` },
      { at: '16:30', meal: 'dinner', amount: `${(0.5 + Math.round(r() * 5) / 2).toFixed(1)} cups` },
    ];
    if (senior) feeding.splice(1, 0, { at: '12:00', meal: 'lunch', amount: '0.5 cup wet food' });
    const medications = [];
    if (r() < 0.32) {
      const med = pickIn(MEDS);
      const times = r() < 0.25 ? ['08:00', '12:00', '18:00'] : ['08:00', '18:00'];
      medications.push({ ...med, at: times });
    }
    const add_ons = [];
    if (r() < 0.4) add_ons.push('daycare_play');
    if (r() < 0.3) add_ons.push('extra_play');
    records.push({
      id: nextId(),
      updated_at: updated,
      status: plan === 'arrive' ? 'confirmed' : 'checked_in',
      service: 'boarding',
      start,
      end,
      pet: { id: `gs_pet_${300 + i}`, name, species: 'dog', weight_lb: weight },
      lodging: { unit },
      playgroup: add_ons.includes('daycare_play') ? (big ? 'Big Yard' : 'Small Yard') : null,
      feeding_schedule: feeding,
      medications,
      add_ons,
      alerts: senior ? ['senior'] : [],
    });
  });

  // Cats: 5 in condos, one leaving at 13:00.
  CAT_NAMES.forEach((name, i) => {
    records.push({
      id: nextId(),
      updated_at: updated,
      status: 'checked_in',
      service: 'boarding',
      start: iso('2026-11-14', '12:00'),
      end: i === 2 ? iso(PILOT_DATE, '13:00') : iso('2026-11-20', '12:00'),
      pet: { id: `gs_pet_${400 + i}`, name, species: 'cat', weight_lb: 9 + i },
      lodging: { unit: `K${i + 1}` },
      playgroup: null,
      feeding_schedule: [
        { at: '07:00', meal: 'breakfast', amount: '1/3 cup dry + 1/4 can' },
        { at: '16:30', meal: 'dinner', amount: '1/4 can wet' },
      ],
      medications: i === 1 ? [{ name: 'Methimazole 2.5 mg', dose: '1/2 tablet', withFood: true, at: ['08:00', '18:00'] }] : [],
      add_ons: [],
      alerts: [],
    });
  });

  // Daycare: 22 dogs, drop-off 7:00-9:00, pick-up 16:00-18:30.
  for (let i = 0; i < 22; i++) {
    const name = DOG_NAMES[34 + i];
    const weight = Math.round(10 + r() * 85);
    const big = weight >= 60;
    const puppy = !big && r() < 0.2;
    const drop = 420 + Math.floor(r() * 120);
    const pick = 960 + Math.floor(r() * 150);
    const lunch = r() < 0.35;
    const meds = r() < 0.1;
    records.push({
      id: nextId(),
      updated_at: updated,
      status: 'confirmed',
      service: 'daycare',
      start: iso(PILOT_DATE, hm(drop)),
      end: iso(PILOT_DATE, hm(pick)),
      pet: { id: `gs_pet_${500 + i}`, name, species: 'dog', weight_lb: weight },
      lodging: null,
      playgroup: big ? 'Big Yard' : puppy ? 'Puppy Yard' : 'Small Yard',
      feeding_schedule: lunch ? [{ at: '11:30', meal: 'lunch', amount: 'owner-packed bag' }] : [],
      medications: meds ? [{ ...MEDS[1], at: ['12:00'] }] : [],
      add_ons: [],
      alerts: puppy ? ['puppy'] : [],
    });
  }

  // A booking created during the day that checks in the same day (job requirement).
  const ziggyUnit = freeUnits.find((u) => !u.startsWith('C'));
  const sameDayBooking = {
    createdAt: toMin('10:12'),
    record: {
      id: 'gs_res_10999',
      updated_at: `${PILOT_DATE}T10:12:00-06:00`,
      status: 'confirmed',
      service: 'boarding',
      start: iso(PILOT_DATE, '13:30'),
      end: iso('2026-11-20', '11:00'),
      pet: { id: 'gs_pet_999', name: 'Ziggy', species: 'dog', weight_lb: 34 },
      lodging: { unit: ziggyUnit },
      playgroup: null,
      feeding_schedule: [{ at: '16:30', meal: 'dinner', amount: '1.5 cups own kibble' }],
      medications: [{ name: 'Gabapentin 100 mg', dose: '1 capsule', withFood: false, at: ['17:00'] }],
      add_ons: [],
      alerts: ['first stay'],
    },
  };

  return { records, sameDayBooking };
}

// Scripted floor events, identical for every dispatch policy so comparisons are fair.
export const INCIDENTS = [
  { kind: 'refused', match: { type: 'feeding', zone: 'C', meal: 'breakfast' }, pet: 'first', note: 'Refused breakfast' },
  { kind: 'help', match: { type: 'potty', bigdog: true, after: toMin('10:45') }, note: 'Pulling hard on the lead, needs a second handler' },
  { kind: 'blocked', match: { type: 'cleaning', subtype: 'checkout' }, nth: 1, note: 'Dog still in suite: owner running late', retryAfter: 45 },
];
