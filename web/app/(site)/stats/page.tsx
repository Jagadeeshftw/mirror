import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { StatsView } from "@/components/stats/stats-view";
import { STATS_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Public stats",
  description:
    "Mirror's public traction stats, read from Monad mainnet: accounts, deposits, copies executed and blocked, latency, and every executed copy with its transaction.",
  alternates: { canonical: "/stats" },
};

export default function StatsPage() {
  return (
    <>
      <SiteHeader active={STATS_URL} />
      <main id="content" className="flex-1">
        <StatsView />
      </main>
    </>
  );
}
