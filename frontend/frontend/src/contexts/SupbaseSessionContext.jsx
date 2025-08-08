import React, { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const SupabaseSessionContext = createContext(null);

export function SupabaseSessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const currentSession = supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session);
        setUser(session?.user || null);
        setLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user || null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return (
    <SupabaseSessionContext.Provider value={{ session, user, loading }}>
      {children}
    </SupabaseSessionContext.Provider>
  );
}

export function useSupabaseSessionContext() {
  const context = useContext(SupabaseSessionContext);
  if (!context) {
    throw new Error("useSupabaseSessionContext must be used within a SupabaseSessionProvider");
  }
  return context;
}
