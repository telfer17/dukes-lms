import "server-only";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url) {
  throw new Error("Missing required env var NEXT_PUBLIC_SUPABASE_URL");
}
if (!secretKey) {
  throw new Error("Missing required env var SUPABASE_SECRET_KEY");
}

// Server-only privileged client using the secret key. Bypasses RLS —
// the "server-only" import makes any client-component import fail at build.
export const supabaseServer = createClient(url, secretKey, {
  auth: {
    persistSession: false,
  },
});
