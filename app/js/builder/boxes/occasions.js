// Builder box: Occasions. Contract: docs/BUILDER.md. Placeholder until its builder lands.
import { el, bullets } from '../../ui.js';

export const box = {
  id: 'occasions', title: 'Occasions', icon: 'recurring', order: 70,
  summary: () => ['Not built yet'],
  async render(container) { container.append(bullets(['This box is being built.'])); },
};
