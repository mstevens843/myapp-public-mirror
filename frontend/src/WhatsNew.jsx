import React, { useEffect, useState } from "react";
import whatsNew from "../whatsNew.json";

/**
 * WhatsNew component
 *
 * Displays a modal listing the latest release notes on first visit after
 * a version bump.  Users can dismiss the panel, which stores a flag
 * keyed by version in localStorage.  A small link in the header will
 * dispatch an `openWhatsNew` event to reopen the panel at any time.
 */
export default function WhatsNew() {
  const [open, setOpen] = useState(false);

  // Determine the version key based off the imported JSON.  The version
  // string should correspond to the most recent entry in CHANGELOG.md or
  // other release metadata.  If the user has not dismissed the current
  // version, open the panel on mount.
  useEffect(() => {
    const key = `whatsNewDismissed_${whatsNew.version}`;
    const dismissed = localStorage.getItem(key);
    if (!dismissed) {
      setOpen(true);
    }

    // Listen for external open requests via a custom event.  This allows
    // header buttons or menu items to trigger the panel.
    const handleOpen = () => setOpen(true);
    window.addEventListener("openWhatsNew", handleOpen);
    return () => window.removeEventListener("openWhatsNew", handleOpen);
  }, []);

  const handleClose = () => {
    const key = `whatsNewDismissed_${whatsNew.version}`;
    localStorage.setItem(key, "true");
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 max-w-md w-[90%] text-zinc-200 shadow-xl">
        <h2 className="text-xl font-bold mb-3 text-white">What&apos;s New</h2>
        <ul className="list-disc list-inside space-y-2 text-sm">
          {Array.isArray(whatsNew.updates) &&
            whatsNew.updates.map((entry, idx) => (
              <li key={idx}>{entry}</li>
            ))}
        </ul>
        <button
          onClick={handleClose}
          className="mt-4 px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}