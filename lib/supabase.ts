import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Server-only client, built with the service role key so it bypasses RLS.
// Never import this from a "use client" component or expose the key via a
// NEXT_PUBLIC_ variable — it must only ever run in API routes.

let client: SupabaseClient | null = null;
let initialized = false;

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabase(): SupabaseClient | null {
  if (initialized) return client;
  initialized = true;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return null;
  }

  client = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  return client;
}
