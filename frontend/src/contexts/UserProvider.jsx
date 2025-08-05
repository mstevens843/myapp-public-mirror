import { createContext, useContext, useEffect, useState } from "react";
import { getUserProfile } from "@/utils/api";
import { toast } from "sonner";

const UserContext = createContext(null);

export const UserProvider = ({ children }) => {
  const [profile, setProfile] = useState({});
  const [loading, setLoading] = useState(true);

  const refreshProfile = async () => {
    try {
      const data = await getUserProfile();                 // ← /auth/me payload
      if (!data) return setLoading(false);

      // 🔥  FLATTEN EVERYTHING WE ACTUALLY NEED
      const flat = {
        ...data.user,                                       // id, username, email, type, phantomPublicKey…
        plan:                data.plan?.plan,
        subscriptionStatus:  data.plan?.subscriptionStatus,
        usage:               data.plan?.usage,
        usageResetAt:        data.plan?.usageResetAt,
        credits:             data.plan?.credits,
        preferences:         data.preferences,
        telegram:            data.telegram,
        activeWallet:        data.activeWallet,
        activeWalletId:      data.activeWallet?.id ?? null,
        wallets:             data.wallets ?? [],
        counts:              data.counts,
      };

      setProfile(flat);
    } catch (err) {
      console.error("❌ Failed to load user profile:", err);
      toast.error("Failed to load user profile.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refreshProfile(); }, []);

  return (
    <UserContext.Provider value={{ ...profile, refreshProfile, loading }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const ctx = useContext(UserContext);
  if (ctx === null) throw new Error("❌ useUser must be used inside a <UserProvider>");
  return ctx;
};
