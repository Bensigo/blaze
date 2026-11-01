/** Run with playwright-cli run-code --filename=tests/dashboard-overview-browser.js against a local production build.
 * All workspace/coordinate responses are labelled fixtures; no real records or paid calls.
 */
async (page) => {
  const base='http://127.0.0.1:3066';
  const now='2026-11-01T08:00:00Z';
  const games=['alpha','beta'].map(id=>({id,title:'LOCAL FIXTURE '+id,url:'https://fixture.invalid/'+id,image:'',description:'Dashboard regression fixture',genre:'Fixture',sdkKey:'unused',origins:[],competitors:[],dailyEnabled:false,createdAt:now}));
  const reads=[],writes=[],external=[],errors=[];
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  page.on('pageerror',error=>errors.push(error.message));
  const makeWorkspace=(gameId,days)=>{
    const n=gameId==='beta'?2:5;
    const session={id:'fixture-session-'+gameId,gameId:gameId==='all'?'alpha':gameId,playerId:'fixture-browser',startedAt:now,lastAt:now,duration:35,activePlaySeconds:30,eventCount:5,device:'desktop',country:'CA',source:'fixture-source',lastStep:'round_complete',completed:true};
    const analytics={sessions:n,players:n,starts:n,completions:2,replays:0,returns:2,errorSessions:0,firstActions:n,lastEventAt:now,windowEnd:now,trend:[{date:'2026-11-01',visits:n,starts:n,completions:2}],funnel:[{name:'Visit',count:n},{name:'Loaded',count:n},{name:'Round started',count:n},{name:'First action',count:n},{name:'Round completed',count:2}],countries:[{name:'Canada fixture',count:n}],sources:[{name:'fixture-source',count:n}],devices:[{name:'desktop',count:n}],dropoffs:[{name:'first_action',count:1}],retention:[{date:'2026-10-28',players:n,eligible:n,returned:2,rate:2/n}],campaigns:[{name:'fixture-campaign',visits:n,starts:n,completions:2,returns:2}],sessionsList:[session],heatmap:[],syntheticSessions:0,activePlay:{totalSeconds:n*30,averageSeconds:30,medianSeconds:30,measuredSessions:n,eligibleSessions:n},launch:{visits:n,exits:1,coverage:{sessions:n,visit:n,loaded:n,roundStart:n,firstAction:n,roundComplete:2,exit:1},conversion:[{source:'fixture-source',campaign:'fixture-campaign',visits:n,starts:n,meaningful:2,activeMeasured:n}],conversionTotal:1}};
    return {user:{name:'LOCAL FIXTURE',email:'fixture@example.invalid'},workspace:{id:'fixture',name:'Fixture'},demo:false,games,recordings:[],clips:[],posts:[],connections:[],findings:[],runs:[],measurements:[],analytics,system:{database:false,google:false,storage:false,worker:false,dailySchedule:'Fixture paused',publishingEnabled:false}};
  };
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==base){external.push(url.origin);return route.abort();}
    if(!url.pathname.startsWith('/api/'))return route.continue();
    if(req.method()!=='GET'){writes.push(url.pathname);return route.abort();}
    reads.push(url.pathname+url.search);
    if(url.pathname==='/api/auth/config')return route.fulfill({json:{googleConfigured:false}});
    if(url.pathname==='/api/workspace')return route.fulfill({json:makeWorkspace(url.searchParams.get('gameId')||'all',url.searchParams.get('days')||'7')});
    if(url.pathname==='/api/analytics/heatmap'){
      const days=url.searchParams.get('days');
      if(days==='14')return route.fulfill({status:503,json:{error:'LOCAL FIXTURE coordinate service unavailable'}});
      const empty=days==='30';
      return route.fulfill({json:{windowStart:now,windowEnd:now,contexts:empty?[]:[{surface:'game',screen:'play',device:'desktop',sampleCount:9,sessionCount:1}],selectedContext:empty?null:{surface:'game',screen:'play',device:'desktop'},bins:empty?[]:[{bx:3,by:4,x:.175,y:.225,count:9}],sampleCount:empty?0:9,coordinateSessions:empty?0:1,eligibleSessions:5,recentSessions:[],recentSessionsTotal:0}});
    }
    if(url.pathname.endsWith('/automation'))return route.fulfill({json:{adapterVerified:false}});
    return route.fulfill({status:404,json:{error:'Unused fixture API'}});
  });
  const headings=['Most played games','Sessions over time','Visit to completion','Pointer heatmap','Measured play time','Instrumentation coverage','Launch conversion','Build a launch link','Traffic sources','Countries','Devices','Next-day return','Campaign traffic'];
  await page.goto(base+'/app',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
  for(const name of headings)await page.getByRole('heading',{name,exact:false}).waitFor({timeout:5000});
  check(await page.getByText('Canada fixture',{exact:true}).isVisible(),'Country observations missing from overview');
  check(await page.locator('.player-breakdowns').getByText('fixture-source',{exact:true}).isVisible(),'Source observations missing from overview');
  check(await page.locator('.cohort-section').filter({has:page.getByRole('heading',{name:'Next-day return'})}).getByText('40%',{exact:true}).isVisible(),'Return cohort values missing');
  check(await page.getByText('Heatmaps are scoped to one game, screen and device.',{exact:true}).isVisible(),'All-game heatmap chooser missing');
  await page.getByRole('combobox',{name:'Game',exact:true}).first().selectOption('alpha');
  await page.getByRole('button',{name:'9 pointer samples at 15 to 20% across, 20 to 25% down',exact:true}).waitFor();
  check(reads.some(url=>url.includes('/api/workspace?')&&url.includes('gameId=alpha')&&url.includes('days=7')),'Game filter did not load scoped workspace');
  check(reads.some(url=>url.includes('/api/analytics/heatmap?')&&url.includes('gameId=alpha')&&url.includes('days=7')),'Heatmap did not use selected game');
  await Promise.all([page.waitForResponse(response=>{const u=new URL(response.url());return u.pathname==='/api/analytics/heatmap'&&u.searchParams.get('gameId')==='alpha'&&u.searchParams.get('days')==='30';}),page.getByLabel('Filter by date').selectOption('30')]);
  await page.getByText('No coordinates in this selection',{exact:true}).waitFor();
  check(reads.some(url=>url.includes('/api/analytics/heatmap?')&&url.includes('gameId=alpha')&&url.includes('days=30')),'Heatmap did not use selected dates');
  await page.getByLabel('Filter by game').selectOption('beta');
  await page.locator('.cohort-section').filter({has:page.getByRole('heading',{name:'Next-day return'})}).getByText('100%',{exact:true}).waitFor();
  check(reads.some(url=>url.includes('/api/workspace?')&&url.includes('gameId=beta')&&url.includes('days=30')),'Second game did not load scoped workspace');
  await page.getByLabel('Filter by date').selectOption('14');
  await page.getByText('Coordinates unavailable',{exact:true}).waitFor();
  await page.getByRole('heading',{name:'Countries',exact:true}).waitFor();
  await page.getByLabel('Filter by date').selectOption('7');
  await page.getByRole('button',{name:'9 pointer samples at 15 to 20% across, 20 to 25% down',exact:true}).waitFor();
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'output/playwright/dashboard-restored-desktop-fixture.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('heading',{name:'Countries',exact:true}).waitFor();
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Mobile dashboard overflows horizontally');
  await page.screenshot({path:'output/playwright/dashboard-restored-mobile-fixture.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('navigation').getByRole('button',{name:'Player analytics',exact:true}).click();
  await page.getByRole('heading',{name:'Player analytics',exact:true}).waitFor();
  for(const name of headings.filter(x=>x!=='Most played games'))await page.getByRole('heading',{name,exact:false}).waitFor();
  check(errors.length===0,'Uncaught JavaScript errors: '+JSON.stringify(errors));
  check(writes.length===0,'Unexpected mutation: '+JSON.stringify(writes));
  check(external.length===0,'Unexpected external request: '+JSON.stringify(external));
  return {fixtureOnly:true,restoredOverviewSections:headings,checks:['populated overview values','all-game heatmap chooser','game-scoped workspace and heatmap','date-scoped workspace and heatmap','changed game updates retention values','empty heatmap','failed heatmap keeps other data visible','heatmap recovery','390px no overflow','analytics page preserved'],uncaughtErrors:errors,mutations:writes,externalRequests:external,paidCalls:0};
}
