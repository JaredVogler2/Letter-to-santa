import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { load } from "cheerio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_HTML_BYTES = 750_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 7000;

function publicIp(ip: string): boolean {
  if (ip.includes(":")) {
    const a = ip.toLowerCase();
    if (a === "::1" || a === "::" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe8") || a.startsWith("fe9") || a.startsWith("fea") || a.startsWith("feb")) return false;
    if (a.startsWith("::ffff:")) return publicIp(a.slice(7));
    if (a.startsWith("2001:db8:")) return false;
    return true;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b,c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113));
}

async function validateUrl(raw: string): Promise<URL> {
  if (raw.length > 4000) throw new Error("Link is too long.");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Enter a full HTTPS product link."); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443"))
    throw new Error("Only public HTTPS product links are supported.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || host === "localhost" || /\.(localhost|local|internal|test|invalid|example)$/.test(host) || isIP(host))
    throw new Error("Only public retail websites can be inspected.");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(entry => !publicIp(entry.address)))
    throw new Error("This link is not a public website.");
  return url;
}

function tidy(value: string | undefined | null, max = 180) {
  return (value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function downloadHtml(raw: string) {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await validateUrl(current);
    const response = await fetch(url.toString(), {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (compatible; LetterToSanta/1.0; +https://www.jaredvogler.com/letter-to-santa)"
      }
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The retailer redirected without a destination.");
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) throw new Error("The retailer did not allow us to read this product page.");
    const type = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type))
      throw new Error("This link does not lead to an HTML product page.");
    if (Number(response.headers.get("content-length") || "0") > MAX_HTML_BYTES)
      throw new Error("This webpage is too large to inspect.");
    const stream = response.body?.getReader();
    if (!stream) throw new Error("The webpage has no readable content.");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await stream.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_HTML_BYTES) throw new Error("This webpage is too large to inspect.");
        chunks.push(value);
      }
    } finally { await stream.cancel().catch(() => {}); }
    const html = new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))));
    return { html, finalUrl: url.toString() };
  }
  throw new Error("This retailer redirected too many times.");
}

function structuredProduct(raw: string) {
  try {
    const parsed: unknown = JSON.parse(raw);
    const find = (value: unknown, depth = 0): { name?: string; image?: string } | null => {
      if (!value || typeof value !== "object" || depth > 5) return null;
      if (Array.isArray(value)) {
        for (const item of value) { const hit = find(item, depth + 1); if (hit) return hit; }
        return null;
      }
      const o = value as Record<string, unknown>;
      const type = o["@type"];
      if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) {
        const image = typeof o.image === "string" ? o.image
          : Array.isArray(o.image) ? (o.image.find(x => typeof x === "string") as string | undefined) : undefined;
        return { name: typeof o.name === "string" ? o.name : undefined, image };
      }
      return find(o["@graph"], depth + 1);
    };
    return find(parsed);
  } catch { return null; }
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).url !== "string")
      return NextResponse.json({ error: "Enter a product link." }, { status: 400 });
    const { html, finalUrl } = await downloadHtml((body as {url: string}).url);
    const $ = load(html);
    let product: {name?:string;image?:string} | null = null;
    $('script[type="application/ld+json"]').slice(0, 15).each((_, el) => {
      if (!product) product = structuredProduct($(el).html() || "");
    });
    const structured = product as {name?:string;image?:string} | null;
    const title = tidy(structured?.name ||
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="twitter:title"]').attr("content") ||
      $("title").first().text());
    const image = tidy(structured?.image ||
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content"), 2000);
    let imageUrl = "";
    try {
      if (image) {
        const parsedImage = new URL(image, finalUrl);
        if (parsedImage.protocol === "https:" && !parsedImage.username && !parsedImage.password)
          imageUrl = parsedImage.toString();
      }
    } catch { /* image optional */ }
    return NextResponse.json({ title: title || "", image: imageUrl, url: finalUrl }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not inspect the link.";
    return NextResponse.json({
      error: message.includes("fetch failed") || message.includes("timeout") ?
        "This store blocked automatic lookup. Add the title manually instead." : message
    }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
