// crypto.mjs — token + secret minting. Uses Node's built-in crypto. No deps.

import { randomBytes } from 'node:crypto';

/** 32 random bytes as URL-safe base64. Used for hostToken, memberToken,
 *  request_id, roomSecret, roomId. */
export function token32() {
  return randomBytes(32).toString('base64url');
}

/** Short room id for human-friendly logging. Not security-bearing. */
export function shortRoomId() {
  return randomBytes(6).toString('base64url');
}
