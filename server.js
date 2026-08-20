// MATCHDAY PUSH — corrected backend
const express=require('express');
const webpush=require('web-push');
const cron=require('node-cron');
const cors=require('cors');
const fs=require('fs');
const path=require('path');

const app=express();
app.use(cors());
app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname,'public')));

const PORT=process.env.PORT||3000;
const FD_KEY=process.env.FOOTBALL_DATA_API_KEY||'';
const API_FOOTBALL_KEY=process.env.API_FOOTBALL_KEY||'';
const VAPID_PUBLIC_KEY=process.env.VAPID_PUBLIC_KEY||'';
const VAPID_PRIVATE_KEY=process.env.VAPID_PRIVATE_KEY||'';
const VAPID_CONTACT_EMAIL=process.env.VAPID_CONTACT_EMAIL||'mailto:you@example.com';

const LEAGUES={
 epl:{name:'Premier League',short:'EPL',fd:'PL',api:39},
 laliga:{name:'La Liga',short:'ESP',fd:'PD',api:140},
 seriea:{name:'Serie A',short:'ITA',fd:'SA',api:135},
 bundesliga:{name:'Bundesliga',short:'GER',fd:'BL1',api:78},
 ligue1:{name:'Ligue 1',short:'FRA',fd:'FL1',api:61},
 ucl:{name:'Champions League',short:'UCL',fd:'CL',api:2}
};
const EXPECTED={epl:20,laliga:20,seriea:20,bundesliga:18,ligue1:18,ucl:36};
const LIVE_MS=30000, FIXTURE_MS=3600000, STANDINGS_MS=300000, NEWS_MS=300000;

if(!VAPID_PUBLIC_KEY||!VAPID_PRIVATE_KEY){
 console.error('Missing VAPID keys. Render must contain VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.');
 process.exit(1);
}
webpush.setVapidDetails(VAPID_CONTACT_EMAIL,VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY);

const DATA=path.join(__dirname,'site-data.json');
const SUBS=path.join(__dirname,'subscriptions.json');
const SCORES=path.join(__dirname,'last-scores.json');
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return fallback}}
function write(file,x){try{fs.writeFileSync(file,JSON.stringify(x,null,2))}catch(e){console.error('write failed',e.message)}}
const expectedTableSizes=EXPECTED;
let subscriptions=read(SUBS,[]);
let lastScores=read(SCORES,{});
let siteData=read(DATA,{leagues:{},transfers:[],lastUpdated:null,fixturesLastUpdated:null,standingsLastUpdated:null,transfersLastUpdated:null,staleLeagues:Object.keys(LEAGUES),expectedTableSizes});
siteData.expectedTableSizes=expectedTableSizes;
let lastPoll=null, fixtureBusy=false, standingsBusy=false, newsBusy=false;

const fdHeaders=()=>({'X-Auth-Token':FD_KEY,'Accept':'application/json'});
async function getJSON(url,opts={}){
 const r=await fetch(url,{...opts,headers:{...(opts.headers||{}),'Accept':'application/json'}});
 const text=await r.text();
 let body=null; try{body=JSON.parse(text)}catch{}
 if(!r.ok) throw new Error(`${r.status} ${url} ${text.slice(0,180)}`);
 return body;
}
function isoDate(d){return d.toISOString().slice(0,10)}
function seasonYearForCompetition(){
 // football-data.org uses the start year for European seasons.
 const raw=process.env.SEASON||'2026/2027';
 const m=String(raw).match(/\b(20\d{2})/);
 return m?Number(m[1]):new Date().getFullYear();
}
const seasonYear=seasonYearForCompetition();

