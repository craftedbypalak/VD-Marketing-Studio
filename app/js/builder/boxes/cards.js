// Builder box: Card templates. Contract: docs/BUILDER.md. Placeholder until its builder lands.
import { el, bullets } from '../../ui.js';

export const box = {
  id: 'cards', title: 'Card templates', icon: 'pictures', order: 20,
  summary: () => ['Not built yet'],
  async render(container) { container.append(bullets(['This box is being built.'])); },
};
