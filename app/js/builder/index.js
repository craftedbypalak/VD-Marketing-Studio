// Every Builder tool box (marketing only; company admin stays in Settings), in one list. Add a box: create boxes/<id>.js exporting `box`, import it here.
import { box as brand } from './boxes/brand.js';
import { box as cards } from './boxes/cards.js';
import { box as rhythm } from './boxes/rhythm.js';
import { box as checker } from './boxes/checker.js';
import { box as video } from './boxes/video.js';
import { box as occasions } from './boxes/occasions.js';

export const BOXES = [brand, cards, rhythm, checker, video, occasions].sort((a, b) => a.order - b.order);
