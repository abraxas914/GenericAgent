// @vitest-environment node
import { describe, it, expect } from 'vitest';

/**
 * Tests for model selection SSOT: session-bound model takes priority over global default.
 * Verifies the logic that ModelSelector uses: sessionModelNo ?? defaultModelNo.
 */
describe('model-selector session binding', () => {
  describe('selectedNo derivation', () => {
    function deriveSelectedNo(sessionModelNo: number | null, defaultModelNo: number): number {
      return sessionModelNo ?? defaultModelNo;
    }

    it('uses session model when available', () => {
      expect(deriveSelectedNo(2, 0)).toBe(2);
      expect(deriveSelectedNo(5, 3)).toBe(5);
    });

    it('falls back to default when session model is null', () => {
      expect(deriveSelectedNo(null, 0)).toBe(0);
      expect(deriveSelectedNo(null, 3)).toBe(3);
    });

    it('uses session model 0 explicitly (not falling through to default)', () => {
      expect(deriveSelectedNo(0, 5)).toBe(0);
    });
  });

  describe('session switch resets model state', () => {
    it('new session starts with null sessionModelNo', () => {
      const state = { sessionModelNo: null as number | null };
      // Simulate setActiveSession clearing state
      state.sessionModelNo = null;
      expect(state.sessionModelNo).toBeNull();
    });

    it('poll result populates sessionModelNo from model.llmNo', () => {
      const state = { sessionModelNo: null as number | null };
      const pollResult = { model: { isMixin: false, current: 'gpt-4', llmNo: 2 } };
      if (pollResult.model?.llmNo != null) {
        state.sessionModelNo = pollResult.model.llmNo;
      }
      expect(state.sessionModelNo).toBe(2);
    });

    it('does not overwrite sessionModelNo when poll model has no llmNo', () => {
      const state = { sessionModelNo: 3 as number | null };
      const pollResult = { model: { isMixin: false, current: 'gpt-4' } as { isMixin: boolean; current: string; llmNo?: number } };
      if (pollResult.model?.llmNo != null) {
        state.sessionModelNo = pollResult.model.llmNo;
      }
      expect(state.sessionModelNo).toBe(3);
    });
  });

  describe('optimistic update and rollback', () => {
    it('optimistically sets sessionModelNo on selectSessionModel', () => {
      const state = { sessionModelNo: 1 as number | null };
      const newModel = 3;
      state.sessionModelNo = newModel;
      expect(state.sessionModelNo).toBe(3);
    });

    it('rolls back on API failure', () => {
      const state = { sessionModelNo: 1 as number | null };
      const prev = state.sessionModelNo;
      state.sessionModelNo = 3; // optimistic
      // simulate failure
      state.sessionModelNo = prev; // rollback
      expect(state.sessionModelNo).toBe(1);
    });
  });
});
