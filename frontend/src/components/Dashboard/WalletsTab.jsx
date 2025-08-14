/**
 * frontend/src/components/Dashboard/WalletsTab.jsx
 * What changed
 * - FIX: hydrateWalletPortfolio no longer reads stale state; it fetches by id and updates state, returning tokens.
 * - On tab load: hydrate ACTIVE wallet first, then hydrate the rest with concurrency (3).
 * - On import: hydrate ONLY the imported wallet (no global reload).
 * - De-dupe in-flight per-wallet hydrations.
 *
 * Why
 * - Previous version checked `wallets` right after setState → empty match → nothing fetched.
 *
 * Risk addressed
 * - Portfolios not loading on page load; 429 storms on import.
 */

import React, { useState, useEffect, useRef } from "react";
import { useUser } from "@/contexts/UserProvider";
import { Button } from "@/components/ui/button";
import { BadgeCheck, Trash2, KeyRound, Star, Plus, Copy, Send } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// utils/auth helpers
import {
  generateWallet,
  loadWallet,
  setActiveWalletApi,
  fetchActiveWallet,
  importWallet as importWalletApi,
  exportWallet,
  deleteWallet,
  sendSol,
  fetchPortfolio,
} from "../../utils/auth";

export default function WalletsTab() {
  const [wallets, setWallets] = useState([]);                 // [{ id, label, publicKey, createdAt, tokens? }]
  const [activeWallet, setActiveWallet] = useState(null);     // walletId
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [exportTarget, setExportTarget] = useState(null);
  const [sendTarget, setSendTarget] = useState(null);
  const [sendDetails, setSendDetails] = useState({ recipient: "", amount: "" });
  const [showFullPortfolio, setShowFullPortfolio] = useState(false);
  const [portfolioDetails, setPortfolioDetails] = useState([]);
  const [walletBalances, setWalletBalances] = useState({});   // id -> { portfolioValue, solBalance }
  const [importTarget, setImportTarget] = useState(false);
  const [importDetails, setImportDetails] = useState({ label: "", privateKey: "" });
  const [loading, setLoading] = useState(true);
  const [generateTarget, setGenerateTarget] = useState(false);
  const [generateLabel, setGenerateLabel] = useState("");

  const { refreshProfile } = useUser();

  // Guards to avoid duplicate hits
  const _activeFetchGuard = useRef(false);
  const _hydratingIds = useRef(new Set()); // walletIds currently fetching portfolio

  const formatKey = (key) => `${key.slice(0, 4)}...${key.slice(-4)}`;

  /** Compute balances + cache */
  const cacheBalances = (walletId, tokens) => {
    const portfolioValue = (tokens || []).reduce((acc, t) => acc + (Number(t.valueUsd) || 0), 0);
    const solBalance = (tokens || []).find((t) => t.symbol === "SOL")?.amount || 0;

    setWalletBalances((prev) => ({
      ...prev,
      [walletId]: {
        portfolioValue,
        solBalance: Number(solBalance) || 0,
      },
    }));
  };

  /**
   * Hydrate a single wallet's portfolio by id (does NOT read `wallets` state).
   * Returns fetched tokens on success; null on failure/skip.
   */
  const hydrateWalletPortfolio = async (walletId) => {
    if (!walletId) return null;
    if (_hydratingIds.current.has(walletId)) return null;
    _hydratingIds.current.add(walletId);
    try {
      const tokens = await fetchPortfolio(walletId);
      setWallets((prev) =>
        prev.map((x) => (x.id === walletId ? { ...x, tokens } : x))
      );
      cacheBalances(walletId, tokens);
      return tokens;
    } catch (err) {
      console.error(`❌ Failed to fetch portfolio for wallet ${walletId}:`, err);
      toast.error("Failed to fetch portfolio.");
      return null;
    } finally {
      _hydratingIds.current.delete(walletId);
    }
  };

  /** Concurrency-limited runner for initial hydration */
  const runWithConcurrency = async (limit, items, fn) => {
    let idx = 0;
    const workers = new Array(Math.max(1, limit)).fill(0).map(async () => {
      while (idx < items.length) {
        const myIdx = idx++;
        const item = items[myIdx];
        try { await fn(item, myIdx); } catch { /* already logged */ }
      }
    });
    await Promise.all(workers);
  };

  /** Initial mount: load wallets list, set active, hydrate ACTIVE first, then others */
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const loadedWallets = await loadWallet(); // minimal list [{id,label,publicKey,...}]
        const normalized = (loadedWallets || []).map((w) => ({ ...w, tokens: undefined }));
        setWallets(normalized);

        // Decide active once (guarded)
        let activeId = null;
        if (!_activeFetchGuard.current) {
          _activeFetchGuard.current = true;
          try {
            activeId = await fetchActiveWallet();
          } finally {
            setTimeout(() => (_activeFetchGuard.current = false), 300);
          }
        }
        const chosenId = activeId || normalized[0]?.id || null;
        setActiveWallet(chosenId);

        // Hydrate active first (so UI shows data fast)
        if (chosenId) {
          const t = await hydrateWalletPortfolio(chosenId);
          if (t) setPortfolioDetails(t);
        }

        // Then hydrate the rest with small concurrency
        const restIds = normalized.map((w) => w.id).filter((id) => id !== chosenId);
        await runWithConcurrency(3, restIds, async (id) => {
          await hydrateWalletPortfolio(id);
        });
      } catch (e) {
        console.error("❌ Failed initial wallet load:", e);
        setWallets([]);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Keep portfolio panel in sync with active wallet */
  useEffect(() => {
    const w = wallets.find((x) => x.id === activeWallet);
    const tokens = w?.tokens || [];
    setPortfolioDetails(tokens);
    if (w?.id && Array.isArray(tokens)) cacheBalances(w.id, tokens);
  }, [activeWallet, wallets]);

  /** Set active wallet (server) then hydrate that wallet if needed */
  const handleSetActive = async (walletId) => {
    const data = await setActiveWalletApi(walletId);
    if (data && typeof data.activeWalletId === "number") {
      toast.success("Active wallet updated.");
      setActiveWallet(data.activeWalletId);

      const w = wallets.find((x) => x.id === data.activeWalletId);
      if (!Array.isArray(w?.tokens)) {
        const t = await hydrateWalletPortfolio(data.activeWalletId);
        if (t) setPortfolioDetails(t);
      }

      if (!_activeFetchGuard.current) {
        _activeFetchGuard.current = true;
        try { await refreshProfile(); } catch (err) {
          console.error("Failed to refresh profile after setting active wallet:", err);
        } finally {
          setTimeout(() => (_activeFetchGuard.current = false), 300);
        }
      }
    } else {
      toast.error("Failed to set active wallet.");
    }
  };

  /** Import: add wallet to state, hydrate ONLY that wallet, do not reload all */
  const handleImportSubmit = async () => {
    const result = await importWalletApi(importDetails.label, importDetails.privateKey);

    if (result?.wallet?.id) {
      const w = result.wallet;
      toast.success("Wallet imported successfully!");

      setWallets((prev) => {
        const exists = prev.some((x) => x.id === w.id);
        return exists ? prev : [{ ...w, tokens: undefined }, ...prev];
      });

      const newActive = (typeof result.activeWalletId === "number" && result.activeWalletId) || w.id;
      setActiveWallet(newActive);

      const t = await hydrateWalletPortfolio(w.id);
      if (t) setPortfolioDetails(t);

      if (!_activeFetchGuard.current) {
        _activeFetchGuard.current = true;
        try { await refreshProfile(); } catch (err) {
          console.error("Failed to refresh profile after import:", err);
        } finally {
          setTimeout(() => (_activeFetchGuard.current = false), 300);
        }
      }
    } else {
      toast.error(result?.error || "Error importing wallet.");
    }

    setImportTarget(false);
    setImportDetails({ label: "", privateKey: "" });
  };

  const handleExport = async (walletId) => {
    const data = await exportWallet(walletId);
    if (data?.privateKey) {
      navigator.clipboard.writeText(data.privateKey);
      toast.success("Private key copied to clipboard.");
    } else {
      toast.error("Failed to export wallet.");
    }
  };

  const handleDelete = async (walletId) => {
    const result = await deleteWallet(walletId);
    if (result) {
      toast.success(result.message || "Wallet deleted.");
      setDeleteTarget(null);
      setWallets((prev) => prev.filter((w) => w.id !== walletId));
      if (activeWallet === walletId) {
        const fallback = wallets.find((w) => w.id !== walletId)?.id || null;
        setActiveWallet(fallback);
        if (fallback) {
          const t = await hydrateWalletPortfolio(fallback);
          if (t) setPortfolioDetails(t);
        }
      }
    } else {
      toast.error("Failed to delete wallet.");
    }
  };

  const handleSend = async () => {
    const senderWallet = sendTarget && wallets.find((w) => w.id === sendTarget.id);
    if (!senderWallet) {
      toast.error("No sender wallet selected.");
      return;
    }

    toast("Sending transaction…", { duration: 4000 });

    const result = await sendSol(
      senderWallet.id,
      sendDetails.recipient,
      parseFloat(sendDetails.amount)
    );

    if (result?.success) {
      toast.success(`Transaction sent! Signature: ${result?.signature}`);
    } else {
      toast.error(`Transaction failed: ${result?.error || "unknown error"}`);
    }

    setSendTarget(null);
    setSendDetails({ recipient: "", amount: "" });
  };

  const handleSendInputChange = (e) => {
    const { name, value } = e.target;
    setSendDetails((prevDetails) => ({
      ...prevDetails,
      [name === "amount_name_fake" ? "amount" : name]: value,
    }));
  };

  // Render
  return (
    <div className="p-4 text-zinc-200">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-white">Wallets</h2>
        <div className="flex space-x-4">
          <Button
            variant="glow"
            onClick={() => setGenerateTarget(true)}
            className="bg-gradient-to-r from-teal-500 to-emerald-600 text-white hover:scale-105 transition-all px-6 py-3 rounded-full flex items-center gap-2 shadow-lg transform hover:shadow-2xl"
          >
            <Plus size={18} className="mr-2" />
            Generate
          </Button>

          <Button
            variant="outline"
            onClick={() => setImportTarget(true)}
            className="border-2 border-teal-500 text-teal-500 hover:text-white hover:bg-teal-600 hover:border-teal-600 hover:scale-105 transition-all px-6 py-3 rounded-full flex items-center gap-2 shadow-lg transform hover:shadow-2xl"
          >
            <KeyRound size={18} className="mr-2" />
            Import
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[...wallets]
          .sort((a, b) => (a.id === activeWallet ? -1 : b.id === activeWallet ? 1 : 0))
          .map((wallet) => (
            <div
              key={wallet.id}
              className={cn(
                "rounded-xl p-4 border bg-zinc-900/80 border-zinc-800 shadow-md transition hover:shadow-emerald-500/20",
                activeWallet === wallet.id && "border-emerald-500/70"
              )}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="text-lg font-medium flex items-center gap-2">
                  🪪 <span className="text-white">{wallet.label}</span>
                  {activeWallet === wallet.id && <BadgeCheck className="text-emerald-400" size={18} />}
                </div>

                <div className="flex items-center gap-3 text-sm text-zinc-300">
                  <button
                    className="flex items-center gap-1 px-3 py-2 text-white bg-emerald-600 rounded-md hover:bg-emerald-700 transition"
                    onClick={() => {
                      navigator.clipboard.writeText(wallet.publicKey);
                      toast.success("Address copied");
                    }}
                  >
                    <Copy size={14} />
                    <span className="text-xs">Receive</span>
                  </button>

                  <Dialog>
                    <DialogTrigger asChild>
                      <button
                        className="flex items-center gap-1 px-3 py-2 text-white bg-emerald-600 rounded-md hover:bg-emerald-700 transition"
                        onClick={async () => {
                          // Ensure portfolio is hydrated if someone clicks immediately
                          const w = wallets.find((x) => x.id === wallet.id);
                          if (!Array.isArray(w?.tokens)) {
                            await hydrateWalletPortfolio(wallet.id);
                          }
                          setSendTarget(wallet);
                        }}
                      >
                        <Send size={14} />
                        <span className="text-xs">Send</span>
                      </button>
                    </DialogTrigger>
                  </Dialog>
                </div>
              </div>

              <div className="flex flex-col text-sm text-zinc-300 mb-4">
                <span>
                  Portfolio: $
                  {walletBalances[wallet.id]?.portfolioValue?.toFixed(2) ??
                    (Array.isArray(wallets.find((w)=>w.id===wallet.id)?.tokens) ? "0.00" : "Loading…")}
                </span>
                <span>
                  SOL Balance: {walletBalances[wallet.id]?.solBalance?.toFixed(4) ??
                    (Array.isArray(wallets.find((w)=>w.id===wallet.id)?.tokens) ? "0.0000" : "Loading…")} SOL
                </span>
              </div>

              <button
                className="mt-2 text-sm text-emerald-400"
                onClick={async () => {
                  const w = wallets.find((x) => x.id === wallet.id);
                  if (!Array.isArray(w?.tokens)) {
                    const t = await hydrateWalletPortfolio(wallet.id); // lazy top-up if needed
                    if (t) setPortfolioDetails(t);
                  } else {
                    setPortfolioDetails(w.tokens);
                  }
                  setShowFullPortfolio(true);
                }}
              >
                View full portfolio
              </button>

              <div className="mt-2 text-sm text-zinc-400">
                🔑 <span className="text-violet-300">{formatKey(wallet.publicKey)}</span>
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                • Created: <span className="text-zinc-400">{new Date(wallet.createdAt).toLocaleDateString()}</span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {activeWallet !== wallet.id && (
                  <Button size="sm" variant="secondary" onClick={() => handleSetActive(wallet.id)}>
                    <Star size={14} className="mr-1" />
                    Set Active
                  </Button>
                )}

                <Dialog>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" onClick={() => setExportTarget(wallet)}>
                      <KeyRound size={14} className="mr-1" />
                      Export
                    </Button>
                  </DialogTrigger>
                  {exportTarget?.id === wallet.id && (
                    <DialogContent>
                      <div className="text-white">
                        <h3 className="text-lg mb-2">Export Private Key</h3>
                        <p className="text-sm mb-4 text-zinc-400">
                          Are you sure you want to export the private key for <strong>{wallet.label}</strong>?
                        </p>
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => setExportTarget(null)}>
                            Cancel
                          </Button>
                          <Button variant="destructive" onClick={() => handleExport(wallet.id)}>
                            Copy Key
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  )}
                </Dialog>

                <Dialog>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(wallet)}>
                      <Trash2 size={14} className="mr-1" />
                      Delete
                    </Button>
                  </DialogTrigger>
                  {deleteTarget?.id === wallet.id && (
                    <DialogContent>
                      <div className="text-white">
                        <h3 className="text-lg mb-2">Delete Wallet</h3>
                        <p className="text-sm mb-4 text-zinc-400">
                          This will remove <strong>{wallet.label}</strong> from your wallet list.
                        </p>
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
                            Cancel
                          </Button>
                          <Button variant="destructive" onClick={() => handleDelete(wallet.id)}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  )}
                </Dialog>
              </div>
            </div>
          ))}
      </div>

      {showFullPortfolio && (
        <Dialog open={showFullPortfolio} onOpenChange={(open) => setShowFullPortfolio(open)}>
          <DialogContent className="bg-zinc-950 rounded-3xl p-8 w-full max-w-lg shadow-2xl border border-zinc-800/50">
            <h3 className="text-2xl font-extrabold text-white text-center mb-6 tracking-wide">
              Full Portfolio
            </h3>

            <div className="space-y-4">
              {portfolioDetails.map((token) => (
                <div
                  key={token.mint}
                  className="flex justify-between items-center p-4 rounded-xl bg-zinc-900/60 shadow-inner hover:shadow-lg hover:shadow-emerald-500/10 transition"
                >
                  <div>
                    <div className="text-lg font-semibold text-white">{token.name}</div>
                    <div className="text-xs text-zinc-500">{token.symbol}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-zinc-300 text-sm">
                      {parseFloat(token.amount).toFixed(4)} {token.symbol}
                    </div>
                    <div className="font-mono text-emerald-400 text-xs font-bold">
                      ${parseFloat(token.valueUsd).toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 p-4 rounded-xl flex justify-between items-center">
              <div className="text-lg font-bold text-white">Total</div>
              <div className="text-lg font-bold text-emerald-400">
                ${portfolioDetails.reduce((acc, t) => acc + (parseFloat(t.valueUsd) || 0), 0).toFixed(2)}
              </div>
            </div>

            <div className="mt-6 flex justify-center">
              <Button variant="outline" onClick={() => setShowFullPortfolio(false)}>
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {sendTarget && (
        <Dialog
          open={!!sendTarget}
          onOpenChange={(open) => {
            if (!open) {
              setSendTarget(null);
              setSendDetails({ recipient: "", amount: "" });
            }
          }}
        >
          <DialogContent>
            <h3 className="text-lg text-white mb-4">Send SOL from {sendTarget.label}</h3>
            <div className="space-y-4">
              <input
                type="text"
                name="recipient"
                placeholder="Recipient Address"
                autoComplete="new-password"
                value={sendDetails.recipient}
                onChange={handleSendInputChange}
                className="w-full p-2 rounded text-white"
              />
              <input
                type="number"
                name="amount_name_fake"
                placeholder="Amount"
                value={sendDetails.amount}
                onChange={handleSendInputChange}
                className="w-full p-2 rounded text-white"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setSendTarget(null)}>Cancel</Button>
                <Button onClick={handleSend}>Send</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {importTarget && (
        <Dialog
          open={importTarget}
          onOpenChange={(open) => {
            if (!open) {
              setImportTarget(false);
              setImportDetails({ label: "", privateKey: "" });
            }
          }}
        >
          <DialogContent>
            <h3 className="text-lg text-white mb-4">Import Wallet</h3>
            <div className="space-y-4">
              <input
                type="text"
                name="wallet_label_fake"
                placeholder="Wallet Label"
                autoComplete="new-password"
                value={importDetails.label}
                onChange={(e) => setImportDetails((prev) => ({ ...prev, label: e.target.value }))}
                className="w-full p-2 rounded text-white"
              />
              <input
                type="text"
                name="privateKey"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="Private Key"
                value={importDetails.privateKey}
                onChange={(e) => setImportDetails((prev) => ({ ...prev, privateKey: e.target.value }))}
                className="w-full p-2 rounded text-white bg-zinc-900 border border-zinc-700 placeholder-zinc-500 font-mono tracking-widest"
                style={{ WebkitTextSecurity: "disc" }}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setImportTarget(false)}>Cancel</Button>
                <Button onClick={handleImportSubmit}>Import</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {generateTarget && (
        <Dialog
          open={generateTarget}
          onOpenChange={(open) => {
            if (!open) {
              setGenerateTarget(false);
              setGenerateLabel("");
            }
          }}
        >
          <DialogContent>
            <h3 className="text-lg text-white mb-4">Generate New Wallet</h3>
            <input
              type="text"
              placeholder="Wallet Label (optional)"
              autoComplete="new-password"
              value={generateLabel}
              onChange={(e) => setGenerateLabel(e.target.value)}
              className="w-full p-2 rounded text-white"
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={() => setGenerateTarget(false)}>Cancel</Button>
              <Button onClick={async () => {
                const result = await generateWallet(generateLabel);
                if (result?.wallet) {
                  toast.success("New wallet generated. 🔐");
                  setGenerateTarget(false);
                  setGenerateLabel("");
                  setWallets((prev) => [{ ...result.wallet, tokens: undefined }, ...prev]);
                  setActiveWallet(result.wallet.id);
                  const t = await hydrateWalletPortfolio(result.wallet.id);
                  if (t) setPortfolioDetails(t);
                } else {
                  toast.error("Error generating wallet.");
                }
              }}>Generate</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
