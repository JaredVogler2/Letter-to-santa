"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type Gift = {
  id: string; url: string; title: string; description: string; image: string; note: string;
  priority: "top" | "wish";
  resolvedUrl?: string; asin?: string; source?: "page" | "search" | "url-hint" | "shared-text" | "unavailable" | "manual";
};
type GiftLookup = {
  title?: string; description?: string; image?: string; resolvedUrl?: string; asin?: string;
  source?: "page" | "search" | "url-hint" | "unavailable"; warning?: string; error?: string
};
type LetterData = { name: string; age: string; message: string; gifts: Gift[] };
type PrintMode = "letter" | "shop";
type PdfReady = { url:string; blob:Blob; filename:string; kind:PrintMode };
const STORAGE = "letter-to-santa-v1";
const initial: LetterData = { name: "", age: "", message: "", gifts: [] };

function safeUrl(raw: string) {
  try { const url = new URL(raw.trim()); return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && (!url.port || url.port === "443") ? url.toString() : null; }
  catch { return null; }
}
function domain(url: string) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Gift website"; } }
function isAmazonGift(url: string) {
  try { return /^(?:a\.co|amzn\.to|amzn\.eu|amzn\.asia|amzn\.com|(?:www\.)?amazon\.(?:com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2,3}))$/i.test(new URL(url).hostname); }
  catch { return false; }
}
function parseGiftPaste(raw: string): {url: string|null; sharedTitle: string} {
  const trimmed = raw.trim();
  const tokens = trimmed.match(/https:\/\/[^\s<>"']+/gi) || [];
  for(const token of tokens) {
    const url = safeUrl(token.replace(/[.,;!?)\]}]+$/,""));
    if(!url) continue;
    const left = trimmed.replace(token," ").replace(/https:\/\/[^\s<>"']+/gi," ");
    const lines = left.split(/[\n\r]+/).map(x=>x.trim().replace(/^[\s"'•*-]+|[\s"'•*-]+$/g,"")).filter(Boolean);
    const title = lines.find(x =>
      x.length >= 9 && x.length <= 180
      && !/^(?:amazon(?:\.com)?|shop|copy link|share|check this out|check out this product|view on amazon|link)$/i.test(x)
      && !/^(?:check out|take a look|found this|i found|view this|see this|shop now).*amazon/i.test(x)
      && !/^https?:/i.test(x)
    ) || "";
    return {url, sharedTitle:title};
  }
  return {url:safeUrl(trimmed),sharedTitle:""};
}
function newId() { return globalThis.crypto?.randomUUID?.() || String(Date.now()) + "-" + Math.random().toString(36).slice(2); }
const NAME_NEEDED = "Gift name needed";
function needsManualName(title: string, url: string): boolean {
  const value = title.trim();
  if (!value || value === NAME_NEEDED) return true;
  if (/^(amazon(?:\.[a-z]{2,4})+|a\.co|amzn\.to|product|shop|home|access denied|robot check|just a moment)[\s:.,!-]*$/i.test(value)) return true;
  if (/^(page not found|404|captcha|are you a robot|something went wrong)/i.test(value)) return true;
  let host = "", shortCode = "";
  try {
    const target = new URL(url);
    host = target.hostname.toLowerCase();
    shortCode = decodeURIComponent(target.pathname.split("/").filter(Boolean).pop() || "");
  } catch { return false; }
  if (/^(a\.co|amzn\.to|bit\.ly|tinyurl\.com|t\.co)$/.test(host)) {
    if (value.toLowerCase() === shortCode.toLowerCase()) return true;
  }
  return false;
}
function cleanGiftTitle(title: string, url: string) {
  return needsManualName(title, url) ? NAME_NEEDED : title.trim().slice(0,180);
}
function Symbol({ name }: { name: string }) {
  const icons: Record<string,string> = { gift:"🎁", magic:"✦", print:"▤", arrow:"↗", link:"↗", down:"↓", up:"↑", remove:"×", copy:"⧉", santa:"✉", star:"✳", check:"✓" };
  return <span aria-hidden="true">{icons[name] || name}</span>;
}
function GiftQR({ gift, size = 70 }: { gift: Gift; size?: number }) {
  return <div className="qrFrame"><QRCodeSVG value={gift.url} size={size} marginSize={1} bgColor="#ffffff" fgColor="#211e1a" level="M" /><span className="qrHint">SCAN ME</span></div>;
}
function GiftIllustration({ gift }: {gift: Gift}) {
  return gift.image ? <img className="productImage" alt="" src={gift.image} loading="lazy" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = "none"; }} /> : <span className="giftEmoji" aria-hidden="true">🎁</span>;
}

export default function Home() {
  const [data, setData] = useState<LetterData>(initial);
  const [loaded, setLoaded] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [activePanel, setActivePanel] = useState<"edit"|"preview">("edit");
  const [printMode, setPrintMode] = useState<PrintMode>("letter");
  const [editing, setEditing] = useState<string | null>(null);
  const [pdfBusy,setPdfBusy] = useState(false);
  const [pdfReady,setPdfReady] = useState<PdfReady | null>(null);
  const [fileSharing,setFileSharing] = useState(false);
  const [shareSupported,setShareSupported] = useState(false);
  const pdfUrlRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(()=>{
    setShareSupported(typeof navigator!=="undefined" && typeof navigator.share==="function" && typeof navigator.canShare==="function");
    return ()=>{if(pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);};
  },[]);
  useEffect(()=>{
    // Never offer an out-of-date PDF after a gift is edited/removed.
    setPdfReady(null);
    if(pdfUrlRef.current){URL.revokeObjectURL(pdfUrlRef.current);pdfUrlRef.current=null;}
  },[data]);

  useEffect(() => {
    try {
      const value = window.localStorage.getItem(STORAGE);
      if (value) {
        const stored = JSON.parse(value) as Partial<LetterData>;
        if (stored && Array.isArray(stored.gifts)) {
          setData({
            name: typeof stored.name === "string" ? stored.name.slice(0,60) : "",
            age: typeof stored.age === "string" ? stored.age.slice(0,10) : "",
            message: typeof stored.message === "string" ? stored.message.slice(0,400) : "",
            gifts: stored.gifts.filter(g => g && typeof g.url === "string" && safeUrl(g.url)).slice(0,50).map(g => ({
              id: typeof g.id === "string" ? g.id : newId(),
              url: g.url, title: cleanGiftTitle(String(g.title || ""),g.url),
              description: String(g.description || "").slice(0,350),
              image: String(g.image || "").slice(0,2000), note: String(g.note || "").slice(0,160),
              priority: g.priority === "top" ? "top" : "wish",
              resolvedUrl: typeof g.resolvedUrl === "string" ? g.resolvedUrl : undefined,
              asin: typeof g.asin === "string" ? g.asin : undefined,
              source: g.source
            }))
          });
        }
      }
    } catch { /* invalid local backup: start fresh */ }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const unnamed = data.gifts.find(g => g.title === NAME_NEEDED);
    if (unnamed) {
      setEditing(current => current || unnamed.id);
      setNotice("Some saved gift links need titles. Use Retry Amazon titles or edit the highlighted gift.");
    }
    // Run once after loading the previous browser-local list, preserving existing gifts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { window.localStorage.setItem(STORAGE, JSON.stringify(data)); } catch { /* private browsing */ }
    }, 150);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [data, loaded]);

  function update<K extends keyof LetterData>(key: K, value: LetterData[K]) {
    setData(current => ({ ...current, [key]: value }));
  }
  function updateGift(id: string, patch: Partial<Gift>) {
    setData(current => ({ ...current, gifts: current.gifts.map(g => g.id === id ? {...g,...patch} : g) }));
  }
  function removeGift(id: string) {
    setData(current => ({ ...current, gifts: current.gifts.filter(g => g.id !== id) }));
    if (editing === id) setEditing(null);
  }
  function moveGift(id: string, direction: number) {
    setData(current => {
      const arr = [...current.gifts], i = arr.findIndex(g => g.id === id), j = i + direction;
      if (i < 0 || j < 0 || j >= arr.length) return current;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...current, gifts: arr };
    });
  }
  async function addGift(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const parsed = parseGiftPaste(urlInput);
    const url = parsed.url;
    if (!url) { setNotice("Paste a full HTTPS link to a gift, then try again."); return; }
    if (data.gifts.length >= 50) { setNotice("A letter can contain up to 50 gifts."); return; }
    if (data.gifts.some(g => g.url === url)) { setNotice("That gift is already on the list."); return; }
    setBusy(true); setNotice("");
    let title = NAME_NEEDED, image = "", description = "", resolvedUrl = "", asin = "";
    let source: Gift["source"] = "unavailable";
    let lookupWarning = "";
    try {
      const response = await fetch("/letter-to-santa/api/metadata", {
        method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({url})
      });
      const result: GiftLookup = await response.json();
      if (response.ok) {
        title = cleanGiftTitle(result.title || "", url);
        description = (result.description || "").slice(0,350);
        image = result.image || "";
        resolvedUrl = result.resolvedUrl || "";
        asin = result.asin || "";
        source = result.source || "unavailable";
        lookupWarning = result.warning || "";
      }
    } catch { /* Links remain valid even if the retailer blocks its metadata. */ }
    if (parsed.sharedTitle && (source !== "page" || needsManualName(title,url))) {
      title=cleanGiftTitle(parsed.sharedTitle,url);
      if (title !== NAME_NEEDED) source = "shared-text";
    }
    const id = newId();
    setData(current => ({ ...current, gifts: [...current.gifts, {
      id,url,title,description,image,note:"",priority:"wish",resolvedUrl,asin,source
    }] }));
    if (title === NAME_NEEDED) {
      setEditing(id);
      setNotice("Amazon's share link was saved and will work for shopping, but Amazon did not reveal the product name. Open the gift and type its name below.");
    } else if (source === "url-hint") {
      setEditing(id);
      setNotice(lookupWarning || "The name came from the Amazon link. Please check it.");
    } else if (source === "search") {
      setNotice("Found a possible product title from indexed Amazon listings. Check that the name matches your gift.");
    }
    setUrlInput(""); setBusy(false);
  }
  async function refreshGift(gift: Gift) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/letter-to-santa/api/metadata", {
        method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({url:gift.url})
      });
      const result: GiftLookup = await response.json();
      if (!response.ok) throw new Error(result.error || "The store blocked product lookup.");
      const newName = cleanGiftTitle(result.title || "",gift.url);
      const patch: Partial<Gift> = {};
      if (newName !== NAME_NEEDED && (gift.title === NAME_NEEDED || needsManualName(gift.title,gift.url))) {
        patch.title=newName; patch.source=result.source;
      }
      if (result.description && !gift.description.trim()) patch.description=result.description.slice(0,350);
      if (result.image && !gift.image) patch.image=result.image;
      if (result.resolvedUrl && result.resolvedUrl !== gift.resolvedUrl) patch.resolvedUrl=result.resolvedUrl;
      if (result.asin && result.asin !== gift.asin) patch.asin=result.asin;
      if (Object.keys(patch).length) updateGift(gift.id,patch);
      setNotice(newName === NAME_NEEDED
        ? "Amazon's link is saved, but its catalog blocked product details. Add the name manually."
        : result.source === "search" ? "A title was recovered from indexed Amazon listings; please verify it." : result.source === "url-hint" ? "A name was inferred from the Amazon URL; check that it matches the gift."
        : Object.keys(patch).length ? "Updated available gift details." : "No new details found.");
    } catch {
      setNotice("The store did not provide a product title. Please enter the gift name manually.");
    } finally { setBusy(false); setEditing(gift.id); }
  }
  async function recoverAllMissing() {
    const missing = data.gifts.filter(g => isAmazonGift(g.url) && (needsManualName(g.title,g.url) || g.source === "url-hint"));
    if(!missing.length) { setNotice("No Amazon gifts need recovery."); return; }
    setBusy(true); setNotice("Checking previously saved Amazon links…");
    let improved=0,unavailable=0;
    for (const gift of missing.slice(0,12)) {
      try {
        const response = await fetch("/letter-to-santa/api/metadata", {
          method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:gift.url})
        });
        const info:GiftLookup=await response.json();
        if(!response.ok) {unavailable++;continue;}
        const patch:Partial<Gift>={};
        const name=cleanGiftTitle(info.title||"",gift.url);
        if((needsManualName(gift.title,gift.url) || gift.source === "url-hint") && name!==NAME_NEEDED && (info.source === "page" || info.source === "search" || needsManualName(gift.title,gift.url))) {
          patch.title=name;patch.source=info.source;
        }
        // The Christmas letter requires a recognizable product title.
        if(!gift.image && info.image)patch.image=info.image;
        if(info.asin)patch.asin=info.asin;
        if(info.resolvedUrl)patch.resolvedUrl=info.resolvedUrl;
        if(Object.keys(patch).length)updateGift(gift.id,patch);
        if(patch.title)improved++;else unavailable++;
      } catch {unavailable++; }
    }
    setBusy(false);
    setNotice(improved
      ? "Recovered titles for " + improved + " Amazon link(s). " + unavailable + " could not be identified automatically."
      : "No new product titles were available. Your Amazon gift links and QR codes are preserved. You can enter a name manually.");
  }
  async function pasteLink() {
    try { const value = await navigator.clipboard.readText(); setUrlInput(value.trim()); }
    catch { setNotice("Use the URL field to paste your copied link."); }
  }
  async function copyList() {
    const content = data.gifts.map((g,i) => String(i + 1) + ". " + g.title
      + (g.description ? "\n" + g.description : "")
      + (g.note ? "\nDetails: " + g.note : "")
      + "\n" + g.url).join("\n\n");
    if (!content) { setNotice("Add a gift before copying your shopping list."); return; }
    try { await navigator.clipboard.writeText((data.name || "Christmas") + " wish list\n\n" + content); setNotice("Shopping list copied!"); }
    catch { setNotice("Couldn't copy automatically. Try printing the shopping list."); }
  }
  function emailList() {
    if (!data.gifts.length) { setNotice("Add a gift before emailing the list."); return; }
    const name = data.name.trim() || "Christmas";
    const items = data.gifts.map((g,i) => [
      String(i+1) + ". " + g.title,
      g.description.trim(),
      g.note.trim() ? "Details: " + g.note.trim() : "",
      "Gift link: " + g.url
    ].filter(Boolean).join("\n")).join("\n\n");
    const subject = name + "'s Christmas wish list";
    const body = "Here are " + name + "'s Christmas wishes, with links you can tap directly from your phone:\n\n" + items;
    if (body.length > 6000) {
      setNotice("This list is long for an email link. Use Copy links to paste the complete list into your email.");
      return;
    }
    window.location.href = "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }
  async function generatePdf(which:PrintMode) {
    if(!data.gifts.length){setNotice("Add at least one gift first.");return;}
    if(pdfBusy)return;
    setPdfBusy(true);setPdfReady(null);setNotice("");
    try{
      const {buildSantaPdf}=await import("../lib/pdfExport");
      const blob=await buildSantaPdf(data,which);
      const slug=(data.name.trim()||"christmas").normalize("NFKD").replace(/[^a-zA-Z0-9]+/g,"-").replace(/^-|-$/g,"").toLowerCase().slice(0,40)||"christmas";
      const filename=slug+(which==="letter"?"-letter-to-santa.pdf":"-shopping-list.pdf");
      if(pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
      const url=URL.createObjectURL(blob);pdfUrlRef.current=url;
      setPdfReady({blob,url,filename,kind:which});
      setPrintMode(which);
      setNotice("Your PDF is ready. Use Open PDF, Download PDF, or Share PDF below.");
    }catch(error){
      console.error("Santa PDF export error",error);
      setNotice("Could not create the PDF. Please try again or open the site in Safari / Chrome. Your wish list is still saved.");
    }finally{setPdfBusy(false);}
  }
  async function sharePdf(){
    if(!pdfReady)return;
    const file=new File([pdfReady.blob],pdfReady.filename,{type:"application/pdf"});
    if(!navigator.share||!navigator.canShare?.({files:[file]})){
      setNotice("File sharing isn't supported by this browser. Use Open PDF or Download PDF instead.");
      return;
    }
    setFileSharing(true);
    try{
      await navigator.share({title:pdfReady.filename,files:[file]});
    }catch(e){
      if(e instanceof Error && e.name!=="AbortError")setNotice("Sharing failed. Use Open PDF or Download PDF instead.");
    }finally{setFileSharing(false);}
  }
  function clearLetter() {
    if (window.confirm("Start a new letter? This clears the current wish list saved in this browser.")) {
      setData(initial); setNotice(""); setEditing(null); setActivePanel("edit");
    }
  }
  const childName = data.name.trim() || "_______________";
  const greeting = data.message.trim() || "I've been dreaming about Christmas, and these are some things that would make me smile. Thank you for bringing magic to our home!";
  return <main className="appShell">
    <header className="topbar">
      <div className="topbarContent">
        <a className="brand" href="/letter-to-santa" aria-label="Letter to Santa home"><span className="brandIcon">✉</span><span>Letter <em>to</em> Santa</span></a>
        <div className="topbarRight"><span className="privateLabel"><Symbol name="star"/> Made with Christmas magic</span><a href="https://www.jaredvogler.com/side-quests" className="backLink">JaredVogler.com <Symbol name="arrow"/></a></div>
      </div>
    </header>
    <section className="hero">
      <div className="seasonEyebrow">✦ THE NORTH POLE LETTER STUDIO ✦</div>
      <h1>Little wishes. <i>Big magic.</i></h1>
      <p>Turn a Christmas wish list into a beautiful letter, with QR codes that take Santa’s helpers straight to each gift.</p>
      <div className="heroStars" aria-hidden="true">✶ · ✧ · ✶</div>
    </section>
    <div className="mobileSwitch" role="group" aria-label="Choose editor or letter preview">
      <button type="button" className={activePanel === "edit" ? "selected" : ""} onClick={() => setActivePanel("edit")}>✎ Build your letter</button>
      <button type="button" className={activePanel === "preview" ? "selected" : ""} onClick={() => setActivePanel("preview")}>✦ Preview letter</button>
    </div>
    <div className="workshop">
      <div className={"builder " + (activePanel !== "edit" ? "mobileHidden" : "")}>
        <div className="builderHeading"><div><span className="stepLabel">STEP 01 / THE LITTLE DETAILS</span><h2>Dear Santa, it’s me!</h2><p>Start with a name, then add the gifts they’re dreaming of.</p></div><span className="headingDecoration" aria-hidden="true">✦</span></div>
        <div className="fieldsRow">
          <label className="field"><span>Child’s first name</span><input aria-label="Child’s first name" maxLength={60} placeholder="e.g. Emma" value={data.name} onChange={e => update("name",e.target.value)} /></label>
          <label className="field ageField"><span>Age <small>(optional)</small></span><input aria-label="Age (optional)" maxLength={10} placeholder="e.g. 5" value={data.age} onChange={e => update("age",e.target.value)} /></label>
        </div>
        <label className="field messageField"><span>A note for Santa <small>(optional)</small></span><textarea maxLength={400} rows={3} placeholder="Tell Santa about their year, a special memory, or what they’re thankful for…" value={data.message} onChange={e => update("message",e.target.value)} /><span className="fieldFoot">Leave blank for a sweet, ready-made greeting.</span></label>
        <div className="dottedDivider"/>
        <div className="sectionHead"><div><span className="stepLabel">STEP 02 / THE WISH LIST</span><h2><span aria-hidden="true">🎁</span> Add a Christmas wish</h2><p>Paste a product link. We’ll find the product title when possible and make its QR code automatically.</p></div></div>
        <form className="addGiftForm" onSubmit={addGift}>
          <label htmlFor="product-url">Product website link</label>
          <div className="urlInputWrap"><span aria-hidden="true">🔗</span><input id="product-url" type="text" inputMode="url" autoComplete="off" required placeholder="Paste an Amazon a.co/d/ link or product share text" value={urlInput} onChange={e => setUrlInput(e.target.value)} /></div>
          <p className="amazonHint">Amazon a.co share links are supported. We try to recover the title using the exact product ID. If no reliable match exists, you can enter the name.</p>
          <div className="addActions"><button className="pasteBtn" type="button" onClick={pasteLink}><Symbol name="copy"/> Paste link</button><button className="primaryBtn" type="submit" disabled={busy}><Symbol name="magic"/> {busy ? "Finding the gift…" : "Add to my list"} <span aria-hidden="true">→</span></button></div>
        </form>
        {notice && <div className="notice" role="status">{notice} <button type="button" onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}
        <div className="wishListHeader"><div><span className="stepLabel">YOUR CHRISTMAS WISHES</span><h3>My wish list <b>{data.gifts.length}</b></h3></div>{data.gifts.length > 0 && <div className="listTools"><button type="button" className="textAction" onClick={recoverAllMissing} disabled={busy}>↻ Retry Amazon titles</button><button type="button" className="textAction" onClick={copyList}><Symbol name="copy"/> Copy links</button></div>}</div>
        {!data.gifts.length && <div className="emptyState"><span>🎄</span><strong>The wish list starts here.</strong><p>Find something wonderful online, copy the link, and paste it above.</p></div>}
        <div className="giftList">{data.gifts.map((gift,i) => <article className="giftCard" key={gift.id}>
          <div className="giftCardMain">
            <div className="giftIndex">{String(i+1).padStart(2,"0")}</div><div className="giftPic"><GiftIllustration gift={gift}/></div>
            <div className="giftInfo"><h4 className={gift.title === NAME_NEEDED ? "missingGiftName" : ""}>{gift.title}</h4>{gift.description && <p className="giftInfoDescription">{gift.description}</p>}<small>{domain(gift.url)}{gift.asin ? " · ASIN " + gift.asin : ""}</small>{(gift.source === "url-hint" || gift.source === "search") && <small className="inferredHint">⚠ {gift.source === "search" ? "Title recovered from indexed listing" : "Name inferred from link"} — please verify</small>}<a href={gift.url} target="_blank" rel="noopener noreferrer" className="giftLink">Open gift <Symbol name="arrow"/></a></div>
            <div className="giftQrSmall"><GiftQR gift={gift} size={66}/></div>
          </div>
          <div className="giftCardTools"><button type="button" onClick={() => setEditing(editing === gift.id ? null : gift.id)}>{editing === gift.id ? "Done editing" : "✎ Edit gift"}</button><button type="button" onClick={() => moveGift(gift.id,-1)} disabled={i===0} aria-label={"Move " + gift.title + " up"}>↑</button><button type="button" onClick={() => moveGift(gift.id,1)} disabled={i===data.gifts.length-1} aria-label={"Move " + gift.title + " down"}>↓</button><button type="button" className="deleteBtn" onClick={() => removeGift(gift.id)} aria-label={"Remove " + gift.title}>✕</button></div>
          {editing === gift.id && <div className="giftEdit"><label className="field"><span>Gift name <small>(required to identify a gift)</small></span><input maxLength={180} placeholder="e.g. LEGO City Fire Station" value={gift.title === NAME_NEEDED ? "" : gift.title} onChange={e=>updateGift(gift.id,{title:e.target.value.slice(0,180)})}/></label>
          
          <label className="field"><span>Extra details <small>(size, color, etc.)</small></span><input maxLength={160} placeholder="e.g. Blue, size 5" value={gift.note} onChange={e=>updateGift(gift.id,{note:e.target.value})}/></label>
          <label className="field"><span>Wish importance</span><select value={gift.priority} onChange={e=>updateGift(gift.id,{priority:e.target.value as Gift["priority"]})}><option value="wish">Would love</option><option value="top">Top wish ★</option></select></label>
          <button className="outlineBtn refreshDetails" type="button" disabled={busy} onClick={()=>refreshGift(gift)}>↻ Retry product title lookup</button>
          <div className="editUrlHint">Shopping link: <a href={gift.url} target="_blank" rel="noopener noreferrer">{gift.url}</a>{gift.asin && <p>Amazon product ID: <strong>{gift.asin}</strong></p>}{gift.resolvedUrl && gift.resolvedUrl !== gift.url && <p>Resolved destination: <a href={gift.resolvedUrl} target="_blank" rel="noopener noreferrer">{gift.resolvedUrl}</a></p>}<p>If automatic title lookup fails, open the Amazon link and copy the gift name into the field above. The QR code will still link to the gift.</p>{gift.asin && <a className="asinSearch" href={"https://www.google.com/search?q=" + encodeURIComponent("Amazon " + gift.asin)} target="_blank" rel="noopener noreferrer">Search this product ID to help identify the gift ↗</a>}</div>
          </div>}
        </article>)}</div>
        <div className="actionPanel">
          <div className="actionIntro"><span aria-hidden="true">✉</span><div><h3>Ready for the North Pole?</h3><p>Your letter is saved privately in this browser.</p></div></div>
          <button type="button" className="primaryBtn fullBtn" disabled={pdfBusy} onClick={() => generatePdf("letter")}><Symbol name="print"/> {pdfBusy?"Creating PDF…":"Generate Santa letter PDF"}</button>
          <button type="button" className="outlineBtn fullBtn" disabled={pdfBusy} onClick={() => generatePdf("shop")}><Symbol name="gift"/> Generate parent shopping PDF</button>
          {pdfReady && <PdfDownloadLinks ready={pdfReady} canShare={shareSupported} onShare={sharePdf} sharing={fileSharing}/>}
          <p className="pdfPlatformHint">Works on iPhone (Safari) and Samsung Android (Chrome/Samsung Internet). No browser print dialog required.</p>
          <button type="button" className="outlineBtn fullBtn emailBtn" onClick={emailList}>✉ Email wish list with clickable links</button>
          <div className="lowerActions"><button type="button" onClick={() => {setActivePanel("preview"); window.scrollTo({top:0,behavior:"smooth"});}}>See letter preview →</button><button type="button" onClick={clearLetter}>Start new letter</button></div>
        </div>
      </div>
      <div className={"previewColumn " + (activePanel !== "preview" ? "mobileHidden" : "")}>
        <div className="previewToolbar"><div><span className="stepLabel">STEP 03 / THE MAGIC REVEAL</span><h2>Your letter to Santa</h2></div><span className="liveBadge"><span/> LIVE PREVIEW</span></div>
        <div className="paperWrap">
          <LetterPaper name={childName} age={data.age} greeting={greeting} gifts={data.gifts}/>
        </div>
        <div className="previewHelp"><span aria-hidden="true">✦</span><p>Every gift shows its title with a tappable shopping link and QR code, including on saved PDFs and email drafts.</p></div>
        <div className="previewButtons"><button className="primaryBtn fullBtn" disabled={pdfBusy} onClick={() => generatePdf("letter")}>{pdfBusy?"Creating PDF…":"▤ Generate Santa PDF"}</button><button className="outlineBtn fullBtn" onClick={emailList}>✉ Email clickable links</button><button className="outlineBtn fullBtn" onClick={copyList}>⧉ Copy gift links</button></div>
        {pdfReady && <PdfDownloadLinks ready={pdfReady} canShare={shareSupported} onShare={sharePdf} sharing={fileSharing}/>}
      </div>
    </div>
    <footer className="pageFooter"><span>Made with ♥ and a little North Pole magic.</span><span>Private by design · No account needed · Free to use</span><a href="https://www.jaredvogler.com">JaredVogler.com ↗</a></footer>
    <div className="printOnly"><div className={printMode === "letter" ? "" : "noPrint"}><LetterPaper name={childName} age={data.age} greeting={greeting} gifts={data.gifts}/></div><div className={printMode === "shop" ? "" : "noPrint"}><ShoppingPaper name={childName} gifts={data.gifts}/></div></div>
  </main>;
}

function PdfDownloadLinks({ready,canShare,onShare,sharing}:{ready:PdfReady;canShare:boolean;onShare:()=>void;sharing:boolean}){
  return <section className="pdfReadyPanel" aria-live="polite">
    <strong>✓ Your {ready.kind==="letter"?"Santa letter":"parent shopping sheet"} PDF is ready</strong>
    <div className="pdfReadyActions">
      <a className="primaryBtn" href={ready.url} download={ready.filename} type="application/pdf">↓ Download PDF</a>
      <a className="outlineBtn" href={ready.url} target="_blank" rel="noopener noreferrer" type="application/pdf">↗ Open PDF</a>
      {canShare && <button type="button" className="outlineBtn" onClick={onShare} disabled={sharing}>{sharing?"Sharing…":"✉ Share PDF"}</button>}
    </div>
    <p>iPhone: tap <b>Open PDF</b>, then the Share button to Save to Files or Print. Samsung: tap <b>Download PDF</b> or <b>Share PDF</b>. If your in-app browser blocks files, open this website in Safari, Chrome, or Samsung Internet.</p>
  </section>;
}

function LetterPaper({name, age, greeting, gifts}:{name:string;age:string;greeting:string;gifts:Gift[]}) {
  return <div className="letterPaper">
    <div className="paperInner">
      <div className="letterCorner left" aria-hidden="true">❄ ✦ ❄</div><div className="letterCorner right" aria-hidden="true">❄</div>
      <div className="letterStamp"><span>✦</span> NORTH POLE EXPRESS <span>✦</span></div>
      <div className="letterTitle"><span className="paperSleigh" aria-hidden="true">✧ ✧ ✧</span><h2>Dear Santa,</h2><div className="letterSwash" aria-hidden="true">❧</div></div>
      <div className="letterBody"><p>My name is <strong>{name}</strong>{age.trim() && <> and I’m <strong>{age.trim()}</strong> years old</>}. I’m writing you a special Christmas letter!</p><p>{greeting}</p></div>
      <div className="wishesTitle"><span>✧</span><h3>My Christmas Wishes</h3><span>✧</span></div>
      {gifts.length ? <div className="paperGifts">{gifts.map((gift,i) => <div className="paperGift" key={gift.id}>
        <div className="paperGiftNumber">{i+1}.</div><div className="paperGiftContent"><div className="paperGiftName">{gift.title.trim() || NAME_NEEDED}{gift.priority === "top" && <span className="topStar" aria-label="Top wish"> ★</span>}</div>{gift.description && <p className="paperGiftDescription">{gift.description}</p>}{gift.note && <div className="paperGiftNote">{gift.note}</div>}<a className="paperGiftUrl" href={gift.url} target="_blank" rel="noopener noreferrer" title={"Open " + gift.title}>{gift.url}</a></div><GiftQR gift={gift} size={73}/></div>)}</div> : <div className="paperEmpty"><p>My wishes will appear here, like magic...</p><div>✧　 ✦　 ✧</div></div>}
      <div className="paperClosing"><p>Thank you, Santa!</p><span>With love,</span><strong>{name}</strong><b>♡</b></div>
      <div className="paperBottom"><span>❄</span><span>✦ · from the heart to the North Pole · ✦</span><span>❄</span></div>
    </div>
  </div>;
}

function ShoppingPaper({name,gifts}:{name:string;gifts:Gift[]}) {
  return <div className="shoppingPaper"><div className="shoppingTop">✦ THE ELF SHOPPING DESK ✦</div><h1>{name === "_______________" ? "Christmas" : name + "’s"} Gift Guide</h1><p className="shoppingIntro">A practical little cheat sheet for Santa’s helpers. Scan a QR code to open the gift link, or use the printed website address.</p>
    <div className="shoppingRows">{gifts.map((gift,i) => <div className="shoppingRow" key={gift.id}><div className="shoppingNum">{String(i+1).padStart(2,"0")}</div><div className="shoppingDetails"><h2>{gift.title.trim() || NAME_NEEDED}{gift.priority === "top" && <span> ★ Top wish</span>}</h2>{gift.description && <p className="shoppingDescription">{gift.description}</p>}{gift.note && <p>{gift.note}</p>}<a className="printedUrl" href={gift.url} target="_blank" rel="noopener noreferrer">{gift.url}</a></div><GiftQR gift={gift} size={95}/></div>)}</div><div className="shoppingFooter">Made at JaredVogler.com/letter-to-santa</div></div>;
}
