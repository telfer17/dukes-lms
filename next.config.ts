import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // /admin/picks was folded into /admin/entrants — one screen for people,
      // payment and this round's picks, so the two can't drift apart. Kept as a
      // redirect rather than a 404 because it is the link an organiser has
      // bookmarked on their phone. Redirects are checked before the filesystem
      // AND before proxy.ts, so a signed-out request lands on /admin/entrants
      // and is then bounced to the login as usual.
      //
      // 307, not 308: a permanent redirect is cached by the browser more or
      // less forever, and the screen it points away from is one `git revert`
      // from existing again. Temporary costs nothing here — this is an admin
      // route with one user, not a hot public path.
      {
        source: "/admin/picks",
        destination: "/admin/entrants",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
