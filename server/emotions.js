// Win probability -> the emotional state a tennis player is likely living through.
// Ordered high to low; first band whose `min` the probability clears wins.
export const EMOTIONS = [
  { min: 0.995, key: 'triumphant', label: 'Triumphant', emoji: '🏆', color: '#f5b301',
    blurb: 'Match point converted. Racquet in the air, falling to the clay.' },
  { min: 0.85, key: 'euphoric', label: 'Euphoric', emoji: '🤩', color: '#22c55e',
    blurb: 'In the zone — every ball is a beach ball, the crowd is chanting their name.' },
  { min: 0.70, key: 'confident', label: 'Confident', emoji: '😎', color: '#16a34a',
    blurb: 'Fist pumps after big points. Dictating rallies, serving with swagger.' },
  { min: 0.57, key: 'focused', label: 'Focused', emoji: '🎯', color: '#0ea5e9',
    blurb: 'Slight edge. Towel, deep breath, one point at a time.' },
  { min: 0.43, key: 'nervy', label: 'Nervy', emoji: '😬', color: '#a855f7',
    blurb: 'On a knife edge. Bouncing the ball 14 times before serving.' },
  { min: 0.30, key: 'frustrated', label: 'Frustrated', emoji: '😤', color: '#f97316',
    blurb: 'Muttering at the player box. Glaring at the strings after a shanked forehand.' },
  { min: 0.15, key: 'desperate', label: 'Desperate', emoji: '😫', color: '#ef4444',
    blurb: 'Going for broke on every shot. Racquet smash risk: high.' },
  { min: 0.005, key: 'crushed', label: 'Crushed', emoji: '😢', color: '#64748b',
    blurb: 'Towel over the head at the changeover. Thinking about the flight home.' },
  { min: -1, key: 'defeated', label: 'Defeated', emoji: '🤝', color: '#475569',
    blurb: 'Handshake at the net. Polite applause. Long walk to the locker room.' },
];

export function emotionFor(probability) {
  return EMOTIONS.find((e) => probability >= e.min);
}
