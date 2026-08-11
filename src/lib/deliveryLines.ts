/**
 * Packing-slip line-item helpers for the delivery card (xprize#56).
 *
 * The delivery card is a packing slip: header (recipient/lot/notes) + 1..n
 * lines. Each line carries product, quantity + unit, unitPrice + currency,
 * total, and priceBasis (which money field is authoritative). Form behavior
 * is bidirectional derivation with "last-touched wins":
 *   - edit unitPrice -> total = qty * unitPrice
 *   - edit total      -> unitPrice = total / qty (priceBasis becomes 'total';
 *                         the derived unit price is display-only)
 *   - edit qty        -> total is recomputed from the current unit price;
 *                         qty is the physical fact and is never derived
 *
 * All money helpers here are pure and framework-agnostic so the derivation
 * rules and rounding are exhaustively testable without rendering React.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PriceBasis = 'per_unit' | 'total';

/**
 * A typed reference to a catalog/market product the supplier owns, when one
 * resolved. `id` is omitted for free-text entries and stub products created
 * from them (claimable/normalizable later, xprize#56) — `label` is always
 * present so the line always has a human-readable product name.
 */
export interface ProductRef {
  id?: string;
  label: string;
}

/**
 * Known units offered in the Unit selector. Not an exhaustive enum — the
 * issue explicitly leaves it open-ended ("each / dozen / kg / tonnes /
 * loaves / ..."), so free text is still accepted; these are just the common
 * options surfaced first.
 */
export const KNOWN_UNITS: readonly string[] = ['each', 'dozen', 'kg', 'tonnes', 'loaves'];

/** Fixed-point scale for `unitPrice`: 4 decimal places of a cent (issue #56: "integer cents, up to 4-decimal sub-cent precision"). */
export const UNIT_PRICE_SCALE = 10_000;

export const DEFAULT_CURRENCY = 'USD';

/**
 * Editable line-item form state. Money fields are kept as raw string inputs
 * (mirroring the delivery card's existing string-input convention) so a
 * field can be blank or mid-edit without forcing a parse; `parse*` helpers
 * below convert to fixed-point integers on demand.
 */
export interface DeliveryLineDraft {
  product: ProductRef;
  qty: string;
  unit: string;
  /** Dollars-and-cents string, e.g. "0.50" or "0.5025" (sub-cent). */
  unitPrice: string;
  currency: string;
  /** Dollars-and-cents string, e.g. "24.00". */
  total: string;
  priceBasis: PriceBasis;
}

export function createEmptyLine(currency: string = DEFAULT_CURRENCY): DeliveryLineDraft {
  return {
    product: { label: '' },
    qty: '',
    unit: '',
    unitPrice: '',
    currency,
    total: '',
    priceBasis: 'per_unit',
  };
}

// ---------------------------------------------------------------------------
// Money parsing / formatting
// ---------------------------------------------------------------------------

/** Parse a dollars string into integer cents. Returns null for unparseable/blank input. */
export function parseCents(input: string): number | null {
  if (input.trim() === '') return null;
  const dollars = Number(input);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

/** Format integer cents as a dollars-and-cents string, e.g. 2400 -> "24.00". */
export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Parse a dollars string into a `UNIT_PRICE_SCALE`-scaled integer (4 decimal
 * places of a cent). Returns null for unparseable/blank input.
 */
export function parseUnitPriceScaled(input: string): number | null {
  if (input.trim() === '') return null;
  const dollars = Number(input);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100 * UNIT_PRICE_SCALE);
}

/**
 * Format a `UNIT_PRICE_SCALE`-scaled integer back into a dollars string.
 * Shows 2 decimal places when the value is a whole number of cents, and 4
 * when it carries sub-cent precision (e.g. a lump-sum total divided evenly).
 */
