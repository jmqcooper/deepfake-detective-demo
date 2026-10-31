import { varlockNextConfigPlugin } from "@varlock/nextjs-integration/plugin";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // The collaborative/device preview reaches the dev server over loopback.
  // Without this, Next serves the HTML but blocks its own client bundle, so
  // responsive and kiosk QA only ever sees the server-rendered loading state.
  allowedDevOrigins: ["127.0.0.1"],
};

// The image supplies its values at boot, so nothing is frozen into the build.
export default varlockNextConfigPlugin({ freezeIntoBundle: false })(nextConfig);
