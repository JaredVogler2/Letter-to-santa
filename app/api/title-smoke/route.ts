import {NextResponse} from "next/server";
import {load} from "cheerio";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){
 const queries=[
  "B0DXKQ4Z8Q",
  '"B0DXKQ4Z8Q" amazon',
  'site:amazon.com/dp/B0DXKQ4Z8Q',
  "VAGUDE Extension Dresser Cabinet Replacement"
 ];
 const sites=[
  "https://search.yahoo.com/search?p=",
  "https://www.bing.com/search?format=rss&q="
 ];
 const result=await Promise.all(queries.flatMap(query=>sites.map(async base=>{
  const url=base+encodeURIComponent(query);
  try{
   const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(6000),headers:{"User-Agent":"Mozilla/5.0","Accept":"text/html,application/xml,application/rss+xml"}});
   const raw=(await response.text()).slice(0,70000);
   const $=load(raw,{xml:{xmlMode:raw.startsWith("<?xml")}});
   const results=base.includes("yahoo")
     ? $("h3").slice(0,8).map((_,el)=>({title:$(el).text().trim().slice(0,140),html:$(el).parent("a").attr("href")?.slice(0,300) || $(el).closest("a").attr("href")?.slice(0,300)})).get()
     : $("item").slice(0,8).map((_,el)=>({title:$(el).find("title").text().slice(0,140),link:$(el).find("link").text().slice(0,300)})).get();
   return {query,engine:base.includes("yahoo")?"yahoo":"bing",status:response.status,results,foundAsin:raw.includes("B0DXKQ4Z8Q")};
  }catch(e){return {query,url,error:String(e)}}
 })));
 return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
}
