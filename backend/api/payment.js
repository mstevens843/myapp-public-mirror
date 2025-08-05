/*
 * payment.js
 *
 * This Express router extends the existing payment endpoints by adding support
 * for accepting subscription and credit payments in USD Coin (USDC) on the
 * Solana blockchain. Users can now choose to pay for plans or compute unit
 * credits via a USDC transfer in addition to the existing Stripe-based
 * checkout. The Solana integration uses an in‑memory session store to
 * generate unique deposit addresses per purchase and verifies on‑chain
 * payments using the configured RPC endpoint. When a payment is detected,
 * the user’s plan or credit balance is updated accordingly.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const express = require('express');
const Stripe = require('stripe');
const prisma = require('../prisma/prisma');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
// Use nanoid instead of uuid: nanoid is lightweight and already installed
// const { nanoid } = require('nanoid');
const nacl = require('tweetnacl');
const bs58 = require('bs58');

// Initialise Stripe for card payments
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Plan limits define the monthly compute unit quota per plan
const PLAN_LIMITS = {
  free: 100_000,
  standard: 600_000,
  pro: 1_500_000,
};

/*
 * ────────────────────────────────────────────────────────────────────────────
 *  Solana USDC Payment Integration
 *
 * For users who wish to pay using USDC on Solana, we generate a new keypair
 * (deposit address) per payment session and store it in memory until it is
 * confirmed. The USDC mint address is configurable via the environment
 * variable `SOLANA_USDC_MINT`, defaulting to the canonical USDC mint on
 * mainnet. The Solana RPC endpoint is configured via `SOLANA_RPC_URL`.
 */

const USDC_MINT = process.env.SOLANA_USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// In‑memory store of pending solana payment sessions keyed by sessionId
// Each entry holds: { userId, plan, amountUSD, publicKey, secretKey, status }
const solanaSessions = new Map();

/**
 * Helper: fetch the USDC token balance for a given Solana public key
 *
 * This function calls the RPC method `getTokenAccountsByOwner` to retrieve
 * all SPL token accounts owned by the provided address filtered by the USDC
 * mint. It then sums the `uiAmount` of each account to compute the total
 * balance in USDC. A JSON‑RPC request is used instead of the `@solana/web3.js`
 * library to avoid adding large dependencies.
 *
 * @param {string} ownerPublicKey base58 encoded owner address
 * @returns {Promise<number>} total USDC balance for the owner (uiAmount)
 */
async function getUsdcBalance(ownerPublicKey) {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'getTokenAccountsByOwner',
    params: [
      ownerPublicKey,
      { mint: USDC_MINT },
      { encoding: 'jsonParsed' }
    ]
  };

  const response = await fetch(SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`RPC request failed with status ${response.status}`);
  }

  const data = await response.json();
  if (!data || !data.result) return 0;
  const accounts = data.result.value;
  let total = 0;
  for (const acc of accounts) {
    const tokenAmount = acc.account.data.parsed.info.tokenAmount;
    // uiAmount may be a float; guard against null/undefined
    const amt = Number(tokenAmount.uiAmount || 0);
    total += amt;
  }
  return total;
}

/**
 * POST /create-solana-session
 *
 * Create a new payment session for paying with USDC on Solana. A unique
 * deposit address is generated for the user and returned along with the
 * amount to send. The user should transfer USDC to this address and then
 * call the verification endpoint. For subscription plans, the price is
 * fixed ($20 for standard, $50 for pro). For credit purchases, the caller
 * must specify an amount in USD.
 *
 * Request body: { plan: 'standard'|'pro'|'credits', amount?: number }
 * Response: { sessionId, publicKey, amountUSD, plan }
 */
