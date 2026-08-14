// Where the app thinks it is served from — the base for absolute share-card
// urls (app/layout.tsx `metadataBase`).
//
// Pure and dependency-free so it can be unit-tested; the layout can't be
// imported in a test because it pulls in next/font.
//
// Every failure mode ends at LOCAL_SITE_URL rather than throwing. This runs at
// module scope in the root layout, so an exception here takes down EVERY page,
// not just the og:image. A bad value must cost a wrong share card and a loud
// log, nothing more.

// Stored in normalised form (trailing slash) so that EVERY return path from
// resolveSiteUrl — fallback or success — hands back the same shape. Returning
// the raw constant from the fallbacks and a `new URL().toString()` from the
// success path meant two spellings of one url, which is exactly the sort of
// thing a caller ends up comparing strings against.
export const LOCAL_SITE_URL = "http://localhost:3001/";

// A share card url has to be fetchable by Facebook/WhatsApp/X. Anything that
// isn't http(s) — ftp:, file:, javascript:, data: — parses perfectly happily as
// a URL and would sail through a bare `new URL()` check, producing metadata no
// scraper can use and, in the javascript:/data: case, a url worth nobody
// echoing into a page. Protocol is checked, not just parseability.
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * @param configured  NEXT_PUBLIC_SITE_URL — wins once there's a custom domain.
 * @param vercelHost  VERCEL_PROJECT_PRODUCTION_URL — a bare host, no scheme.
 *                    Vercel sets it on every deployment, no configuration.
 * @param onReject    Reporter for an unusable value. Defaults to console.error.
 */
export function resolveSiteUrl(
  configured: string | undefined,
  vercelHost: string | undefined,
  onReject: (message: string) => void = console.error
): string {
  const fromEnv = configured?.trim();
  const fromVercel = vercelHost?.trim();
  // Blank counts as unset: `??` would accept the empty string a cleared Vercel
  // dashboard field leaves behind.
  const candidate =
    fromEnv || (fromVercel ? `https://${fromVercel}` : "") || LOCAL_SITE_URL;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    onReject(
      `Ignoring unusable site URL ${JSON.stringify(candidate)} — falling back to ${LOCAL_SITE_URL}. Set NEXT_PUBLIC_SITE_URL to an absolute url including https://`
    );
    return LOCAL_SITE_URL;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    onReject(
      `Ignoring unusable site URL ${JSON.stringify(candidate)} — falling back to ${LOCAL_SITE_URL}. Only http:// and https:// are usable for share cards.`
    );
    return LOCAL_SITE_URL;
  }

  return parsed.toString();
}
