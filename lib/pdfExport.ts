"use client";

import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

export type PdfGift = {
  id:string; url:string; title:string; description:string; note:string; priority:"top"|"wish";
};
export type SantaPdfData = {
  name:string; age:string; message:string; gifts:PdfGift[];
};
export type SantaPdfKind = "letter"|"shop";

const PAGE_W=612, PAGE_H=792;
const RED=rgb(0.55,0.14,0.19), GREEN=rgb(0.13,0.29,0.23), GOLD=rgb(0.69,0.5,0.27);
const INK=rgb(0.24,0.20,0.18), PALE=rgb(1,0.985,0.96), BORDER=rgb(0.88,0.80,0.68), LINK=rgb(0.13,0.34,0.50);
const FONT_SAFE=/[^\x20-\x7E\xA0-\xFF]/g;

function printable(raw:string):string{
  return (raw||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[‘’]/g,"'").replace(/[“”]/g,'"')
    .replace(/[—–−]/g,"-").replace(/…/g,"...")
    .replace(/•/g,"-").replace(/♥/g,"<3")
    .replace(/[\r\n\t]+/g," ").replace(FONT_SAFE,"").replace(/\s+/g," ").trim();
}
function displayLink(raw:string){
  try{
    const u=new URL(raw);
    let display=u.origin+u.pathname;
    if(display.length>94)display=display.slice(0,90)+"...";
    return display;
  }catch{return raw.slice(0,90);}
}
function lines(text:string,font:{widthOfTextAtSize:(text:string,size:number)=>number},size:number,maxWidth:number,maxLines=100){
  const words=printable(text).split(/\s+/).filter(Boolean);
  const result:string[]=[];let current="";
  function flush(){if(current){result.push(current);current="";}}
  for(const word of words){
    const candidate=current?current+" "+word:word;
    if(font.widthOfTextAtSize(candidate,size)<=maxWidth){current=candidate;continue;}
    flush();
    if(font.widthOfTextAtSize(word,size)<=maxWidth){current=word;continue;}
    let segment="";
    for(const ch of word){
      if(font.widthOfTextAtSize(segment+ch,size)>maxWidth && segment){result.push(segment);segment="";}
      segment+=ch;
    }
    current=segment;
  }
  flush();
  if(result.length<=maxLines)return result;
  const truncated=result.slice(0,maxLines);
  let last=truncated[maxLines-1];
  while(last && font.widthOfTextAtSize(last+"...",size)>maxWidth)last=last.slice(0,-1);
  truncated[maxLines-1]=last+"...";
  return truncated;
}
function addHyperlink(doc:PDFDocument,page:ReturnType<PDFDocument["addPage"]>,url:string,
  x:number,y:number,w:number,h:number){
  // Real PDF link annotations work on iPhone Preview, Samsung PDF readers, and desktop viewers.
  try{
    const safe=new URL(url);
    if(safe.protocol!=="https:")return;
    const annot=doc.context.obj({
      Type:PDFName.of("Annot"),Subtype:PDFName.of("Link"),
      Rect:[x,y,x+w,y+h],
      Border:[0,0,0],
      A:doc.context.obj({S:PDFName.of("URI"),URI:PDFString.of(safe.href)})
    });
    page.node.addAnnot(doc.context.register(annot));
  }catch{/* Malformed gift URL should not prevent a PDF download. */}
}

