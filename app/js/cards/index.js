// The card template registry. [pictures]
// Each template module exports { meta, size(fields), render(fields, theme, opts) }.
// The Builder (Card templates box, settings.cards) can switch templates off and set
// their default theme and footer line: call setCards(settings.cards) before using
// activeTemplates(), themeFor() or defaultsFor().

import * as statusRule from './statusRule.js';
import * as quote from './quote.js';
import * as hook from './hook.js';
import * as thumbnail from './thumbnail.js';
import * as carouselSlide from './carouselSlide.js';
import * as linkedinImage from './linkedinImage.js';
import * as festivalGreeting from './festivalGreeting.js';
import { isTemplateOn, footerFor } from './_kit.js';

/** Every template, on or off. */
export const TEMPLATES = [statusRule, quote, hook, thumbnail, carouselSlide, linkedinImage, festivalGreeting];

export const byId = (id) => TEMPLATES.find((t) => t.meta.id === id) || null;

/** The templates the Builder has left on (all of them when none is off; never an empty list). */
export function activeTemplates() {
  const on = TEMPLATES.filter((t) => isTemplateOn(t.meta.id));
  return on.length ? on : TEMPLATES;
}

/** A template's default fields, with the Builder's default footer line. */
export function defaultsFor(t) {
  const d = { ...t.meta.defaults };
  if ('footer' in d) d.footer = footerFor(t.meta);
  return d;
}

export { ready, isReady, brandIssues, setBrand, useBrand, setCards, themeFor, isTemplateOn, footerFor, cardText } from './_kit.js';
