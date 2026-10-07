// Home. Funded accounts see their follows; accounts with no deposit see watch mode (real copies on
// the team-run demo follower). While the Mirror backend hasn't answered: a skeleton for 5 s, then
// what has loaded, then "Can't reach Mirror" with watch mode read straight from Monad.
import React from "react";
import { useHomeState } from "../../state/home";
import { AppBar } from "../../ui/chrome";
import { FundedHome } from "../../ui/homeFunded";
import { Screen, Scroll } from "../../ui/kit";
import { LaptopHome } from "../../ui/laptop/LaptopHome";
import { useLayout } from "../../ui/layout";
import { HomeSkeleton, SlowCard, WatchHome } from "../../ui/watchHome";

export default function Home() {
  return useLayout() === "laptop" ? <LaptopHome /> : <PhoneHome />;
}

function PhoneHome() {
  const s = useHomeState();
  return (
    <Screen testID="home.screen">
      <AppBar brand />
      <Scroll testID="home.scroll">
        {s.mode === "skeleton" ? <HomeSkeleton walletCNS={s.walletCNS} waitedMs={s.waitedMs} /> : null}
        {s.mode === "slow" ? <SlowCard walletCNS={s.walletCNS} waitedMs={s.waitedMs} onWatch={s.watch} onRetry={s.retry} /> : null}
        {s.mode === "watch" || s.mode === "watchDown" ? <WatchHome cfg={s.cfg} walletCNS={s.walletCNS} down={s.mode === "watchDown"} onRetry={s.retry} /> : null}
        {s.mode === "funded" && s.totals ? <FundedHome totals={s.totals} mirrorDown={s.phase === "down"} monadDown={s.rpc.isError} onRetry={s.retry} /> : null}
      </Scroll>
    </Screen>
  );
}
