import * as React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter, SheetClose } from "./sheet";
import { Rocket, ThumbsUp, Shield, MessageCircle, BarChart } from "lucide-react";

const FAQSheet = ({ open, onClose }) => {
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetContent side="right" className="bg-zinc-900 text-white p-8 overflow-auto max-h-screen">
        <SheetHeader>
          <SheetTitle className="text-3xl font-extrabold text-gradient mb-4">How the Bot Works</SheetTitle>
        </SheetHeader>

        <SheetDescription className="text-sm space-y-3">
          {/* Auto-Bot Trading */}
          <div>
            <h3 className="font-semibold text-xl text-gradient">
              <Rocket className="inline mr-2 text-emerald-400" /> Auto-Bot Trading
            </h3>
            <ul className="text-s text-gray-300 list-inside">
              <li><strong className="text-gradient">Sniper</strong>, <strong className="text-gradient">Scalper</strong>, and <strong className="text-gradient">Trend Following</strong> are advanced strategies you can choose from to <strong>automate</strong> your trades in real-time.</li>
              <li>Simply <strong>set your preferences</strong> and let the bot execute trades based on the most up-to-date market conditions!</li>
            </ul>
          </div>

          {/* Manual Trading */}
          <div>
            <h3 className="font-semibold text-xl text-gradient">
              <ThumbsUp className="inline mr-2 text-blue-400" /> Manual Trading
            </h3>
            <ul className="text-s text-gray-300 list-inside">
              <li><strong>Take full control</strong> over your trades with <span className="text-gradient">manual trading</span>.</li>
              <li>Set your <strong>amounts</strong>, <strong>slippage</strong>, and execute trades using <span className="text-gradient">Limit Orders</span> or <span className="text-gradient">DCA Orders</span> for added flexibility.</li>
            </ul>
          </div>

          {/* Safety Checker */}
          <div>
            <h3 className="font-semibold text-xl text-gradient">
              <Shield className="inline mr-2 text-red-400" /> Safety Checker
            </h3>
            <ul className="text-s text-gray-300 list-inside">
              <li>Run your tokens through <strong className="text-gradient">7 cutting-edge safety checks</strong> to ensure you're not trading risky assets.</li>
              <li>From <strong className="text-gradient">honeypots</strong> to <strong className="text-gradient">whale control</strong>, we’ve got you covered with the <strong>safest trades</strong> on Solana!</li>
            </ul>
          </div>

          {/* Telegram Alerts */}
          <div>
            <h3 className="font-semibold text-xl text-gradient">
              <MessageCircle className="inline mr-2 text-purple-400" /> Telegram Alerts
            </h3>
            <ul className="text-s text-gray-300 list-inside">
              <li><strong>Stay connected</strong> no matter where you are! Get instant trade and safety alerts sent directly to your <span className="text-gradient">Telegram</span>.</li>
              <li>Never miss a <strong>crucial update</strong> again!</li>
            </ul>
          </div>

          {/* Portfolio & Trade Data */}
          <div>
            <h3 className="font-semibold text-xl text-gradient">
              <BarChart className="inline mr-2 text-yellow-400" /> Portfolio & Trade Data
            </h3>
            <ul className="text-s text-gray-300 list-inside">
              <li><strong>Visualize</strong> your trading success with <strong>real-time charts</strong>.</li>
              <li>Track your portfolio's <strong>performance</strong>, make <strong>data-driven decisions</strong>, and improve your strategy for better returns.</li>
            </ul>
          </div>
        </SheetDescription>

        <SheetFooter className="pt-4">
          <button onClick={onClose} className="bg-gradient-to-r from-green-400 to-blue-500 text-white font-semibold p-2 rounded-md hover:shadow-lg transition-all duration-300 text-xs">
            Close
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default FAQSheet;