function normalizeTeam(t){
 return {id:t?.id??null,name:t?.name||'Unknown',shortName:t?.shortName||t?.tla||t?.name||'',logo:t?.crest||t?.logo||''};
}
function normalizeFDMatch(m){
 const home=normalizeTeam(m.homeTeam),away=normalizeTeam(m.awayTeam);
 const ft=m.score?.fullTime||{}, half=m.score?.halfTime||{};
 return {
  id:m.id,date:m.utcDate,utcDate:m.utcDate,status:m.status,statusShort:m.status,
  homeTeam:home,awayTeam:away,
  homeScore:ft.home??null,awayScore:ft.away??null,
  halftimeHome:half.home??null,halftimeAway:half.away??null,
  competition:m.competition?.name||'',matchday:m.matchday||null,venue:m.venue||''
 };
}
async function fetchFDMatches(code){
 if(!FD_KEY) throw new Error('FOOTBALL_DATA_API_KEY is missing');
 // Fetch a bounded window around today. This avoids downloading an entire season.
 const now=new Date(), from=new Date(now); from.setDate(now.getDate()-7);
 const to=new Date(now); to.setDate(now.getDate()+45);
 const url=`https://api.football-data.org/v4/competitions/${encodeURIComponent(code)}/matches?dateFrom=${isoDate(from)}&dateTo=${isoDate(to)}`;
 const body=await getJSON(url,{headers:fdHeaders()});
 return (body.matches||[]).map(normalizeFDMatch).sort((a,b)=>new Date(a.date)-new Date(b.date));
}
function normalizeStandingRow(r){
 const t=normalizeTeam(r.team);
 return {position:r.position,team:t,played:r.playedGames??0,won:r.won??0,draw:r.draw??0,lost:r.lost??0,goalsFor:r.goalsFor??0,goalsAgainst:r.goalsAgainst??0,goalDifference:r.goalDifference??0,points:r.points??0};
}
async function fetchFDStandings(code){
 if(!FD_KEY) throw new Error('FOOTBALL_DATA_API_KEY is missing');
 const body=await getJSON(`https://api.football-data.org/v4/competitions/${encodeURIComponent(code)}/standings`,{headers:fdHeaders()});
 const table=(body.standings||[]).find(x=>x.type==='TOTAL')?.table || body.standings?.[0]?.table || [];
 return table.map(normalizeStandingRow);
}
async function fetchFDCompetition(code){
 return getJSON(`https://api.football-data.org/v4/competitions/${encodeURIComponent(code)}`,{headers:fdHeaders()});
}

// TheSportsDB is used only as a fixture fallback when football-data.org has a temporary failure.
const TSDB={
 epl:4328,laliga:4335,seriea:4332,bundesliga:4331,ligue1:4334,ucl:4480
};
function normalizeTSDB(e){
 const d=e.dateEvent||e.strTimestamp||`${e.dateEventLocal||''}T${e.strTime||'00:00:00'}`;
 return {id:`tsdb-${e.idEvent}`,date:new Date(d).toISOString(),utcDate:new Date(d).toISOString(),
  status:e.strStatus||'SCHEDULED',statusShort:e.strStatus||'SCHEDULED',
  homeTeam:{id:e.idHomeTeam||null,name:e.strHomeTeam||'Unknown',shortName:e.strHomeTeam||'',logo:e.strHomeTeamBadge||''},
  awayTeam:{id:e.idAwayTeam||null,name:e.strAwayTeam||'Unknown',shortName:e.strAwayTeam||'',logo:e.strAwayTeamBadge||''},
  homeScore:e.intHomeScore==null?null:Number(e.intHomeScore),awayScore:e.intAwayScore==null?null:Number(e.intAwayScore),
  competition:e.strLeague||'',venue:e.strVenue||''};
}
async function fetchTSDB(key){
 const body=await getJSON(`https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${TSDB[key]}`);
 return (body.events||[]).map(normalizeTSDB);
}

function validTable(key,rows){
 if(key==='ucl' && rows.length===0) return true; // before 2026/27 league phase draw
 return rows.length===EXPECTED[key];
}
async function refreshFixtures(){
 if(fixtureBusy)return; fixtureBusy=true;
 try{
  const stale=new Set(siteData.staleLeagues||[]);
  for(const [key,l] of Object.entries(LEAGUES)){
   try{
    let fixtures=[];
    try{fixtures=await fetchFDMatches(l.fd)}catch(e){console.warn('FD fixtures',key,e.message)}
    if(!fixtures.length){
      try{fixtures=await fetchTSDB(key)}catch(e){console.warn('TSDB fixtures',key,e.message)}
    }
    if(fixtures.length){
      siteData.leagues[key]??={};
      Object.assign(siteData.leagues[key],{name:l.name,short:l.short,fixtures});
      stale.delete(key);
    }else stale.add(key);
   }catch(e){console.error('fixture',key,e.message);stale.add(key)}
  }
  siteData.staleLeagues=[...stale];
  siteData.fixturesLastUpdated=new Date().toISOString();
  siteData.lastUpdated=siteData.fixturesLastUpdated;
  write(DATA,siteData);
 }finally{fixtureBusy=false}
}
async function refreshStandings(){
 if(standingsBusy)return; standingsBusy=true;
 try{
  const stale=new Set(siteData.staleLeagues||[]);
  for(const [key,l] of Object.entries(LEAGUES)){
   try{
    const rows=await fetchFDStandings(l.fd);
    if(validTable(key,rows)){
      siteData.leagues[key]??={};
      Object.assign(siteData.leagues[key],{name:l.name,short:l.short,standings:rows});
      if(rows.length||key==='ucl') stale.delete(key);
    }else console.warn(`Rejected ${key} table: ${rows.length}, expected ${EXPECTED[key]}`);
   }catch(e){console.error('standings',key,e.message)}
  }
  siteData.staleLeagues=[...stale];
  siteData.standingsLastUpdated=new Date().toISOString();
  siteData.lastUpdated=siteData.standingsLastUpdated;
  write(DATA,siteData);
 }finally{standingsBusy=false}
}

