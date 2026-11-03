// Builder box: Checker rules. Contract: docs/BUILDER.md. Placeholder until its builder lands.
import { el, bullets } from '../../ui.js';

export const box = {
  id: 'checker', title: 'Checker rules', icon: 'review', order: 50,
  summary: () => ['Not built yet'],
  async render(container) { container.append(bullets(['This box is being built.'])); },
};
