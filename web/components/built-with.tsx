"use client";
import React from "react";
import { motion } from "motion/react";
import { Container } from "./container";
import { Eyebrow, Heading } from "./heading";
import { GlowingEffect } from "./ui/glowing-effect";

const STACK = [
  { name: "Monad", role: "Chain", text: "Your contract account lives here. Sub-second blocks and fast finality make onchain rule checks on every order practical." },
  { name: "Perpl", role: "Exchange", text: "The onchain perpetuals exchange where leaders trade and your copies are filled." },
  { name: "AUSD by Agora", role: "Balance", text: "Your balance is held in AUSD, a dollar stablecoin, and is always visible in the app." },
  { name: "Mera", role: "Accounts", text: "Passkey accounts. One fingerprint or face prompt creates it. No seed phrase, no extension." },
  { name: "Envio", role: "Indexing", text: "HyperIndex over Perpl and Mirror events: leader stats, follower PnL per leader and the public stats page." },
  { name: "Nansen", role: "Intelligence · coming", text: "Wallet labels and cross-venue history that will feed the leader ranking score." },
];

export const BuiltWith = () => {
  return (
    <section id="stack" className="py-20 md:py-28 lg:py-32">
      <Container>
        <Eyebrow>Built with</Eyebrow>
        <Heading className="max-w-3xl">Standing on a serious stack.</Heading>
        <div className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 md:mt-16">
          {STACK.map((s, i) => (
            <motion.div
              key={s.name}
              initial={{ opacity: 0, y: -10, filter: "blur(10px)" }}
              whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.5, ease: "easeOut", delay: i * 0.07 }}
              className="relative rounded-2xl border border-border p-1"
            >
              <GlowingEffect variant="brand" spread={36} glow disabled={false} proximity={64} inactiveZone={0.01} borderWidth={1.5} />
              <div className="relative h-full rounded-xl bg-card p-5 md:p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-xl font-semibold tracking-tight text-foreground">{s.name}</h3>
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{s.role}</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground text-pretty">{s.text}</p>
              </div>
            </motion.div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Names are used to describe integrations only. No affiliation or endorsement is implied.
        </p>
      </Container>
    </section>
  );
};
