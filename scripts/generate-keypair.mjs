#!/usr/bin/env node
/**
 * scripts/generate-keypair.mjs
 *
 * One-time script: generate an Ed25519 keypair for AgriFortress app registration.
 * Run with:  node scripts/generate-keypair.mjs
 *
 * Outputs:
 *   - publicKey  → supply when registering via https://imajin.ai/auth/developer/apps
 *   - privateKey → add to .env.local as APP_PRIVATE_KEY (never committed, never sent to the server)
 *
 * After registration you'll also receive:
 *   - APP_ID    (app_xxx)          → used to construct the consent URL
 *   - APP_DID   (did:imajin:xxx)   → shown in the developer UI and registration response
 */

import * as ed from '@noble/ed25519';

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

const secretKey = ed.utils.randomSecretKey();
const publicKey = await ed.getPublicKeyAsync(secretKey);

const privateKeyHex = bytesToHex(secretKey);
const publicKeyHex  = bytesToHex(publicKey);

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';

console.log(`\n${BOLD}=== AgriFortress keypair generation ===${RESET}\n`);

console.log(`${CYAN}Step 1 — Register the app${RESET}`);
console.log('  Go to: https://imajin.ai/auth/developer/apps');
console.log('');
console.log(`  ${YELLOW}Important:${RESET} the Callback URL is baked into the registration.`);
console.log('  Register ONCE per deployment target (dev and prod need separate APP_IDs):');
console.log('');
console.log(`    ${BOLD}Dev registration${RESET}`);
console.log('      Name:         AgriFortress (dev)');
console.log('      Callback URL: https://dev-integrity.imajin.ai/api/auth/callback');
console.log('      Scopes:       supply:read, supply:write, profile:read, media:read, media:write, quickbooks:read, quickbooks:write');
console.log(`      Public Key:   ${GREEN}${publicKeyHex}${RESET}`);
console.log('');
console.log(`    ${BOLD}Prod registration${RESET}  ${YELLOW}(separate entry, same public key is fine)${RESET}`);
console.log('      Name:         AgriFortress');
console.log('      Callback URL: https://integrity.imajin.ai/api/auth/callback');
console.log('      Scopes:       supply:read, supply:write, profile:read, media:read, media:write, quickbooks:read, quickbooks:write');
console.log(`      Public Key:   ${GREEN}${publicKeyHex}${RESET}`);
console.log('');

console.log(`${CYAN}Step 2 — Add to .env.local${RESET}`);
console.log('  (Keep secret — never commit this file)\n');
console.log(`  ${BOLD}APP_PRIVATE_KEY${RESET}=${RED}${privateKeyHex}${RESET}`);
console.log('');
console.log('  From the registration response, also add:');
console.log('  APP_ID=<app_xxx>            # registry ID, used in the consent URL');
console.log('  APP_DID=<did:imajin:xxx>    # DID derived from your public key');
console.log('');
console.log(`${RED}${BOLD}⚠  Save the private key now — it will not be shown again.${RESET}`);
console.log('');