export async function buildSantaPdf(data:SantaPdfData,kind:SantaPdfKind):Promise<Blob>{
  if(!data.gifts.length)throw new Error("Add at least one gift before creating your PDF.");
  const doc=await PDFDocument.create();
  doc.setTitle((printable(data.name)||"Christmas")+(kind==="letter"?" - Letter to Santa":" - Gift Shopping Guide"));
  doc.setAuthor("Letter to Santa | JaredVogler.com");
  doc.setSubject("Christmas wish list with direct product links and QR codes");
  const regular=await doc.embedFont(StandardFonts.Helvetica);
  const bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const serif=await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold=await doc.embedFont(StandardFonts.TimesRomanBold);
  const serifItalic=await doc.embedFont(StandardFonts.TimesRomanItalic);
  const qrPngs=await Promise.all(data.gifts.map(async gift=>{
    try{
      const dataURL=await QRCode.toDataURL(gift.url,{errorCorrectionLevel:"M",margin:2,width:320,color:{dark:"#241b19",light:"#FFFFFF"}});
      return await doc.embedPng(dataURL);
    }catch{return null;}
  }));
  let page=doc.addPage([PAGE_W,PAGE_H]);
  let y=PAGE_H-50;
  const baseFooter=44;
  function background(sheet:ReturnType<PDFDocument["addPage"]>){
    sheet.drawRectangle({x:0,y:0,width:PAGE_W,height:PAGE_H,color:PALE});
    sheet.drawRectangle({x:22,y:22,width:PAGE_W-44,height:PAGE_H-44,borderColor:BORDER,borderWidth:1});
    sheet.drawLine({start:{x:35,y:PAGE_H-34},end:{x:PAGE_W-35,y:PAGE_H-34},thickness:.8,color:GOLD});
    sheet.drawText("THE NORTH POLE LETTER STUDIO",{x:44,y:PAGE_H-49,font:bold,size:8,color:GREEN});
    sheet.drawText("JaredVogler.com/letter-to-santa",{x:44,y:28,font:regular,size:8,color:GOLD});
  }
  background(page);
  function newPage(){
    page=doc.addPage([PAGE_W,PAGE_H]);
    background(page);
    y=PAGE_H-78;
  }
  function space(minH:number){if(y-minH<baseFooter+40)newPage();}
  function textBlock(text:string,x:number,size:number,maxWidth:number,font=regular,
    leading=size*1.4,color=INK,maxLines=100){
    const l=lines(text,font,size,maxWidth,maxLines);
    for(const line of l){page.drawText(line,{x,y,font,size,color});y-=leading;}
    return l.length;
  }

  const child=printable(data.name)||"A very special child";
  if(kind==="letter"){
    page.drawText("Dear Santa,",{x:57,y:y-31,font:serifItalic,size:38,color:RED});y-=75;
    textBlock("My name is "+child+(data.age.trim() ? " and I am "+printable(data.age)+" years old":"")+
      ". I am writing you a special Christmas letter!",58,12,480,serif,17,INK);
    y-=8;
    const greeting=printable(data.message)||"I have been dreaming about Christmas. These are a few things that would make me smile. Thank you for bringing magic to our home!";
    textBlock(greeting,58,11.5,480,serif,16,INK);
    y-=24;
    space(60);
    page.drawLine({start:{x:55,y:y+18},end:{x:554,y:y+18},thickness:1,color:GOLD});
    page.drawText("MY CHRISTMAS WISHES",{x:57,y,font:serifBold,size:17,color:RED});
    y-=31;
  }else{
    page.drawText("The Elf Shopping Desk",{x:51,y:y-18,font:serifBold,size:28,color:RED});y-=52;
    textBlock(child+"'s Christmas Gift Guide",52,16,498,serifBold,22,GREEN);
    y-=8;
    textBlock("Scan a QR code or tap the underlined product link to open the gift website.",52,10,490,regular,15,INK);
    y-=27;
  }

  for(let index=0;index<data.gifts.length;index++){
    const gift=data.gifts[index];
    const title=printable(gift.title)||"Christmas wish";
    const titleLines=lines(title,serifBold,kind==="letter"?13.5:14,364,3);
    const description=printable(gift.description);
    const detail=printable(gift.note);
    // Description is optional; the product title and clickable URL are always present.
    const descLines=description?lines(description,regular,9.2,360,2):[];
    const noteLines=detail?lines("Details: "+detail,regular,9.2,360,2):[];
    const linkLabel="Gift link: "+displayLink(gift.url);
    const linkLines=lines(linkLabel,regular,8.8,370,2);
    const textHeight=titleLines.length*17+descLines.length*12.5+noteLines.length*12.5+linkLines.length*11+19;
    const cardHeight=Math.max(110,textHeight+24);
    space(cardHeight+12);
    const top=y+14,bottom=top-cardHeight;
    page.drawRectangle({x:49,y:bottom,width:514,height:cardHeight,color:rgb(1,0.995,0.984),borderColor:BORDER,borderWidth:.8});
    page.drawText(String(index+1).padStart(2,"0"),{x:62,y:top-24,font:bold,size:9,color:GOLD});
    let sy=top-27;
    for(const line of titleLines){page.drawText(line,{x:86,y:sy,font:serifBold,size:kind==="letter"?13.5:14,color:RED});sy-=17;}
    if(gift.priority==="top"){page.drawText("TOP WISH",{x:86,y:sy,font:bold,size:8,color:GOLD});sy-=12;}
    for(const line of descLines){page.drawText(line,{x:86,y:sy,font:regular,size:9.2,color:INK});sy-=12.5;}
    for(const line of noteLines){page.drawText(line,{x:86,y:sy,font:regular,size:9.2,color:INK});sy-=12.5;}
    sy-=5;
    const linkTop=sy+10;
    for(const line of linkLines){page.drawText(line,{x:86,y:sy,font:regular,size:8.8,color:LINK});sy-=11;}
    page.drawLine({start:{x:86,y:sy+7},end:{x:86+Math.min(335,regular.widthOfTextAtSize(linkLines[0]||"",8.8)),y:sy+7},thickness:0.5,color:LINK});
    addHyperlink(doc,page,gift.url,83,sy-2,380,linkTop-sy+6);
    if(qrPngs[index]){
      const q=qrPngs[index]!;
      const qrSize=82;
      page.drawRectangle({x:468,y:top-96,width:92,height:92,color:rgb(1,1,1)});
      page.drawImage(q,{x:473,y:top-91,width:qrSize,height:qrSize});
      page.drawText("SCAN TO SHOP",{x:479,y:top-102,font:bold,size:6.5,color:GREEN});
    }
    y=bottom-15;
  }
  if(kind==="letter"){
    space(95);
    y-=2;
    page.drawText("Thank you, Santa!",{x:60,y,font:serifItalic,size:18,color:RED});y-=23;
    page.drawText("With love, "+child,{x:60,y,font:serifItalic,size:17,color:GREEN});
  }
  const pages=doc.getPages();
  for(let i=0;i<pages.length;i++){
    pages[i].drawText("Page "+(i+1)+" of "+pages.length,{
      x:515,y:28,font:regular,size:8,color:GOLD
    });
  }
  const saved=await doc.save();
  const bytes=new Uint8Array(saved.length);
  bytes.set(saved);
  return new Blob([bytes.buffer],{type:"application/pdf"});
}