router.post('/create-solana-session', requireAuth, async (req, res) => {
  try {
    const { nanoid } = await import('nanoid');

    const { plan, amount } = req.body;
    const userId = req.user.id;

    if (!plan || !['standard', 'pro', 'credits'].includes(plan)) {
      return res.status(400).json({ error: `Invalid plan for Solana payment: ${plan}` });
    }

    // Determine USD amount based on plan or provided amount
    let amountUSD;
    if (plan === 'standard') {
      amountUSD = 20;
    } else if (plan === 'pro') {
      amountUSD = 50;
    } else if (plan === 'credits') {
      if (!amount || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Amount must be a positive number when buying credits' });
      }
      amountUSD = Number(amount);
    }

    // Generate a new Solana keypair for this payment session
    const keypair = nacl.sign.keyPair();
    const publicKey = bs58.encode(Buffer.from(keypair.publicKey));
    const secretKey = bs58.encode(Buffer.from(keypair.secretKey));
    // Generate a unique session ID
    const sessionId = nanoid(12);

    // Persist session in memory
    solanaSessions.set(sessionId, {
      userId,
      plan,
      amountUSD,
      publicKey,
      secretKey,
      status: 'pending',
      createdAt: new Date()
    });

    console.log(`🪙 Created Solana payment session ${sessionId} for user ${userId} (${plan}, $${amountUSD}) → deposit address ${publicKey}`);
    return res.json({ sessionId, publicKey, amountUSD, plan });
  } catch (err) {
    console.error('❌ Failed to create Solana session:', err);
    return res.status(500).json({ error: 'Failed to create Solana payment session' });
  }
});

/**
 * POST /verify-solana-session
 *
 * Verify that the user has sent the required amount of USDC to the deposit
 * address associated with the given session ID. If the payment is found,
 * the user’s subscription plan or credit balance is updated accordingly. The
 * session status is then marked as paid and removed from the in‑memory store.
 *
 * Request body: { sessionId: string }
 * Response: { success: true, message }
 */
router.post('/verify-solana-session', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = req.user.id;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    const session = solanaSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Solana session not found or already verified' });
    }
    if (session.userId !== userId) {
      return res.status(403).json({ error: 'This session does not belong to the authenticated user' });
    }

    // Query Solana RPC for the USDC balance of the deposit address
    let balance;
    try {
      balance = await getUsdcBalance(session.publicKey);
    } catch (rpcErr) {
      console.error('❌ RPC error while checking USDC balance:', rpcErr);
      return res.status(500).json({ error: 'Failed to verify payment on Solana' });
    }

    console.log(`🔍 Verifying Solana session ${sessionId}: balance ${balance} USDC, required ${session.amountUSD} USDC`);
    if (balance < session.amountUSD) {
      return res.status(200).json({ success: false, message: 'Payment not yet detected or insufficient USDC received.' });
    }

    // Payment has been received; update user accordingly
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (session.plan === 'standard' || session.plan === 'pro') {
      const plan = session.plan;
      const newUsageResetAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await prisma.user.update({
        where: { id: userId },
        data: {
          plan,
          subscriptionStatus: 'active',
          usage: 0,
          usageResetAt: newUsageResetAt,
        },
      });
      console.log(`✅ User ${userId} upgraded to ${plan} via Solana payment`);
    } else if (session.plan === 'credits') {
      // Each dollar buys 30k compute units (based on 600k CU for $20)
      const creditsToAdd = session.amountUSD * 30_000;
      await prisma.user.update({
        where: { id: userId },
        data: {
          credits: { increment: creditsToAdd },
        },
      });
      console.log(`✅ Added ${creditsToAdd} CU credits to user ${userId} via Solana payment`);
    }

    // Optionally, mark session as paid and remove from the store
    solanaSessions.delete(sessionId);
    return res.json({ success: true, message: 'Payment verified and account updated.' });
  } catch (err) {
    console.error('❌ Failed to verify Solana session:', err);
    return res.status(500).json({ error: 'Failed to verify Solana payment session' });
  }
});

/*
 * ────────────────────────────────────────────────────────────────────────────
 *  Existing Stripe and subscription endpoints
 *
 * The remainder of this file retains the original Stripe subscription and
 * payment logic provided in the earlier implementation. Only minimal edits
 * were made to integrate with the Solana endpoints. These routes manage
 * subscription creation, plan changes, payment method management, credit
 * purchases and webhook handling.
 */

