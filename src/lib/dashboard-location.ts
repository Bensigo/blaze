export const dashboardViews = ["overview","games","analytics","acquisition","retention","audience","site","sessions","research","connections","account","discovery","help"] as const;
export type DashboardView = typeof dashboardViews[number];
export type DashboardLocation = {page:DashboardView;gameId:string;days:string};

export function readDashboardLocation(search:string, gameIds?:readonly string[]):DashboardLocation {
  const params=new URLSearchParams(search);
  const requestedView=params.get("view")||"overview";
  const view=requestedView === "forever" ? "site" : requestedView;
  const requested=params.get("game")||"all";
  const gameId=/^[a-zA-Z0-9_-]{1,100}$/.test(requested)&&(!gameIds||requested==="all"||gameIds.includes(requested))?requested:"all";
  return {page:dashboardViews.includes(view as DashboardView)?view as DashboardView:"overview",gameId,days:["7","14","30"].includes(params.get("days")||"")?params.get("days")!:"7"};
}

export function dashboardHref(location:DashboardLocation):string {
  const params=new URLSearchParams();
  if(location.page!=="overview")params.set("view",location.page);
  if(location.gameId!=="all")params.set("game",location.gameId);
  if(location.days!=="7")params.set("days",location.days);
  return `/app${params.size?`?${params}`:""}`;
}
