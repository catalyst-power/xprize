import { describe, it, expect, beforeEach } from 'vitest';
import { getSettlementRecord, setSettlementRecord, tryClaimTransition, __resetSettlementStoreForTests } from './settlementStore';

beforeEach(() => {
  __resetSettlementStoreForTests();
});

describe('getSettlementRecord / setSettlementRecord', () => {
  it('returns undefined for an unknown correlationId', () => {
    expect(getSettlementRecord('lot_unknown')).toBeUndefined();
  });

  it('round-trips a stored record', () => {
    setSettlementRecord('lot_1', { state: 'awaiting-payment', invoiceId: 'inv_1' });
    expect(getSettlementRecord('lot_1')).toEqual({ state: 'awaiting-payment', invoiceId: 'inv_1' });
  });
});

describe('tryClaimTransition', () => {
  it('claims successfully when there is no existing record', () => {
    expect(tryClaimTransition('lot_1', ['pending-invoice'], 'awaiting-payment')).toBe(true);
    expect(getSettlementRecord('lot_1')?.state).toBe('awaiting-payment');
  });

  it('claims successfully when the existing state is in the allowed `from` list', () => {
    setSettlementRecord('lot_1', { state: 'awaiting-payment' });
    expect(tryClaimTransition('lot_1', ['awaiting-payment'], 'settled')).toBe(true);
    expect(getSettlementRecord('lot_1')?.state).toBe('settled');
  });

  it('refuses to claim when the existing state is not in the allowed `from` list (idempotency guard)', () => {
    setSettlementRecord('lot_1', { state: 'settled' });
    expect(tryClaimTransition('lot_1', ['pending-invoice', 'awaiting-payment'], 'settled')).toBe(false);
    // State is unchanged — no double-settle side effect.
    expect(getSettlementRecord('lot_1')?.state).toBe('settled');
  });

  it('a second concurrent claim for the same transition fails once the first succeeds', () => {
    expect(tryClaimTransition('lot_1', ['pending-invoice'], 'awaiting-payment')).toBe(true);
    expect(tryClaimTransition('lot_1', ['pending-invoice'], 'awaiting-payment')).toBe(false);
  });
});