// Helper middleware: Enforce per-user monthly quota
async function checkQuota(req, res, next) {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, plan: true, usage: true, credits: true },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const plan = user.plan?.toLowerCase() || 'free';
    const quota = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    if (user.usage >= quota) {
      if (user.credits <= 0) {
        console.log(`🚨 User ${user.id} exceeded quota and has no credits.`);
        return res.status(403).json({ error: 'Quota and credits exhausted' });
      }
      // deduct 1 CU from credits
      await prisma.user.update({
        where: { id: userId },
        data: { credits: { decrement: 1 } },
      });
    } else {
      // increment usage
      await prisma.user.update({
        where: { id: userId },
        data: { usage: { increment: 1 } },
      });
    }
    const THRESHOLD = 0.9;
    if (user.usage / quota >= THRESHOLD) {
      console.log(`⚠️ User ${user.id} has used ${Math.round((user.usage / quota) * 100)}% of quota`);
    }
    req.user = user;
    next();
  } catch (err) {
    console.error(`❌ Quota check error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /subscription-status
router.get('/subscription-status', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const limit = PLAN_LIMITS[user.plan || 'free'] || PLAN_LIMITS.free;
    res.json({
      plan: user.plan || 'free',
      subscriptionStatus: user.subscriptionStatus || 'inactive',
      usage: user.usage,
      limit,
      credits: user.credits ?? 0,
    });
  } catch (err) {
    console.error(`❌ Failed to get subscription status: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /create-checkout-session (Stripe)
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  // Accept amount when purchasing additional credits
  const { plan, amount } = req.body;
  const userId = req.user.id;
  console.log(`📝 Checkout session requested for plan: ${plan} by user ${userId}`);
  if (!['standard', 'pro', 'credits'].includes(plan)) {
    return res.status(400).json({ error: `Invalid plan selected: ${plan}` });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Handle one‑time credit purchases separately
    if (plan === 'credits') {
      const amountNumber = Number(amount);
      if (!amountNumber || isNaN(amountNumber) || amountNumber <= 0) {
        return res.status(400).json({ error: 'Amount must be a positive number when buying credits' });
      }
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: { name: 'Prepaid Credits' },
              unit_amount: Math.round(amountNumber * 100),
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        customer_email: req.user.email,
        success_url: `${process.env.FRONTEND_URL}/payment-success`,
        cancel_url: `${process.env.FRONTEND_URL}/payment-cancel`,
      });
      console.log(
        `✅ Credit purchase session created: ${session.id} for user ${userId} (amount $${amountNumber})`
      );
      return res.json({ sessionId: session.id });
    }

    // Otherwise handle subscription plans (standard/pro)
    const priceId =
      plan === 'pro'
        ? process.env.STRIPE_PRICE_PRO
        : process.env.STRIPE_PRICE_STANDARD;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      client_reference_id: userId,
      customer: user.stripeCustomerId || undefined,
      metadata: { plan },
      success_url: `${process.env.FRONTEND_URL}/payment-success`,
      cancel_url: `${process.env.FRONTEND_URL}/payment-cancel`,
    });
    console.log(`✅ Checkout session created: ${session.id} for user ${userId}`);
    res.json({ sessionId: session.id });
  } catch (err) {
    console.error(`❌ Failed to create checkout session: ${err.message}`);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Stripe webhook endpoint
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_ENDPOINT_SECRET;
  console.log('📬 Incoming webhook…');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log(`✅ Webhook verified: ${event.type}`);
  } catch (err) {
    console.error(`❌ Webhook signature error: ${err.message}`);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        console.log(`🔗 Checkout completed for user ${userId} → customer ${customerId}, subscription ${subscriptionId}`);
        const plan = session.metadata?.plan || 'standard';
        await prisma.user.update({
          where: { id: userId },
          data: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            plan,
            subscriptionStatus: 'active',
          },
        });
        console.log(`✅ Saved customer, subscription, and updated plan (${plan}) for user ${userId}`);
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const user = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } });
        if (!user) {
          console.warn(`⚠️ No user found for customer ${customerId}`);
          return res.status(200).send('No user yet, retry later');
        }
        const lineItem = invoice.lines.data[0];
        const priceId = lineItem.price.id;
        let plan = 'free';
        if (priceId === process.env.STRIPE_PRICE_STANDARD) plan = 'standard';
        if (priceId === process.env.STRIPE_PRICE_PRO) plan = 'pro';
        await prisma.user.update({
          where: { id: user.id },
          data: {
            subscriptionStatus: 'active',
            plan,
            usage: 0,
            usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
        console.log(`✅ User ${user.id} updated after payment`);
        break;
      }
      default:
        console.log(`ℹ️ Unhandled event: ${event.type}`);
    }
    res.status(200).send('Success');
  } catch (err) {
    console.error(`❌ Webhook error: ${err.message}`);
    res.status(500).send('Internal server error');
  }
});

