import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Warranty / Workshop / PHEV SUV Workshop / Known Issues pages were merged into /technical (2026-09-21).
  // TEMPORARY (307) on purpose: this restructuring is easy to back out of while it beds in. Switch to
  // `permanent: true` (308) once confirmed stable — browsers cache permanent redirects, so don't do it early.
  async redirects() {
    return [
      { source: "/warranty", destination: "/technical?tab=warranty", permanent: false },
      { source: "/workshop", destination: "/technical?tab=workshop", permanent: false },
      { source: "/workshop-phev-suv", destination: "/technical?tab=workshop", permanent: false },
      { source: "/known-issues", destination: "/technical?tab=issues", permanent: false },
    ];
  },
};

export default nextConfig;
