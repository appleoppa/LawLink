"use client";

import { MotionConfig } from "framer-motion";

/**
 * Keeps Framer Motion aligned with the user's OS-level motion preference.
 * Domain components remain responsible for deciding whether motion is useful.
 */
export function AppMotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
