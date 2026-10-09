import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Disabled: this app is auth-gated and per-user throughout (every page
  // reads cookies/Supabase session), so there is nothing worth statically
  // prerendering - Cache Components' prerender pass was erroring on
  // Date.now() usage inside the auth/session code path.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
