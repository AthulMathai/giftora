import "server-only";

/**
 * One place for AI calls. Uses Google Gemini when GEMINI_API_KEY is set (it has a free tier:
 * get a key at https://aistudio.google.com/apikey), otherwise Anthropic's API when
 * ANTHROPIC_API_KEY is set. Never send supplier costs or customer data to it: only product
 * names, descriptions and categories.
 */
export type AiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function aiConfigured(): string | null {
  if (process.env.GEMINI_API_KEY) return "Gemini";
  if (process.env.ANTHROPIC_API_KEY) return "Claude";
  return null;
}

export const AI_MISSING = "Add a free GEMINI_API_KEY (from aistudio.google.com/apikey) in Vercel → giftora-staff → Environment Variables to turn on AI.";

/** Sends a prompt that asks for JSON and returns the parsed object. */
export async function generateJson<T>(prompt: string, maxTokens = 2000): Promise<AiResult<T>> {
  let text = "";
  try {
    if (process.env.GEMINI_API_KEY) {
      const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: maxTokens, temperature: 0.4 },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await res.json().catch(() => null)) as
        | { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string; status?: string } } | null;
      if (!res.ok) {
        console.error("[ai] gemini", res.status, body?.error?.message);
        if (res.status === 429) return { ok: false, error: "The free AI limit was reached for the moment. Wait a minute and try again." };
        if (res.status === 400 || res.status === 403) return { ok: false, error: "The Gemini key isn't valid. Check GEMINI_API_KEY in Vercel." };
        return { ok: false, error: "The AI service didn't answer. Try again in a minute." };
      }
      text = (body?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    } else if (process.env.ANTHROPIC_API_KEY) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await res.json().catch(() => null)) as { content?: { type: string; text?: string }[]; error?: { message?: string } } | null;
      if (!res.ok) {
        console.error("[ai] anthropic", res.status, body?.error?.message);
        return { ok: false, error: res.status === 401 ? "The AI key isn't valid. Check ANTHROPIC_API_KEY in Vercel." : "The AI service didn't answer. Try again in a minute." };
      }
      text = (body?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    } else {
      return { ok: false, error: AI_MISSING };
    }
  } catch (e) {
    console.error("[ai]", e);
    return { ok: false, error: "The AI service didn't answer. Try again in a minute." };
  }
  const json = text.match(/[[{][\s\S]*[\]}]/)?.[0];
  try {
    return { ok: true, data: JSON.parse(json ?? "") as T };
  } catch {
    return { ok: false, error: "The AI reply couldn't be read. Try again." };
  }
}
