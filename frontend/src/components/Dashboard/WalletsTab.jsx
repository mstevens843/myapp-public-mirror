import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { BadgeCheck, Trash2, KeyRound, Star, Plus, Copy, Send } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { generateWallet, loadWallet, setActiveWalletApi, fetchActiveWallet, importWallet, 
  exportWallet, deleteWallet,  sendSol, fetchPortfolio } from "../../utils/auth"
import { fetchTokensByWallet } from "../../utils/auth";



export default function WalletsTab() {
  const [wallets, setWallets] = useState([]);
  const [activeWallet, setActiveWallet] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [exportTarget, setExportTarget] = useState(null);
const [sendTarget, setSendTarget] = useState(null);
  const [sendDetails, setSendDetails] = useState({ recipient: "", amount: "" });
  const [showFullPortfolio, setShowFullPortfolio] = useState(false);
  const [portfolioDetails, setPortfolioDetails] = useState([]);
const [walletBalances, setWalletBalances] = useState({}); 
const [importTarget, setImportTarget] = useState(false);
const [importDetails, setImportDetails] = useState({ label: "", privateKey: "" });
const [loading, setLoading] = useState(true);
const [generateTarget, setGenerateTarget] = useState(false);
const [generateLabel, setGenerateLabel] = useState("");


useEffect(() => {
  const wallet = wallets.find(w => w.id === activeWallet);
  if (!wallet) return;

  setPortfolioDetails(wallet.tokens);

const tokens = wallet.tokens || [];

const portfolioValue = tokens.reduce(
  (acc, token) => acc + (token.valueUsd || 0),
  0
);
const solBalance = tokens.find(t => t.symbol === "SOL")?.amount || 0;

  setWalletBalances(prev => ({
    ...prev,
    [wallet.id]: { portfolioValue, solBalance }
  }));
}, [activeWallet, wallets]);

const loadUserWallets = async () => {
  setLoading(true);

  const loadedWallets = await loadWallet();
  console.log("🔷 Loaded wallets:", loadedWallets);

  if (!Array.isArray(loadedWallets) || loadedWallets.length === 0) {
    console.error("❌ No wallets found");
    setWallets([]);
    return;
  }

  const enriched = await Promise.all(
    loadedWallets.map(async (wallet) => {
      try {
        console.log(`🔷 Calling fetchPortfolio(${wallet.id})`);
        const tokens = await fetchPortfolio(wallet.id);
        console.log(`✅ Portfolio for wallet ${wallet.id}:`, tokens);

        const portfolioValue = tokens.reduce(
          (acc, token) => acc + (token.valueUsd || 0),
          0
        );
        const solBalance = tokens.find(t => t.symbol === "SOL")?.amount || 0;

        setWalletBalances(prev => ({
          ...prev,
          [wallet.id]: { portfolioValue, solBalance }
        }));

        return {
          ...wallet,
          tokens
        };
      } catch (err) {
        console.error(`❌ Failed to fetch portfolio for wallet ${wallet.id}:`, err);
        return wallet;
      }
    })
  );

  console.log("✅ Enriched wallets:", enriched);
  setWallets(enriched);

  const activeId = await fetchActiveWallet();
  setActiveWallet(activeId || enriched[0]?.id || null);

  const firstWalletTokens = enriched[0]?.tokens || [];
  setPortfolioDetails(firstWalletTokens);

  setLoading(false);
};


useEffect(() => { 
  async function loadUserWallets() {
    setLoading(true);
    const loadedWallets = await loadWallet();
    console.log("🔷 Loaded wallets:", loadedWallets);

    if (!Array.isArray(loadedWallets) || loadedWallets.length === 0) {
      console.error("❌ No wallets found");
      setWallets([]);
      return;
    }

    const enriched = await Promise.all(
      loadedWallets.map(async (wallet) => {
        try {
          console.log(`🔷 Calling fetchPortfolio(${wallet.id})`);
          const tokens = await fetchPortfolio(wallet.id);
          console.log(`✅ Portfolio for wallet ${wallet.id}:`, tokens);

          const portfolioValue = tokens.reduce(
            (acc, token) => acc + (token.valueUsd || 0),
            0
          );
          const solBalance = tokens.find(t => t.symbol === "SOL")?.amount || 0;

          setWalletBalances(prev => ({
            ...prev,
            [wallet.id]: { portfolioValue, solBalance }
          }));

          return {
            ...wallet,
            tokens
          };
        } catch (err) {
          console.error(`❌ Failed to fetch portfolio for wallet ${wallet.id}:`, err);
          return wallet;
        }
      })
    );

    console.log("✅ Enriched wallets:", enriched);
    setWallets(enriched);

const activeId = await fetchActiveWallet();
setActiveWallet(activeId || enriched[0]?.id || null);

    const firstWalletTokens = enriched[0]?.tokens || [];
    setPortfolioDetails(firstWalletTokens);

    setLoading(false);
  }

  loadUserWallets();
}, []);


//   useEffect(() => {
//   if (!activeWallet) return;

//   async function refreshPortfolio() {
//     const wallet = wallets.find(w => w.id === activeWallet);
//     if (!wallet) return;

//     try {
//       const tokens = await fetchPortfolio(wallet.id);

//       // Update tokens in the wallets array directly:
//       setWallets(prev =>
//         prev.map(w => w.id === wallet.id ? { ...w, tokens } : w)
//       );

//       setPortfolioDetails(tokens);

//       const portfolioValue = tokens.reduce(
//         (acc, token) => acc + (token.valueUsd || 0),
//         0
//       );
//       const solBalance = tokens.find(t => t.symbol === "SOL")?.amount || 0;

//       setWalletBalances(prev => ({
//         ...prev,
//         [wallet.id]: { portfolioValue, solBalance }
//       }));
//     } catch (err) {
//       console.error("Failed to fetch portfolio:", err.message);
//       toast.error("Failed to fetch portfolio.");
//     }
//   }

//   refreshPortfolio();
// }, [activeWallet]);

    const formatKey = (key) => `${key.slice(0, 4)}...${key.slice(-4)}`;


const handleSetActive = async (walletId) => {
  const data = await setActiveWalletApi(walletId);
  console.log("🔵 server response:", data);   // <-- add this
  if (data && typeof data.activeWalletId === "number") {
    toast.success("Active wallet updated.");
    setActiveWallet(data.activeWalletId);
  } else {
    toast.error("Failed to set active wallet.");
  }
};


const handleImportSubmit = async () => {
  const result = await importWallet(importDetails.label, importDetails.privateKey);

  if (result?.wallet) {
    toast.success("Wallet imported successfully!");
    await loadUserWallets(); // reload properly
  } else {
    toast.error("Error importing wallet.");
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
    setDeleteTarget(null);   // 👈 close modal here
    await loadUserWallets();
  } else {
    toast.error("Failed to delete wallet.");
  }
};


    const handleWipeAll = async () => {
    const response = await wipeAllWallets();
    if (response) {
      setWallets([]);
      toast.success("All wallets wiped.");
    } else {
      toast.error("Error wiping wallets.");
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

  if (result.success) {
    toast.success(`Transaction sent! Signature: ${result.signature}`);
  } else {
    toast.error(`Transaction failed: ${result.error}`);
  }

  setSendTarget(null);
  setSendDetails({ recipient: "", amount: "" });
};



const handleSendInputChange = (e) => {
  const { name, value } = e.target;
  setSendDetails((prevDetails) => ({
    ...prevDetails,
    [name]: value,
  }));
};


const handleGenerateConfirm = async () => {
  const result = await generateWallet(generateLabel);

  if (result?.wallet) {
    toast.success("New wallet generated. 🔐");
    setGenerateTarget(false);      // 👈 close modal
    setGenerateLabel("");          // 👈 reset input
    await loadUserWallets();       // 👈 refresh
  } else {
    toast.error("Error generating wallet.");
  }
};


  //   // Handle copy public key to clipboard
  // const handleReceive = (walletPublicKey) => {
  //   navigator.clipboard.writeText(walletPublicKey);
  //   toast.success("Address copied to clipboard!");
  // };

  console.log("wallets in render:", wallets);
console.log("activeWallet:", activeWallet);

   return (
    <div className="p-4 text-zinc-200">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-white">Wallets</h2>
<div className="flex space-x-4">
  {/* Generate Button */}
<Button
  variant="glow"
  onClick={() => setGenerateTarget(true)}
  className="bg-gradient-to-r from-teal-500 to-emerald-600 text-white hover:scale-105 transition-all px-6 py-3 rounded-full flex items-center gap-2 shadow-lg transform hover:shadow-2xl"
>
  <Plus size={18} className="mr-2" />
  Generate
</Button>

  {/* Import Button */}
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

    {/* Action buttons (Receive and Send) */}
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
            onClick={() => setSendTarget(wallet)}
          >
            <Send size={14} />
            <span className="text-xs">Send</span>
          </button>
        </DialogTrigger>
      </Dialog>
    </div>
  </div>

  {/* Portfolio and SOL balance, moved to a clearer position */}
  <div className="flex flex-col text-sm text-zinc-300 mb-4">
<span>
  Portfolio: ${walletBalances[wallet.id]?.portfolioValue?.toFixed(2) ?? "Loading…"}
</span>
<span>
  SOL Balance: {walletBalances[wallet.id]?.solBalance?.toFixed(4) ?? "Loading…"} SOL
</span>
  </div>

  {/* "View full portfolio" button */}
<button
  className="mt-2 text-sm text-emerald-400"
  onClick={() => {
    setPortfolioDetails(wallet.tokens || []);
    setShowFullPortfolio(true);
  }}
>
  View full portfolio
</button>

  {/* Wallet info like key and created date */}
  <div className="mt-2 text-sm text-zinc-400">
    🔑 <span className="text-violet-300">{formatKey(wallet.publicKey)}</span>
  </div>
  <div className="text-xs text-zinc-500 mt-1">
    • Created: <span className="text-zinc-400">{new Date(wallet.createdAt).toLocaleDateString()}</span>
  </div>

  {/* Action buttons (Set Active, Export, Delete) */}
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
              <div className="font-mono text-zinc-300 text-sm">{parseFloat(token.amount).toFixed(4)} {token.symbol}</div>
              <div className="font-mono text-emerald-400 text-xs font-bold">${parseFloat(token.valueUsd).toFixed(2)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 p-4 rounded-xl flex justify-between items-center">
        <div className="text-lg font-bold text-white">Total</div>
        <div className="text-lg font-bold text-emerald-400">
          $
          {portfolioDetails.reduce((acc, t) => acc + (parseFloat(t.valueUsd) || 0), 0).toFixed(2)}
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
          onChange={(e) =>
            setImportDetails((prev) => ({ ...prev, label: e.target.value }))
          }
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
  onChange={(e) =>
    setImportDetails((prev) => ({ ...prev, privateKey: e.target.value }))
  }
  className="w-full p-2 rounded text-white bg-zinc-900 border border-zinc-700 placeholder-zinc-500 font-mono tracking-widest"
  style={{ WebkitTextSecurity: 'disc' }} 
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
        <Button onClick={handleGenerateConfirm}>Generate</Button>
      </div>
    </DialogContent>
  </Dialog>
)}

    </div>
  );
}
