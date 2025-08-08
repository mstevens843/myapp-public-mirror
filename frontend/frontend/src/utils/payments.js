// utils/payments.js
//
// Centralised helpers for interacting with the backend payment API. This file
// contains wrappers around the various HTTP endpoints used for managing
// subscriptions, purchasing credits, adding payment methods, and now for
// paying with USDC on Solana. Each function handles authentication via
// `authFetch`, parses JSON responses and returns a normalised object or
// boolean depending on success.

import { authFetch } from '@/utils/authFetch';

/**
 * POST /api/payment/create-setup-intent
 * Initialise the card setup flow by obtaining a client secret from Stripe.
 */
export async function createSetupIntent() {
  try {
    const res = await authFetch('/api/payment/create-setup-intent', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      console.error('❌ Failed to create setup intent:', data?.error);
      return null;
    }
    return data; // { clientSecret }
  } catch (err) {
    console.error('❌ createSetupIntent error:', err.message);
    return null;
  }
}

/**
 * POST /api/payment/create-checkout-session
 * Kick off a Stripe Checkout session for a subscription plan or credit purchase.
 */
export async function createCheckoutSession(plan, amount) {
  try {
    const res = await authFetch('/api/payment/create-checkout-session', {
      method: 'POST',
      body: JSON.stringify({ plan, amount }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error('❌ Invalid JSON in checkout response:', text);
      return null;
    }
    if (!res.ok) {
      console.error('❌ Failed to create checkout session:', data?.error || text);
      return null;
    }
    return data; // { sessionId }
  } catch (err) {
    console.error('❌ createCheckoutSession error:', err.message);
    return null;
  }
}

/**
 * GET /api/payment/subscription-status
 * Retrieve the current subscription plan, usage, limit and credits for the user.
 */
export async function getSubscriptionStatus() {
  try {
    const res = await authFetch('/api/payment/subscription-status');
    if (!res.ok) throw new Error('Failed to fetch subscription status');
    return await res.json();
  } catch (err) {
    console.error('❌ getSubscriptionStatus error:', err.message);
    return null;
  }
}

/**
 * POST /api/payment/change-plan
 * Change the active subscription plan. Returns { success: true, newPlan } on success.
 */
export async function changeSubscriptionPlan(newPlan) {
  try {
    const res = await authFetch('/api/payment/change-plan', {
      method: 'POST',
      body: JSON.stringify({ newPlan }),
    });
    if (!res.ok) throw new Error('Failed to change subscription plan');
    return await res.json();
  } catch (err) {
    console.error('❌ changeSubscriptionPlan error:', err.message);
    return null;
  }
}

/**
 * GET /api/payment/get-payment-method
 * Get the default saved card details for the user, or null if none exists.
 */
export async function getPaymentMethod() {
  try {
    const res = await authFetch('/api/payment/get-payment-method');
    if (!res.ok) throw new Error('Failed to fetch payment method');
    return await res.json();
  } catch (err) {
    console.error('❌ getPaymentMethod error:', err.message);
    return null;
  }
}

/**
 * POST /api/payment/call-birdeye
 * Make a test API call that counts against the user’s compute unit quota.
 */
export async function callBirdeye() {
  try {
    const res = await authFetch('/api/payment/call-birdeye', { method: 'POST' });
    if (!res.ok) throw new Error('Birdeye call failed');
    return await res.json();
  } catch (err) {
    console.error('❌ callBirdeye error:', err.message);
    return null;
  }
}

/**
 * POST /api/payment/delete-payment-method
 * Remove the user’s default payment method from Stripe. Returns boolean for success.
 */
export async function deletePaymentMethod() {
  const res = await authFetch('/api/payment/delete-payment-method', { method: 'POST' });
  return res.ok;
}

/**
 * POST /api/payment/cancel-subscription
 * Request cancellation of the active subscription at period end. Returns { success }
 */
export async function cancelSubscription() {
  try {
    const res = await authFetch('/api/payment/cancel-subscription', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to cancel subscription');
    return await res.json();
  } catch (err) {
    console.error('❌ cancelSubscription error:', err.message);
    return null;
  }
}

/**
 * POST /api/payment/uncancel
 * Reverse a pending subscription cancellation. Returns { success }
 */
export async function uncancelSubscription() {
  try {
    const res = await authFetch('/api/payment/uncancel', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to uncancel subscription');
    return await res.json();
  } catch (err) {
    console.error('❌ uncancelSubscription error:', err.message);
    return null;
  }
}

/**
 * POST /api/payment/create-solana-session
 * Create a payment session for paying with USDC on Solana. Pass either a
 * plan (standard|pro) or 'credits' with an amount. Returns { sessionId, publicKey, amountUSD, plan }.
 */
export async function createSolanaSession(plan, amount) {
  try {
    const body = { plan };
    if (amount !== undefined) body.amount = amount;
    const res = await authFetch('/api/payment/create-solana-session', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error('❌ Failed to create Solana session:', data?.error);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error('❌ createSolanaSession error:', err.message);
    return null;
  }
}

/**
 * POST /api/payment/verify-solana-session
 * Verify a previously created Solana payment session. If successful, the
 * server will update the user’s plan or credit balance accordingly. Returns
 * { success: boolean, message }.
 */
export async function verifySolanaSession(sessionId) {
  try {
    const res = await authFetch('/api/payment/verify-solana-session', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error('❌ Failed to verify Solana session:', data?.error);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error('❌ verifySolanaSession error:', err.message);
    return null;
  }
}