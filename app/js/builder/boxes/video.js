// Builder box: Video defaults. Contract: docs/BUILDER.md. Placeholder until its builder lands.
import { el, bullets } from '../../ui.js';

export const box = {
  id: 'video', title: 'Video defaults', icon: 'video', order: 60,
  summary: () => ['Not built yet'],
  async render(container) { container.append(bullets(['This box is being built.'])); },
};
