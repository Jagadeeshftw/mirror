import React from "react";
import { Logo } from "./logo";
import { Container } from "./container";
import { ModeToggle } from "./mode-toggle";
import { IconBrandAndroid } from "@tabler/icons-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { APK_URL, BETA_DEPOSIT_CAP, BRAND, CONTRACT_URL, DOCS_URL } from "@/lib/site";

export const Footer = () => {
  const product = [
    { title: "How it works", href: "#how" },
    { title: "Safety model", href: "#safety" },
    { title: "Leaderboard", href: "#leaders" },
    { title: "Why Monad", href: "#monad" },
    { title: "FAQ", href: "#faqs" },
  ];
  const resources = [
    { title: "Docs", href: DOCS_URL },
    { title: "Download APK", href: APK_URL },
    { title: "Vault contract", href: CONTRACT_URL },
    { title: "Built with", href: "#stack" },
  ];

  return (
    <footer className="relative overflow-hidden border-t border-border py-14 md:py-20 perspective-distant">
      <Container className="relative z-20 grid grid-cols-2 gap-10 lg:grid-cols-5">
        <div className="col-span-2 flex flex-col items-start gap-4">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground">
            Copy the best onchain traders. Keep your limits.
          </p>
          <Button asChild className="shadow-brand">
            <a href={APK_URL}>
              <IconBrandAndroid /> Download APK
            </a>
          </Button>
        </div>
        <FooterCol title="Product" items={product} />
        <FooterCol title="Resources" items={resources} />
        <div className="col-span-2 flex flex-col gap-3 lg:col-span-1">
          <h4 className="text-sm font-medium text-foreground">Built on</h4>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Monad · Perpl · AUSD by Agora · Mera passkeys · Envio · Nansen
          </p>
        </div>
      </Container>

      <Container className="relative z-20 mt-12 border-t border-border pt-6">
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
          {BRAND} is beta software. Smart contracts are unaudited and deposits
          are capped at {BETA_DEPOSIT_CAP} per account. Perpetual futures are
          leveraged and risky; copying a trader does not guarantee their
          results. Nothing here is financial advice. Figures on this page are
          illustrative.
        </p>
        <div className="mt-6 flex flex-col-reverse items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p className="text-sm text-muted-foreground">
            &copy; 2026 {BRAND}. All rights reserved.
          </p>
          <div className="flex items-center gap-5 text-sm text-muted-foreground">
            <a href="#" className="hover:text-foreground">Privacy</a>
            <a href="#" className="hover:text-foreground">Terms</a>
            <ModeToggle />
          </div>
        </div>
      </Container>

      {/* template perspective grid, recoloured to the border token */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -inset-x-[150%] -inset-y-40 h-[200%]",
          "[background-size:40px_40px]",
          "[background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)]",
          "mask-radial-from-40% opacity-70"
        )}
        style={{ transform: "rotateX(60deg)" }}
      />
    </footer>
  );
};

const FooterCol = ({ title, items }: { title: string; items: { title: string; href: string }[] }) => (
  <div className="flex flex-col gap-3">
    <h4 className="text-sm font-medium text-foreground">{title}</h4>
    <ul className="flex list-none flex-col gap-2">
      {items.map((item) => (
        <li key={item.title}>
          <a href={item.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            {item.title}
          </a>
        </li>
      ))}
    </ul>
  </div>
);
