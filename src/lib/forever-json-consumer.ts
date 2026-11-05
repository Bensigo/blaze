// Vendored from Forever shared/forever-json.ts at commit 62e4671e; preserve producer validation semantics.
import {z} from 'zod';

/** The `forever.json` format (version 1): one file per game holding the facts and text of its public page. */
export const FOREVER_GENRES = ['Action', 'Board', 'Cards', 'Puzzle', 'Social', 'Sports', 'Trivia'] as const;
export const PLAY_MODES = ['solo', 'cpu', 'friends', 'online'] as const;
export const INPUTS = ['keyboard', 'mouse', 'touch', 'gamepad'] as const;

/** All-caps words that stay allowed anywhere (plus every word of the game's own name). */
const CAPS_OK = new Set(['CPU', 'NPC', 'NPCs', 'KJV', 'WEB', 'DJ', 'TV']);

/** Text with surrounding spaces removed, so it is never empty and limits count what a reader sees. */
const text = (min = 1, max?: number) => {
  const field = z.string().trim().min(min, min <= 1 ? 'Cannot be empty.' : `Use at least ${min} characters.`);
  return max === undefined ? field : field.max(max, `Use at most ${max} characters.`);
};
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
const list = <T extends z.ZodType>(item: T, min: number, max: number, unit: string) =>
  z.array(item).min(min, `Use at least ${plural(min, unit)}.`).max(max, `Use at most ${plural(max, unit)}.`);
const mediaPath = text();
const isoDate = z.iso.date('Use a real date written as YYYY-MM-DD.');
const isDate = (value: unknown): value is string => isoDate.safeParse(value).success;
const date = z.string().trim().pipe(isoDate);
const httpsUrl = z.string().trim().refine(value => {
  try { return value.startsWith('https://') && Boolean(new URL(value).hostname); } catch { return false; }
}, 'Use a full address that starts with https://.');
const count = z.number('Use a number.').int('Use a whole number.').min(1, 'Use a number from 1 to 100.').max(100, 'Use a number from 1 to 100.');

const players = z.strictObject({min: count, max: count, label: text()});
const controls = z.strictObject({label: text(), input: list(z.enum(INPUTS), 1, INPUTS.length, 'input')});
const devices = z.strictObject({phone: z.enum(['landscape', 'portrait', 'either']), desktop: z.boolean()});
const session = z.strictObject({opponents: text(), duration: text(), saving: text()});
const cost = z.strictObject({play: z.enum(['free', 'pearls']), notes: text().optional()});
const cover = z.strictObject({src: mediaPath, srcset: mediaPath.optional(), alt: text()});
const screenshot = z.strictObject({src: mediaPath, alt: text()});
const trailer = z.strictObject({src: mediaPath, poster: mediaPath, name: text(), uploaded: date});
const mediaShape = {cover, share: mediaPath, preview: mediaPath.optional(), screenshots: list(screenshot, 0, 6, 'screenshot'), trailer: trailer.nullable()};
const maker = z.strictObject({name: text(), url: httpsUrl.nullable()});
const faqEntry = z.strictObject({q: text(1, 99), a: text(1, 299)});

const short = {
  formatVersion: z.literal(1, 'This reader understands formatVersion 1 only.'),
  id: text(),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single hyphens, such as "last-card".'),
  name: text(2, 40),
  genre: z.enum(FOREVER_GENRES),
  maker,
  released: date,
  updated: date,
};
const visibilityError = 'Use listed, unlisted or hidden.';
/** A JSON object is the only thing that can match; a wrong visibility is the other way to miss. */
const unionError = (issue: {code: string}) => issue.code === 'invalid_type' ? 'Expected a JSON object.' : visibilityError;

/** Everything a game with a page must say. */
const publicShape = z.strictObject({
  ...short,
  tagline: text(1, 60),
  description: text(70, 160),
  about: list(text(), 1, 4, 'paragraph'),
  players,
  modes: list(z.enum(PLAY_MODES), 1, PLAY_MODES.length, 'mode'),
  guestPlay: z.boolean(),
  controls,
  devices,
  session,
  cost,
  howToPlay: list(text(1, 159), 3, 8, 'step'),
  faq: list(faqEntry, 3, 8, 'question'),
  ageRating: z.literal('18+', 'Use null or "18+".').nullable().default(null),
  media: z.strictObject({...mediaShape, screenshots: mediaShape.screenshots.default([]), trailer: mediaShape.trailer.default(null)}),
  visibility: z.enum(['listed', 'unlisted'], visibilityError),
});

