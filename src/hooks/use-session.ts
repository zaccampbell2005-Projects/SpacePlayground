import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** Current signed-in user (null when signed out), kept fresh via auth events. */
export function useSessionUser() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    supabase.auth.getUser().then(({ data: d }) => setUser(d.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  return user;
}
