import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { exchangeSupabaseSession } from "@/utils/account";

export default function EmailConfirmed() {
  const nav = useNavigate();
  const { search, hash } = useLocation();
  const [msg, set] = useState("Setting up your session…");

  useEffect(() => {
    (async () => {
      let session = null;

      /* ═════════ 1. PKCE (query ?code) ═════════ */
      const code = new URLSearchParams(search).get("code");
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession({ authCode: code });
        if (error) { console.error("exchangeCodeForSession:", error); set("Auth handshake failed."); return; }
        session = data.session;
      }

      /* ═════════ 2. Hash (#access_token) fallback ═════════ */
      if (!session && hash.startsWith("#access_token")) {
        const params = new URLSearchParams(hash.slice(1));
        const access_token  = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        if (access_token && refresh_token) {
          const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) { console.error("setSession:", error); set("Auth handshake failed."); return; }
          session = data.session;
        }
      }

      /* ═════════ 3. Persisted (localStorage) ═════════ */
      if (!session) {
        const { data: { session: persisted } } = await supabase.auth.getSession();
        session = persisted;
      }

      if (!session) { console.error("❌ No Supabase session"); set("No session found."); return; }

      console.log("📦 Supabase session object:", session);
      console.log("📨 Access token (short):", session?.access_token?.slice(0, 24) + "...");

      /* ═════════ 4. Swap for platform JWT ═════════ */
      const result = await exchangeSupabaseSession(session.access_token);
      if (!result?.accessToken) { set("Internal login failed."); return; }

      nav("/app", { replace: true });
    })();
  }, [search, hash, nav]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white">
      <h2 className="text-3xl font-bold mb-4 bg-gradient-to-r from-purple-400 to-emerald-400 bg-clip-text text-transparent animate-pulse">
        ✅ Email confirmed!
      </h2>
      <p className="mb-8 text-zinc-400">{msg}</p>
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-purple-500 animate-spin-slow"></div>
        <div className="absolute inset-2 rounded-full border-4 border-emerald-500 animate-ping"></div>
        <div className="absolute inset-4 rounded-full bg-purple-600"></div>
      </div>
    </div>
  );
}
