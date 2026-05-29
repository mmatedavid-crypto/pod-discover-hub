import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";
const adminRpcClient = supabase as unknown as {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
};

type Options = {
  redirectToAuth?: boolean;
  allowTemporaryFallback?: boolean;
};

export function useAdminAccess(options: Options = {}) {
  const { redirectToAuth = true, allowTemporaryFallback = false } = options;
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user.id ?? null;

      if (!alive) return;
      setUserId(uid);

      if (!uid) {
        setIsAdmin(false);
        setLoading(false);
        if (redirectToAuth) navigate("/auth");
        return;
      }

      const { data: hasAdmin } = await adminRpcClient.rpc("has_role", {
        _user_id: uid,
        _role: "admin",
      });

      if (!alive) return;
      setIsAdmin(hasAdmin === true || (allowTemporaryFallback && uid === TEMP_ADMIN_USER_ID));
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [allowTemporaryFallback, navigate, redirectToAuth]);

  return { loading, isAdmin, userId };
}
