"use client";
import React, { useEffect, useState } from "react";
import { Logo } from "./logo";
import { Container } from "./container";
import { Button } from "./ui/button";
import { IconBrandAndroid, IconMenu2, IconWorld, IconX } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { ModeToggle } from "./mode-toggle";
import { DOCS_URL, DOWNLOAD_URL, STATS_URL, WEB_APP_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

const navlinks = [
  { title: "How it works", href: "#how" },
  { title: "Safety", href: "#safety" },
  { title: "Leaders", href: "#leaders" },
  { title: "Why Monad", href: "#monad" },
  { title: "Stats", href: STATS_URL },
  { title: "Docs", href: DOCS_URL },
];

export const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-colors duration-300",
        scrolled
          ? "border-border bg-background/80 backdrop-blur-xl"
          : "border-transparent bg-background/0"
      )}
    >
      <DesktopNavbar />
      <MobileNavbar />
    </header>
  );
};

export const MobileNavbar = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex lg:hidden px-4 h-16 items-center justify-between relative">
      <Logo />
      <div className="flex items-center gap-2">
        <ModeToggle />
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="size-9 rounded-full border border-border bg-card flex items-center justify-center"
        >
          <IconMenu2 className="size-4" />
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, backdropFilter: "blur(16px)" }}
            exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 h-dvh w-full z-50 px-4 bg-background flex flex-col justify-between pb-8"
          >
            <div>
              <div className="flex h-16 items-center justify-between">
                <Logo />
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => setOpen(false)}
                  className="size-9 rounded-full border border-border bg-card flex items-center justify-center"
                >
                  <IconX className="size-4" />
                </button>
              </div>

              <div className="flex flex-col gap-6 my-10">
                {navlinks.map((item, index) => (
                  <motion.div
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: index * 0.06 }}
                    key={item.title}
                  >
                    <a
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="text-2xl text-foreground font-medium tracking-tight"
                    >
                      {item.title}
                    </a>
                  </motion.div>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Button asChild size="lg" variant="outline" className="w-full">
                <a href={WEB_APP_URL} onClick={() => setOpen(false)}>
                  <IconWorld /> Open web app
                </a>
              </Button>
              <Button asChild size="lg" className="w-full shadow-brand">
                <a href={DOWNLOAD_URL} onClick={() => setOpen(false)}>
                  <IconBrandAndroid /> Download for Android
                </a>
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const DesktopNavbar = () => {
  return (
    <Container className="h-16 items-center justify-between hidden lg:flex">
      <Logo />
      <nav aria-label="Main" className="flex items-center gap-8">
        {navlinks.map((item) => (
          <a
            key={item.title}
            href={item.href}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
          >
            {item.title}
          </a>
        ))}
      </nav>
      <div className="flex items-center gap-3">
        <ModeToggle />
        <Button asChild variant="outline">
          <a href={WEB_APP_URL}>
            <IconWorld /> Open web app
          </a>
        </Button>
        <Button asChild className="shadow-brand">
          <a href={DOWNLOAD_URL}>
            <IconBrandAndroid /> Download APK
          </a>
        </Button>
      </div>
    </Container>
  );
};
