import { describe, it, expect } from 'vitest';
import {
  loadPrompts,
  expandPrompt,
  normalizePromptName
} from '../../src/backend/services/prompts.js';
import type { JarvisConfig, PromptItem } from '../../src/backend/config/config-manager.js';

function config(prompts: PromptItem[] | undefined): JarvisConfig {
  return { version: 1, models: { default: null, items: [] }, prompts };
}

const review: PromptItem = {
  id: 'p1',
  name: 'review',
  description: 'Revue de code',
  content: 'Fais une revue du code suivant et liste les bugs potentiels :'
};

describe('prompts service', () => {
  it('normalizes prompt names (leading slash, case)', () => {
    expect(normalizePromptName('/Review')).toBe('review');
    expect(normalizePromptName('  fix-it ')).toBe('fix-it');
  });

  it('keeps only named, non-empty, non-reserved prompts', () => {
    const prompts = loadPrompts(
      config([
        review,
        { id: 'p2', name: '', content: 'x' },
        { id: 'p3', name: 'empty', content: '   ' },
        { id: 'p4', name: 'tdd', content: 'je masque /tdd' },
        { id: 'p5', name: '/agent', content: 'je masque /agent' }
      ])
    );
    expect(prompts.map(p => p.id)).toEqual(['p1']);
    expect(loadPrompts(config(undefined))).toEqual([]);
  });

  it('expands /name into the prompt content, appending the arguments', () => {
    expect(expandPrompt('/review', [review])).toBe(review.content);
    expect(expandPrompt('/review src/app.ts', [review])).toBe(`${review.content}\n\nsrc/app.ts`);
    // Insensible à la casse.
    expect(expandPrompt('/REVIEW ok', [review])).toBe(`${review.content}\n\nok`);
  });

  it('returns null for reserved commands, unknown prompts and non-slash text', () => {
    expect(expandPrompt('/tdd add tests', [review])).toBeNull();
    expect(expandPrompt('/workflow bug-fix x', [review])).toBeNull();
    expect(expandPrompt('/agent do it', [review])).toBeNull();
    expect(expandPrompt('/unknown', [review])).toBeNull();
    expect(expandPrompt('hello /review', [review])).toBeNull();
  });
});
