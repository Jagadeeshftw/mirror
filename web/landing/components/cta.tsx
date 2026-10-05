"use client";
import React from "react";
import { motion } from "motion/react";
import { IconArrowRight, IconBrandAndroid } from "@tabler/icons-react";
import { Container } from "./container";
import { Button } from "./ui/button";
import { DottedGlowBackground } from "./ui/dotted-glow-background";
import { APK_URL, BETA_DEPOSIT_CAP, DOCS_URL } from "@/lib/site";

export const CTA = () => {
  return (
    <section id="download" className="pb-20 md:pb-28">
      <Container>
        <div className="relative overflow-hidden rounded-[2rem] border border-border bg-card px-6 py-16 text-center md:px-12 md:py-24">
          <DottedGlowBackground
            className="pointer-events-none mask-radial-to-60% mask-radial-at-center"
            opacity={0.6}
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
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="relative"
          >
            <h2 className="mx-auto max-w-2xl text-[2rem] font-semibold leading-[1.08] tracking-[-0.035em] text-foreground md:text-5xl text-balance">
              Follow the best. On your terms.
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-base text-muted-foreground md:text-lg">
              Install the beta, create your account with a fingerprint and fund
              it with up to {BETA_DEPOSIT_CAP}.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="w-full shadow-brand sm:w-auto">
                <a href={APK_URL}>
                  <IconBrandAndroid className="size-5" /> Download the APK
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <a href={DOCS_URL}>
                  Read the docs <IconArrowRight />
                </a>
              </Button>
            </div>
            <p className="mt-5 font-mono text-[11px] text-muted-foreground">
              Android APK · Sideload install · Beta software
            </p>
          </motion.div>
        </div>
      </Container>
    </section>
  );
};
