"use client";
import React, { useState } from "react";
import { Container } from "./container";
import { Eyebrow, Heading } from "./heading";
import { IconPlus } from "@tabler/icons-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { BETA_DEPOSIT_CAP, BRAND } from "@/lib/site";

const QUESTIONS = [
  {
    question: `Can ${BRAND} withdraw my money?`,
    answer: `No. Your AUSD sits in your own contract account. The copy keeper can only submit copies that pass your rules; withdrawing, changing rules, pausing and closing all require your passkey. There is no code path that sends collateral to anyone but you, and a withdraw call from the keeper reverts.`,
  },
  {
    question: "What happens when a leader's trade breaks one of my rules?",
    answer: `The contract rejects the copy before it reaches Perpl. The app shows which rule blocked it and the numbers, for example: "Leader opened 20x BTC long. Your max leverage is 5x. Not copied."`,
  },
  {
    question: "Which rules can I set?",
    answer:
      "Up to four leaders, each with a sizing ratio (a percentage of the leader's position), max leverage, allowed markets with a max notional per market, max slippage against the mark price, a daily loss stop, a high-water-mark drawdown stop and an expiry date. Your allocation is simply what you deposit. Every rule is checked onchain on every copied order.",
  },
  {
    question: "Do I need a seed phrase, a wallet extension or MON for gas?",
    answer:
      "No. Your account is a passkey created with one fingerprint or face prompt, and it restores on a new phone from the passkey alone. Transactions are gasless for you, including withdrawals.",
  },
  {
    question: "How fast are copies?",
    answer:
      "Built to land within about a second of the leader's fill: we measured Monad blocks at about 290 ms and finality about 550 ms after a block is proposed. Every copy shows its measured latency, its commit state (Proposed, Voted, Finalized) and a link to the transaction on MonadVision.",
  },
  {
    question: "How are leaders ranked?",
    answer:
      "Automatically, from onchain Perpl data: PnL, drawdown, win rate and consistency. Nansen wallet intelligence (coming) adds labels like Smart Trader or Fund and cross-venue history.",
  },
  {
    question: "Is the contract audited?",
    answer: `Not yet. That's why deposits are capped at ${BETA_DEPOSIT_CAP} per account during the beta. Copy trading perpetuals is risky and you can lose what you deposit.`,
  },
  {
    question: "Why Android only?",
    answer:
      "We're starting with an Android APK so we can ship and iterate quickly during the beta. Other platforms will follow.",
  },
];

export const FAQs = () => {
  return (
    <section id="faqs" className="border-t border-border py-20 md:py-28 lg:py-32">
      <Container className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Eyebrow>FAQ</Eyebrow>
          <Heading>Questions, answered plainly.</Heading>
        </div>
        <div className="flex flex-col gap-3">
          {QUESTIONS.map((q) => (
            <Question key={q.question} {...q} />
          ))}
        </div>
      </Container>
    </section>
  );
};

const Question = ({ question, answer }: { question: string; answer: string }) => {
  const [open, setOpen] = useState(false);

  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className={cn(
        "w-full cursor-pointer overflow-hidden rounded-2xl border bg-card p-5 text-left transition-colors md:p-6",
        open ? "border-brand/30" : "border-border hover:border-foreground/15"
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-base font-semibold tracking-tight text-foreground md:text-lg">
          {question}
        </h3>
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full transition-all duration-300",
            open ? "rotate-45 bg-primary text-primary-foreground" : "bg-muted text-foreground"
          )}
        >
          <IconPlus className="size-4" />
        </span>
      </div>
      <motion.div
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-hidden"
      >
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground text-pretty">
          {answer}
        </p>
      </motion.div>
    </button>
  );
};
