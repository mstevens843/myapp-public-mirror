import React, { useState, useRef } from "react";
import { motion } from "framer-motion";
import { LogIn, HelpCircle, Pause, Play } from "lucide-react"; // Added HelpCircle icon
// import AuthModal from "@/components/Auth/AuthModal";
import FAQSheet from "@/components/ui/FAQSheet"; // Import the FAQSheet component
// import WalletOnboardModal from "../AuthWallet/WalletOnboardModal";
import LaunchAppModal from "./LaunchAppModal";


export default function LandingPage() {
  const [authOpen, setAuthOpen] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [faqOpen, setFaqOpen] = useState(false); // State to control FAQ Sheet visibility
  const [walletAuthOpen, setWalletAuthOpen] = useState(false); //  New Web3 modal toggle
  const [modalOpen, setModalOpen] = useState(false);
  const handleTogglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play();
      setIsPlaying(true);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 relative overflow-hidden">
      {/* Blurred Glow Background */}
      <div className="absolute -top-20 -left-20 w-[600px] h-[600px] rounded-full bg-purple-600/20 blur-[160px] z-0" />

      {/* Hero Section */}
      <div className="relative z-10 text-center max-w-xl">
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-4xl sm:text-5xl font-bold mb-4"
        >
          Solana Bot Trading.{" "}
          <span className="text-purple-400">Beautifully Automated.</span>
        </motion.h1>
        <p className="text-zinc-400 text-lg mb-8">
          Trade smarter with alerts, bots, and real-time metrics. No experience required.
        </p>

        {/* CTA Button */}
        {/* <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setAuthOpen(true)}
          className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl shadow-lg transition-all duration-300 flex items-center gap-2 mx-auto"
        >
          <LogIn size={18} />
          Launch App
        </motion.button> */}
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.98 }}
          // onClick={() => setWalletAuthOpen(true)} // ✅ updated to open Web3 flow
          onClick={() => setModalOpen(true)}
          className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl shadow-lg transition-all duration-300 flex items-center gap-2 mx-auto"
        >
          <LogIn size={18} />
          Launch App
        </motion.button>
      </div>
      <LaunchAppModal open={modalOpen} setOpen={setModalOpen} />
{/* <WalletOnboardModal open={walletAuthOpen} setOpen={setWalletAuthOpen} /> */}

      {/* Dashboard Preview */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="mt-14 w-full flex justify-center"
      >
        <div
          className="relative rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900/40 backdrop-blur-md shadow-2xl max-w-4xl"
          style={{
            boxShadow: "inset 0 0 0.5px rgba(255,255,255,0.05), 0 20px 50px rgba(0,0,0,0.3)",
          }}
        >
          {!videoFailed ? (
            <div className="relative">
              <video
                ref={videoRef}
                src="/dashboard-preview.mp4"
                autoPlay
                muted
                loop
                playsInline
                onError={() => setVideoFailed(true)}
                className="w-full h-auto object-contain opacity-90"
                style={{
                  maxHeight: "580px",
                  maskImage: "linear-gradient(to bottom, white 90%, transparent)",
                  WebkitMaskImage: "linear-gradient(to bottom, white 90%, transparent)",
                }}
              />

              {/* Toggle Button */}
              <button
                onClick={handleTogglePlayback}
                className="absolute bottom-4 right-4 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700 rounded-full p-2 transition-all text-white"
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>
            </div>
          ) : (
            <img
              src="/fallback-dashboard.png" // ⬅️ Replace with your screenshot path
              alt="Bot Dashboard Preview"
              className="w-full h-auto object-contain opacity-90"
              style={{
                maxHeight: "580px",
                maskImage: "linear-gradient(to bottom, white 90%, transparent)",
                WebkitMaskImage: "linear-gradient(to bottom, white 90%, transparent)",
              }}
            />
          )}
        </div>
      </motion.div>

      {/* FAQ Sheet (Hidden until triggered) */}
      <FAQSheet open={faqOpen} onClose={() => setFaqOpen(false)} />

      {/* FAQ Help Button in Bottom Right Corner */}
      <motion.div
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.98 }}
        className="fixed bottom-8 right-8 bg-purple-600 hover:bg-purple-700 text-white rounded-full p-4 cursor-pointer shadow-lg"
        onClick={() => setFaqOpen(true)} // Opens FAQ Sheet
      >
        <HelpCircle size={24} />
        {/* Tooltip */}
        <span className="absolute bottom-12 left-1/2 transform -translate-x-1/2 text-xs text-white bg-black p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          Discover how the bot works
        </span>
      </motion.div>
    </div>
  );
}
