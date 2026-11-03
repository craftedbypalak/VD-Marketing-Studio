// Every Builder tool box, in one list. Add a box: create boxes/<id>.js exporting `box`, import it here.
import { box as brand } from './boxes/brand.js';
import { box as cards } from './boxes/cards.js';
import { box as accounts } from './boxes/accounts.js';
import { box as rhythm } from './boxes/rhythm.js';
import { box as checker } from './boxes/checker.js';
import { box as video } from './boxes/video.js';
import { box as occasions } from './boxes/occasions.js';
import { box as solutions } from './boxes/solutions.js';
import { box as ai } from './boxes/ai.js';
import { box as team } from './boxes/team.js';

export const BOXES = [brand, cards, accounts, rhythm, checker, video, occasions, solutions, ai, team].sort((a, b) => a.order - b.order);
