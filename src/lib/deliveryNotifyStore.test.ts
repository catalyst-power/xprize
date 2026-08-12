import { describe, it, expect, beforeEach } from 'vitest';
import {
  cacheRecipientDid,
  getDeliveryNotifyRecord,
  markRungSent,
  markStopped,
  __resetDeliveryNotifyStoreForTests,
} from './deliveryNotifyStore';

beforeEach(() => {
  __resetDeliveryNotifyStoreForTests();
});

describe('cacheRecipientDid', () => {
  it('returns undefined for a lot with no record yet', () => {
    expect(getDeliveryNotifyRecord('lot_x')).toBeUndefined();
  });

  it('stores the recipient DID with an empty sentRungs list', () => {
    cacheRecipientDid('lot_1', 'did:imajin:david');

    expect(getDeliveryNotifyRecord('lot_1')).toEqual({
      recipientDid: 'did:imajin:david',
      sentRungs: [],
      stoppedAt: undefined,
      lastSentAt: undefined,
    });
  });

  it('overwrites a previously cached recipient DID without dropping sentRungs/stoppedAt', () => {
    cacheRecipientDid('lot_1', 'did:imajin:old');
    markRungSent('lot_1', 'did:imajin:old', 0);

    cacheRecipientDid('lot_1', 'did:imajin:new');

    const record = getDeliveryNotifyRecord('lot_1');
    expect(record?.recipientDid).toBe('did:imajin:new');
    expect(record?.sentRungs).toEqual([0]);
  });
});

describe('markRungSent', () => {
  it('adds a rung to a fresh record', () => {
    markRungSent('lot_1', 'did:imajin:david', 0);

    const record = getDeliveryNotifyRecord('lot_1');
    expect(record?.sentRungs).toEqual([0]);
    expect(record?.recipientDid).toBe('did:imajin:david');
    expect(record?.lastSentAt).toBeDefined();
  });

  it('accumulates multiple distinct rungs', () => {
    markRungSent('lot_1', 'did:imajin:david', 0);
    markRungSent('lot_1', 'did:imajin:david', 1);

    expect(getDeliveryNotifyRecord('lot_1')?.sentRungs).toEqual([0, 1]);
  });

  it('never records the same rung twice (idempotent dedupe)', () => {
    markRungSent('lot_1', 'did:imajin:david', 2);
    markRungSent('lot_1', 'did:imajin:david', 2);

    expect(getDeliveryNotifyRecord('lot_1')?.sentRungs).toEqual([2]);
  });

  it('keeps rungs isolated per correlationId', () => {
    markRungSent('lot_1', 'did:imajin:david', 0);
    markRungSent('lot_2', 'did:imajin:grace', 1);

    expect(getDeliveryNotifyRecord('lot_1')?.sentRungs).toEqual([0]);
    expect(getDeliveryNotifyRecord('lot_2')?.sentRungs).toEqual([1]);
  });
});

describe('markStopped', () => {
  it('sets stoppedAt on a fresh record', () => {
    markStopped('lot_1');

    const record = getDeliveryNotifyRecord('lot_1');
    expect(record?.stoppedAt).toBeDefined();
    expect(record?.sentRungs).toEqual([]);
  });

  it('is idempotent — does not move stoppedAt once already stopped', () => {
    markStopped('lot_1');
    const firstStoppedAt = getDeliveryNotifyRecord('lot_1')?.stoppedAt;

    markStopped('lot_1');

    expect(getDeliveryNotifyRecord('lot_1')?.stoppedAt).toBe(firstStoppedAt);
  });

  it('preserves already-recorded rungs and recipientDid when stopping', () => {
    markRungSent('lot_1', 'did:imajin:david', 0);

    markStopped('lot_1');

    const record = getDeliveryNotifyRecord('lot_1');
    expect(record?.recipientDid).toBe('did:imajin:david');
    expect(record?.sentRungs).toEqual([0]);
    expect(record?.stoppedAt).toBeDefined();
  });
});
