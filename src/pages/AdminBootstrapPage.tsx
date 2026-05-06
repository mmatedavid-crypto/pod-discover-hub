import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNoindex } from "@/lib/useNoindex";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

export default function AdminBootstrapPage() {
  useNoindex("Admin · Bootstrap — Podiverzum");
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id || null;
      if (!uid) {
        navigate("/auth");
        return;
      }
      setUserId(uid);
      setReady(true);
    })();
  }, [navigate]);

  const grantAdmin = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-bootstrap", { body: {} });
    setBusy(false);

    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Admin bootstrap failed");
      return;
    }

    toast.success("Admin access granted");
    navigate("/admin");
  };

  if (!ready) {
    return (
      <Layout>
        <div className="container mx-auto py-20 text-muted-foreground">Loading…</div>
      </Layout>
    );
  }

  if (userId !== TEMP_ADMIN_USER_ID) {
    return (
      <Layout>
        <div className="container mx-auto py-20 max-w-md">
          <h1 className="text-2xl font-semibold">Not allowed</h1>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto py-20 max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">Admin bootstrap</h1>
        <p className="text-sm text-muted-foreground">
          Temporary setup route for this signed-in admin user only.
        </p>
        <button
          onClick={grantAdmin}
          disabled={busy}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
        >
          {busy ? "Granting…" : "Grant admin access"}
        </button>
      </div>
    </Layout>
  );
}
