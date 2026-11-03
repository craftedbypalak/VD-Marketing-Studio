// The card template registry. [pictures]
// Each template module exports { meta, size(fields), render(fields, theme, opts) }.

import * as statusRule from './statusRule.js';
import * as quote from './quote.js';
import * as hook from './hook.js';
import * as thumbnail from './thumbnail.js';
import * as carouselSlide from './carouselSlide.js';
import * as linkedinImage from './linkedinImage.js';

export const TEMPLATES = [statusRule, quote, hook, thumbnail, carouselSlide, linkedinImage];

export const byId = (id) => TEMPLATES.find((t) => t.meta.id === id) || null;

export { ready, isReady, brandIssues } from './_kit.js';
