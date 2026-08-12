import { describe, it, expect } from 'vitest';
import { attestationTypeLabel, attestationSummary } from './PendingSignatures';
import type { AttestationRecord } from '@/lib/kernel/attestations';

const RECORD: AttestationRecord = {
  id: 'att_1',
  issuerDid: 'did:imajin:scott',
  subjectDid: 'did:imajin:debbie',
  type: 'supply.received',
  contextId: 'lot_1',
  contextType: 'supply',
  cid: 'bafy1',
  attestationStatus: 'pending',
  issuedAt: '2026-08-11T00:00:00Z',
};

// ---------------------------------------------------------------------------
// attestationTypeLabel
// ---------------------------------------------------------------------------

describe('attestationTypeLabel', () => {
  it('maps supply.received to "Delivery receipt"', () => {
    expect(attestationTypeLabel('supply.received')).toBe('Delivery receipt');
  });

  it('maps supply.declared to "Lot declaration"', () => {
    expect(attestationTypeLabel('supply.declared')).toBe('Lot declaration');
  });

  it('falls back to the raw type for unknown attestation types', () => {
    expect(attestationTypeLabel('custom.type')).toBe('custom.type');
  });
});

// ---------------------------------------------------------------------------
// attestationSummary
// ---------------------------------------------------------------------------

describe('attestationSummary', () => {
  it('summarizes a record with its human-readable type label and issuer', () => {
    expect(attestationSummary(RECORD)).toBe('Delivery receipt from did:imajin:scott');
  });

  it('falls back to the raw type for an unrecognized attestation type', () => {
    expect(attestationSummary({ ...RECORD, type: 'custom.type' })).toBe(
      'custom.type from did:imajin:scott',
    );
  });
});
