"use client";

/**
 * Letter to Santa PDF renderer.
 * Decorative PDF is drawn directly with pdf-lib (not a screenshot or window.print),
 * so it remains reliable on iOS Safari and Android Chrome/Samsung Internet.
 * Every product URL has a real PDF URI annotation; each gift also has a QR image.
 */
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";
import type { PDFPage, PDFFont, RGB } from "pdf-lib";
import QRCode from "qrcode";

export type PdfGift = {
  id: string; url: string; title: string; description: string; note: string;
  priority: "top" | "wish";
};
export type SantaPdfData = {
  name: string; age: string; message: string; gifts: PdfGift[];
};
export type SantaPdfKind = "letter" | "shop";

const W=612, H=792;
const C={
  paper:rgb(1,0.975,0.936),
  ivory:rgb(1,0.991,0.967),
  burgundy:rgb(0.61,0.155,0.204),
  red:rgb(0.75,0.21,0.24),
  gold:rgb(0.73,0.56,0.32),
  paleGold:rgb(0.895,0.817,0.682),
  ink:rgb(0.30,0.23,0.20),
  muted:rgb(0.53,0.42,0.33),
  green:rgb(0.20,0.39,0.31),
  link:rgb(0.19,0.40,0.53),
  snow:rgb(0.59,0.78,0.89),
  white:rgb(1,1,1)
};
const unsafe=/[^\x20-\x7E\xA0-\xFF]/g;
function plain(value:string):string{
  return (value||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[‘’]/g,"'").replace(/[“”]/g,'"')
    .replace(/[—–−]/g,"-").replace(/…/g,"...")
    .replace(/\u00a0/g," ").replace(/[\r\n\t]+/g," ")
    .replace(unsafe,"").replace(/\s+/g," ").trim();
}
function lineBreaks(value:string,font:PDFFont,size:number,maxW:number,maxLines=100):string[]{
  const words=plain(value).split(/\s+/).filter(Boolean), result:string[]=[];
  let line="";
  for(const word of words){
    const candidate=line?line+" "+word:word;
    if(font.widthOfTextAtSize(candidate,size)<=maxW){line=candidate;continue;}
    if(line)result.push(line);
    line="";
    if(font.widthOfTextAtSize(word,size)<=maxW){line=word;continue;}
    for(const ch of word){
      if(line && font.widthOfTextAtSize(line+ch,size)>maxW){result.push(line);line="";}
      line+=ch;
    }
  }
  if(line)result.push(line);
  if(result.length<=maxLines)return result;
  const cut=result.slice(0,maxLines);
  let last=cut[maxLines-1];
  while(last && font.widthOfTextAtSize(last+"...",size)>maxW)last=last.slice(0,-1);
  cut[maxLines-1]=last+"...";
  return cut;
}
function safeDisplayUrl(raw:string){
  try{
    const u=new URL(raw);
    const label=u.origin+u.pathname;
    return label.length<=90?label:label.slice(0,87)+"...";
  }catch{return raw.slice(0,90);}
}
function centered(page:PDFPage,text:string,font:PDFFont,size:number,y:number,color:RGB,x=W/2){
  const width=font.widthOfTextAtSize(text,size);
  page.drawText(text,{x:x-width/2,y,font,size,color});
}
function tracked(page:PDFPage,text:string,font:PDFFont,size:number,y:number,color:RGB,spacing=2.1){
  const tokens=[...text];
  const width=tokens.reduce((sum,t)=>sum+font.widthOfTextAtSize(t,size)+spacing,0)-spacing;
  let x=(W-width)/2;
  for(const c of tokens){page.drawText(c,{x,y,font,size,color});x+=font.widthOfTextAtSize(c,size)+spacing;}
}
function star(page:PDFPage,x:number,y:number,r:number,color:RGB=C.gold){
  page.drawLine({start:{x:x-r,y},end:{x:x+r,y},thickness:.65,color});
  page.drawLine({start:{x,y:y-r*1.5},end:{x,y:y+r*1.5},thickness:.65,color});
  page.drawLine({start:{x:x-r*.42,y:y-r*.55},end:{x:x+r*.42,y:y+r*.55},thickness:.45,color});
  page.drawLine({start:{x:x-r*.42,y:y+r*.55},end:{x:x+r*.42,y:y-r*.55},thickness:.45,color});
}
function snowflake(page:PDFPage,x:number,y:number,r=13){
  for(let k=0;k<6;k++){
    const a=k*Math.PI/3,dx=Math.cos(a),dy=Math.sin(a);
    page.drawLine({start:{x,y},end:{x:x+r*dx,y:y+r*dy},thickness:1.05,color:C.snow});
    for(const side of [-1,1]){
      const bx=x+dx*r*.66,by=y+dy*r*.66;
      const theta=a+Math.PI+side*Math.PI/4;
      page.drawLine({start:{x:bx,y:by},end:{x:bx+r*.23*Math.cos(theta),y:by+r*.23*Math.sin(theta)},thickness:.75,color:C.snow});
    }
  }
  page.drawCircle({x,y,size:1.7,color:C.snow});
}
function background(page:PDFPage){
  // Border closely follows the live website's red-and-cream air-mail stationery.
  page.drawRectangle({x:0,y:0,width:W,height:H,color:C.white});
  page.drawRectangle({x:23,y:20,width:W-46,height:H-40,color:C.paper});
  // Diagonal red stripes and narrow golden accents on all four edges.
  for(let y=29;y<770;y+=34){
    page.drawLine({start:{x:28,y:y+19},end:{x:49,y:y-2},thickness:10,color:C.red});
    page.drawLine({start:{x:563,y:y+19},end:{x:584,y:y-2},thickness:10,color:C.red});
    page.drawLine({start:{x:29,y:y+31},end:{x:49,y:y+11},thickness:2.1,color:C.gold});
    page.drawLine({start:{x:563,y:y+31},end:{x:584,y:y+11},thickness:2.1,color:C.gold});
  }
  for(let x=33;x<579;x+=38){
    page.drawLine({start:{x,y:772},end:{x:x+18,y:753},thickness:10,color:C.red});
    page.drawLine({start:{x,y:40},end:{x:x+18,y:22},thickness:10,color:C.red});
    page.drawLine({start:{x:x+27,y:769},end:{x:x+37,y:758},thickness:1.8,color:C.gold});
    page.drawLine({start:{x:x+27,y:38},end:{x:x+37,y:27},thickness:1.8,color:C.gold});
  }
  // Clean inner parchment masks any stripe overflow and keeps safe margins.
  page.drawRectangle({x:52,y:51,width:508,height:693,color:C.paper});
  page.drawRectangle({x:58,y:57,width:496,height:681,borderColor:C.paleGold,borderWidth:.65});
}
function addLink(doc:PDFDocument,page:PDFPage,url:string,x:number,y:number,w:number,h:number){
  try{
    const u=new URL(url);
    if(u.protocol!=="https:")return;
    const annotation=doc.context.obj({
      Type:PDFName.of("Annot"),Subtype:PDFName.of("Link"),
      Rect:[x,y,x+w,y+h],Border:[0,0,0],
      A:doc.context.obj({S:PDFName.of("URI"),URI:PDFString.of(u.toString())})
    });
    page.node.addAnnot(doc.context.register(annotation));
  }catch{/* A bad URL should never invalidate an entire letter. */}
}
function renderLines(page:PDFPage,contents:string[],font:PDFFont,size:number,
  x:number,y:number,leading:number,color:RGB):number{
  for(const content of contents){page.drawText(content,{x,y,font,size,color});y-=leading;}
  return y;
}
type RichPart={text:string;font:PDFFont;size:number;color:RGB};
function richParagraph(page:PDFPage,runs:RichPart[],x0:number,y0:number,maxWidth:number,leading:number):number{
  let x=x0,y=y0;
  for(const run of runs){
    for(const word of plain(run.text).split(" ").filter(Boolean)){
      const token=word+" ",width=run.font.widthOfTextAtSize(token,run.size);
      if(x>x0 && x+width>x0+maxWidth){x=x0;y-=leading;}
      if(x>x0+maxWidth-12 && x===x0){y-=leading;}
      page.drawText(word,{x,y,font:run.font,size:run.size,color:run.color});
      x+=width;
    }
  }
  return y-leading;
}

