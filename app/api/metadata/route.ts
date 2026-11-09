import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { load } from "cheerio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_HTML_BYTES = 750_000;
const MAX_REDIRECTS = 6;
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

function isAmazonShortHost(host: string): boolean {
  return ["a.co", "amzn.to", "amzn.eu", "amzn.asia", "amzn.com"].includes(host.toLowerCase().replace(/^www\./,""));
}
function isAmazonHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^www\./,"");
  return name === "amazon.com" || /^amazon\.(?:co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2,3})$/.test(name);
}
function asinFromUrl(raw: string) {
  try {
    const u = new URL(raw), path = decodeURIComponent(u.pathname);
    if (!isAmazonHost(u.hostname)) return "";
    return (path.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})(?:\/|$)/i) || [])[1]?.toUpperCase() || "";
  } catch { return ""; }
}
function titleHintFromAmazonUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!isAmazonHost(url.hostname) || !asinFromUrl(raw)) return "";
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex(part => ["dp","gp"].includes(part.toLowerCase()));
    if (idx < 1) return "";
    const slug = parts[idx-1];
    if (!slug.includes("-") || slug.length > 145) return "";
    const words = slug.replace(/[-_]+/g," ").replace(/[^a-zA-Z0-9 +&',]/g," ").replace(/\s+/g," ").trim();
    if (words.split(" ").length < 3) return "";
    return words.slice(0,180);
  } catch { return ""; }
}
/**
 * When Amazon blocks its product page, the ASIN is still a stable exact identifier.
 * Query public search results, and NEVER accept a result unless its destination is
 * an Amazon product page with the same ASIN. This is best-effort, not an Amazon API.
 * No child details, gift list or original short link are sent to search engines.
 */
async function indexedAmazonTitle(asin: string): Promise<string> {
  if (!/^[A-Z0-9]{10}$/.test(asin)) return "";
  const query = encodeURIComponent('"' + asin + '" amazon');
  const sources = [
    {kind:"yahoo",url:"https://search.yahoo.com/search?p=" + encodeURIComponent(asin)},
    {kind:"bing",url:"https://www.bing.com/search?format=rss&q=" + query}
  ] as const;
  type Candidate={title:string;score:number};
  const normalize = (value: string) =>
    value.replace(/^Amazon(?:\.[a-z.]+)?\s*[:|–-]\s*/i,"")
      .replace(/\s*[-|–]\s*Amazon(?:\.[a-z.]+)?\s*$/i,"")
      .replace(/\s+/g," ").trim().slice(0,180);
  const candidates:Candidate[][] = await Promise.all(sources.map(async source=>{
    try {
      const response = await fetch(source.url,{
        cache:"no-store",signal:AbortSignal.timeout(4500),
        headers:{"Accept":"text/html,application/rss+xml,application/xml","User-Agent":"Mozilla/5.0 (compatible; LetterToSanta/1.0)"}
      });
      if (!response.ok || Number(response.headers.get("content-length")||"0") > 150000) return [];
      const html=(await response.text()).slice(0,150000);
      const $=load(html,source.kind==="bing"?{xml:{xmlMode:true}}:undefined);
      const rows:{title:string;link:string}[]=[];
      if(source.kind==="bing"){
        $("item").slice(0,12).each((_,el)=>rows.push({title:$(el).find("title").text(),link:$(el).find("link").text()}));
      } else {
        $("h3").slice(0,16).each((_,el)=>{
          const anchor=$(el).closest("a");
          let link=anchor.attr("href")||"";
          // Yahoo wraps search results in a redirect URL, with the destination in /RU=...
          const wrapped=link.match(/\/RU=([^/]+)/);
          if(wrapped)try{link=decodeURIComponent(wrapped[1]);}catch{return;}
          rows.push({title:$(el).text(),link});
        });
      }
      return rows.flatMap(({title,link})=>{
        if (asinFromUrl(link)!==asin) return [];
        const name=normalize(title);
        if(name.length < 14 || /^(?:amazon|products?|buy now|home|shop|customer reviews|page not found)\b/i.test(name)) return [];
        return [{title:name,score:(name.includes("...")||name.includes("…")?0:60)+Math.min(name.length,160)}];
      });
    } catch { return []; }
  }));
  const all=candidates.flat().sort((a,b)=>b.score-a.score);
  return all[0]?.title || "";
}

