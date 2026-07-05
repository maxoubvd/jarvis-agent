import { describe, it, expect } from 'vitest';
import { clamp } from '@/frontend/shared/utils';

describe('Utility functions', () => {
  describe('clamp', () => {
    it('should return the value when within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it('should return the minimum when value is below range', () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('should return the maximum when value is above range', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('should handle edge cases', () => {
      expect(clamp(0, 0, 10)).toBe(0);
      expect(clamp(10, 0, 10)).toBe(10);
    });
  });
});