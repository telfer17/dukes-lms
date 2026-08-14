// resolveSiteUrl runs at module scope in the root layout, so anything it lets
// through becomes the metadataBase for every page — and anything it throws on
// takes the whole site down. Both halves are pinned here.

import { describe, expect, it, vi } from "vitest";
import { LOCAL_SITE_URL, resolveSiteUrl } from "@/lib/site-url";

/** Swallows the reject message so a passing run stays quiet, and counts it. */
function withReporter() {
  const onReject = vi.fn();
  return {
    onReject,
    resolve: (configured?: string, vercelHost?: string) =>
      resolveSiteUrl(configured, vercelHost, onReject),
  };
}

describe("resolveSiteUrl", () => {
  it("uses a configured https url", () => {
    const { resolve, onReject } = withReporter();
    expect(resolve("https://dukes.example", undefined)).toBe(
      "https://dukes.example/"
    );
    expect(onReject).not.toHaveBeenCalled();
  });

  it("accepts plain http (local and self-hosted setups)", () => {
    const { resolve, onReject } = withReporter();
    expect(resolve("http://192.168.0.10:3001", undefined)).toBe(
      "http://192.168.0.10:3001/"
    );
    expect(onReject).not.toHaveBeenCalled();
  });

  it("builds an https url from the bare Vercel host", () => {
    const { resolve } = withReporter();
    expect(resolve(undefined, "dukes-lms.vercel.app")).toBe(
      "https://dukes-lms.vercel.app/"
    );
  });

  it("prefers the configured url over the Vercel host", () => {
    const { resolve } = withReporter();
    expect(resolve("https://dukes.example", "dukes-lms.vercel.app")).toBe(
      "https://dukes.example/"
    );
  });

  // The CodeRabbit finding: parseable is not the same as usable. A share card
  // url has to be fetchable over http(s); everything else falls back loudly.
  it.each([
    "ftp://dukes.example/site",
    "file:///Users/david/site",
    "data:text/html,<h1>hi</h1>",
    "javascript:alert(1)",
    "mailto:someone@example.com",
  ])("falls back for a non-http protocol: %s", (value) => {
    const { resolve, onReject } = withReporter();
    expect(resolve(value, undefined)).toBe(LOCAL_SITE_URL);
    expect(onReject).toHaveBeenCalledOnce();
  });

  // Pre-existing behaviour that must survive the protocol check.
  it.each(["", "   ", "dukes.example.com", "https://"])(
    "falls back for a blank or unparseable value: %j",
    (value) => {
      const { resolve, onReject } = withReporter();
      expect(resolve(value, undefined)).toBe(LOCAL_SITE_URL);
      if (value.trim() !== "") expect(onReject).toHaveBeenCalledOnce();
    }
  );

  it("falls back to local when nothing is set, without complaining", () => {
    const { resolve, onReject } = withReporter();
    expect(resolve(undefined, undefined)).toBe(LOCAL_SITE_URL);
    expect(onReject).not.toHaveBeenCalled();
  });
});
