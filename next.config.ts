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

      // /board and /grid merged into /leaderboard. These two links are in the
      // WhatsApp group, in the launch message and on people's home screens —
      // the whole point of the competition is that players open them on a
      // Saturday — so they keep working rather than 404ing.
      //
      // 307, like the one above: temporary costs nothing, and a permanent
      // redirect is cached by the browser more or less forever, which would be
      // a nuisance if either name is ever wanted again.
      {
        source: "/board",
        destination: "/leaderboard",
        permanent: false,
      },
      {
        source: "/grid",
        destination: "/leaderboard",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
