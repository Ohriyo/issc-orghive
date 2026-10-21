import type { Medal } from '../presenters/leaderboard-model';

/** Static class names per medal (Tailwind needs them whole). */
export const MEDAL_STYLES: Record<Medal, { ink: string; band: string; place: string }> = {
  gold: { ink: 'text-medal-gold-ink', band: 'bg-medal-gold-band', place: '1st place' },
  silver: { ink: 'text-medal-silver-ink', band: 'bg-medal-silver-band', place: '2nd place' },
  bronze: { ink: 'text-medal-bronze-ink', band: 'bg-medal-bronze-band', place: '3rd place' },
};

const CONFETTI_COLORS = [
  'bg-medal-gold',
  'bg-leaf',
  'bg-sage',
  'bg-medal-silver',
  'bg-olive',
  'bg-medal-bronze',
];

/** Deterministic pieces per burst (mulberry32), so rendering stays pure. */
export function confettiPieces(seed: number, count = 28) {
  let state = seed * 0x9e3779b9;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, (_, id) => {
    const angle = random() * Math.PI * 2;
    const distance = 70 + random() * 110;
    return {
      id,
      x: Math.cos(angle) * distance,
      // Biased upward, then they fall a little.
      y: Math.sin(angle) * distance * 0.7 - 40,
      fall: 30 + random() * 40,
      rotate: (random() - 0.5) * 540,
      size: random() > 0.5 ? 'size-2.5' : 'size-2',
      color: CONFETTI_COLORS[id % CONFETTI_COLORS.length]!,
    };
  });
}
