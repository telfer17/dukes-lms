import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  );
}

// Browser-safe client using the publishable key (anon-level access only).
// Intended for future public reads; predictions writes must go through
// the server route, since RLS blocks anon writes.
export const supabaseBrowser = createClient(url, publishableKey);
