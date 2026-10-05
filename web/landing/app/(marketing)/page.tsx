import { Hero } from "@/components/hero";
import { CopyTicker } from "@/components/copy-ticker";
import { HowItWorks } from "@/components/how-it-works";
import { Safety } from "@/components/safety";
import { Stats } from "@/components/stats";
import { Leaderboard } from "@/components/leaderboard";
import { WhyMonad } from "@/components/why-monad";
import { BuiltWith } from "@/components/built-with";
import { FAQs } from "@/components/faqs";
import { CTA } from "@/components/cta";

export default function Home() {
  return (
    <div className="min-h-screen">
      <Hero />
      <CopyTicker />
      <HowItWorks />
      <Safety />
      <Stats />
      <Leaderboard />
      <WhyMonad />
      <BuiltWith />
      <FAQs />
      <CTA />
    </div>
  );
}
