/**
 * Token safety service
 *
 * Centralised service that validates input token mints against a variety of
 * heuristics to prevent scams and honeypots. This service caches results
 * locally to avoid hammering RPCs and supports allow/deny lists via
 * the TokenSafetyList table. Consumers should call `checkToken` prior to
 * executing any swap. The returned verdict may be one of:
 *   - "allow": token passes all checks
 *   - "warn": potential issue (e.g. high transfer fee); user may override
 *   - "block": hard failure (e.g. freeze authority not renounced)
 *
 * Reasons array explains why a verdict was reached. UIs should present
 * reasons to users to help them make informed decisions.
 */

const prisma = require('../../prisma/prisma');
const { Connection, PublicKey } = require('@solana/web3.js');

// Simple in-memory cache for verdicts. Keyed by mint.
const cache = new Map(); // mint → { verdict, reasons, expiresAt }

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');
const CACHE_TTL_MS = parseInt(process.env.TOKEN_SAFETY_CACHE_MS, 10) || 10 * 60 * 1000;

async function fetchTokenInfo(mint) {
  // Query on-chain metadata; simplified placeholder. Real implementation would
  // fetch via RPC and metadata program.
  try {
    const pub = new PublicKey(mint);
    const mintAccount = await connection.getParsedAccountInfo(pub);
    if (!mintAccount || !mintAccount.value) throw new Error('Mint not found');
    const data = mintAccount.value.data;
    // Extract some fields for heuristics
    const decimals = data.parsed.info.decimals;
    const supply = parseFloat(data.parsed.info.supply);
    const freezeAuthority = data.parsed.info.freezeAuthority;
    return { decimals, supply, freezeAuthority };
  } catch (err) {
    return null;
  }
}

function getCached(mint) {
  const entry = cache.get(mint);
  if (entry && entry.expiresAt > Date.now()) return entry;
  return null;
}

function setCached(mint, verdict, reasons) {
  cache.set(mint, { verdict, reasons, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Check a token mint for safety. Performs allow/deny lookups, on-chain
 * verification and heuristics. Returns { verdict, reasons }.
 *
 * @param {string} mint
 */
async function checkToken(mint) {
  // Hard-coded stablecoins may be allowed by default
  const STABLES = [
    'So11111111111111111111111111111111111111112', // SOL (wrapped)
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  ];
  if (STABLES.includes(mint)) return { verdict: 'allow', reasons: [] };
  // Cached?
  const cached = getCached(mint);
  if (cached) return { verdict: cached.verdict, reasons: cached.reasons };
  // Check allow/deny lists
  const listEntry = await prisma.tokenSafetyList.findUnique({ where: { mint } });
  if (listEntry) {
    if (listEntry.status === 'deny') {
      setCached(mint, 'block', [listEntry.reason || 'Token denied']);
      return { verdict: 'block', reasons: [listEntry.reason || 'Token denied'] };
    }
    if (listEntry.status === 'allow') {
      setCached(mint, 'allow', []);
      return { verdict: 'allow', reasons: [] };
    }
  }
  // On-chain checks
  const info = await fetchTokenInfo(mint);
  const reasons = [];
  let verdict = 'allow';
  if (!info) {
    verdict = 'block';
    reasons.push('Mint not found');
  } else {
    if (info.decimals < 0 || info.decimals > 12) {
      verdict = 'block';
      reasons.push('Unusual decimals');
    }
    if (info.supply < 1000) {
      verdict = 'warn';
      reasons.push('Low supply');
    }
    if (info.freezeAuthority) {
      verdict = 'block';
      reasons.push('Freeze authority not renounced');
    }
  }
  setCached(mint, verdict, reasons);
  return { verdict, reasons };
}

module.exports = { checkToken };