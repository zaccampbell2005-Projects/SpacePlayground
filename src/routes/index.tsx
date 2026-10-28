import { createFileRoute } from "@tanstack/react-router";
import CosmosApp from "@/components/cosmos/CosmosApp";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Quantum·Relativity Cosmos — Astrophysics Sandbox" },
      { name: "description", content: "Forge planets, spin up black holes and watch spacetime ripple in a relativistic N-body astrophysics sandbox." },
      { property: "og:title", content: "Quantum·Relativity Cosmos Sandbox" },
      { property: "og:description", content: "Relativistic N-body physics, accretion disks, gravitational waves and a planet forge — in your browser." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CosmosApp,
});
