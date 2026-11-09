import {NextResponse} from "next/server";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const asin="B0DXKQ4Z8Q";
export async function GET(){
 const q=encodeURIComponent(asin+" Amazon");
 const sites=[
  "https://www.bing.com/search?format=rss&q="+q,
  "https://www.google.com/search?hl=en&q="+q,
  "https://www.google.com/search?udm=14&q="+q,
  "https://search.yahoo.com/search?p="+q,
  "https://www.amazon.com/VAGUDE-Extension-Dresser-Cabinet-Replacement/dp/"+asin
 ];
 const output=await Promise.all(sites.map(async url=>{
  try{
   const r=await fetch(url,{cache:"no-store",redirect:"manual",signal:AbortSignal.timeout(6500),headers:{"User-Agent":"Mozilla/5.0","Accept":"text/html,application/xml,application/rss+xml"}});
   const s=(await r.text()).slice(0,15000);
   const titles=(s.match(/<title[^>]*>[^<]{10,180}<\/title>/gi)||[]).slice(0,7);
   const items=s.match(/<item>[\s\S]{0,2500}/i)?.[0]?.slice(0,1500);
   return {host:new URL(url).hostname,status:r.status,ctype:r.headers.get("content-type"),length:s.length,titles,items,containsAsin:s.includes(asin),start:s.slice(0,100)};
  }catch(e){return {host:new URL(url).hostname,error:String(e)}}
 }));
 return NextResponse.json(output,{headers:{"Cache-Control":"no-store"}});
}
