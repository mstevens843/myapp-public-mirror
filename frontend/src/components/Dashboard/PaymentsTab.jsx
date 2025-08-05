// PaymentsTab.jsx
//
// This component renders the payment & subscription settings page. It has been
// extended to support paying for subscriptions or credits using USDC on the
// Solana blockchain. When selecting a plan, users can choose to pay via
// Stripe (card) or via a USDC transfer. For USDC payments, a deposit address
// is generated server‑side and presented to the user along with the amount
// required. The user can then verify the payment, and upon success their plan
// or credits are updated automatically.

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Info, ChevronDown } from 'lucide-react';
import AddPaymentMethod from './PaymentsTab/AddPaymentMethod';
import PlanSelectionCards from './PaymentsTab/PlanSelectionCards';
import { Dialog, DialogTrigger, DialogContent, DialogClose } from '@/components/ui/dialog';
import {
  createCheckoutSession,
  getSubscriptionStatus,
  getPaymentMethod,
  deletePaymentMethod,
  callBirdeye,
  createSetupIntent,
  changeSubscriptionPlan,
  cancelSubscription,
  uncancelSubscription,
  createSolanaSession,
  verifySolanaSession,
} from '@/utils/payments';

const PaymentsTab = () => {
  const [plan, setPlan] = useState('free');
  const [usage, setUsage] = useState(0);
  const [limit, setLimit] = useState(100_000);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [credits, setCredits] = useState(0);
  const [subscriptionStatus, setSubscriptionStatus] = useState('inactive');
  const [showPlansInfo, setShowPlansInfo] = useState(false);
  const [showStripeInfo, setShowStripeInfo] = useState(false);
  const [pendingPlan, setPendingPlan] = useState(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showUncancelDialog, setShowUncancelDialog] = useState(false);
  const [solanaSession, setSolanaSession] = useState(null);
  const [solanaVerifying, setSolanaVerifying] = useState(false);

  // Derived state
  const usageRatio = usage / limit;
  const usagePercent = (usageRatio * 100).toFixed(2);
  const isOverQuota = usage >= limit;
  const isFreeUser = plan === 'free';
  const isOutOfCredits = credits <= 0;
  const isWarning = usageRatio >= 0.9 && !isOverQuota;
  const isCritical = isOverQuota && (isFreeUser || isOutOfCredits);

  const formatCredits = (amount) => {
    if (amount < 0.000001 && amount !== 0) return '<0.000001';
    return Number(amount).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 6,
    });
  };

  useEffect(() => {
    (async () => {
      const status = await getSubscriptionStatus();
      if (status) {
        setPlan(status.plan || 'free');
        setUsage(status.usage || 0);
        setLimit(status.limit || 100_000);
        setSubscriptionStatus(status.subscriptionStatus || 'inactive');
        setCredits(status.credits || 0);
      } else {
        toast.error('Failed to load subscription status.');
      }
      const method = await getPaymentMethod();
      if (method) {
        setPaymentMethod(method);
      } else {
        toast.info('No payment method on file.');
      }
    })();
  }, []);

  /**
   * Stripe checkout for subscription plans. Delegates to Stripe’s hosted
   * checkout flow and redirects the user.
   */
  const handleCheckout = async (selectedPlan) => {
    const session = await createCheckoutSession(selectedPlan);
    if (!session || !session.sessionId) {
      toast.error('Failed to create checkout session.');
      return;
    }
    const stripe = window.Stripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);
    const { error } = await stripe.redirectToCheckout({ sessionId: session.sessionId });
    if (error) {
      toast.error('Stripe redirect failed.');
      console.error(error);
    }
  };

  /**
   * Confirm subscription change via Stripe. If there is an active
   * subscription this will swap the plan; otherwise it kicks off a Stripe
   * checkout flow.
   */
  const handleConfirmChange = async () => {
    if (!pendingPlan) return;
    if (subscriptionStatus === 'active') {
      const ok = await changeSubscriptionPlan(pendingPlan);
      if (ok) {
        toast.success(`Changed plan to ${pendingPlan}`);
        setPlan(pendingPlan);
      } else {
        toast.error('Failed to change subscription plan.');
      }
    } else {
      await handleCheckout(pendingPlan);
    }
    setPendingPlan(null);
  };

  /**
   * Create a Solana payment session for the selected plan. This will
   * request a unique deposit address and amount from the server and then
   * display instructions to the user in a modal.
   *
   * @param {string} selectedPlan plan key (standard, pro)
   */
  const handleSolanaSelectPlan = async (selectedPlan) => {
    const session = await createSolanaSession(selectedPlan);
    if (!session || !session.sessionId) {
      toast.error('Failed to create Solana payment session.');
      return;
    }
    setSolanaSession(session);
    setPendingPlan(null);
  };

  /**
   * Create a Solana payment session for credit purchases (amount in USD).
   * This is similar to handleSolanaSelectPlan but accepts an explicit
   * amount parameter.
   */
  const handleSolanaCheckoutCredits = async (amountUSD) => {
    const session = await createSolanaSession('credits', amountUSD);
    if (!session || !session.sessionId) {
      toast.error('Failed to create Solana payment session.');
      return;
    }
    setSolanaSession(session);
  };

  /**
   * Verify the Solana payment by contacting the server. If the payment is
   * confirmed the user’s plan or credits will be updated automatically.
   */
  const handleVerifySolanaPayment = async () => {
    if (!solanaSession) return;
    setSolanaVerifying(true);
    const result = await verifySolanaSession(solanaSession.sessionId);
    setSolanaVerifying(false);
    if (result?.success) {
      toast.success('Payment verified! Updating your account…');
      const status = await getSubscriptionStatus();
      if (status) {
        setPlan(status.plan || 'free');
        setUsage(status.usage || 0);
        setLimit(status.limit || 100_000);
        setSubscriptionStatus(status.subscriptionStatus || 'inactive');
        setCredits(status.credits || 0);
      }
      setSolanaSession(null);
    } else {
      toast.error(result?.message || 'Payment not found. Please check again.');
    }
  };

  const handlePlanSelect = (selectedPlan) => {
    if (selectedPlan === plan) return;
    setPendingPlan(selectedPlan);
  };

  const handleTestApiCall = async () => {
    const result = await callBirdeye();
    if (result?.success) {
      toast.success('✅ Test API call succeeded. Usage incremented.');
      setUsage((prev) => prev + 1);
    } else {
      toast.error('🚨 Test API call failed or quota exceeded.');
    }
  };

  const handleCheckoutCredits = async (amount) => {
    const session = await createCheckoutSession('credits', amount);
    if (!session || !session.sessionId) {
      toast.error('Failed to create checkout session.');
      return;
    }
    const stripe = window.Stripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);
    const { error } = await stripe.redirectToCheckout({ sessionId: session.sessionId });
    if (error) {
      toast.error('Stripe redirect failed.');
      console.error(error);
    }
  };

  const handleUncancelSubscription = async () => {
    const result = await uncancelSubscription();
    if (result?.success) {
      toast.success('Your subscription cancellation has been reversed.');
      setSubscriptionStatus('active');
    } else {
      toast.error('Failed to uncancel subscription.');
    }
    setShowUncancelDialog(false);
  };

  const handleChangePlan = () => {
    if (plan === 'standard') {
      setPendingPlan('pro');
    } else if (plan === 'pro') {
      setPendingPlan('standard');
    } else {
      setPendingPlan('standard');
    }
  };

  return (
    <div className="container mx-auto p-6 bg-black text-white">
      {/* Info Banner */}
      <div className="bg-emerald-600 text-black p-4 rounded-lg mb-6 flex items-center gap-3">
        <Info size={18} />
        <span className="text-sm">
          <strong>Note:</strong> You'll be paying for API usage. This is part of the beta phase, and no profits will be made. Thanks for supporting the development!
        </span>
      </div>
      <h2 className="text-2xl font-bold mb-4">Payment & Subscription Settings</h2>
      <div className="space-y-4">
        {/* Subscription Plan Card */}
        <div className="bg-zinc-800 text-white p-4 rounded-lg">
          <h3 className="text-lg font-semibold">Subscription Plan</h3>
          <p>
            Your current plan: <span className="text-emerald-400">{plan}</span>
          </p>
          <p className="text-xs text-gray-400 mt-1">
            We now accept crypto payments: pay your subscription or purchase credits with <span className="text-purple-400 font-medium">USDC</span> on Solana.
          </p>
          {subscriptionStatus === 'cancelling' && (
            <p className="text-xs text-yellow-400 mt-1">
              Your subscription is scheduled for cancellation at the end of this billing period.
            </p>
          )}
          <div className="mt-2">
            <label className="block text-sm">Usage Meter</label>
            <div className="bg-zinc-600 rounded-full h-2 mt-1">
              <div
                className="bg-emerald-400 h-2 rounded-full"
                style={{ width: `${Math.min((usage / limit) * 100, 100)}%` }}
              ></div>
            </div>
            <p className="text-xs mt-1">
              Usage: {usage.toLocaleString()} / {limit.toLocaleString()} CU
            </p>
            <p className="text-xs mt-1">Credits remaining: {formatCredits(credits)} CU</p>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={handleChangePlan}
              className="px-3 py-1 text-sm rounded-md border border-emerald-400 text-emerald-400 hover:bg-emerald-600 hover:text-white"
            >
              Change Plan
            </button>
            {/* Hide cancel/uncancel subscription actions for free users, as there is no active subscription to manage. */}
            {plan !== 'free' && (
              <button
                onClick={() => {
                  if (subscriptionStatus === 'cancelling') {
                    setShowUncancelDialog(true);
                  } else {
                    setShowCancelDialog(true);
                  }
                }}
                className="px-3 py-1 text-sm rounded-md text-red-400 hover:text-red-500"
              >
                {subscriptionStatus === 'cancelling' ? 'Uncancel Subscription' : 'Cancel Subscription'}
              </button>
            )}
          </div>
        </div>
        {/* Test call card for free users */}
        {plan === 'free' && (
          <div className="bg-zinc-800 p-4 rounded-lg">
            <h3 className="text-lg font-semibold">Test User</h3>
            <p className="text-sm">
              As a <span className="text-emerald-400">test/free user</span>, you have a monthly limit of <strong>100,000 CU</strong>.
            </p>
            <button
              className="bg-emerald-500 mt-3 px-3 py-1 rounded-md text-sm text-white"
              onClick={handleTestApiCall}
            >
              Test API Call (increments usage)
            </button>
          </div>
        )}
        {/* Payment Methods card and Stripe info toggle */}
        <div className="bg-zinc-800 p-4 rounded-lg flex flex-col md:flex-row md:justify-between md:items-start gap-4">
          <div>
            <h3 className="text-lg font-semibold">Payment Methods</h3>
            {paymentMethod ? (
              <div>
                <p>Card ending in: {paymentMethod.last4}</p>
                <button
                  className="text-red-400 hover:text-red-500"
                  onClick={async () => {
                    const ok = await deletePaymentMethod();
                    if (ok) {
                      toast.success('Payment method removed.');
                      setPaymentMethod(null);
                    } else {
                      toast.error('Failed to remove payment method.');
                    }
                  }}
                >
                  Remove Payment Method
                </button>
              </div>
            ) : (
              <Dialog>
                <DialogTrigger asChild>
                  <button className="bg-emerald-500 p-2 rounded-md text-sm text-white">Add Payment Method</button>
                </DialogTrigger>
                <DialogContent>
                  <div className="flex justify-between mb-4">
                    <h3 className="text-lg font-bold">Add Payment Method</h3>
                    <DialogClose asChild>
                      <button className="text-red-500">✖</button>
                    </DialogClose>
                  </div>
                  <AddPaymentMethod
                    onComplete={async () => {
                      const updated = await getPaymentMethod();
                      if (updated) setPaymentMethod(updated);
                    }}
                  />
                </DialogContent>
              </Dialog>
            )}
          </div>
          <div
            className="bg-zinc-900 text-xs text-gray-400 rounded-md p-3 md:w-1/3 cursor-pointer"
            onClick={() => setShowStripeInfo((prev) => !prev)}
          >
            <div className="flex justify-between items-center">
              <span className="text-emerald-400 font-medium">💳 Stripe Info</span>
              <ChevronDown className={`transition-transform ${showStripeInfo ? 'rotate-180' : ''}`} />
            </div>
            {showStripeInfo && (
              <p className="mt-1">
                Stripe Elements handles all PCI compliance for you — the card data never touches your server.
              </p>
            )}
          </div>
        </div>
        {/* Plan Selection Cards */}
        <PlanSelectionCards currentPlan={plan} onSelect={handlePlanSelect} />
        {/* About Plans Info */}
        <div
          className="bg-zinc-800 text-sm text-gray-300 rounded-lg p-4 mb-6 mt-4 cursor-pointer"
          onClick={() => setShowPlansInfo((prev) => !prev)}
        >
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white">💡 About Our Plans</h3>
            <ChevronDown className={`transition-transform ${showPlansInfo ? 'rotate-180' : ''}`} />
          </div>
          {showPlansInfo && (
            <div className="mt-2 text-gray-300">
              <p>
                SolPulse API usage is measured in <span className="text-emerald-400 font-medium">Compute Units (CU)</span>. Every API call consumes CU. You get <span className="font-medium">100K CU</span> free each month.
              </p>
              <p className="mt-2">
                <span className="text-emerald-400 font-medium">Standard Plan</span>: 600K CU/month — great for active traders & bots.
                <br />
                <span className="text-emerald-400 font-medium">Pro Plan</span>: 1.5M CU/month — for degens & whales running heavy strategies.
              </p>
              <p className="mt-2 text-xs text-gray-500">
                🚨 Any usage beyond your quota will fail unless you upgrade or buy more credits.
              </p>
            </div>
          )}
        </div>
        {/* Warnings and Critical Alerts */}
        {isWarning && (
          <div className="bg-yellow-500 text-black p-4 rounded-lg mt-6 flex items-center gap-3">
            <Info size={18} />
            <span className="text-sm">
              <strong>Alert:</strong> You’ve used <strong>{usagePercent}%</strong> of your monthly quota. API usage beyond your limit will be blocked. Please upgrade your plan to continue uninterrupted service.
            </span>
          </div>
        )}
        {isCritical && (
          <div className="bg-red-600 text-black p-4 rounded-lg mt-6 flex items-center gap-3">
            <Info size={18} />
            <span className="text-sm">
              {isFreeUser ? (
                <>
                  <strong>Alert:</strong> You’ve used your free monthly quota. Please upgrade to a paid plan or wait until the next reset.
                </>
              ) : (
                <>
                  <strong>Alert:</strong> You’ve used your monthly quota and have no remaining credits. Please purchase more credits to continue using the service.
                </>
              )}
            </span>
          </div>
        )}
        {/* Buy credits card for non‑free users when quota exceeded */}
        {isCritical && !isFreeUser && (
          <div className="mt-4 flex justify-center">
            <div className="mt-4 flex flex-col gap-2 items-center">
              <p className="text-sm">Buy more credits:</p>
              <div className="flex gap-4">
                <button
                  className="bg-emerald-600 p-2 rounded-md text-sm text-white"
                  onClick={() => handleCheckoutCredits(20)}
                >
                  $20 — 600K CU (Card)
                </button>
                <button
                  className="bg-emerald-600 p-2 rounded-md text-sm text-white"
                  onClick={() => handleCheckoutCredits(50)}
                >
                  $50 — 1.5M CU (Card)
                </button>
              </div>
              {/* Additional buttons for Solana credit purchase */}
              <div className="flex gap-4 mt-2">
                <button
                  className="bg-purple-600 p-2 rounded-md text-sm text-white"
                  onClick={() => handleSolanaCheckoutCredits(20)}
                >
                  20 USDC — 600K CU
                </button>
                <button
                  className="bg-purple-600 p-2 rounded-md text-sm text-white"
                  onClick={() => handleSolanaCheckoutCredits(50)}
                >
                  50 USDC — 1.5M CU
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Cancellation info and uncancel button for scheduled cancels */}
        {subscriptionStatus === 'cancelling' && (
          <div className="bg-yellow-600 text-black p-2 rounded-md mt-2">
            <p className="text-sm">Your subscription is scheduled for cancellation at the end of this billing period.</p>
            <button
              onClick={() => setShowUncancelDialog(true)}
              className="mt-1 px-2 py-1 text-xs bg-emerald-600 text-white rounded"
            >
              Undo Cancellation
            </button>
          </div>
        )}
      </div>
      {/* Confirm Plan Change Dialog */}
      <Dialog open={!!pendingPlan} onOpenChange={() => setPendingPlan(null)}>
        <DialogContent>
          <h3 className="text-lg font-semibold mb-2">Confirm Change to {pendingPlan?.toUpperCase()} Plan</h3>
          <p className="text-sm text-gray-400 mb-2">
            You’re switching to the <span className="text-emerald-400">{pendingPlan}</span> plan. This will adjust your monthly quota and billing accordingly.
          </p>
          {pendingPlan === 'standard' && (
            <div className="text-sm text-gray-300 mb-2">
              <p>
                <strong>$20/month</strong> or <strong>20 USDC</strong>
              </p>
              <p>CU: 600K units</p>
            </div>
          )}
          {pendingPlan === 'pro' && (
            <div className="text-sm text-gray-300 mb-2">
              <p>
                <strong>$50/month</strong> or <strong>50 USDC</strong>
              </p>
              <p>CU: 1.5M units</p>
            </div>
          )}
          <div className="flex flex-col sm:flex-row justify-end gap-2 mt-4">
            <button
              className="px-3 py-1 text-sm rounded-md text-gray-400"
              onClick={() => setPendingPlan(null)}
            >
              Cancel
            </button>
            <button
              className="px-3 py-1 text-sm rounded-md bg-emerald-600 text-white"
              onClick={handleConfirmChange}
            >
              Pay with Card
            </button>
            <button
              className="px-3 py-1 text-sm rounded-md bg-purple-600 text-white"
              onClick={() => handleSolanaSelectPlan(pendingPlan)}
            >
              Pay with USDC
            </button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Cancel Subscription Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent>
          <h3 className="text-lg font-semibold mb-2">Confirm Subscription Cancellation</h3>
          <p className="text-sm text-gray-400 mb-4">
            Are you sure you want to cancel your subscription? You will retain access to your current plan and quota until the end of your current billing period.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <button
              className="px-3 py-1 text-sm rounded-md text-gray-400"
              onClick={() => setShowCancelDialog(false)}
            >
              Keep Subscription
            </button>
            <button
              className="px-3 py-1 text-sm rounded-md bg-red-600 text-white"
              onClick={async () => {
                setShowCancelDialog(false);
                const result = await cancelSubscription();
                if (result?.success) {
                  toast.success('Your subscription will be cancelled at the end of the billing period.');
                  setSubscriptionStatus('cancelling');
                } else {
                  toast.error('Failed to cancel subscription.');
                }
              }}
            >
              Confirm Cancellation
            </button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Uncancel Subscription Dialog */}
      <Dialog open={showUncancelDialog} onOpenChange={setShowUncancelDialog}>
        <DialogContent>
          <h3 className="text-lg font-semibold mb-2">Confirm Uncancel Subscription</h3>
          <p className="text-sm text-gray-400 mb-4">
            Are you sure you want to keep your subscription active? Your scheduled cancellation will be removed, and you’ll continue to be billed as normal.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <button
              className="px-3 py-1 text-sm rounded-md text-gray-400"
              onClick={() => setShowUncancelDialog(false)}
            >
              Keep Cancellation
            </button>
            <button
              className="px-3 py-1 text-sm rounded-md bg-emerald-600 text-white"
              onClick={handleUncancelSubscription}
            >
              Confirm Uncancel
            </button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Solana Payment Session Modal */}
      {solanaSession && (
        <Dialog open={!!solanaSession} onOpenChange={() => setSolanaSession(null)}>
          <DialogContent>
            <h3 className="text-lg font-semibold mb-2">Pay with USDC on Solana</h3>
            <p className="text-sm text-gray-400">
              Please send exactly <span className="text-emerald-400 font-medium">{solanaSession.amountUSD} USDC</span> to the following address on the Solana network:
            </p>
            <div className="mt-3 p-3 bg-zinc-900 rounded-md break-all font-mono text-sm">
              {solanaSession.publicKey}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              After sending, click “I’ve Paid” to verify your payment on‑chain. Payment confirmations may take a few seconds.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                className="px-3 py-1 text-sm rounded-md text-gray-400"
                onClick={() => setSolanaSession(null)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1 text-sm rounded-md bg-purple-600 text-white"
                onClick={handleVerifySolanaPayment}
                disabled={solanaVerifying}
              >
                {solanaVerifying ? 'Verifying…' : 'I’ve Paid'}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default PaymentsTab;