"use client";
import { useTheme } from "next-themes";
import React from "react";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/** Light/dark toggle. `still` drops the icon transition (docs, stats and download have no motion). */
export const ModeToggle = ({ className, still = false }: { className?: string; still?: boolean }) => {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label="Toggle light and dark theme"
      title="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className={cn(
        "relative size-9 shrink-0 cursor-pointer rounded-full border border-border bg-card text-muted-foreground hover:text-foreground flex items-center justify-center",
        !still && "transition-colors",
        className
      )}
    >
      <IconSun
        size={16}
        aria-hidden
        className={cn(
          "absolute dark:scale-0",
          !still && "rotate-0 scale-100 transition-all duration-300 dark:-rotate-90"
        )}
      />
      <IconMoon
        size={16}
        aria-hidden
        className={cn(
          "absolute scale-0 dark:scale-100",
          !still && "rotate-90 transition-all duration-300 dark:rotate-0"
        )}
      />
    </button>
  );
};
