/**
 * Canton API (BFF mode)
 *
 * Client requirements:
 * - Frontend MUST NOT call Canton JSON API directly
 * - Frontend MUST NOT store Canton JWTs or refresh tokens
 *
 * All ledger operations go through our backend:
 * - /api/onboarding/* (external-party onboarding)
 * - /api/ledger/* (ledger proxy)
 * - /api/orderbooks/* (global order book views)
 */

import { getOrCreateUserId } from './userId';
import { loadWallet, decryptPrivateKey, signMessage, bytesToBase64 } from '../wallet/keyManager';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

async function bffFetch(path, options = {}) {
  const partyId = typeof localStorage !== 'undefined'
    ? localStorage.getItem('canton_party_id')
    : null;
  const wallet = loadWallet();
  const publicKeyBase64 = wallet?.publicKey ? bytesToBase64(wallet.publicKey) : null;

  const headers = {
    'Content-Type': 'application/json',
    'x-user-id': getOrCreateUserId(),
    ...(partyId ? { 'x-party-id': partyId } : {}),
    ...(publicKeyBase64 ? { 'x-public-key': publicKeyBase64 } : {}),
    ...(options.headers || {}),
  };

  return fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });
}

async function getChallenge() {
  const res = await bffFetch('/ledger/challenge', { method: 'GET' });
  if (!res.ok) throw new Error(`Failed to get challenge: ${res.status} ${res.statusText}`);
  return res.json();
}

async function signBackendChallenge(challenge) {
  const wallet = loadWallet();
  if (!wallet) throw new Error('Wallet not found. Please create/import wallet again.');

  // MVP: prompt for password at time of signing (wallet remains non-custodial)
  const password = window.prompt('Unlock wallet to sign this action (password):');
  if (!password) throw new Error('Wallet signing cancelled.');

  const privateKey = await decryptPrivateKey(wallet.encryptedPrivateKey, password);
  const signatureBase64 = await signMessage(privateKey, utf8ToBase64(challenge));
  return signatureBase64;
}

export async function queryContracts(templateId, _party = null) {
  const res = await bffFetch('/ledger/query-active-contracts', {
    method: 'POST',
    body: JSON.stringify({ templateId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Query failed: ${res.status}`);
  return data.contracts || [];
}

export async function queryContractsAtOffset(templateId, _party = null, offset = '0') {
  const res = await bffFetch('/ledger/query-active-contracts', {
    method: 'POST',
    body: JSON.stringify({ templateId, offset }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Query failed: ${res.status}`);
  return data.contracts || [];
}

export async function fetchContract(contractId, _party = null, offset = null) {
  const res = await bffFetch('/ledger/fetch-contract', {
    method: 'POST',
    body: JSON.stringify({ contractId, offset }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Fetch failed: ${res.status}`);
  return data.contract;
}

export async function fetchContracts(contractIds, _party = null, offset = null) {
  const res = await bffFetch('/ledger/fetch-contracts', {
    method: 'POST',
    body: JSON.stringify({ contractIds, offset }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Fetch failed: ${res.status}`);
  return data.contracts || [];
}

export async function createContract(templateId, payload, _party = null) {
  const { challenge } = await getChallenge();
  const signatureBase64 = await signBackendChallenge(challenge);

  const res = await bffFetch('/ledger/create', {
    method: 'POST',
    body: JSON.stringify({
      templateId,
      createArguments: payload,
      actAs: 'user',
      readAs: 'user',
      challenge,
      signatureBase64,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Create failed: ${res.status}`);
  return data.result;
}

export async function exerciseChoice(contractId, choice, argument, _party = null, templateId = null) {
  const { challenge } = await getChallenge();
  const signatureBase64 = await signBackendChallenge(challenge);

  const res = await bffFetch('/ledger/exercise', {
    method: 'POST',
    body: JSON.stringify({
      templateId: templateId || 'UNKNOWN:UNKNOWN',
      contractId,
      choice,
      choiceArgument: argument ?? {},
      actAs: 'user',
      readAs: 'user',
      challenge,
      signatureBase64,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Exercise failed: ${res.status}`);
  return data.result;
}

export async function getAvailableTradingPairs(_party = null) {
  const res = await fetch(`${API_BASE_URL}/orderbooks`, { method: 'GET' });
  const json = await res.json().catch(() => ({}));
  const data = json?.data ?? json;
  const orderBooks = data?.orderBooks || [];
  return orderBooks.map((ob) => ob.tradingPair).filter(Boolean);
}

export async function getGlobalOrderBook(tradingPair) {
  // Use aggregated order book endpoint (Milestone 3)
  // Use precision=8 so small prices (e.g. 0.005 vs 0.009) aren't incorrectly merged
  const res = await fetch(`${API_BASE_URL}/orderbooks/${encodeURIComponent(tradingPair)}?aggregate=true&precision=8&depth=50`, { 
    method: 'GET' 
  });
  const json = await res.json().catch(() => ({}));
  const data = json?.data ?? json;
  const ob = data?.orderBook || null;
  if (!ob) return null;
  
  // Handle both aggregated and raw formats
  // Aggregated format has bids/asks with cumulative depth
  // Raw format has buyOrders/sellOrders
  const buyOrders = ob.bids || ob.buyOrders || [];
  const sellOrders = ob.asks || ob.sellOrders || [];
  
  return {
    ...ob,
    buyOrders: buyOrders,
    sellOrders: sellOrders,
    buys: buyOrders, // Alias for compatibility
    sells: sellOrders, // Alias for compatibility
    buyOrdersCount: buyOrders.length,
    sellOrdersCount: sellOrders.length,
  };
}



