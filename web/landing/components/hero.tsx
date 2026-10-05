"use client";
import React from "react";
import { motion } from "motion/react";
import {
  IconArrowRight,
  IconBrandAndroid,
  IconFingerprint,
  IconGasStationOff,
  IconLockAccess,
} from "@tabler/icons-react";
import { Container } from "./container";
import { Button } from "./ui/button";
import { PointerHighlight } from "./ui/pointer-highlight";
import { DottedGlowBackground } from "./ui/dotted-glow-background";
import { PhoneFrame } from "./phone/app-ui";
import { HomeScreen } from "./phone/home-screen";
import { FollowSheetScreen } from "./phone/follow-sheet";
import { APK_URL, BRAND, DOCS_URL } from "@/lib/site";

const ease = [0.22, 1, 0.36, 1] as const;

export const Hero = () => {
  return (
    <section id="top" className="relative overflow-hidden pt-8 md:pt-14 lg:pt-16 pb-16 md:pb-24">
      {/* soft accent wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-[-10%] h-[420px] w-[480px] md:h-[640px] md:w-[820px] rounded-full bg-brand/[0.07] md:bg-brand/10 blur-3xl dark:bg-brand/15"
      />
      <Container className="relative grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-6">
        <div>
          <motion.a
            href="#safety"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease }}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand">
              Beta
            </span>
            Android · Built on Monad · Trades on Perpl
            <IconArrowRight className="size-3" />
          </motion.a>

          <motion.h1
            initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.7, ease, delay: 0.05 }}
            className="mt-6 font-display text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.04em] text-foreground sm:text-6xl lg:text-[4.25rem]"
          >
            Copy the best onchain traders.
            <PointerHighlight
              containerClassName="mt-2 inline-block"
              rectangleClassName="rounded-lg border-brand/50 bg-brand-soft/70 dark:bg-brand-soft/60"
              pointerClassName="text-brand size-5"
            >
              <span className="relative z-10 block px-2 text-brand">
                Keep your limits.
              </span>
            </PointerHighlight>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease, delay: 0.2 }}
            className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg text-pretty"
          >
            {BRAND} follows top traders on Perpl from your Android phone. A
            smart contract checks your limits on every copied order. It can
            trade for you. It can never withdraw.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease, delay: 0.3 }}
            className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <Button asChild size="lg" className="shadow-brand">
              <a href={APK_URL}>
                <IconBrandAndroid className="size-5" />
                Download for Android
                <span className="rounded-full bg-white/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide dark:bg-black/15">
                  APK
                </span>
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={DOCS_URL}>
                Read the docs <IconArrowRight />
              </a>
            </Button>
          </motion.div>

          <motion.ul
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.08, delayChildren: 0.45 } } }}
            className="mt-10 grid grid-cols-1 gap-3 text-sm text-muted-foreground sm:grid-cols-3 sm:gap-4"
          >
            {[
              { icon: IconFingerprint, text: "Passkey account. No seed phrase." },
              { icon: IconLockAccess, text: "Can trade. Can't withdraw." },
              { icon: IconGasStationOff, text: "Gasless. You never need MON." },
            ].map(({ icon: Icon, text }) => (
              <motion.li
                key={text}
                variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
                className="flex items-center gap-2"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground">
                  <Icon className="size-3.5" />
                </span>
                {text}
              </motion.li>
            ))}
          </motion.ul>
        </div>

        <HeroPhones />
      </Container>
    </section>
  );
};

const HeroPhones = () => {
  return (
    <div className="relative mx-auto h-[620px] w-full max-w-[600px] md:h-[700px]">
      <DottedGlowBackground
        className="pointer-events-none mask-radial-to-65% mask-radial-at-center"
        opacity={0.55}
        gap={14}
        radius={1.4}
        colorLightVar="--muted-foreground"
        glowColorLightVar="--brand"
        colorDarkVar="--muted-foreground"
        glowColorDarkVar="--brand"
        backgroundOpacity={0}
        speedMin={0.3}
        speedMax={1.4}
        speedScale={1}
      />

      {/* back phone: follow sheet (hidden on small screens) */}
      <motion.div
        initial={{ opacity: 0, y: 40, rotate: -8 }}
        animate={{ opacity: 1, y: 0, rotate: -6 }}
        transition={{ duration: 0.9, ease, delay: 0.35 }}
        className="absolute left-[2%] top-12 hidden origin-bottom sm:block"
      >
        <motion.div
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        >
          <PhoneFrame className="scale-[0.9] opacity-95">
            <FollowSheetScreen />
          </PhoneFrame>
        </motion.div>
      </motion.div>

      {/* front phone: home with live copy feed */}
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease, delay: 0.15 }}
        className="absolute left-1/2 top-4 -translate-x-1/2 sm:left-auto sm:right-[2%] sm:translate-x-0"
      >
        <PhoneFrame>
          <HomeScreen />
        </PhoneFrame>
      </motion.div>
    </div>
  );
};
