import { initBoard } from './ui/board.mjs';
import { initCards } from './ui/cards.mjs';
import { initLab } from './ui/lab.mjs';
import { initBuild } from './ui/build.mjs';

const safely = (name, fn) => {
  try { return fn(); } catch (err) { console.error(`${name} failed`, err); return null; }
};

safely('board', initBoard);
safely('cards', initCards);
safely('lab', initLab);
initBuild().catch((err) => console.error('build failed', err));
