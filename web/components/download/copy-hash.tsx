"use client";
import React, { useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";

/** Copies the APK's SHA-256 to the clipboard. No animation: the label changes for two seconds. */
export const CopyHash = ({ value }: { value: string }) => {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      setDone(false);
    }
  };
  return (
    <button type="button" onClick={copy} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
      {done ? <IconCheck className="size-3.5" aria-hidden /> : <IconCopy className="size-3.5" aria-hidden />}
      <span aria-live="polite">{done ? "Copied" : "Copy"}</span>
    </button>
  );
};
