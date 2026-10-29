// Public metadata for the controlled lab; this route creates no records or events.
export function GET() {
  return Response.json({
    formatVersion: 1,
    id: 'blaze-decision-validation-v1',
    slug: 'blaze-decision-validation-v1',
    name: 'Blaze Controlled Decision Lab',
    genre: 'Action',
    maker: { name: 'Blaze', url: null },
    released: '2026-10-29', updated: '2026-10-29',
    tagline: 'A controlled one-choice decision lab',
    description: 'A synthetic controlled lab with two safe choices for validating a decision and its observed result.',
    about: [
      'This controlled Blaze lab presents two harmless choices and records which was selected in a visibly distinct terminal state. It is a test fixture, not a production game or evidence about a real player.',
      'The lab has no account, tracking library, telemetry, or network calls of its own. The scene is deliberately simple and should only be interpreted as controlled test evidence. A separate worker may record an authorized test, subject to its own isolation and spending controls.'
    ],
    players: { min: 1, max: 1, label: 'One test operator' }, modes: ['solo'], guestPlay: true,
    controls: { label: 'On-screen buttons', input: ['touch'] },
    devices: { phone: 'either', desktop: true },
    session: { opponents: 'Solo', duration: 'One choice', saving: 'No game data saved by the lab' },
    cost: { play: 'free' },
    howToPlay: ['Review the two stars.', 'Choose either star.', 'Observe the selected star and terminal state.'],
    faq: [
      { q: 'What is this?', a: 'A controlled Blaze decision validation lab.' },
      { q: 'Does the lab collect telemetry?', a: 'No. The lab itself sends no telemetry.' },
      { q: 'Is this a production game?', a: 'No. It is synthetic test material.' }
    ],
    ageRating: null,
    media: { cover: { src: '/fixture/cover.svg', alt: 'Controlled fixture cover' }, share: '/fixture/cover.svg', screenshots: [], trailer: null },
    visibility: 'unlisted'
  });
}
