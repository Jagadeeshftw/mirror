import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { WalletView } from "@/components/perpl/wallet-view";
import { isAccountQuery, wallet } from "@/lib/perpl/wallet";
import { PERPL_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ account: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { account } = await params;
  const label = /^\d+$/.test(account) ? `#${account}` : account.slice(0, 10);
  return {
    title: `Perpl account ${label}`,
    description: "Open positions, unrealised and realised PnL, estimated distance to liquidation, leverage history and recent fills of a Perpl account, read from Monad.",
    robots: { index: false },
  };
}

export default async function WalletPage({ params }: Props) {
  const { account } = await params;
  const q = decodeURIComponent(account).trim().replace(/^#/, "");
  if (!isAccountQuery(q)) notFound();
  const data = await wallet(q);
  return (
    <>
      <SiteHeader active={PERPL_URL} wide />
      <main id="content" className="flex-1">
        <WalletView data={data} />
      </main>
    </>
  );
}
