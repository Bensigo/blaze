import { requireIdentity, apiError } from "@/lib/auth";
import { investigateSessions, type InvestigationFilter } from "@/lib/analytics-sql";

export async function GET(request: Request) {
 try {
  const user=await requireIdentity(), p=new URL(request.url).searchParams;
  const gameId=p.get("gameId") || "", kind=p.get("kind"), days=Number(p.get("days") || 14), endValue=p.get("end"), end=endValue ? Date.parse(endValue) : Date.now();
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(gameId) || ![7,14,30].includes(days) || !Number.isFinite(end) || end>Date.now()+60000 || end<Date.now()-90*86400000) return Response.json({error:"Invalid investigation query"},{status:400});
  let filter: InvestigationFilter;
  if(kind === "heatmap") {
   const surface=p.get("surface"),screen=p.get("screen"),device=p.get("device"),bx=p.get("bx"),by=p.get("by");
   if ((surface!=="game" && surface!=="viewport") || !screen || !/^[A-Za-z0-9_-]{1,40}$/.test(screen) || !device || !["mobile","tablet","desktop","Unknown"].includes(device) || bx===null || by===null || !/^(?:[0-9]|1[0-9])$/.test(bx) || !/^(?:[0-9]|1[0-9])$/.test(by)) return Response.json({error:"Invalid investigation query"},{status:400});
   filter={kind,gameId,surface,screen,device,bx:Number(bx),by:Number(by)};
  } else if(kind === "dropoff") {
   const dropoff=p.get("dropoff");
   if(!dropoff || dropoff.length>100 || /[\x00-\x1f\x7f]/.test(dropoff)) return Response.json({error:"Invalid investigation query"},{status:400});
   filter={kind,gameId,dropoff};
  } else return Response.json({error:"Invalid investigation query"},{status:400});
  return Response.json(await investigateSessions(user.workspace_id,filter,days,end),{headers:{"Cache-Control":"private, no-store"}});
 } catch(error) { return apiError(error); }
}
