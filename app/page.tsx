"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type Gift = { id: string; url: string; title: string; image: string; note: string; priority: "top" | "wish" };
type LetterData = { name: string; age: string; message: string; gifts: Gift[] };
type PrintMode = "letter" | "shop";
const STORAGE = "letter-to-santa-v1";
const initial: LetterData = { name: "", age: "", message: "", gifts: [] };

function safeUrl(raw: string) {
  try { const url = new URL(raw.trim()); return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && (!url.port || url.port === "443") ? url.toString() : null; }
  catch { return null; }
}
function domain(url: string) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Gift website"; } }
function newId() { return globalThis.crypto?.randomUUID?.() || String(Date.now()) + "-" + Math.random().toString(36).slice(2); }
function defaultTitle(url: string) {
  try {
    const path = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "");
    return path.replace(/\.(html|htm)$/, "").replace(/[-_]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) || "New Christmas wish";
  } catch { return "New Christmas wish"; }
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
              url: g.url, title: String(g.title || "Christmas wish").slice(0,180),
              image: String(g.image || "").slice(0,2000), note: String(g.note || "").slice(0,160),
              priority: g.priority === "top" ? "top" : "wish"
            }))
          });
        }
      }
    } catch { /* invalid local backup: start fresh */ }
    setLoaded(true);
  }, []);

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
    const url = safeUrl(urlInput);
    if (!url) { setNotice("Paste a full HTTPS link to a gift, then try again."); return; }
    if (data.gifts.length >= 50) { setNotice("A letter can contain up to 50 gifts."); return; }
    if (data.gifts.some(g => g.url === url)) { setNotice("That gift is already on the list."); return; }
    setBusy(true); setNotice("");
    let title = defaultTitle(url), image = "";
    try {
      const response = await fetch("/letter-to-santa/api/metadata", {
        method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({url})
      });
      const result: {title?:string;image?:string;error?:string} = await response.json();
      if (response.ok && result.title) title = result.title;
      if (response.ok && result.image) image = result.image;
      if (!response.ok) setNotice("Gift added. The shop blocked title extraction, so you can edit its name below.");
    } catch { setNotice("Gift added. You can edit its title below."); }
    const id = newId();
    setData(current => ({ ...current, gifts: [...current.gifts, {id,url,title,image,note:"",priority:"wish"}] }));
    setUrlInput(""); setBusy(false);
  }
  async function pasteLink() {
    try { const value = await navigator.clipboard.readText(); setUrlInput(value.trim()); }
    catch { setNotice("Use the URL field to paste your copied link."); }
  }
  async function copyList() {
    const content = data.gifts.map((g,i) => String(i + 1) + ". " + g.title + "\n" + g.url + (g.note ? "\nNote: " + g.note : "")).join("\n\n");
    if (!content) { setNotice("Add a gift before copying your shopping list."); return; }
    try { await navigator.clipboard.writeText((data.name || "Christmas") + " wish list\n\n" + content); setNotice("Shopping list copied!"); }
    catch { setNotice("Couldn't copy automatically. Try printing the shopping list."); }
  }
  function print(which: PrintMode) {
    if (!data.gifts.length) { setNotice("Add at least one gift first."); return; }
    setPrintMode(which);
    window.setTimeout(() => window.print(), 100);
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
        <div className="sectionHead"><div><span className="stepLabel">STEP 02 / THE WISH LIST</span><h2><span aria-hidden="true">🎁</span> Add a Christmas wish</h2><p>Paste a product link. We’ll try to find its name and make a QR code automatically.</p></div></div>
        <form className="addGiftForm" onSubmit={addGift}>
          <label htmlFor="product-url">Product website link</label>
          <div className="urlInputWrap"><span aria-hidden="true">🔗</span><input id="product-url" type="url" inputMode="url" autoComplete="url" required placeholder="https://www.example.com/product/..." value={urlInput} onChange={e => setUrlInput(e.target.value)} /></div>
          <div className="addActions"><button className="pasteBtn" type="button" onClick={pasteLink}><Symbol name="copy"/> Paste link</button><button className="primaryBtn" type="submit" disabled={busy}><Symbol name="magic"/> {busy ? "Finding the gift…" : "Add to my list"} <span aria-hidden="true">→</span></button></div>
        </form>
        {notice && <div className="notice" role="status">{notice} <button type="button" onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}
        <div className="wishListHeader"><div><span className="stepLabel">YOUR CHRISTMAS WISHES</span><h3>My wish list <b>{data.gifts.length}</b></h3></div>{data.gifts.length > 0 && <button type="button" className="textAction" onClick={copyList}><Symbol name="copy"/> Copy links</button>}</div>
        {!data.gifts.length && <div className="emptyState"><span>🎄</span><strong>The wish list starts here.</strong><p>Find something wonderful online, copy the link, and paste it above.</p></div>}
        <div className="giftList">{data.gifts.map((gift,i) => <article className="giftCard" key={gift.id}>
          <div className="giftCardMain">
            <div className="giftIndex">{String(i+1).padStart(2,"0")}</div><div className="giftPic"><GiftIllustration gift={gift}/></div>
            <div className="giftInfo"><h4>{gift.title}</h4><small>{domain(gift.url)}</small><a href={gift.url} target="_blank" rel="noopener noreferrer" className="giftLink">Open gift <Symbol name="arrow"/></a></div>
            <div className="giftQrSmall"><GiftQR gift={gift} size={66}/></div>
          </div>
          <div className="giftCardTools"><button type="button" onClick={() => setEditing(editing === gift.id ? null : gift.id)}>{editing === gift.id ? "Done editing" : "✎ Edit gift"}</button><button type="button" onClick={() => moveGift(gift.id,-1)} disabled={i===0} aria-label={"Move " + gift.title + " up"}>↑</button><button type="button" onClick={() => moveGift(gift.id,1)} disabled={i===data.gifts.length-1} aria-label={"Move " + gift.title + " down"}>↓</button><button type="button" className="deleteBtn" onClick={() => removeGift(gift.id)} aria-label={"Remove " + gift.title}>✕</button></div>
          {editing === gift.id && <div className="giftEdit"><label className="field"><span>Gift name</span><input maxLength={180} value={gift.title} onChange={e=>updateGift(gift.id,{title:e.target.value})}/></label><label className="field"><span>Little detail <small>(size, color, etc.)</small></span><input maxLength={160} placeholder="e.g. Blue, size 5" value={gift.note} onChange={e=>updateGift(gift.id,{note:e.target.value})}/></label><label className="field"><span>Wish importance</span><select value={gift.priority} onChange={e=>updateGift(gift.id,{priority:e.target.value as Gift["priority"]})}><option value="wish">Would love</option><option value="top">Top wish ★</option></select></label></div>}
        </article>)}</div>
        <div className="actionPanel">
          <div className="actionIntro"><span aria-hidden="true">✉</span><div><h3>Ready for the North Pole?</h3><p>Your letter is saved privately in this browser.</p></div></div>
          <button type="button" className="primaryBtn fullBtn" onClick={() => print("letter")}><Symbol name="print"/> Print / Save letter as PDF</button>
          <button type="button" className="outlineBtn fullBtn" onClick={() => print("shop")}><Symbol name="gift"/> Print parent shopping sheet</button>
          <div className="lowerActions"><button type="button" onClick={() => {setActivePanel("preview"); window.scrollTo({top:0,behavior:"smooth"});}}>See letter preview →</button><button type="button" onClick={clearLetter}>Start new letter</button></div>
        </div>
      </div>
      <div className={"previewColumn " + (activePanel !== "preview" ? "mobileHidden" : "")}>
        <div className="previewToolbar"><div><span className="stepLabel">STEP 03 / THE MAGIC REVEAL</span><h2>Your letter to Santa</h2></div><span className="liveBadge"><span/> LIVE PREVIEW</span></div>
        <div className="paperWrap">
          <LetterPaper name={childName} age={data.age} greeting={greeting} gifts={data.gifts}/>
        </div>
        <div className="previewHelp"><span aria-hidden="true">✦</span><p>Every QR code opens the original gift website. Print for Santa or share the PDF with family!</p></div>
        <div className="previewButtons"><button className="primaryBtn fullBtn" onClick={() => print("letter")}>▤ Print / Save PDF</button><button className="outlineBtn fullBtn" onClick={copyList}>⧉ Copy gift links</button></div>
      </div>
    </div>
    <footer className="pageFooter"><span>Made with ♥ and a little North Pole magic.</span><span>Private by design · No account needed · Free to use</span><a href="https://www.jaredvogler.com">JaredVogler.com ↗</a></footer>
    <div className="printOnly"><div className={printMode === "letter" ? "" : "noPrint"}><LetterPaper name={childName} age={data.age} greeting={greeting} gifts={data.gifts}/></div><div className={printMode === "shop" ? "" : "noPrint"}><ShoppingPaper name={childName} gifts={data.gifts}/></div></div>
  </main>;
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
        <div className="paperGiftNumber">{i+1}.</div><div className="paperGiftContent"><div className="paperGiftName">{gift.title}{gift.priority === "top" && <span className="topStar" aria-label="Top wish"> ★</span>}</div>{gift.note && <div className="paperGiftNote">{gift.note}</div>}<div className="paperGiftDomain">{domain(gift.url)}</div></div><GiftQR gift={gift} size={73}/></div>)}</div> : <div className="paperEmpty"><p>My wishes will appear here, like magic...</p><div>✧　 ✦　 ✧</div></div>}
      <div className="paperClosing"><p>Thank you, Santa!</p><span>With love,</span><strong>{name}</strong><b>♡</b></div>
      <div className="paperBottom"><span>❄</span><span>✦ · from the heart to the North Pole · ✦</span><span>❄</span></div>
    </div>
  </div>;
}

function ShoppingPaper({name,gifts}:{name:string;gifts:Gift[]}) {
  return <div className="shoppingPaper"><div className="shoppingTop">✦ THE ELF SHOPPING DESK ✦</div><h1>{name === "_______________" ? "Christmas" : name + "’s"} Gift Guide</h1><p className="shoppingIntro">A practical little cheat sheet for Santa’s helpers. Scan a QR code to open the gift link, or use the printed website address.</p>
    <div className="shoppingRows">{gifts.map((gift,i) => <div className="shoppingRow" key={gift.id}><div className="shoppingNum">{String(i+1).padStart(2,"0")}</div><div className="shoppingDetails"><h2>{gift.title}{gift.priority === "top" && <span> ★ Top wish</span>}</h2>{gift.note && <p>{gift.note}</p>}<p>{domain(gift.url)}</p><div className="printedUrl">{gift.url}</div></div><GiftQR gift={gift} size={95}/></div>)}</div><div className="shoppingFooter">Made at JaredVogler.com/letter-to-santa</div></div>;
}
