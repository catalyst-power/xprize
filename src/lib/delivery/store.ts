/**
 * App-side last-delivery store for pre-fill.
 *
 * v0.1 stopgap: persists the most recent delivery per user DID in an
 * httpOnly cookie (small, same-origin, no server storage needed).
 * When a kernel "recent lots by supplier" read endpoint exists, this
 * should be replaced by a server-side fetch.
 *
 * Cookie name: af_last_delivery_<did_hash>
 * TTL: 30 days
 */

import { cookies } from 'next/headers';

const COOKIE_PREFIX = 'af_last_delivery_';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export interface LastDelivery {
  customer: string;
  commodity: string;
  unit: string;
  quantity: number;
  date: string; // ISO date string (YYYY-MM-DD)
}

function cookieName(userDid: string): string {
  // Simple hash to keep cookie name short and valid
  let hash = 0;
  for (let i = 0; i < userDid.length; i++) {
    const char = userDid.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `${COOKIE_PREFIX}${Math.abs(hash).toString(36)}`;
}

export async function getLastDelivery(userDid: string): Promise<LastDelivery | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(cookieName(userDid))?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LastDelivery;
  } catch {
    return null;
  }
}

export async function setLastDelivery(userDid: string, delivery: LastDelivery): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set({
    name: cookieName(userDid),
    value: JSON.stringify(delivery),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}
