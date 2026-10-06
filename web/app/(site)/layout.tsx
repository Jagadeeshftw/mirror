import React from "react";
import { SiteFooter } from "@/components/site-footer";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {children}
      <SiteFooter />
    </div>
  );
}
