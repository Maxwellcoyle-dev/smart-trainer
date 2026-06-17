import { createClient, SupabaseClient } from "@supabase/supabase-js";

export function createSupabaseClient(
  url: string,
  key: string
): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

export type { SupabaseClient };
