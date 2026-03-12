/**
 * MVP user identity (no Keycloak).
 * Generates a stable anonymous userId stored in localStorage.
 *
 * The backend uses this to map: userId -> { partyId, publicKey }.
 */

const KEY = 'clob_user_id';

export function getOrCreateUserId() {
  let id = null;
  try {
    id = localStorage.getItem(KEY);
  } catch {}

  if (id && typeof id === 'string' && id.trim() !== '') return id;

  const newId = (globalThis.crypto?.randomUUID?.() || `user_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  try {
    localStorage.setItem(KEY, newId);
  } catch {}
  return newId;
}



