import { useSupabaseSessionContext } from "@/contexts/SupabaseSessionContext";

export function useSupabaseSession() {
  return useSupabaseSessionContext();
}
