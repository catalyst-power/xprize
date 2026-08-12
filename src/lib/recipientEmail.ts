/**
 * Free-form email recipient validation for the delivery card (xprize#86:
 * "invite a recipient who isn't on Imajin at all, via email").
 *
 * Shared between the client (`DeliveryGesture.tsx`, gating the confirm
 * gesture) and the server (`/api/connections/invite` route), so an
 * malformed address is rejected the same way on both sides — the client
 * check is a UX nicety, never the only gate before a kernel round trip.
 *
 * Deliberately simple (RFC 5322 is not fully implemented) — good enough to
 * catch typos/garbage before it reaches the kernel's invite-create, not a
 * full validator.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidRecipientEmail(value: string | undefined): boolean {
  if (value === undefined) return false;
  return EMAIL_PATTERN.test(value.trim());
}
