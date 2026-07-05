import { describe, it, expect, vi } from 'vitest';
import { HITLManager } from '../../src/backend/services/hitl.js';

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
});