const NEWS_WORDS=/\b(sign|signs|signing|signed|transfer|transfers|joins|joined|joining|loan|loans|deal|agreed|agree|move|moves|medical|swap|contract|renewal|released|departure)\b/i;
async function refreshNews(){
 if(newsBusy)return; newsBusy=true;
 try{
  const r=await fetch('https://feeds.bbci.co.uk/sport/football/rss.xml');
  if(!r.ok)throw new Error(`BBC RSS ${r.status}`);
  const xml=await r.text();
  const items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m=>m[1]).map(x=>{
   const val=n=>{const m=x.match(new RegExp(`<${n}>([\\s\\S]*?)<\\/${n}>`,'i'));return (m?m[1]:'').replace(/<!\[CDATA\[|\]\]>/g,'').trim()};
   return {headline:val('title'),body:val('description'),link:val('link')};
  }).filter(x=>NEWS_WORDS.test(x.headline)).slice(0,12).map(x=>({...x,league:'Football',tag:'Transfer'}));
  if(items.length){siteData.transfers=items;siteData.transfersLastUpdated=new Date().toISOString();siteData.lastUpdated=siteData.transfersLastUpdated;write(DATA,siteData)}
 }catch(e){console.error('news',e.message)}finally{newsBusy=false}
}

async function notifyAll(title,body){
 const keep=[];
 for(const sub of subscriptions){
  try{await webpush.sendNotification(sub,JSON.stringify({title,body}));keep.push(sub)}
  catch(e){if(e.statusCode!==404&&e.statusCode!==410)keep.push(sub)}
 }
 subscriptions=keep;write(SUBS,subscriptions);
}
async function pollLive(){
 lastPoll=new Date().toISOString();
 try{
  // football-data.org now exposes live scores for its covered competitions.
  for(const [key,l] of Object.entries(LEAGUES)){
   try{
    const matches=await fetchFDMatches(l.fd);
    for(const f of matches){
      if(!['IN_PLAY','PAUSED','LIVE','HALFTIME','EXTRA_TIME','PENALTY_SHOOTOUT'].includes(String(f.status).toUpperCase()))continue;
      if(f.homeScore==null||f.awayScore==null)continue;
      const k=`${key}:${f.id}`,prev=lastScores[k];
      if(prev && (prev.home!==f.homeScore||prev.away!==f.awayScore)){
       await notifyAll(`⚽ ${f.homeTeam.name} ${f.homeScore}–${f.awayScore} ${f.awayTeam.name}`,`${l.name} · live score update`);
      }
      lastScores[k]={home:f.homeScore,away:f.awayScore};
    }
   }catch(e){console.error('live',key,e.message)}
  }
  write(SCORES,lastScores);
 }catch(e){console.error('live poll',e.message)}
}