// POST /change-plan
router.post('/change-plan', requireAuth, async (req, res) => {
  const { newPlan } = req.body;
  const userId = req.user.id;
  console.log(`🔄 Change plan requested: ${newPlan} by user ${userId}`);
  if (!['standard', 'pro'].includes(newPlan)) {
    return res.status(400).json({ error: `Invalid plan: ${newPlan}` });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!user.subscriptionStatus || user.subscriptionStatus !== 'active' || !user.stripeSubscriptionId) {
      return res.status(400).json({ error: 'No active subscription to change' });
    }
    const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    const subscriptionItemId = subscription.items.data[0]?.id;
    if (!subscriptionItemId) {
      return res.status(400).json({ error: 'Could not determine subscription item' });
    }
    const priceId = newPlan === 'pro' ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_STANDARD;
    await stripe.subscriptions.update(user.stripeSubscriptionId, {
      items: [{ id: subscriptionItemId, price: priceId }],
    });
    await prisma.user.update({ where: { id: userId }, data: { plan: newPlan } });
    console.log(`✅ Plan changed to ${newPlan} for user ${userId}`);
    res.json({ success: true, newPlan });
  } catch (err) {
    console.error(`❌ Change plan error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /get-payment-method
router.get('/get-payment-method', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.stripeCustomerId) {
      return res.json(null);
    }
    const paymentMethods = await stripe.paymentMethods.list({ customer: user.stripeCustomerId, type: 'card' });
    const card = paymentMethods.data[0];
    if (!card) return res.json(null);
    res.json({
      brand: card.card.brand,
      last4: card.card.last4,
      exp_month: card.card.exp_month,
      exp_year: card.card.exp_year,
    });
  } catch (err) {
    console.error(`❌ Failed to get payment method: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /purchase-credits (Stripe)
router.post('/purchase-credits', requireAuth, async (req, res) => {
  const { amount } = req.body; // in dollars
  const userId = req.user.id;
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: 'Prepaid Credits' },
          unit_amount: amount * 100,
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    customer_email: req.user.email,
    success_url: `${process.env.FRONTEND_URL}/payment-success`,
    cancel_url: `${process.env.FRONTEND_URL}/payment-cancel`,
  });
  res.json({ sessionId: session.id });
});

// POST /create-setup-intent
router.post('/create-setup-intent', requireAuth, async (req, res) => {
  try {
    let user = await prisma.user.findUnique({ where: { id: req.user.id } });
    let customerId = user?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } });
      customerId = customer.id;
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
    }
    const setupIntent = await stripe.setupIntents.create({ customer: customerId, payment_method_types: ['card'] });
    res.json({ clientSecret: setupIntent.client_secret });
  } catch (err) {
    console.error(`❌ Failed to create SetupIntent: ${err.message}`);
    res.status(500).send('Internal server error');
  }
});

// POST /delete-payment-method
router.post('/delete-payment-method', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.stripeCustomerId) {
      return res.status(400).json({ error: 'No Stripe customer ID on file' });
    }
    const paymentMethods = await stripe.paymentMethods.list({ customer: user.stripeCustomerId, type: 'card' });
    const card = paymentMethods.data[0];
    if (!card) {
      return res.status(404).json({ error: 'No card on file' });
    }
    await stripe.paymentMethods.detach(card.id);
    res.json({ success: true });
  } catch (err) {
    console.error(`❌ Failed to delete card: ${err.message}`);
    res.status(500).send('Internal server error');
  }
});

// POST /cancel-subscription
router.post('/cancel-subscription', requireAuth, async (req, res) => {
  const userId = req.user.id;
  console.log(`🔴 Cancel subscription requested by user ${userId}`);
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!user.subscriptionStatus || user.subscriptionStatus !== 'active' || !user.stripeSubscriptionId) {
      return res.status(400).json({ error: 'No active subscription to cancel' });
    }
    await stripe.subscriptions.update(user.stripeSubscriptionId, { cancel_at_period_end: true });
    await prisma.user.update({ where: { id: userId }, data: { subscriptionStatus: 'cancelling' } });
    console.log(`✅ Subscription for user ${userId} marked as cancelling`);
    res.json({ success: true, message: 'Subscription will be cancelled at the end of the current billing period.' });
  } catch (err) {
    console.error(`❌ Cancel subscription error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /uncancel
router.post('/uncancel', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.stripeSubscriptionId) {
      return res.status(404).json({ error: 'No active subscription found' });
    }
    await stripe.subscriptions.update(user.stripeSubscriptionId, { cancel_at_period_end: false });
    await prisma.user.update({ where: { id: userId }, data: { subscriptionStatus: 'active' } });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ uncancelSubscription error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;