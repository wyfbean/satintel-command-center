import { GlobeShell } from "@/components/globe/globe-shell";

// WebGL/3D page rendered entirely client-side; do not prerender.
export const dynamic = "force-dynamic";

export default function GlobePage() {
  return <GlobeShell />;
}
