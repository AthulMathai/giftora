/**
 * Column mapping for the supplier sheet import. Runs in the browser: the sheet is read locally
 * and only the mapped, normalized rows are sent to the server.
 */

export type FieldKey =
  | "item_number" | "name" | "description" | "category" | "cost" | "on_hand_qty" | "aisle_location" | "barcode"
  | "inner_qty" | "inner_barcode" | "outer_qty" | "outer_barcode" | "group" | "option1" | "option2"
  | "occasions" | "recipients" | "tags";

export interface FieldDef { key: FieldKey; label: string; hint?: string; guesses: RegExp }

export const FIELDS: FieldDef[] = [
  { key: "item_number", label: "Item number (SKU)", hint: "Required. Used to match existing products.", guesses: /^(item ?(no|num|number|#|code)?|sku|article|product ?(code|no|number)|code|part ?(no|number))$/i },
  { key: "name", label: "Name", guesses: /^(name|item ?name|product( name)?|description 1|desc(ription)?|title|item description)$/i },
  { key: "description", label: "Long description", guesses: /^(long description|details|description 2|notes?|features?)$/i },
  { key: "category", label: "Category", guesses: /^(category|cat|department|dept|class|group name|type)$/i },
  { key: "cost", label: "Cost (your acquisition cost)", hint: "Dollars, e.g. 12.50", guesses: /^(cost|unit cost|our cost|wholesale|net( price)?|price|buy price|cost price)$/i },
  { key: "on_hand_qty", label: "Stock on hand", guesses: /^(qty|quantity|on ?hand|stock|available|avail|inventory|soh|qty on hand)$/i },
  { key: "aisle_location", label: "Picking location", guesses: /^(location|loc|aisle|bin|shelf|bay|pick ?(location|face)|slot)$/i },
  { key: "barcode", label: "Barcode (UPC/EAN)", guesses: /^(barcode|upc|ean|gtin|bar code|upc code)$/i },
  { key: "inner_qty", label: "Inner pack qty", guesses: /^(inner|inner ?(qty|pack|quantity)|ip|inner pk)$/i },
  { key: "inner_barcode", label: "Inner pack barcode", guesses: /^(inner (barcode|upc)|ip (barcode|upc))$/i },
  { key: "outer_qty", label: "Outer case qty", guesses: /^(outer|outer ?(qty|pack|quantity)|case ?(qty|pack)?|master ?(pack|case|qty)?|mc|cs ?qty)$/i },
  { key: "outer_barcode", label: "Outer case barcode", guesses: /^(outer (barcode|upc)|case (barcode|upc)|master (barcode|upc))$/i },
  { key: "group", label: "Style / group", hint: "Rows with the same value become sizes or colours of one product.", guesses: /^(style|style ?(no|number|#)|group|parent|family|model)$/i },
  { key: "option1", label: "Option 1 (e.g. Size)", guesses: /^(size)$/i },
  { key: "option2", label: "Option 2 (e.g. Colour)", guesses: /^(colou?r|color name|shade)$/i },
  { key: "occasions", label: "Occasions", hint: "Comma separated", guesses: /^(occasions?)$/i },
  { key: "recipients", label: "For whom", hint: "Comma separated", guesses: /^(recipients?|for( whom)?|gender)$/i },
  { key: "tags", label: "Tags / keywords", guesses: /^(tags?|keywords?)$/i },
];

export type Mapping = Partial<Record<FieldKey, string>>;   // field -> sheet header

export function guessMapping(headers: string[]): Mapping {
  const m: Mapping = {};
  const used = new Set<string>();
  for (const f of FIELDS) {
    const h = headers.find((x) => !used.has(x) && f.guesses.test(x.trim().replace(/[._]+/g, " ").replace(/\s+/g, " ")));
    if (h) { m[f.key] = h; used.add(h); }
  }
  return m;
}

export interface ImportRow {
  row: number;
  item_number: string;
  name?: string;
  title?: string;           // customer-facing name (AI or staff)
  description?: string;
  category?: string;
  cost_cents?: number;
  on_hand_qty?: number;
  aisle_location?: string;
  barcode?: string;
  inner_qty?: number;
  inner_barcode?: string;
  outer_qty?: number;
  outer_barcode?: string;
  group?: string;
  options?: Record<string, string>;
  occasions?: string[];
  recipients?: string[];
  tags?: string[];
  seo_title?: string;
  seo_description?: string;
}

const str = (v: unknown) => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
};
const int = (v: unknown) => {
  const s = str(v);
  if (s === undefined) return undefined;
  const n = Number(s.replace(/[, ]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
};
const money = (v: unknown) => {
  const s = str(v);
  if (s === undefined) return undefined;
  const n = Number(s.replace(/[$,\s]|CAD/gi, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};
const list = (v: unknown) => {
  const s = str(v);
  return s ? s.split(/[,;|]/).map((x) => x.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).filter(Boolean) : undefined;
};
const barcode = (v: unknown) => {
  const s = str(v);
  if (!s) return undefined;
  // Excel turns long barcodes into numbers like 6.28E+11; recover the digits when possible.
  if (/^\d+(\.\d+)?e\+\d+$/i.test(s)) return BigInt(Math.round(Number(s))).toString();
  return s.replace(/\.0$/, "");
};

/** Turns sheet rows (objects keyed by header) into import rows using the mapping. */
export function normalize(raw: Record<string, unknown>[], m: Mapping, optionNames: [string, string]): ImportRow[] {
  const get = (r: Record<string, unknown>, k: FieldKey) => (m[k] ? r[m[k]!] : undefined);
  return raw.map((r, i) => {
    const options: Record<string, string> = {};
    const o1 = str(get(r, "option1")), o2 = str(get(r, "option2"));
    if (o1) options[optionNames[0] || "Option 1"] = o1;
    if (o2) options[optionNames[1] || "Option 2"] = o2;
    const row: ImportRow = {
      row: i + 2, // header is row 1 in the sheet
      item_number: str(get(r, "item_number")) ?? "",
      name: str(get(r, "name")),
      description: str(get(r, "description")),
      category: str(get(r, "category")),
      cost_cents: money(get(r, "cost")),
      on_hand_qty: int(get(r, "on_hand_qty")),
      aisle_location: str(get(r, "aisle_location")),
      barcode: barcode(get(r, "barcode")),
      inner_qty: int(get(r, "inner_qty")),
      inner_barcode: barcode(get(r, "inner_barcode")),
      outer_qty: int(get(r, "outer_qty")),
      outer_barcode: barcode(get(r, "outer_barcode")),
      group: str(get(r, "group")),
      options: Object.keys(options).length ? options : undefined,
      occasions: list(get(r, "occasions")),
      recipients: list(get(r, "recipients")),
      tags: list(get(r, "tags")),
    };
    return row;
  }).filter((r) => Object.values(r).some((v, idx) => idx > 0 && v !== undefined && v !== ""));
}

/** Photo file name → item number: "HD-BLK-M.jpg", "HD-BLK-M-2.jpg", "HD-BLK-M_3.png", "HD-BLK-M (2).jpg". */
export function itemFromFileName(fileName: string, folder?: string): { item: string; candidates: string[] } {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "").trim();
  const stripped = base.replace(/\s*\(\d+\)$/, "").replace(/[-_ ]+\d{1,2}$/, "");
  const candidates = [base, stripped];
  if (folder) candidates.unshift(folder.trim());
  return { item: candidates[0]!, candidates: [...new Set(candidates.filter(Boolean))] };
}
