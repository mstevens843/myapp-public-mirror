// Lets user paste a base58 private key, loads it, and shows balance.
import React, { useState } from "react";
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import "@/styles/components/WalletLoader.css";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";


const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL;

const WalletLoader = ({ onWalletLoaded, onSelectionChange }) => {
    const [privateKey, setPrivateKey] = useState("");
    const [wallets, setWallets] = useState(() => {
      const stored = localStorage.getItem("wallets");
      return stored ? JSON.parse(stored) : [];
    });
    const [selectedWallets, setSelectedWallets] = useState(() => {
      const stored = localStorage.getItem("selectedWallets");
      return stored ? JSON.parse(stored) : [];
    });
    const [balances, setBalances] = useState({});
    const [error, setError] = useState("");



    const handleLoadWallet = async () => {
        try {
          let keypair;
      
          if (privateKey.trim().startsWith("[")) {
            const parsed = JSON.parse(privateKey);
            keypair = Keypair.fromSecretKey(Uint8Array.from(parsed));
          } else {
            const decoded = bs58.decode(privateKey.trim());
            keypair = Keypair.fromSecretKey(decoded);
          }
      
          const pubkey = keypair.publicKey.toBase58();
          if (wallets.find((w) => w.publicKey === pubkey)) {
            setError("Wallet already loaded.");
            return;
          }
      
          const updated = [...wallets, { secret: privateKey.trim(), publicKey: pubkey }];
          const autoSelected = selectedWallets.length === 0 ? [pubkey] : selectedWallets;
      
          setWallets(updated);
          setSelectedWallets(autoSelected);
          localStorage.setItem("wallets", JSON.stringify(updated));
          localStorage.setItem("selectedWallets", JSON.stringify(autoSelected));
          setPrivateKey("");
          setError("");
      
          const connection = new Connection(RPC_URL);
          const lamports = await connection.getBalance(keypair.publicKey);
          setBalances((prev) => ({ ...prev, [pubkey]: (lamports / 1e9).toFixed(4) }));
      
          onWalletLoaded(keypair);
          onSelectionChange(autoSelected);
        } catch (err) {
          console.error("Wallet Load Error:", err.message);
          setError("❌ Invalid key. Must be base58 or a JSON array.");
        }
      };
      
      const handleToggle = (pubkey) => {
        const updated = selectedWallets.includes(pubkey)
          ? selectedWallets.filter((k) => k !== pubkey)
          : [...selectedWallets, pubkey];
      
        setSelectedWallets(updated);
        localStorage.setItem("selectedWallets", JSON.stringify(updated));
        onSelectionChange(updated);
      };
      
      const handleDelete = (pubkey) => {
        const filtered = wallets.filter((w) => w.publicKey !== pubkey);
        const selectedFiltered = selectedWallets.filter((k) => k !== pubkey);
        setWallets(filtered);
        setSelectedWallets(selectedFiltered);
        localStorage.setItem("wallets", JSON.stringify(filtered));
        localStorage.setItem("selectedWallets", JSON.stringify(selectedFiltered));
      };

       //Place this just below your handleDelete function:
        const handleDragEnd = (result) => {
            if (!result.destination) return;
        
            const reordered = Array.from(wallets);
            const [removed] = reordered.splice(result.source.index, 1);
            reordered.splice(result.destination.index, 0, removed);
        
            setWallets(reordered);
            localStorage.setItem("wallets", JSON.stringify(reordered));
        };
            
    

        return (
            <div className="wallet-loader">
              <h3 className="wallet-title">🔑 Load Your Wallet</h3>
              <textarea
                rows="3"
                placeholder="Paste base58 or JSON key"
                className="wallet-textarea"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
              />
              <button className="wallet-button" onClick={handleLoadWallet}>
                Load Wallet
              </button>
              {error && <div className="wallet-error">{error}</div>}
          
              {wallets.length > 0 && (
                <div className="wallet-list mt-3">
                  <h4 className="wallet-title">🗂️ Loaded Wallets:</h4>
                  <DragDropContext onDragEnd={handleDragEnd}>
                    <Droppable droppableId="wallets" isDropDisabled={false}>
                      {(provided) => (
                        <ul {...provided.droppableProps} ref={provided.innerRef}>
                          {wallets.map((w, index) => (
                            <Draggable
                              key={w.publicKey}
                              draggableId={w.publicKey.toString()}
                              index={index}
                            >
                              {(provided, snapshot) => (
                               <li
                               ref={provided.innerRef}
                               {...provided.draggableProps}
                               className={`wallet-item flex items-center justify-between ${
                                 snapshot.isDragging ? "dragging" : ""
                               }`}
                             >
                               <div className="flex items-center gap-2">
                                 <input
                                   type="checkbox"
                                   checked={selectedWallets.includes(w.publicKey)}
                                   onChange={() => handleToggle(w.publicKey)}
                                 />
                                 <span
                                   className={`wallet-key ${
                                     selectedWallets.includes(w.publicKey) ? "selected-wallet" : ""
                                   }`}
                                 >
                                   {w.publicKey}
                                 </span>
                                 <span className="wallet-balance">— 💰 {balances[w.publicKey] ?? "..."} SOL</span>
                               </div>
                             
                               <div className="flex items-center gap-2">
                                 <button
                                   className="wallet-remove"
                                   onClick={() => handleDelete(w.publicKey)}
                                 >
                                   ❌
                                 </button>
                                 <span
                                   className="wallet-drag-handle"
                                   {...provided.dragHandleProps}
                                 >
                                   ☰
                                 </span>
                               </div>
                             </li>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </ul>
                      )}
                    </Droppable>
                  </DragDropContext>
                </div>
              )}
            </div>
          );
    };

export default WalletLoader;

