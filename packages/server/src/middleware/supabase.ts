import { createMiddleware } from "hono/factory";
import { createSupabaseClient, type SupabaseClient } from "@smart-trainer/core";

declare module "hono" {
  interface ContextVariableMap {
    supabase: SupabaseClient;
    userId: string;
  }
}

export const getSupabase = createMiddleware(async (c, next) => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");

  const supabase = createSupabaseClient(url, key);
  c.set("supabase", supabase);

  // Single-user: authenticate via Bearer token (Supabase JWT or personal token)
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (!error && user) {
      c.set("userId", user.id);
    }
  }

  await next();
});