/** A hidden game has no page yet: the short fields are required, and anything else it carries must still be valid. */
const hiddenShape = z.strictObject({
  ...short,
  tagline: publicShape.shape.tagline.optional(),
  description: publicShape.shape.description.optional(),
  about: publicShape.shape.about.optional(),
  players: players.partial().optional(),
  modes: publicShape.shape.modes.optional(),
  guestPlay: z.boolean().optional(),
  controls: controls.partial().optional(),
  devices: devices.partial().optional(),
  session: session.partial().optional(),
  cost: cost.optional(),
  howToPlay: publicShape.shape.howToPlay.optional(),
  faq: publicShape.shape.faq.optional(),
  ageRating: z.literal('18+', 'Use null or "18+".').nullable().optional(),
  media: z.strictObject(mediaShape).partial().optional(),
  visibility: z.literal('hidden', visibilityError),
});

export type PublicGameFile = z.infer<typeof publicShape>;
export type HiddenGameFile = z.infer<typeof hiddenShape>;
export type GameFile = PublicGameFile | HiddenGameFile;

const words = (value: string) => value.match(/\p{L}+/gu) ?? [];

/** Five or more short comma-separated items in a row, within one sentence, read as a keyword list rather than a sentence. Empty items are skipped. */
function isKeywordList(value: string) {
  return value.split(/[.!?]+/).some(sentence => {
    let run = 0;
    for (const item of sentence.split(',')) {
      const count = item.trim().split(/\s+/).filter(Boolean).length;
      if (count === 0) continue;
      run = count <= 3 ? run + 1 : 0;
      if (run >= 5) return true;
    }
    return false;
  });
}

function textProblems(value: string, allowedCaps: Set<string>) {
  const problems: string[] = [];
  if (/[<>]/.test(value)) problems.push('Use plain text: no HTML, so no < or > characters.');
  if (/\bhttps?:\/\/|\bwww\./i.test(value)) problems.push('Remove the web link; only maker.url may hold one.');
  if (isKeywordList(value)) problems.push('Write sentences, not a list of keywords.');
  const shouted = words(value).filter(word => word.length >= 3 && word === word.toUpperCase() && word !== word.toLowerCase() && !allowedCaps.has(word));
  if (shouted.length) problems.push(`Avoid all-caps words (${[...new Set(shouted)].join(', ')}); only the game's name and short forms such as CPU may be.`);
  return problems;
}

/** Every free-text field and where it sits. Ids, slugs, dates, media paths and maker.url are not text. */
function freeText(file: GameFile) {
  const fields: [string, string | undefined][] = [
    ['name', file.name], ['tagline', file.tagline], ['description', file.description],
    ['players.label', file.players?.label], ['controls.label', file.controls?.label],
    ['session.opponents', file.session?.opponents], ['session.duration', file.session?.duration], ['session.saving', file.session?.saving],
    ['cost.notes', file.cost?.notes], ['media.cover.alt', file.media?.cover?.alt], ['media.trailer.name', file.media?.trailer?.name], ['maker.name', file.maker.name],
  ];
  file.about?.forEach((paragraph, i) => fields.push([`about.${i}`, paragraph]));
  file.howToPlay?.forEach((step, i) => fields.push([`howToPlay.${i}`, step]));
  file.faq?.forEach((entry, i) => fields.push([`faq.${i}.q`, entry.q], [`faq.${i}.a`, entry.a]));
  file.media?.screenshots?.forEach((shot, i) => fields.push([`media.screenshots.${i}.alt`, shot.alt]));
  return fields;
}

/** The rules that look across fields. They run once the fields themselves have the right types. */
function checkFile(file: GameFile, ctx: z.RefinementCtx) {
  const issue = (at: (string | number)[], message: string) => ctx.addIssue({code: 'custom', path: at, message});
  const min = file.players?.min, max = file.players?.max;
  if (min !== undefined && max !== undefined && min > max) issue(['players'], 'players.min cannot be more than players.max.');
  if (isDate(file.released) && isDate(file.updated) && file.updated < file.released) issue(['updated'], 'updated cannot be earlier than released.');
  const total = file.about?.reduce((sum, paragraph) => sum + paragraph.length, 0);
  if (total !== undefined && (total < 400 || total > 1200)) issue(['about'], `Use 400–1,200 characters in total across the paragraphs (now ${total}).`);
  const allowedCaps = new Set([...CAPS_OK, ...words(file.name)]);
  for (const [at, value] of freeText(file)) {
    if (value !== undefined) for (const problem of textProblems(value, allowedCaps)) issue(at.split('.'), problem);
  }
}

const fileSchema = z.discriminatedUnion('visibility', [publicShape.superRefine(checkFile), hiddenShape.superRefine(checkFile)], {error: unionError});

/** Checks one parsed `forever.json`. Each error reads `<dotted.path>: <message>`. */
export function validateForeverJson(raw: unknown): {ok: true; file: GameFile} | {ok: false; errors: string[]} {
  const result = fileSchema.safeParse(raw);
  if (result.success) return {ok: true, file: result.data};
  return {ok: false, errors: result.error.issues.map(issue => `${issue.path.map(String).join('.')}: ${issue.message}`)};
}

/** Whether the game has a page (listed or unlisted) rather than being hidden. */
export const isPublicFile = (file: GameFile): file is PublicGameFile => file.visibility !== 'hidden';
