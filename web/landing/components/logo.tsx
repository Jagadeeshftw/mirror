import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/site";
import React from "react";

export const Logo = ({ className }: { className?: string }) => {
  return (
    <a
      href="#top"
      className={cn("flex items-center gap-2 text-foreground", className)}
      aria-label={`${BRAND} home`}
    >
      <LogoIcon className="size-6" />
      <span className="text-[15px] font-semibold tracking-tight">{BRAND}</span>
    </a>
  );
};

/** Mark: a filled half and its outlined reflection across a centre axis. */
export const LogoIcon = (props: React.SVGAttributes<SVGSVGElement>) => {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <rect width="24" height="24" rx="7" className="fill-brand" />
      <path d="M11 6.5a5.5 5.5 0 0 0 0 11V6.5Z" fill="white" />
      <path
        d="M13 6.5a5.5 5.5 0 0 1 0 11V6.5Z"
        stroke="white"
        strokeOpacity="0.85"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
};
