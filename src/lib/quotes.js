// Short, original lines shown on the block page.

export const QUOTES = [
  'The thing you came here to avoid is still waiting. Go do it.',
  'Attention is the rent you pay for the life you want.',
  'Ten focused minutes beat an hour of half-attention.',
  'You closed this door on purpose. Trust that version of you.',
  'Boredom is just focus warming up.',
  'Small, finished things add up to big ones.',
  'The feed will still be there. This moment won’t.',
  'Do the next small step. Then the one after that.',
  'Your future self is rooting for you right now.',
  'Deep work feels slow and looks fast.',
  'Breathe. Stretch. Then back to it.',
  'You don’t need more motivation, just fewer exits.',
];

export function pickQuote(seed = Date.now()) {
  return QUOTES[Math.abs(Math.floor(seed)) % QUOTES.length];
}
