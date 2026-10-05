"use client";
import { useTheme } from "next-themes";
import React from "react";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export const ModeToggle = ({ className }: { className?: string }) => {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label="Toggle light and dark theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className={cn(
        "relative size-9 shrink-0 cursor-pointer rounded-full border border-border bg-card text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center",
        className
      )}
    >
      <IconSun
        size={16}
        className="absolute rotate-0 scale-100 transition-all duration-300 dark:-rotate-90 dark:scale-0"
      />
      <IconMoon
        size={16}
        className="absolute rotate-90 scale-0 transition-all duration-300 dark:rotate-0 dark:scale-100"
      />
    </button>
  );
};
