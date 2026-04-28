// state.mjs — read/write helpers for local config + session.
//
// Two files under ~/.collab-claw/ :
//
//   config.json   — long-lived user config (display name).
//                   Survives across rooms. Mode 0644.
//
//   session.json  — short-lived state for the *current* room.
//                   Written by `collab-claw host` (host) or `collab-claw join`
//                   (joiner). Deleted on `end` / `leave`. Mode 0600.
//
// Schema versioned so we can evolve later without breaking existing installs.

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_DIR  = join(homedir(), '.collab-claw');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
export const SESSION_PATH = join(CONFIG_DIR, 'session.json');

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(path, obj, mode = 0o600) {
  ensureDir();
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  chmodSync(tmp, mode);
  // atomic-ish rename
  writeFileSync(path, JSON.stringify(obj, null, 2));
  chmodSync(path, mode);
  try { unlinkSync(tmp); } catch {}
}

// ---------- config ----------

export function readConfig() {
  return readJson(CONFIG_PATH) || { v: 1, name: null, defaultRelayPort: 7474 };
}

export function writeConfig(patch) {
  const cur = readConfig();
  const next = { ...cur, ...patch, v: 1 };
  writeJson(CONFIG_PATH, next, 0o644);
  return next;
}

export function getName() {
  const cfg = readConfig();
  return cfg.name || null;
}

export function setName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('name must be a non-empty string');
  }
  if (!/^[A-Za-z0-9_\- ]{1,32}$/.test(name)) {
    throw new Error('name must be 1-32 chars, alphanumeric/space/_/-');
  }
  return writeConfig({ name: name.trim() });
}

// ---------- session ----------

/**
 * @typedef {Object} HostSession
 * @property {1} v
 * @property {"host"} mode
 * @property {string} roomId
 * @property {string} roomSecret  - shared in URL fragment for pairing
 * @property {string} hostToken   - bearer for host-only relay endpoints
 * @property {string} relayUrl    - e.g. http://192.168.1.42:7474
 * @property {string} hostName
 * @property {string} createdAt
 * @property {number} relayPid
 */

/**
 * @typedef {Object} JoinerSession
 * @property {1} v
 * @property {"joiner"} mode
 * @property {string} roomId
 * @property {string} memberToken - bearer for member endpoints
 * @property {string} memberId
 * @property {string} relayUrl
 * @property {string} name
 * @property {string} createdAt
 */

export function readSession() {
  return readJson(SESSION_PATH);
}

/** @param {HostSession|JoinerSession} session */
export function writeSession(session) {
  if (!session || !session.mode) throw new Error('session.mode required');
  const next = { v: 1, ...session, createdAt: session.createdAt || new Date().toISOString() };
  writeJson(SESSION_PATH, next, 0o600);
  return next;
}

export function clearSession() {
  if (existsSync(SESSION_PATH)) {
    try { unlinkSync(SESSION_PATH); } catch {}
  }
}

export function isHosting() {
  const s = readSession();
  return !!s && s.mode === 'host' && s.roomId;
}

export function isJoined() {
  const s = readSession();
  return !!s && s.mode === 'joiner' && s.roomId;
}