export async function buildSantaPdf(data:SantaPdfData,kind:SantaPdfKind):Promise<Blob>{
  if(!data.gifts.length)throw new Error("Add at least one gift before creating your PDF.");
  const doc=await PDFDocument.create();
  const name=plain(data.name)||"A very special child";
  doc.setTitle(name+(kind==="letter"?" - Letter to Santa":" - Christmas Shopping Guide"));
  doc.setAuthor("Letter to Santa | JaredVogler.com");
  doc.setSubject("Christmas wishes with clickable product links and scan-ready QR codes");
  const helv=await doc.embedFont(StandardFonts.Helvetica);
  const helvBold=await doc.embedFont(StandardFonts.HelveticaBold);
  const serif=await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold=await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic=await doc.embedFont(StandardFonts.TimesRomanItalic);
  const boldItalic=await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
  const qrImages=await Promise.all(data.gifts.map(async g=>{
    try{
      const dataUrl=await QRCode.toDataURL(g.url,{
        errorCorrectionLevel:"M",margin:2,width:400,
        color:{dark:"#241B19",light:"#FFFFFF"}
      });
      return await doc.embedPng(dataUrl);
    }catch{return null;}
  }));
  let page=doc.addPage([W,H]);background(page);
  let y=0;
  const safeBottom=92;
  function heading(label:string,continued=false){
    snowflake(page,96,709,14);
    snowflake(page,510,709,14);
    star(page,163,730,4.5);
    star(page,450,730,4.5);
    tracked(page,"NORTH POLE EXPRESS",helvBold,8.5,718,C.gold,2.5);
    star(page,270,693,3.2);
    star(page,306,692,3.9);
    star(page,342,693,3.2);
    if(continued){
      centered(page,label,serifBold,26,648,C.burgundy);
      centered(page,"THE WISH LIST CONTINUES",helv,9,619,C.muted);
      page.drawLine({start:{x:109,y:604},end:{x:502,y:604},color:C.paleGold,thickness:.8});
      y=584;
    }
  }
  heading("");
  function newPage(label="Christmas Wishes"){
    page=doc.addPage([W,H]);background(page);heading(label,true);
  }
  function wishHeading(){
    if(y<210){newPage();return;}
    star(page,126,y+3,3.3);star(page,486,y+3,3.3);
    centered(page,"My Christmas Wishes",serifBold,22,y,C.burgundy);
    page.drawLine({start:{x:151,y:y-14},end:{x:462,y:y-14},color:C.paleGold,thickness:.75});
    y-=39;
  }

  if(kind==="letter"){
    centered(page,"Dear Santa,",italic,49,620,C.burgundy);
    centered(page,"-  *  -",italic,14,602,C.gold);
    y=568;
    const intro:RichPart[]=[
      {text:"My name is",font:serif,size:14.3,color:C.ink},
      {text:name,font:boldItalic,size:16.2,color:C.burgundy},
      ...(plain(data.age) ? [
        {text:"and I'm",font:serif,size:14.3,color:C.ink},
        {text:plain(data.age),font:boldItalic,size:16.2,color:C.burgundy},
        {text:"years old.",font:serif,size:14.3,color:C.ink}
      ] : [{text:".",font:serif,size:14.3,color:C.ink}]),
      {text:"I'm writing you a special Christmas letter!",font:serif,size:14.3,color:C.ink}
    ];
    y=richParagraph(page,intro,101,y,412,21)-17;
    const greeting=plain(data.message)||
      "I've been dreaming about Christmas, and these are some things that would make me smile. Thank you for bringing magic to our home!";
    y=renderLines(page,lineBreaks(greeting,serif,14,412),serif,14,101,y,20.5,C.ink)-23;
    wishHeading();
  }else{
    centered(page,"Santa's Shopping List",serifBold,33,640,C.burgundy);
    centered(page,name+"'s Christmas Wishes",italic,18,605,C.green);
    y=571;
    y=renderLines(page,lineBreaks("Scan a QR code or tap the gift website link to shop.",serif,13.5,412),
      serif,13.5,101,y,19,C.ink)-18;
    wishHeading();
  }

  function drawGift(gift:PdfGift,idx:number){
    const title=plain(gift.title)||"Christmas wish";
    const titleLines=lineBreaks(title,serifBold,15.3,305,3);
    const note=plain(gift.note);
    const noteLines=note?lineBreaks(note,helv,9.5,290,2):[];
    const linkLines=lineBreaks(safeDisplayUrl(gift.url),helv,9,299,2);
    const titleH=titleLines.length*18.5;
    const noteH=noteLines.length*13;
    const linkH=linkLines.length*12;
    const cardH=Math.max(118,31+titleH+noteH+linkH+(gift.priority==="top"?12:0));
    if(y-cardH<safeBottom)newPage();
    const top=y,bot=top-cardH;
    // Cream card, fine gold rim, the vertical spacing of the live-preview gift cards.
    page.drawRectangle({
      x:80,y:bot,width:452,height:cardH,
      color:C.ivory,borderColor:C.paleGold,borderWidth:1.05
    });
    // Little numbered flourish at the left.
    page.drawText(String(idx+1)+".",{x:92,y:top-37,font:italic,size:20,color:C.gold});
    let tx=116,ty=top-31;
    ty=renderLines(page,titleLines,serifBold,15.3,tx,ty,18.5,C.burgundy);
    if(gift.priority==="top"){
      page.drawText("* TOP WISH",{x:tx,y:ty,font:helvBold,size:8.2,color:C.gold});ty-=12;
    }
    if(noteLines.length){
      ty=renderLines(page,noteLines,helv,9.5,tx,ty,13,C.muted);
    }
    ty-=3;
    const linkTop=ty+11;
    ty=renderLines(page,linkLines,helv,9,tx,ty,12,C.link);
    // Underline each printed link row to make the PDF touch target obvious.
    for(let j=0;j<linkLines.length;j++){
      const baseline=linkTop-11-j*12;
      const width=Math.min(299,helv.widthOfTextAtSize(linkLines[j],9));
      page.drawLine({start:{x:tx,y:baseline-2},end:{x:tx+width,y:baseline-2},thickness:.5,color:C.link});
    }
    addLink(doc,page,gift.url,tx-3,ty+1,304,linkTop-ty+8);

    const qr=qrImages[idx];
    const qrX=435,qrY=bot+(cardH-91)/2+7;
    page.drawRectangle({
      x:qrX-4,y:qrY-5,width:88,height:90,
      color:C.white,borderColor:C.paleGold,borderWidth:.8
    });
    if(qr)page.drawImage(qr,{x:qrX+2,y:qrY+4,width:76,height:76});
    centered(page,"SCAN ME",helvBold,6.7,qrY-1,C.muted,qrX+40);
    addLink(doc,page,gift.url,qrX-2,qrY-4,85,88);
    y=bot-13;
  }
  for(let i=0;i<data.gifts.length;i++)drawGift(data.gifts[i],i);
  if(kind==="letter"){
    if(y<155)newPage("A Letter with Love");
    y-=5;
    page.drawText("Thank you, Santa!",{x:104,y,font:italic,size:21,color:C.burgundy});
    y-=26;
    page.drawText("With love,",{x:104,y,font:italic,size:14,color:C.muted});
    y-=25;
    page.drawText(name,{x:106,y,font:boldItalic,size:21,color:C.burgundy});
    star(page,105+Math.min(220,boldItalic.widthOfTextAtSize(name,21))+16,y+9,6,C.red);
  }
  const pages=doc.getPages();
  for(let i=0;i<pages.length;i++){
    const p=pages[i];
    centered(p,"from the heart to the North Pole",italic,9,68,C.gold);
    p.drawText("Page "+(i+1)+" / "+pages.length,{
      x:486,y:69,font:helv,size:7.7,color:C.muted
    });
  }
  const saved=await doc.save();
  const bytes=new Uint8Array(saved.length);bytes.set(saved);
  return new Blob([bytes.buffer],{type:"application/pdf"});
}
