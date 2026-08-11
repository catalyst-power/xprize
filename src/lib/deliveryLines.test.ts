import { describe, it, expect } from 'vitest';
import {
  applyQtyEdit,
  applyTotalEdit,
  applyUnitPriceEdit,
  computeTotalCents,
  computeUnitPriceScaledFromTotal,
  createEmptyLine,
  formatCents,
  formatUnitPriceScaled,
  freezeLine,
  isLineValid,
  legacyFieldsToLine,
  lineTotalLabel,
  manifestGrandTotalCents,
  parseCents,
  parseUnitPriceScaled,
  UNIT_PRICE_SCALE,
  type DeliveryLineDraft,
} from './deliveryLines';

// ---------------------------------------------------------------------------
// Money parsing / formatting
// ---------------------------------------------------------------------------

describe('parseCents', () => {
  it('parses a whole-dollar string to cents', () => {
    expect(parseCents('24.00')).toBe(2400);
  });

  it('parses a string with no decimal point', () => {
    expect(parseCents('24')).toBe(2400);
  });

  it('rounds to the nearest cent', () => {
    expect(parseCents('24.005')).toBe(2401);
  });

  it('returns null for an empty string', () => {
    expect(parseCents('')).toBeNull();
  });

  it('returns null for a blank (whitespace-only) string', () => {
    expect(parseCents('   ')).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(parseCents('abc')).toBeNull();
  });
});

describe('formatCents', () => {
  it('formats whole cents as a 2-decimal dollar string', () => {
    expect(formatCents(2400)).toBe('24.00');
  });

  it('formats a single-digit cents value with leading zero', () => {
    expect(formatCents(5)).toBe('0.05');
  });
});

describe('parseUnitPriceScaled', () => {
  it('parses a dollars string into a UNIT_PRICE_SCALE-scaled integer', () => {
    expect(parseUnitPriceScaled('0.50')).toBe(50 * UNIT_PRICE_SCALE);
  });

  it('preserves sub-cent precision up to 4 decimal places', () => {
    expect(parseUnitPriceScaled('0.5025')).toBe(Math.round(50.25 * UNIT_PRICE_SCALE));
  });

  it('returns null for blank input', () => {
    expect(parseUnitPriceScaled('')).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(parseUnitPriceScaled('free')).toBeNull();
  });
});

describe('formatUnitPriceScaled', () => {
  it('formats a whole-cent scaled value with 2 decimals', () => {
    expect(formatUnitPriceScaled(50 * UNIT_PRICE_SCALE)).toBe('0.50');
  });

  it('formats a sub-cent scaled value with 4 decimals', () => {
    expect(formatUnitPriceScaled(Math.round(50.25 * UNIT_PRICE_SCALE))).toBe('0.5025');
  });
});

// ---------------------------------------------------------------------------
// Derivation primitives
// ---------------------------------------------------------------------------

describe('computeTotalCents', () => {
  it('computes qty * unitPrice, rounded to the nearest cent', () => {
    expect(computeTotalCents(48, 50 * UNIT_PRICE_SCALE)).toBe(2400);
  });

  it('rounds fractional cent results', () => {
    // 3 units at $0.335/unit = $1.005 -> rounds to 101 cents.
    expect(computeTotalCents(3, 33.5 * UNIT_PRICE_SCALE)).toBe(101);
  });
});

