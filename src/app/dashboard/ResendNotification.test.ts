import { describe, it, expect } from 'vitest';
import { resendResultMessage } from './ResendNotification';

describe('resendResultMessage', () => {
  it('reports the skip reason when the recipient already signed', () => {
    expect(resendResultMessage({ skipped: true, reason: 'Recipient has already signed.' })).toBe(
      'Recipient has already signed.',
    );
  });

  it('falls back to a default skip message when no reason is given', () => {
    expect(resendResultMessage({ skipped: true })).toBe('Already signed \u2014 no reminder needed.');
  });

  it('surfaces the error message on failure', () => {
    expect(resendResultMessage({ error: 'chat.messages.send failed: 403 Soft DID' })).toBe(
      'chat.messages.send failed: 403 Soft DID',
    );
  });

  it('notes a failed invite resend alongside a successful notification', () => {
    expect(resendResultMessage({ notified: true, inviteSent: true, inviteFailed: true })).toBe(
      'Notification resent. Invite could not be resent \u2014 share the invite link directly.',
    );
  });

  it('reports both the notification and invite resent when both succeed', () => {
    expect(resendResultMessage({ notified: true, inviteSent: true, inviteFailed: false })).toBe(
      'Notification and invite resent.',
    );
  });

  it('reports just the notification when no invite was needed', () => {
    expect(resendResultMessage({ notified: true, inviteSent: false, inviteFailed: false })).toBe(
      'Notification resent.',
    );
  });
});