export function formatUnitPriceScaled(scaled: number): string {
  const dollars = scaled / (100 * UNIT_PRICE_SCALE);
  const wholeCents = Math.round(dollars * 100) === dollars * 100;
  return wholeCents ? dollars.toFixed(2) : dollars.toFixed(4);
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** total (cents) = qty * unitPrice (scaled), rounded to the nearest cent. */
export function computeTotalCents(qty: number, unitPriceScaled: number): number {
  return Math.round((qty * unitPriceScaled) / UNIT_PRICE_SCALE);
}

/** Display-only unit price (scaled) derived from a lump-sum total (cents) and qty. */
export function computeUnitPriceScaledFromTotal(qty: number, totalCents: number): number {
  if (qty === 0) return 0;
  return Math.round((totalCents * UNIT_PRICE_SCALE) / qty);
}

/**
 * Apply an edit to `unitPrice`: recomputes `total` from qty * unitPrice.
 * `priceBasis` becomes 'per_unit' — unit price + qty are now authoritative.
 */
export function applyUnitPriceEdit(line: DeliveryLineDraft, unitPriceInput: string): DeliveryLineDraft {
  const scaled = parseUnitPriceScaled(unitPriceInput);
  const qty = Number(line.qty);

  if (scaled === null || line.qty.trim() === '' || !Number.isFinite(qty)) {
    return { ...line, unitPrice: unitPriceInput, priceBasis: 'per_unit' };
  }

  return {
    ...line,
    unitPrice: unitPriceInput,
    total: formatCents(computeTotalCents(qty, scaled)),
    priceBasis: 'per_unit',
  };
}

/**
 * Apply an edit to `total`: derives a display-only `unitPrice` from
 * total / qty (a lump-sum deal). `priceBasis` becomes 'total' — total is
 * now authoritative and the shown unit price is derived.
 */
export function applyTotalEdit(line: DeliveryLineDraft, totalInput: string): DeliveryLineDraft {
  const cents = parseCents(totalInput);
  const qty = Number(line.qty);

  if (cents === null || line.qty.trim() === '' || !Number.isFinite(qty) || qty === 0) {
    return { ...line, total: totalInput, priceBasis: 'total' };
  }

  return {
    ...line,
    total: totalInput,
    unitPrice: formatUnitPriceScaled(computeUnitPriceScaledFromTotal(qty, cents)),
    priceBasis: 'total',
  };
}

/**
 * Apply an edit to `qty`: always recomputes `total` from the current unit
 * price — qty is the physical fact and is never the derived field, even if
 * `total` was the last-touched money field before this edit.
 */
export function applyQtyEdit(line: DeliveryLineDraft, qtyInput: string): DeliveryLineDraft {
  const qty = Number(qtyInput);
  const scaled = parseUnitPriceScaled(line.unitPrice);

  if (qtyInput.trim() === '' || !Number.isFinite(qty) || scaled === null) {
    return { ...line, qty: qtyInput };
  }

  return {
    ...line,
    qty: qtyInput,
    total: formatCents(computeTotalCents(qty, scaled)),
    priceBasis: 'per_unit',
  };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** "48 x $0.50 = $24.00" — null when qty/unitPrice/total aren't all parseable yet. */
export function lineTotalLabel(line: DeliveryLineDraft): string | null {
  const qty = Number(line.qty);
  const scaled = parseUnitPriceScaled(line.unitPrice);
  const totalCents = parseCents(line.total);

  if (line.qty.trim() === '' || !Number.isFinite(qty) || scaled === null || totalCents === null) {
    return null;
  }

  return `${qty} \u00d7 $${formatUnitPriceScaled(scaled)} = $${formatCents(totalCents)}`;
}

/** Sum of every line's total (cents); lines with an unparseable total contribute 0. */
export function manifestGrandTotalCents(lines: readonly DeliveryLineDraft[]): number {
  let sum = 0;
  for (const line of lines) {
    sum += parseCents(line.total) ?? 0;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Validation (sign-time)
// ---------------------------------------------------------------------------

/**
 * True when a line is frozen-record-ready: product has a label, qty/unit
 * are set, and qty * unitPrice rounds to total (the rounding rule implied
 * by priceBasis — since both derivation paths already round to the cent,
 * a valid line's fields are always exactly consistent by construction).
 */
export function isLineValid(line: DeliveryLineDraft): boolean {
  if (line.product.label.trim() === '') return false;
  if (line.unit.trim() === '') return false;

  const qty = Number(line.qty);
  const scaled = parseUnitPriceScaled(line.unitPrice);
  const totalCents = parseCents(line.total);

  if (line.qty.trim() === '' || !Number.isFinite(qty) || scaled === null || totalCents === null) {
    return false;
  }

  return computeTotalCents(qty, scaled) === totalCents;
}

// ---------------------------------------------------------------------------
// Frozen (signed) line -- the record, not the form
// ---------------------------------------------------------------------------

export interface ConfirmedLine {
  product: ProductRef;
  qty: number;
  unit: string;
  /** UNIT_PRICE_SCALE-scaled integer. */
  unitPrice: number;
  currency: string;
  /** Integer cents. */
  total: number;
  priceBasis: PriceBasis;
}

/**
 * Freeze a valid draft into its signed, numeric form. Callers must check
 * `isLineValid()` first -- returns null for an invalid draft rather than
 * signing an inconsistent record (AGENTS.md sec 4: never a signed ambiguity).
 */
export function freezeLine(line: DeliveryLineDraft): ConfirmedLine | null {
  if (!isLineValid(line)) return null;

  const scaled = parseUnitPriceScaled(line.unitPrice);
  const totalCents = parseCents(line.total);
  if (scaled === null || totalCents === null) return null;

  return {
    product: line.product,
    qty: Number(line.qty),
    unit: line.unit,
    unitPrice: scaled,
    currency: line.currency,
    total: totalCents,
    priceBasis: line.priceBasis,
  };
}

// ---------------------------------------------------------------------------
// Legacy single-product mapping (backward compatibility)
// ---------------------------------------------------------------------------

/**
 * Map a legacy single-product inference (`{product, qty, unit, unitPrice?,
 * total?, priceBasis?}`) to a one-line draft. Used when the kernel's
 * candidate metadata hasn't yet grown to the `{lines: [...]}` shape
 * (xprize#56: "keep backward compatibility: a legacy single-product payload
 * maps to lines[0]").
 *
 * `total`/`priceBasis` are the xprize#58 fix: money mentioned in the gesture
 * must reach the line's money fields, not just `unitPrice`. When an explicit
 * `priceBasis` is given and its corresponding field is present, that field
 * wins; otherwise `total` (a lump-sum price, e.g. "12 eggs for $5") takes
 * precedence over `unitPrice` (e.g. "12 eggs at $0.50") since a total is the
 * more common phrasing and unitPrice can always be re-derived from it.
 */
export function legacyFieldsToLine(
  fields: {
    product?: string;
    qty?: number;
    unit?: string;
    unitPrice?: number;
    total?: number;
    priceBasis?: PriceBasis;
  },
  currency: string = DEFAULT_CURRENCY,
): DeliveryLineDraft {
  const empty = createEmptyLine(currency);
  const qty = fields.qty != null ? String(fields.qty) : '';
  const line: DeliveryLineDraft = {
    ...empty,
    product: { label: fields.product ?? '' },
    qty,
    unit: fields.unit ?? '',
  };

  if (fields.priceBasis === 'per_unit' && fields.unitPrice != null) {
    return applyUnitPriceEdit(line, String(fields.unitPrice));
  }
  if (fields.priceBasis === 'total' && fields.total != null) {
    return applyTotalEdit(line, String(fields.total));
  }
  if (fields.total != null) return applyTotalEdit(line, String(fields.total));
  if (fields.unitPrice != null) return applyUnitPriceEdit(line, String(fields.unitPrice));
  return line;
}
