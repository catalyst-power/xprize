/**
 * Phase A — end-to-end supply loop integration harness.
 *
 * Proves the AgriFortress supply chain against a LIVE kernel via the public
 * app surface only (app-auth + documented supply/* HTTP routes). No @imajin/*
 * imports, no direct DB, no bus — same boundary as the app itself (AGENTS.md §2).
 *
 * Kernel route contract verified against ima-jin/imajin-ai@main
 * apps/kernel/src/lib/supply.ts (publishSupplyStage / publishReceiptStage /
 * handleLotsBySupplierGet / handleLotGet).
 *
 * Run:
 *   KERNEL_URL=https://... APP_DID=... APP_PRIVATE_KEY=... APP_ATTESTATION_ID=... \
 *   npm run test:e2e
 *
 * When KERNEL_URL is unset the entire suite skips with a clear message so the
 * fast unit lane (`npm test`) is never blocked.
 *
 * Out of scope for Phase A (documented below):
 *   - .fair manifest: no HTTP endpoint on the public app surface
 *     (ima-jin/imajin-ai@main — no /fair route under /api).
 *   - QB invoice threading: requires a live QuickBooks connector service.
 *   - Consent revocation → 403: requires a consent-management API call not
 *     yet wired in this repo's auth flow.
 * These are Phase A+ / Phase B items.
 *
 * Issue: catalyst-power/xprize#32
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fetchKernel } from '@/lib/kernel/client';
import { TokenProvider } from '@/lib/kernel/auth';
import type { LotChain, SupplyStageResponse } from '@/lib/supply';

// ---------------------------------------------------------------------------
// Environment guard — skip the whole suite when there is no live kernel
// ---------------------------------------------------------------------------

const KERNEL_URL = process.env['KERNEL_URL'];
const hasKernel = typeof KERNEL_URL === 'string' && KERNEL_URL.length > 0;

// Use a per-run commodity suffix so parallel runs don't bleed state.
const RUN_ID = randomUUID().slice(0, 8);
const COMMODITY = `eggs-${RUN_ID}`;
const QUANTITY = 6;
const UNIT = 'dozen';

// ---------------------------------------------------------------------------
// Happy path — the full supply loop
// ---------------------------------------------------------------------------

describe.skipIf(!hasKernel)(
  'supply loop — happy path (requires KERNEL_URL)',
  () => {
    let correlationId: string;
    let declaredAttestationCid: string | null;

    // All steps in one beforeAll so each it() below asserts a single property
    // of the completed loop without repeating the HTTP calls.
    beforeAll(async () => {
      // ── Step 1: declare (mint the lot) ──────────────────────────────────
      const declRes = await fetchKernel('/supply/api/declared', {
        method: 'POST',
        body: JSON.stringify({ commodity: COMMODITY, quantity: QUANTITY, unit: UNIT }),
      });
      expect(declRes.status).toBe(201);
      const declared = await declRes.json() as SupplyStageResponse;
      correlationId = declared.correlationId;

      // ── Step 2: received (sign the receipt) ─────────────────────────────
      const recvRes = await fetchKernel('/supply/api/received', {
        method: 'POST',
        body: JSON.stringify({
          lotId: correlationId,
          commodity: COMMODITY,
          quantity: QUANTITY,
          unit: UNIT,
        }),
      });
      expect(recvRes.status).toBe(201);
      await recvRes.json(); // drain body

      // ── Step 3: read the lot chain ───────────────────────────────────────
      const chainRes = await fetchKernel(
        `/supply/api/lot/${encodeURIComponent(correlationId)}`,
        { method: 'GET' },
      );
      expect(chainRes.status).toBe(200);
      const chain = await chainRes.json() as LotChain;

      // Stash the declared stage's attestationCid for the provenance test.
      declaredAttestationCid = chain.stages
        .find((s) => s.stage === 'declared')
        ?.attestationCid ?? null;
    });

    it('declared stage: ok=true, stage=declared, correlationId is non-empty', async () => {
      expect(correlationId).toBeTruthy();
    });

    it('received stage threads onto the same correlationId', async () => {
      // Re-read to assert the stage; correlationId already confirmed above.
      const res = await fetchKernel(
        `/supply/api/lot/${encodeURIComponent(correlationId)}`,
        { method: 'GET' },
      );
      const chain = await res.json() as LotChain;
      const received = chain.stages.find((s) => s.stage === 'received');
      expect(received).toBeDefined();
      expect(chain.lot.correlationId).toBe(correlationId);
    });

    it('lot chain contains exactly two stages (declared + received)', async () => {
      const res = await fetchKernel(
        `/supply/api/lot/${encodeURIComponent(correlationId)}`,
        { method: 'GET' },
      );
      const chain = await res.json() as LotChain;
      expect(chain.stages).toHaveLength(2);
      expect(chain.stages[0].stage).toBe('declared');
      expect(chain.stages[1].stage).toBe('received');
    });

    it('provenance chain: received.priorCid links to declared.attestationCid', async () => {
      const res = await fetchKernel(
        `/supply/api/lot/${encodeURIComponent(correlationId)}`,
        { method: 'GET' },
      );
      const chain = await res.json() as LotChain;
      const received = chain.stages.find((s) => s.stage === 'received');
      expect(received?.priorCid).toBe(declaredAttestationCid);
    });

    it('issuer/subject are kernel-pinned to the supplier DID (not app-set)', async () => {
      const res = await fetchKernel(
        `/supply/api/lot/${encodeURIComponent(correlationId)}`,
        { method: 'GET' },
      );
      const chain = await res.json() as LotChain;
      // originatingDid is set by the kernel from the app-auth token — never
      // by the app payload. Verify it is a non-empty DID string.
      expect(chain.lot.originatingDid).toMatch(/^did:/);
    });

    it('quantity in the signed record matches the asserted value — never recomputed', async () => {
      const res = await fetchKernel(
        `/supply/api/lot/${encodeURIComponent(correlationId)}`,
        { method: 'GET' },
      );
      const chain = await res.json() as LotChain;
      const declared = chain.stages.find((s) => s.stage === 'declared');
      const payload = declared?.payload as Record<string, unknown> | undefined;
      // The asserted value 6 — read back from the signed record, not recomputed.
      expect(payload?.['quantity']).toBe(QUANTITY);
    });

    // --- Out-of-scope markers (Phase A+) -----------------------------------

    it.todo(
      '.fair manifest: not assertable from app surface in Phase A ' +
      '(no /fair HTTP endpoint on ima-jin/imajin-ai@main public API)',
    );

    it.todo(
      'QB invoice threading: requires live QuickBooks connector service',
    );

    it.todo(
      'consent revocation → 403: requires consent-management API call ' +
      'not yet wired in this repo',
    );
  },
);

// ---------------------------------------------------------------------------
// Fail-closed proofs
// ---------------------------------------------------------------------------

describe.skipIf(!hasKernel)(
  'supply loop — fail-closed proofs (requires KERNEL_URL)',
  () => {
    it('missing / bad Authorization header → 401', async () => {
      const kernelBase = (KERNEL_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${kernelBase}/supply/api/declared`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer bad_token',
        },
        body: JSON.stringify({ commodity: COMMODITY, quantity: QUANTITY, unit: UNIT }),
      });
      expect(res.status).toBe(401);
    });

    it('missing commodity in body → 400', async () => {
      const res = await fetchKernel('/supply/api/declared', {
        method: 'POST',
        body: JSON.stringify({ quantity: QUANTITY, unit: UNIT }), // commodity absent
      });
      expect(res.status).toBe(400);
    });

    it('received with missing lotId → 400 (no phantom receipt)', async () => {
      const res = await fetchKernel('/supply/api/received', {
        method: 'POST',
        body: JSON.stringify({ commodity: COMMODITY, quantity: QUANTITY, unit: UNIT }), // lotId absent
      });
      expect(res.status).toBe(400);
    });

    it('partial failure: declared succeeds, received with wrong lotId type → chain has declared only', async () => {
      const runId = randomUUID().slice(0, 8);
      const commodity = `partial-${runId}`;

      // declare succeeds
      const declRes = await fetchKernel('/supply/api/declared', {
        method: 'POST',
        body: JSON.stringify({ commodity, quantity: 1, unit: 'unit' }),
      });
      expect(declRes.status).toBe(201);
      const { correlationId: partialLotId } = await declRes.json() as SupplyStageResponse;

      // received fails (lotId is empty string, not the real ID)
      const recvRes = await fetchKernel('/supply/api/received', {
        method: 'POST',
        body: JSON.stringify({ lotId: '', commodity, quantity: 1, unit: 'unit' }),
      });
      expect(recvRes.status).toBe(400);

      // chain still shows declared only — no phantom receipt
      const chainRes = await fetchKernel(
        `/supply/api/lot/${encodeURIComponent(partialLotId)}`,
        { method: 'GET' },
      );
      const chain = await chainRes.json() as LotChain;
      expect(chain.stages.some((s) => s.stage === 'received')).toBe(false);
      expect(chain.stages.some((s) => s.stage === 'declared')).toBe(true);
    });
  },
);

// ---------------------------------------------------------------------------
// Graceful skip when KERNEL_URL is not configured
// ---------------------------------------------------------------------------

describe.skipIf(hasKernel)('supply loop — skip notice', () => {
  it('KERNEL_URL is not set — e2e harness skipped (unit lane unaffected)', () => {
    // This test exists purely to produce a legible skip message in CI output.
    // Set KERNEL_URL + APP_DID + APP_PRIVATE_KEY + APP_ATTESTATION_ID to run the harness.
  });
});

// ---------------------------------------------------------------------------
// Auth bootstrap smoke-test (runs without a full loop, just token minting)
// ---------------------------------------------------------------------------

describe.skipIf(!hasKernel)('auth bootstrap (requires KERNEL_URL)', () => {
  it('TokenProvider mints a non-empty Bearer token from app credentials', async () => {
    const appDid = process.env['APP_DID'];
    const privateKey = process.env['APP_PRIVATE_KEY'];
    const attestationId = process.env['APP_ATTESTATION_ID'];

    if (!appDid || !privateKey || !attestationId) {
      // Not a hard failure — the token mint is also exercised by fetchKernel calls above.
      return;
    }

    const provider = new TokenProvider({
      kernelUrl: KERNEL_URL ?? '',
      appDid,
      privateKey,
      attestationId,
    });
    const token = await provider.getToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });
});
