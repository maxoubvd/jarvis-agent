import { describe, it, expect, vi } from 'vitest';
import { HITLManager } from '../../packages/core/src/services/hitl.js';

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn().mockResolvedValue('Refuser')
  }
}));

describe('HITLManager', () => {
  it('grants everything in free mode', async () => {
    const hitl = new HITLManager('free');
    const result = await hitl.checkApproval('terminal', { command: 'rm -rf /' });
    expect(result.granted).toBe(true);
  });

  it('auto-approves safe reads in moderate mode', async () => {
    const hitl = new HITLManager('moderate');
    const result = await hitl.checkApproval('read_file', { path: 'src/index.ts' });
    expect(result.granted).toBe(true);
  });

  it('prompts (and here refuses) for dangerous commands in moderate mode', async () => {
    const hitl = new HITLManager('moderate');
    const result = await hitl.checkApproval('terminal', { command: 'rm -rf node_modules' });
    expect(result.granted).toBe(false);
  });

  it('exposes the current mode', () => {
    const hitl = new HITLManager('strict');
    expect(hitl.getMode()).toBe('strict');
    hitl.setMode('free');
    expect(hitl.getMode()).toBe('free');
  });

  it('delegates prompts to the chat handler; allow-session is remembered', async () => {
    const hitl = new HITLManager('strict');
    const handler = vi.fn().mockResolvedValue({ decision: 'allow-session' });
    hitl.setPromptHandler(handler);

    const first = await hitl.checkApproval('terminal', { command: 'npm run build' });
    expect(first.granted).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    // Same action: the session allowance short-circuits the prompt.
    const second = await hitl.checkApproval('terminal', { command: 'npm run build' });
    expect(second.granted).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a denial through the handler carries the user instructions', async () => {
    const hitl = new HITLManager('strict');
    hitl.setPromptHandler(async () => ({ decision: 'deny', feedback: 'fix the lint first' }));

    const result = await hitl.askApproval('terminal', { command: 'npm test' });
    expect(result.granted).toBe(false);
    expect(result.feedback).toBe('fix the lint first');
  });

  it('falls back to the native dialog when the handler returns null', async () => {
    const hitl = new HITLManager('strict');
    hitl.setPromptHandler(async () => null);
    // The vscode mock responds "Deny" → denied via the native dialog.
    const result = await hitl.checkApproval('terminal', { command: 'npm test' });
    expect(result.granted).toBe(false);
    expect(result.feedback).toBeUndefined();
  });
});