describe('computeUnitPriceScaledFromTotal', () => {
  it('divides total cents by qty, scaled', () => {
    expect(computeUnitPriceScaledFromTotal(48, 2400)).toBe(50 * UNIT_PRICE_SCALE);
  });

  it('returns 0 when qty is 0 (avoids divide-by-zero)', () => {
    expect(computeUnitPriceScaledFromTotal(0, 2400)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bidirectional derivation — last-touched wins (xprize#56)
// ---------------------------------------------------------------------------

function lineWith(overrides: Partial<DeliveryLineDraft>): DeliveryLineDraft {
  return { ...createEmptyLine(), qty: '48', ...overrides };
}

describe('applyUnitPriceEdit', () => {
  it('recomputes total from qty * unitPrice', () => {
    const line = applyUnitPriceEdit(lineWith({}), '0.50');
    expect(line.unitPrice).toBe('0.50');
    expect(line.total).toBe('24.00');
  });

  it('sets priceBasis to per_unit', () => {
    const line = applyUnitPriceEdit(lineWith({ priceBasis: 'total' }), '0.50');
    expect(line.priceBasis).toBe('per_unit');
  });

  it('keeps the raw input and does not touch total when qty is not yet a number', () => {
    const line = applyUnitPriceEdit(lineWith({ qty: '' }), '0.50');
    expect(line.unitPrice).toBe('0.50');
    expect(line.total).toBe('');
  });

  it('keeps the raw input and does not touch total when unitPrice is not parseable (mid-typing)', () => {
    const line = applyUnitPriceEdit(lineWith({ total: '10.00' }), '$');
    expect(line.unitPrice).toBe('$');
    expect(line.total).toBe('10.00');
  });
});

describe('applyTotalEdit', () => {
  it('derives a display-only unitPrice from total / qty', () => {
    const line = applyTotalEdit(lineWith({}), '24.00');
    expect(line.total).toBe('24.00');
    expect(line.unitPrice).toBe('0.50');
  });

  it('sets priceBasis to total (lump-sum deal)', () => {
    const line = applyTotalEdit(lineWith({}), '24.00');
    expect(line.priceBasis).toBe('total');
  });

  it('handles a lump sum that does not divide evenly (sub-cent unit price)', () => {
    // $10.00 / 3 units = $3.3333.../unit
    const line = applyTotalEdit(lineWith({ qty: '3' }), '10.00');
    expect(line.unitPrice).toBe('3.3333');
  });

  it('keeps the raw input and does not touch unitPrice when qty is 0', () => {
    const line = applyTotalEdit(lineWith({ qty: '0' }), '24.00');
    expect(line.total).toBe('24.00');
    expect(line.unitPrice).toBe('');
  });
});

describe('applyQtyEdit', () => {
  it('recomputes total from the current unit price', () => {
    const withPrice = applyUnitPriceEdit(lineWith({}), '0.50');
    const line = applyQtyEdit(withPrice, '96');
    expect(line.qty).toBe('96');
    expect(line.total).toBe('48.00');
  });

  it('recomputes total from unit price even when total was the last-touched field (qty is never derived)', () => {
    // A lump-sum total sets priceBasis='total' and derives a display unit price;
    // editing qty afterwards must still recompute total from that unit price.
    const lumpSum = applyTotalEdit(lineWith({}), '24.00'); // unitPrice derived: 0.50
    const line = applyQtyEdit(lumpSum, '96');
    expect(line.total).toBe('48.00');
    expect(line.priceBasis).toBe('per_unit');
  });

  it('keeps the raw input and does not touch total when unitPrice is not yet set', () => {
    const line = applyQtyEdit(lineWith({}), '96');
    expect(line.qty).toBe('96');
    expect(line.total).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

describe('lineTotalLabel', () => {
  it('renders "qty x $unitPrice = $total"', () => {
    const line = applyUnitPriceEdit(lineWith({}), '0.50');
    expect(lineTotalLabel(line)).toBe('48 \u00d7 $0.50 = $24.00');
  });

  it('returns null when the line is not yet fully specified', () => {
    expect(lineTotalLabel(createEmptyLine())).toBeNull();
  });
});

describe('manifestGrandTotalCents', () => {
  it('sums the total of every line', () => {
    const lineA = applyUnitPriceEdit(lineWith({}), '0.50'); // $24.00
    const lineB = applyUnitPriceEdit(lineWith({ qty: '10' }), '2.00'); // $20.00
    expect(manifestGrandTotalCents([lineA, lineB])).toBe(4400);
  });

  it('returns 0 for an empty lines list', () => {
    expect(manifestGrandTotalCents([])).toBe(0);
  });

  it('treats a line with an unparseable total as contributing 0', () => {
    const line = createEmptyLine();
    expect(manifestGrandTotalCents([line])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Validation + freezing (sign-time) — AGENTS.md §4: never a signed ambiguity
// ---------------------------------------------------------------------------

describe('isLineValid', () => {
  it('is valid when product/unit/qty/unitPrice/total are all set and consistent', () => {
    const line = applyUnitPriceEdit(
      { ...lineWith({}), product: { label: 'eggs' }, unit: 'dozen' },
      '0.50',
    );
    expect(isLineValid(line)).toBe(true);
  });

  it('is invalid when the product label is blank', () => {
    const line = applyUnitPriceEdit(lineWith({ unit: 'dozen' }), '0.50');
    expect(isLineValid(line)).toBe(false);
  });

  it('is invalid when the unit is blank', () => {
    const line = applyUnitPriceEdit(
      { ...lineWith({}), product: { label: 'eggs' } },
      '0.50',
    );
    expect(isLineValid(line)).toBe(false);
  });

  it('is invalid when total was hand-edited to a value inconsistent with qty * unitPrice', () => {
    const line: DeliveryLineDraft = {
      ...createEmptyLine(),
      product: { label: 'eggs' },
      unit: 'dozen',
      qty: '48',
      unitPrice: '0.50',
      total: '99.00', // inconsistent — never produced by the derivation helpers
    };
    expect(isLineValid(line)).toBe(false);
  });

  it('is invalid when qty is blank', () => {
    const line = applyUnitPriceEdit(
      { ...lineWith({}), product: { label: 'eggs' }, unit: 'dozen', qty: '' },
      '0.50',
    );
    expect(isLineValid(line)).toBe(false);
  });
});

describe('freezeLine', () => {
  it('freezes a valid line into its signed numeric form', () => {
    const line = applyUnitPriceEdit(
      { ...lineWith({}), product: { id: 'prod_eggs', label: 'Eggs' }, unit: 'dozen' },
      '0.50',
    );
    const frozen = freezeLine(line);
    expect(frozen).toEqual({
      product: { id: 'prod_eggs', label: 'Eggs' },
      qty: 48,
      unit: 'dozen',
      unitPrice: 50 * UNIT_PRICE_SCALE,
      currency: 'USD',
      total: 2400,
      priceBasis: 'per_unit',
    });
  });

  it('returns null for an invalid line rather than signing an inconsistent record', () => {
    expect(freezeLine(createEmptyLine())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Legacy single-product mapping (backward compatibility)
// ---------------------------------------------------------------------------

describe('legacyFieldsToLine', () => {
  it('maps a legacy {product, qty, unit} payload to a one-line draft', () => {
    const line = legacyFieldsToLine({ product: 'eggs', qty: 6, unit: 'dozen' });
    expect(line.product).toEqual({ label: 'eggs' });
    expect(line.qty).toBe('6');
    expect(line.unit).toBe('dozen');
  });

  it('derives total when a legacy unitPrice is present', () => {
    const line = legacyFieldsToLine({ product: 'eggs', qty: 6, unit: 'dozen', unitPrice: 2 });
    expect(line.unitPrice).toBe('2');
    expect(line.total).toBe('12.00');
  });

  it('leaves money fields blank when no legacy unitPrice is present', () => {
    const line = legacyFieldsToLine({ product: 'eggs', qty: 6, unit: 'dozen' });
    expect(line.unitPrice).toBe('');
    expect(line.total).toBe('');
  });

  it('defaults to an empty product label when the legacy payload has none', () => {
    const line = legacyFieldsToLine({ qty: 6, unit: 'dozen' });
    expect(line.product).toEqual({ label: '' });
  });
});
