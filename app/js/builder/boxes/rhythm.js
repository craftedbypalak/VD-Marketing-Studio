// Builder box: Posting rhythm. Contract: docs/BUILDER.md. Placeholder until its builder lands.
import { el, bullets } from '../../ui.js';

export const box = {
  id: 'rhythm', title: 'Posting rhythm', icon: 'calendar', order: 40,
  summary: () => ['Not built yet'],
  async render(container) { container.append(bullets(['This box is being built.'])); },
};
