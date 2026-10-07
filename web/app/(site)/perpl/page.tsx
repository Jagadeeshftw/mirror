import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { OverviewView } from "@/components/perpl/overview-view";
import { overview } from "@/lib/perpl/overview";
import { PERPL_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Perpl analytics",
  description:
    "Perpl-wide analytics and risk, read from Monad: volume, open interest, funding, liquidations, concentration, accounts near liquidation and a drill-down for any Perpl account.",
  alternates: { canonical: PERPL_URL },
};

export default async function PerplPage() {
  const data = await overview();
  return (
    <>
      <SiteHeader active={PERPL_URL} wide />
      <main id="content" className="flex-1">
        <OverviewView data={data} />
      </main>
    </>
  );
}
