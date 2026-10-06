import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/site";
import Link from "next/link";
import React from "react";

export const Logo = ({ className, href = "/" }: { className?: string; href?: string }) => {
  return (
    <Link
      href={href}
      className={cn("flex items-center gap-2 text-foreground", className)}
      aria-label={`${BRAND} home`}
    >
      <LogoIcon className="size-6" />
      <span className="text-[15px] font-semibold tracking-tight">{BRAND}</span>
    </Link>
  );
};

/** Mark: the sail, a solid triangle and its reflection across a vertical axis (source: brand/svg/mark.svg). */
export const LogoIcon = (props: React.SVGAttributes<SVGSVGElement>) => {
  return (
    <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden {...props}>
      <rect width="32" height="32" rx="9" fill="#4B3BFF" />
      <path d="M15 7.5 6.5 24.5H15z" fill="#FFFFFF" />
      <path d="M17 7.5l8.5 17H17z" fill="#FFFFFF" fillOpacity="0.45" />
    </svg>
  );
};