function tidy(value: string | undefined | null, max = 180) {
  return (value || "").replace(/\s+/g, " ").trim().slice(0, max);
}
function cleanDescription(value: string | undefined | null) {
  if (!value) return "";
  // Product JSON-LD sometimes contains embedded HTML. Render only readable text.
  return tidy(load("<div>" + value + "</div>")("div").text(), 350);
}
function cleanTitle(value: string | undefined | null) {
  const title = tidy(value);
  // Landing-page labels, access errors and bot blocks are not product names.
  if (/^(amazon(?:\.[a-z]{2,4})+|a\.co|amzn\.to|access denied|just a moment|robot check|page not found)[\s:.,!-]*$/i.test(title) ||
      /^(404|captcha|are you a robot|something went wrong)/i.test(title)) return "";
  return title;
}

type PageResult = { html: string; finalUrl: string; blocked: boolean; responseCode: number };
async function downloadHtml(raw: string): Promise<PageResult> {
  let current = raw;
  const amazonShort = isAmazonShortHost(new URL(raw).hostname);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await validateUrl(current);
    const amazonDestination = isAmazonHost(url.hostname);
    // Follow only Amazon-owned destinations from Amazon short links.
    if (amazonShort && !amazonDestination && !isAmazonShortHost(url.hostname))
      throw new Error("Amazon short link redirected outside Amazon.");
    // Important: a.co typically returns 404 for HEAD. Use GET with manual redirects.
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 (compatible; LetterToSanta/1.0; +https://www.jaredvogler.com/letter-to-santa)"
        }
      });
    } catch (error) {
      // After resolving a short link, the catalog page may refuse cloud servers.
      // Return the known product destination, not a made-up title or broken link.
      if (amazonShort && amazonDestination) return {html:"",finalUrl:url.toString(),blocked:true,responseCode:0};
      throw error;
    }
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The retailer redirected without a destination.");
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) {
      if (amazonShort || amazonDestination)
        return { html:"", finalUrl:url.toString(), blocked:true, responseCode:response.status };
      throw new Error("The retailer did not allow us to read this product page.");
    }
    const type = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
      if (amazonShort || amazonDestination)
        return {html:"",finalUrl:url.toString(),blocked:true,responseCode:response.status};
      throw new Error("This link does not lead to an HTML product page.");
    }
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
    return {html,finalUrl:url.toString(),blocked:false,responseCode:response.status};
  }
  throw new Error("This retailer redirected too many times.");
}

function structuredProduct(raw: string) {
  try {
    const parsed: unknown = JSON.parse(raw);
    const find = (value: unknown, depth = 0): { name?: string; image?: string; description?: string } | null => {
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
        return {
          name: typeof o.name === "string" ? o.name : undefined,
          image,
          description: typeof o.description === "string" ? o.description : undefined
        };
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
    const { html, finalUrl, blocked, responseCode } = await downloadHtml((body as {url: string}).url);
    const $ = load(html);
    let product: {name?:string;image?:string;description?:string} | null = null;
    $('script[type="application/ld+json"]').slice(0, 15).each((_, el) => {
      if (!product) product = structuredProduct($(el).html() || "");
    });
    const structured = product as {name?:string;image?:string;description?:string} | null;
    const extractedTitle = cleanTitle(structured?.name ||
      $('[id="productTitle"]').first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="twitter:title"]').attr("content") ||
      $("title").first().text());
    const asin = asinFromUrl(finalUrl);
    const titleHint = titleHintFromAmazonUrl(finalUrl);
    const indexedTitle = extractedTitle ? "" : await indexedAmazonTitle(asin);
    const title = extractedTitle || indexedTitle || titleHint;
    const source = extractedTitle ? "page" : indexedTitle ? "search" : titleHint ? "url-hint" : "unavailable";
    const description = cleanDescription(structured?.description ||
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="twitter:description"]').attr("content") ||
      $('meta[name="description"]').attr("content") ||
      $('[itemprop="description"]').first().text());
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
    return NextResponse.json({
      title, description, image: imageUrl, url: (body as {url:string}).url,
      resolvedUrl: finalUrl,
      asin,
      source,
      warning: source === "search" ? "Title recovered from indexed search results using the exact Amazon product ID; please confirm it is the right item."
        : source === "url-hint" ? "Name inferred from URL; please check the exact product."
        : source === "unavailable" && (blocked || isAmazonShortHost(new URL((body as {url:string}).url).hostname))
        ? "Amazon limited access to product details. Add the product title manually."
        : "",
      responseCode
    }, {headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not inspect the link.";
    return NextResponse.json({
      error: message.includes("fetch failed") || message.includes("timeout") ?
        "This store blocked automatic lookup. Add the title manually instead." : message
    }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
