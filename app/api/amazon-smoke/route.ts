import {NextRequest, NextResponse} from "next/server";
import {POST} from "../metadata/route";
export const dynamic = "force-dynamic";
export async function GET() {
 const input = new NextRequest("https://www.jaredvogler.com/letter-to-santa/api/metadata", {
   method:"POST", headers:{"content-type":"application/json"},
   body:JSON.stringify({url:"https://a.co/d/iTfVzuL"})
 });
 const response=await POST(input);
 const data=await response.json();
 return NextResponse.json({
   httpStatus:response.status, source:data.source || "none",
   asin:data.asin || null, resolvedUrl:data.resolvedUrl || null,
   title:data.title || null, warning:data.warning || null,
   responseCode:data.responseCode || null, error:data.error || null
 },{headers:{"Cache-Control":"no-store"}});
}
