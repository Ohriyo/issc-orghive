import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { fadeReveal, focusReveal, usePrefersReducedMotion } from './motion';

export interface RevealProps {
  children: ReactNode;
  className?: string;
}

/**
 * Scroll reveal: the content comes into focus the first time it enters the viewport.
 * Under prefers-reduced-motion it appears without movement or blur.
 */
export function Reveal({ children, className }: RevealProps) {
  const reduced = usePrefersReducedMotion();
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount: 0.15 }}
      variants={reduced ? fadeReveal : focusReveal}
    >
      {children}
    </motion.div>
  );
}
