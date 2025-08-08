import { useEffect, useRef, useState } from "react";
import { LogOut, User, ChevronDown } from "lucide-react";
import { logoutUser } from "@/utils/auth";

export default function AccountMenu({ onAccountClick }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  const handleLogout = async () => {
    await logoutUser();
    window.location.href = "/";
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      {/* Profile Button */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="
          flex items-center gap-2 px-4 py-2 rounded-xl shadow
          bg-gradient-to-br from-emerald-500/80 to-teal-600/80
          hover:from-emerald-600 hover:to-teal-700
          border border-emerald-400/30 ring-1 ring-emerald-300/20
          text-white text-sm backdrop-blur-md transition-all
        "
      >
        <User size={18} />
        <ChevronDown
          size={16}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="
            absolute right-0 mt-2 w-52
            bg-zinc-900/90 backdrop-blur-lg
            rounded-xl shadow-lg border border-zinc-700/50
            text-sm text-white z-50 animate-fade-in
          "
        >
          <button
            onClick={() => {
              setOpen(false);
              onAccountClick();
            }}
            className="
              w-full flex items-center gap-2 px-4 py-3
              hover:bg-zinc-800/80 transition-colors
            "
          >
            <User size={16} />
            <span>Profile</span>
          </button>

          <div className="border-t border-zinc-700/50" />

          <button
            onClick={handleLogout}
            className="
              w-full flex items-center gap-2 px-4 py-3
              text-red-400 hover:bg-zinc-800/80 transition-colors
            "
          >
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      )}
    </div>
  );
}