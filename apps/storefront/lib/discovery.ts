/**
 * Gift-discovery vocabulary: occasions, recipients and budgets. Products carry occasion and
 * recipient slugs (products.occasions / products.recipients); these give them names, page
 * copy and FAQs for search engines and AI answer engines.
 */

export interface Faq { q: string; a: string }

export interface Occasion {
  slug: string;
  name: string;
  title: string;        // page heading
  intro: string;
  faq: Faq[];
}

export const OCCASIONS: Occasion[] = [
  {
    slug: "birthday", name: "Birthday", title: "Birthday gifts",
    intro: "Birthday presents they'll actually use, from cozy keepsakes to little luxuries, checked by hand and shipped across Canada.",
    faq: [
      { q: "What's a good birthday gift if I don't know what they like?", a: "Pick something useful and a little indulgent — a candle trio, a cozy throw or a coffee set suits most people. Filter by who it's for to narrow it down." },
      { q: "How fast will a birthday gift arrive?", a: "Standard shipping takes 3–7 business days across Canada. Choose Express at checkout if the birthday is close." },
    ],
  },
  {
    slug: "christmas", name: "Christmas", title: "Christmas gifts",
    intro: "Christmas gift ideas for everyone on your list. Shop early — our Christmas gifts ship right away.",
    faq: [
      { q: "Can I buy Christmas gifts early?", a: "Yes. Christmas gifts are available now and ship as soon as they're packed, so you can be done before the December rush." },
      { q: "When is the last day to order for Christmas delivery?", a: "Order by December 15 for standard shipping within Canada. Express gives you a few more days." },
    ],
  },
  {
    slug: "halloween", name: "Halloween", title: "Halloween gifts",
    intro: "Playful treats for hosts, costume lovers and anyone who loves a candle-lit October night.",
    faq: [{ q: "When should I order for Halloween?", a: "Order by October 24 for standard shipping to arrive before Halloween in most of Canada." }],
  },
  {
    slug: "housewarming", name: "Housewarming", title: "Housewarming gifts",
    intro: "Warm, good-looking things for a new home: candles, throws, serveware and kitchen favourites.",
    faq: [{ q: "What's a thoughtful housewarming gift?", a: "Something for the home they'll use every day — a soft throw, a scented candle or a coffee set are safe, welcome choices." }],
  },
  {
    slug: "thank-you", name: "Thank you", title: "Thank-you gifts",
    intro: "Small, thoughtful ways to say thanks — for teachers, hosts, colleagues and friends.",
    faq: [{ q: "How much should I spend on a thank-you gift?", a: "Most thank-you gifts land between $20 and $50. Browse gifts under $50 for ideas." }],
  },
  {
    slug: "valentines-day", name: "Valentine's Day", title: "Valentine's Day gifts",
    intro: "Romantic and sweet gifts for partners, friends and galentines.",
    faq: [{ q: "When should I order for Valentine's Day?", a: "Order by February 7 for standard shipping across Canada." }],
  },
  {
    slug: "mothers-day", name: "Mother's Day", title: "Mother's Day gifts",
    intro: "Gifts that say thank you to the one who does it all.",
    faq: [{ q: "When is Mother's Day in Canada?", a: "Mother's Day is the second Sunday in May. Order a week ahead for standard shipping." }],
  },
  {
    slug: "fathers-day", name: "Father's Day", title: "Father's Day gifts",
    intro: "Good-looking, useful gifts for the dads in your life.",
    faq: [{ q: "When is Father's Day in Canada?", a: "Father's Day is the third Sunday in June. Order a week ahead for standard shipping." }],
  },
  {
    slug: "graduation", name: "Graduation", title: "Graduation gifts",
    intro: "Gifts to mark the big step — practical, personal and built to last.",
    faq: [{ q: "What's a good graduation gift?", a: "Something they'll carry into their next chapter, like a quality leather wallet or something personalized." }],
  },
  {
    slug: "just-because", name: "Just because", title: "Just-because gifts",
    intro: "No occasion needed. Little surprises that make someone's week.",
    faq: [],
  },
];

export interface Recipient { slug: string; name: string; title: string; match: string[] }

export const RECIPIENTS: Recipient[] = [
  { slug: "her", name: "For her", title: "Gifts for her", match: ["her", "mom", "wife", "girlfriend", "sister"] },
  { slug: "him", name: "For him", title: "Gifts for him", match: ["him", "dad", "husband", "boyfriend", "brother"] },
  { slug: "mom", name: "For mom", title: "Gifts for mom", match: ["mom"] },
  { slug: "dad", name: "For dad", title: "Gifts for dad", match: ["dad"] },
  { slug: "couple", name: "For couples", title: "Gifts for couples", match: ["couple"] },
  { slug: "friend", name: "For a friend", title: "Gifts for a friend", match: ["friend"] },
  { slug: "teen", name: "For teens", title: "Gifts for teens", match: ["teen"] },
  { slug: "coffee-lover", name: "Coffee lovers", title: "Gifts for coffee lovers", match: ["coffee-lover"] },
];

