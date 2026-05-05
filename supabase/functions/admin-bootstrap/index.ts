import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new Error("Not authenticated");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Not authenticated");
    if (userData.user.id !== TEMP_ADMIN_USER_ID) throw new Error("Not allowed");

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { error } = await adminClient
      .from("user_roles")
      .upsert(
        { user_id: TEMP_ADMIN_USER_ID, role: "admin" },
        { onConflict: "user_id,role" },
      );

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error";
    return new Response(JSON.stringify({ error: message }), {
      status: message === "Not allowed" ? 403 : 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