app.get('/vapid-public-key',(q,res)=>res.json({publicKey:VAPID_PUBLIC_KEY}));
app.post('/subscribe',(q,res)=>{
 const s=q.body;if(!s?.endpoint)return res.status(400).json({error:'Invalid subscription'});
 if(!subscriptions.some(x=>x.endpoint===s.endpoint)){subscriptions.push(s);write(SUBS,subscriptions)}
 res.status(201).json({ok:true});
});
app.post('/unsubscribe',(q,res)=>{subscriptions=subscriptions.filter(x=>x.endpoint!==q.body?.endpoint);write(SUBS,subscriptions);res.json({ok:true})});
app.post('/test-notification',async(q,res)=>{await notifyAll('Test alert ⚽','Matchday notifications are working.');res.json({ok:true,sentTo:subscriptions.length})});
app.get('/api/data',(q,res)=>{res.set('Cache-Control','no-store');res.json({...siteData,serverTime:new Date().toISOString(),season:seasonYear,refreshIntervals:{liveScoresSeconds:30,fixturesSeconds:3600,standingsSeconds:300,transfersSeconds:300}})});
app.get('/api/refresh-now',async(q,res)=>{await refreshFixtures();await refreshStandings();await refreshNews();res.json({ok:true,lastUpdated:siteData.lastUpdated,staleLeagues:siteData.staleLeagues})});
app.post('/api/refresh-now',async(q,res)=>{await refreshFixtures();await refreshStandings();await refreshNews();res.json({ok:true,lastUpdated:siteData.lastUpdated,staleLeagues:siteData.staleLeagues})});

app.get('/health',async(q,res)=>{
 let fdTest=null;
 if(FD_KEY){try{const r=await fetchFDCompetition('PL');fdTest={ok:true,httpStatus:200,competition:r?.name||'Premier League'}}catch(e){fdTest={ok:false,error:e.message}}}
 res.json({ok:true,buildMarker:'matchday-backend-v2',subscribers:subscriptions.length,lastPoll,lastDataRefresh:siteData.lastUpdated,footballDataKeySet:Boolean(FD_KEY),apiFootballKeySet:Boolean(API_FOOTBALL_KEY),footballDataTest:fdTest,staleLeagues:siteData.staleLeagues||[]});
});

// Match detail proxy. API-Football is only called when a user asks for a specific match.
const detailCache=new Map();
const APIBASE='https://v3.football.api-sports.io';
const APIIDS=Object.fromEntries(Object.entries(LEAGUES).map(([k,v])=>[k,v.api]));
app.get('/api/match-detail',async(q,res)=>{
 if(!API_FOOTBALL_KEY)return res.json({error:'not_configured'});
 const {leagueKey,home,away,start}=q.query,leagueId=APIIDS[leagueKey];
 if(!leagueId||!home||!away||!start)return res.status(400).json({error:'missing_params'});
 const cacheKey=`${leagueKey}|${home}|${away}|${start}`,cached=detailCache.get(cacheKey);
 if(cached&&Date.now()-cached.at<120000)return res.json(cached.data);
 try{
  const season=new Date(start).getMonth()>=6?new Date(start).getFullYear():new Date(start).getFullYear()-1;
  const date=start.slice(0,10),h={'x-apisports-key':API_FOOTBALL_KEY};
  const fd=await getJSON(`${APIBASE}/fixtures?league=${leagueId}&season=${season}&date=${date}`,{headers:h});
  const norm=s=>(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const m=(fd.response||[]).find(x=>norm(x.teams?.home?.name)===norm(home)&&norm(x.teams?.away?.name)===norm(away));
  if(!m)return res.json({fixture:null,stats:[],lineups:[],players:[],error:'fixture_not_found'});
  const id=m.fixture.id;
  const [st,li,pl,ev]=await Promise.all([
   getJSON(`${APIBASE}/fixtures/statistics?fixture=${id}`,{headers:h}).catch(()=>({response:[]})),
   getJSON(`${APIBASE}/fixtures/lineups?fixture=${id}`,{headers:h}).catch(()=>({response:[]})),
   getJSON(`${APIBASE}/fixtures/players?fixture=${id}`,{headers:h}).catch(()=>({response:[]})),
   getJSON(`${APIBASE}/fixtures/events?fixture=${id}`,{headers:h}).catch(()=>({response:[]}))
  ]);
  const result={fixture:m,stats:st.response||[],lineups:li.response||[],players:pl.response||[],events:ev.response||[],updatedAt:new Date().toISOString()};
  detailCache.set(cacheKey,{at:Date.now(),data:result});res.json(result);
 }catch(e){res.status(502).json({error:e.message})}
});

async function startup(){
 await Promise.allSettled([refreshFixtures(),refreshStandings(),refreshNews()]);
 await pollLive();
}
cron.schedule('*/30 * * * * *',pollLive);
cron.schedule('*/5 * * * *',refreshFixtures);
cron.schedule('*/5 * * * *',refreshStandings);
cron.schedule('*/5 * * * *',refreshNews);
startup().catch(e=>console.error('startup',e));

app.listen(PORT,()=>console.log(`Matchday backend v2 listening on ${PORT}`));