export const BUDGETS = [25, 50, 75, 100] as const;

export function occasionBySlug(slug: string) { return OCCASIONS.find((o) => o.slug === slug); }
export function recipientBySlug(slug: string) { return RECIPIENTS.find((r) => r.slug === slug); }

// ---------------------------------------------------------------------------
// Natural-language gift search: "birthday gift for my girlfriend under $50 who loves coffee"
// → { occasion: birthday, recipient: her, maxCents: 5000, terms: "coffee" }.
// Rule-based for now; the same shape can later be filled by an AI model.
// ---------------------------------------------------------------------------
const RECIPIENT_WORDS: Record<string, string> = {
  her: "her", she: "her", woman: "her", women: "her", girlfriend: "her", wife: "her", sister: "her", daughter: "her",
  aunt: "her", grandma: "her", grandmother: "her", him: "him", he: "him", man: "him", men: "him", boyfriend: "him",
  husband: "him", brother: "him", son: "him", uncle: "him", grandpa: "him", grandfather: "him",
  mom: "mom", mum: "mom", mother: "mom", mama: "mom", dad: "dad", father: "dad", papa: "dad",
  couple: "couple", couples: "couple", friend: "friend", friends: "friend", bestie: "friend", coworker: "friend",
  colleague: "friend", teen: "teen", teenager: "teen",
};
const OCCASION_WORDS: Record<string, string> = {
  birthday: "birthday", bday: "birthday", christmas: "christmas", xmas: "christmas", holiday: "christmas", holidays: "christmas",
  halloween: "halloween", housewarming: "housewarming", "new home": "housewarming", thanks: "thank-you", "thank you": "thank-you",
  valentine: "valentines-day", valentines: "valentines-day", "valentine's": "valentines-day", "mother's day": "mothers-day",
  "mothers day": "mothers-day", "father's day": "fathers-day", "fathers day": "fathers-day", graduation: "graduation", grad: "graduation",
};
const SYNONYMS: Record<string, string> = {
  mug: "cup", cups: "cup", blankets: "blanket", throw: "blanket", candles: "candle", hoodies: "hoodie", sweatshirt: "hoodie",
  wallets: "wallet", espresso: "coffee", latte: "coffee", tea: "tea", cozy: "cozy", cosy: "cozy",
};
const STOP = new Set(["a", "an", "the", "for", "my", "to", "gift", "gifts", "present", "presents", "who", "that", "loves",
  "love", "likes", "like", "is", "into", "and", "or", "with", "of", "under", "below", "less", "than", "around", "about",
  "something", "ideas", "idea", "best", "good", "nice", "cheap", "her", "his", "their", "in", "on", "she", "he", "i", "me"]);

export interface GiftIntent { occasion?: string; recipient?: string; maxCents?: number; minCents?: number; terms: string }

export function parseGiftQuery(raw: string): GiftIntent {
  let q = ` ${raw.toLowerCase().replace(/[“”"]/g, " ")} `;
  const intent: GiftIntent = { terms: "" };

  const under = q.match(/(?:under|below|less than|up to|max|<)\s*\$?\s*(\d{1,5})/);
  if (under) { intent.maxCents = Number(under[1]) * 100; q = q.replace(under[0], " "); }
  const between = q.match(/\$?(\d{1,5})\s*(?:-|to)\s*\$?(\d{1,5})/);
  if (between) { intent.minCents = Number(between[1]) * 100; intent.maxCents = Number(between[2]) * 100; q = q.replace(between[0], " "); }
  const around = q.match(/(?:around|about|~)\s*\$?\s*(\d{1,5})/);
  if (around) { const n = Number(around[1]); intent.minCents = Math.round(n * 0.7) * 100; intent.maxCents = Math.round(n * 1.3) * 100; q = q.replace(around[0], " "); }
  q = q.replace(/\$\s*\d+/g, " ");

  for (const [phrase, slug] of Object.entries(OCCASION_WORDS).sort((a, b) => b[0].length - a[0].length)) {
    const re = new RegExp(`(^|\\W)${phrase.replace(/[.*+?^${}()|[\]\\']/g, "\\$&")}(\\W|$)`);
    if (re.test(q)) { intent.occasion ??= slug; q = q.replace(re, " "); }
  }
  const words = q.split(/[^a-z0-9'-]+/).filter(Boolean);
  const rest: string[] = [];
  for (const w of words) {
    const r = RECIPIENT_WORDS[w];
    if (r && !intent.recipient && !["her", "he", "she"].includes(w)) { intent.recipient = r; continue; }
    if (r && !intent.recipient && /\bfor (her|him)\b/.test(raw.toLowerCase())) { intent.recipient = r; continue; }
    if (STOP.has(w) || /^\d+$/.test(w)) continue;
    rest.push(SYNONYMS[w] ?? w);
  }
  // "for her" / "for him" phrasing
  const forWho = raw.toLowerCase().match(/\bfor (her|him)\b/);
  if (forWho && !intent.recipient) intent.recipient = forWho[1];
  intent.terms = [...new Set(rest)].join(" ").trim();
  return intent;
}
