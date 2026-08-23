const express=require('express');const webpush=require('web-push');const cron=require('node-cron');const cors=require('cors');const fs=require('fs');const path=require('path');const crypto=require('crypto');let compression;try{compression=require('compression')}catch{compression=null}
const app=express();app.use(cors());if(compression)app.use(compression());app.use(express.json({limit:'1mb'}));app.use(express.static(path.join(__dirname,'public'),{maxAge:'1d'}));
const SW_JS=`self.addEventListener('push',e=>{let d={title:'MATCHDAY PUSH',body:'Live match update'};try{d=JSON.parse(e.data.text())}catch{}e.waitUntil(self.registration.showNotification(d.title,{body:d.body,icon:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAACGklEQVR4nO3TMQHAIADAsLGHGwX4VwkyOJoo6NMx1z4fRP2vA+AlA5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYg7QJ3IQK2JZYKuQAAAABJRU5ErkJggg==',badge:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAACGklEQVR4nO3TMQHAIADAsLGHGwX4VwkyOJoo6NMx1z4fRP2vA+AlA5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYg7QJ3IQK2JZYKuQAAAABJRU5ErkJggg==',data:{url:'/'}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs){if('focus'in c){c.focus();return c}}return clients.openWindow(e.notification.data?.url||'/')}))});`;
app.get('/sw.js',(q,r)=>{r.set('Content-Type','application/javascript; charset=utf-8');r.set('Service-Worker-Allowed','/');r.set('Cache-Control','no-cache');r.send(SW_JS)});
const PORT=process.env.PORT||3000,FD=(process.env.FOOTBALL_DATA_API_KEY||'').trim(),AF=(process.env.API_FOOTBALL_KEY||'').trim(),VP=(process.env.VAPID_PUBLIC_KEY||'').trim(),VR=(process.env.VAPID_PRIVATE_KEY||'').trim(),VE=(process.env.VAPID_CONTACT_EMAIL||'mailto:you@example.com').trim();
const L={epl:['Premier League','EPL','PL',20,39],laliga:['La Liga','ESP','PD',20,140],seriea:['Serie A','ITA','SA',20,135],bundesliga:['Bundesliga','GER','BL1',18,78],ligue1:['Ligue 1','FRA','FL1',18,61],ucl:['Champions League','UCL','CL',36,2]};
const DATA=path.join(__dirname,'site-data.json'),SUB=path.join(__dirname,'subscriptions.json'),SCO=path.join(__dirname,'last-scores.json'),USR=path.join(__dirname,'users.json');const read=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}},write=(f,x)=>{try{fs.writeFileSync(f,JSON.stringify(x,null,2))}catch(e){console.error(e.message)}};
let data=read(DATA,{leagues:{},transfers:[],staleLeagues:Object.keys(L)}),subs=read(SUB,[]),scores=read(SCO,{}),users=read(USR,{}),lastPoll=null,busy=0;
const hash=(pw,salt)=>crypto.scryptSync(pw,salt,32).toString('hex');
function findUserByToken(token){for(const email in users){if(users[email].token===token)return{email,...users[email]}}return null}
let pushEnabled=false;
if(!VP||!VR){console.error('Missing VAPID keys — push notifications disabled, rest of the app will still run.')}
else{try{webpush.setVapidDetails(VE,VP,VR);pushEnabled=true}catch(e){console.error('Invalid VAPID keys (check for extra whitespace/newlines when pasting into Render) — push notifications disabled, rest of the app will still run:',e.message)}}
async function json(u,o={}){let r=await fetch(u,{...o,headers:{Accept:'application/json',...(o.headers||{})}}),t=await r.text(),b;try{b=JSON.parse(t)}catch{}if(!r.ok)throw Error(`${r.status} ${t.slice(0,160)}`);return b}
const team=t=>({id:t?.id??null,name:t?.name||'Unknown',shortName:t?.shortName||t?.tla||t?.name||'',logo:t?.crest||t?.logo||''});
const match=m=>{let f=m.score?.fullTime||{},h=m.score?.halfTime||{};return{id:m.id,date:m.utcDate,utcDate:m.utcDate,status:m.status,statusShort:m.status,homeTeam:team(m.homeTeam),awayTeam:team(m.awayTeam),homeScore:f.home??null,awayScore:f.away??null,halftimeHome:h.home??null,halftimeAway:h.away??null,competition:m.competition?.name||'',matchday:m.matchday??null,venue:m.venue||''}};
const row=r=>({position:r.position,team:team(r.team),played:r.playedGames||0,won:r.won||0,draw:r.draw||0,lost:r.lost||0,goalsFor:r.goalsFor||0,goalsAgainst:r.goalsAgainst||0,goalDifference:r.goalDifference||0,points:r.points||0});
const day=d=>d.toISOString().slice(0,10);
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
let fdQueue=Promise.resolve(),fdLastCall=0;
function fdThrottled(u,o={}){
 const run=fdQueue.then(async()=>{
  const wait=Math.max(0,fdLastCall+6500-Date.now());
  if(wait>0)await sleep(wait);
  fdLastCall=Date.now();
  return json(u,{...o,headers:{'X-Auth-Token':FD,...(o.headers||{})}});
 });
 fdQueue=run.catch(()=>{});
 return run;
}
const codeToKey=Object.fromEntries(Object.entries(L).map(([k,v])=>[v[2],k]));
async function fixtures(k){let c=L[k][2],n=new Date(),a=new Date(n),b=new Date(n);a.setDate(a.getDate()-3);b.setDate(b.getDate()+60);let x=await fdThrottled(`https://api.football-data.org/v4/competitions/${c}/matches?dateFrom=${day(a)}&dateTo=${day(b)}`);return(x.matches||[]).map(match).sort((a,b)=>new Date(a.date)-new Date(b.date))}
async function standings(k){let x=await fdThrottled(`https://api.football-data.org/v4/competitions/${L[k][2]}/standings`);return((x.standings||[]).find(s=>s.type==='TOTAL')?.table||x.standings?.[0]?.table||[]).map(row)}
async function refresh(){
 let stale=new Set(Object.keys(L));
 for(let k in L){
  try{
   let f=await fixtures(k);
   let s=await standings(k);
   data.leagues[k]={name:L[k][0],short:L[k][1],fixtures:f,standings:s};
   if(f.length&&((k==='ucl'&&s.length===36)||s.length===L[k][3]))stale.delete(k)
  }catch(e){console.error(k,e.message)}
 }
 data.staleLeagues=[...stale];data.lastUpdated=new Date().toISOString();data.fixturesLastUpdated=data.lastUpdated;data.standingsLastUpdated=data.lastUpdated;write(DATA,data)
}
async function news(){try{let r=await fetch('https://feeds.bbci.co.uk/sport/football/rss.xml');let x=await r.text();let arr=[...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m=>{let z=m[1],v=n=>((z.match(new RegExp(`<${n}>([\\s\\S]*?)<\\/${n}>`,'i'))||[])[1]||'').replace(/<!\[CDATA\[|\]\]>/g,'').trim();return{headline:v('title'),body:v('description'),link:v('link')}}).filter(x=>/transfer|sign|deal|loan|move|joins|medical|contract/i.test(x.headline)).slice(0,20);data.transfers=arr;data.transfersLastUpdated=new Date().toISOString();data.lastUpdated=data.transfersLastUpdated;write(DATA,data)}catch(e){console.error('news',e.message)}}
async function live(){
 lastPoll=new Date().toISOString();
 try{
  const x=await fdThrottled(`https://api.football-data.org/v4/matches?status=LIVE`);
  const liveStatuses=['IN_PLAY','PAUSED','LIVE','HALFTIME','EXTRA_TIME','PENALTY_SHOOTOUT'];
  for(const m of (x.matches||[])){
   const k=codeToKey[m.competition?.code];
   if(!k)continue;
   const f=match(m);
   if(!liveStatuses.includes(String(f.status).toUpperCase())||f.homeScore==null||f.awayScore==null)continue;
   const q=k+':'+f.id, prev=scores[q]||{home:0,away:0};
   if(pushEnabled&&(prev.home!==f.homeScore||prev.away!==f.awayScore)){
    for(const sub of subs){
     try{await webpush.sendNotification(sub,JSON.stringify({title:`⚽ ${f.homeTeam.name} ${f.homeScore}–${f.awayScore} ${f.awayTeam.name}`,body:L[k][0]+' · live score update'}));}
     catch(e){if(e.statusCode===404||e.statusCode===410){subs=subs.filter(s=>s.endpoint!==sub.endpoint);write(SUB,subs)} }
    }
   }
   scores[q]={home:f.homeScore,away:f.awayScore};
  }
 }catch(e){console.error('live',e.message)}
 write(SCO,scores);
}
app.get('/health',(q,r)=>{r.json({ok:true,buildMarker:'matchday-backend-v3',subscribers:subs.length,lastPoll,lastDataRefresh:data.lastUpdated,footballDataKeySet:!!FD,apiFootballKeySet:!!AF,highlightlyKeySet:!!HL,leaguesLoaded:Object.keys(data.leagues||{}).length,staleLeagues:data.staleLeagues||[]})});
app.get('/api/data',(q,r)=>r.set('Cache-Control','no-store').json({...data,serverTime:new Date().toISOString(),expectedTableSizes:Object.fromEntries(Object.entries(L).map(([k,v])=>[k,v[3]])),refreshIntervals:{liveScoresSeconds:30,fixturesSeconds:300,standingsSeconds:300,transfersSeconds:300}}));
app.get('/api/refresh-now',async(q,r)=>{if(!busy){busy=1;await refresh();await news();busy=0}r.json({ok:true,staleLeagues:data.staleLeagues,lastUpdated:data.lastUpdated})});app.post('/api/refresh-now',async(q,r)=>{if(!busy){busy=1;await refresh();await news();busy=0}r.json({ok:true,staleLeagues:data.staleLeagues,lastUpdated:data.lastUpdated})});
app.get('/vapid-public-key',(q,r)=>pushEnabled?r.json({publicKey:VP}):r.status(503).json({error:'Push notifications are not configured on the server yet.'}));app.post('/subscribe',(q,r)=>{if(!q.body?.endpoint)return r.status(400).json({error:'Invalid subscription'});if(!subs.some(x=>x.endpoint===q.body.endpoint))subs.push(q.body);write(SUB,subs);r.status(201).json({ok:true})});app.post('/unsubscribe',(q,r)=>{subs=subs.filter(x=>x.endpoint!==q.body?.endpoint);write(SUB,subs);r.json({ok:true})});
app.post('/api/signup',(q,r)=>{const{email,password}=q.body||{};if(!email||!password)return r.status(400).json({error:'Email and password are required.'});const key=String(email).toLowerCase().trim();if(users[key])return r.status(409).json({error:'An account with this email already exists.'});const salt=crypto.randomBytes(16).toString('hex'),token=crypto.randomBytes(24).toString('hex'),createdAt=new Date().toISOString();users[key]={salt,passwordHash:hash(password,salt),token,createdAt,teams:[]};write(USR,users);r.status(201).json({ok:true,token,email:key,createdAt})});
app.post('/api/login',(q,r)=>{const{email,password}=q.body||{};const key=String(email||'').toLowerCase().trim();const u=users[key];if(!u||hash(password||'',u.salt)!==u.passwordHash)return r.status(401).json({error:'Incorrect email or password.'});const token=crypto.randomBytes(24).toString('hex');u.token=token;write(USR,users);r.json({ok:true,token,email:key,createdAt:u.createdAt})});
app.get('/api/user/me',(q,r)=>{const u=findUserByToken(q.query.token);if(!u)return r.status(401).json({error:'Not signed in.'});r.json({email:u.email,createdAt:u.createdAt,teams:u.teams||[]})});
app.post('/api/user/teams',(q,r)=>{const{token,teams}=q.body||{};const u=findUserByToken(token);if(!u)return r.status(401).json({error:'Not signed in.'});users[u.email].teams=Array.isArray(teams)?teams:[];write(USR,users);r.json({ok:true,teams:users[u.email].teams})});
const HL=(process.env.HIGHLIGHTLY_API_KEY||'').trim();
const HL_HEADERS={'x-rapidapi-key':HL};
function hlNorm(s){return String(s||'').toLowerCase().replace(/[^a-z]/g,'')}
async function hlFindMatchId(home,away,isoDate){
 if(!HL||!isoDate)return null;
 const day=isoDate.slice(0,10);
 try{
  const res=await json(`https://soccer.highlightly.net/matches?homeTeamName=${encodeURIComponent(home)}&awayTeamName=${encodeURIComponent(away)}&date=${day}`,{headers:HL_HEADERS});
  const list=res.data||res||[];
  if(list[0])return list[0].id;
 }catch(e){console.error('hl find',e.message)}
 return null;
}
async function hlMatchDetail(matchId){
 if(!HL)return null;
 try{
  const raw=await json(`https://soccer.highlightly.net/matches/${matchId}`,{headers:HL_HEADERS});
  const m=Array.isArray(raw)?raw[0]:(raw.data?.[0]||raw);
  if(!m)return null;
  const goals=[],bookings=[],subs=[];
  for(const ev of(m.events||[])){
   const timeStr=String(ev.time||'');
   const[minStr,extraStr]=timeStr.split('+');
   const minute=parseInt(minStr,10)||null,injuryTime=extraStr?parseInt(extraStr,10):null;
   const teamName=ev.team?.name;
   const type=String(ev.type||'').toLowerCase();
   if(type==='goal'||type==='penalty'){
    goals.push({minute,injuryTime,scorer:{name:ev.player},assist:ev.assist?{name:ev.assist}:null,team:{name:teamName}});
   }else if(type==='own goal'){
    goals.push({minute,injuryTime,scorer:{name:ev.player},assist:null,team:{name:teamName},ownGoal:true});
   }else if(type==='yellow card'){
    bookings.push({minute,card:'YELLOW',player:{name:ev.player},team:{name:teamName}});
   }else if(type==='red card'){
    bookings.push({minute,card:'RED',player:{name:ev.player},team:{name:teamName}});
   }else if(type==='substitution'){
    subs.push({minute,playerOut:{name:ev.substituted},playerIn:{name:ev.player},team:{name:teamName}});
   }
  }
  let lineups=[{team:{name:m.homeTeam?.name},formation:null,startXI:[],bench:[],statistics:null},{team:{name:m.awayTeam?.name},formation:null,startXI:[],bench:[],statistics:null}];
  try{
   const lu=await json(`https://soccer.highlightly.net/lineups/${matchId}`,{headers:HL_HEADERS});
   const build=side=>{
    const flat=(side?.initialLineup||[]).flat().map(p=>({shirtNumber:p.number||null,name:p.name}));
    const bench=(side?.substitutes||[]).map(p=>({shirtNumber:p.number||null,name:p.name}));
    return{startXI:flat,bench,formation:side?.formation||null};
   };
   const h=build(lu.homeTeam),a=build(lu.awayTeam);
   lineups=[{team:{name:m.homeTeam?.name},formation:h.formation,startXI:h.startXI,bench:h.bench,statistics:null},{team:{name:m.awayTeam?.name},formation:a.formation,startXI:a.startXI,bench:a.bench,statistics:null}];
  }catch(e){console.error('hl lineups',e.message)}
  const nameMap=[[/possession/,'ball_possession'],[/shots?\s*on\s*target/,'shots_on_goal'],[/total\s*shots|^shots$/,'shots'],[/corner/,'corner_kicks'],[/foul/,'fouls'],[/yellow/,'yellow_cards'],[/red/,'red_cards']];
  const mapStats=arr=>{const out={};for(const it of(arr||[])){const dn=String(it.displayName||'').toLowerCase();for(const[re,key]of nameMap){if(re.test(dn)){const n=parseFloat(String(it.value).toString().replace('%',''));out[key]=isNaN(n)?0:n;break}}}return Object.keys(out).length?out:null};
  if(m.statistics?.[0])lineups[0].statistics=mapStats(m.statistics[0].statistics);
  if(m.statistics?.[1])lineups[1].statistics=mapStats(m.statistics[1].statistics);
  const hasAny=goals.length||bookings.length||subs.length||lineups.some(t=>t.startXI.length);
  return hasAny?{goals,bookings,substitutions:subs,lineups}:null;
 }catch(e){console.error('hl detail',e.message);return null}
}
app.get('/api/debug-highlightly',async(q,r)=>{
 try{
  if(!HL)return r.json({error:'HIGHLIGHTLY_API_KEY is not set on the server yet.'});
  const{home,away,date}=q.query;
  const matchId=await hlFindMatchId(home,away,date);
  if(!matchId)return r.json({error:'No matching Highlightly match found for those team names/date.'});
  const raw=await json(`https://soccer.highlightly.net/matches/${matchId}`,{headers:HL_HEADERS}).catch(e=>({error:e.message}));
  const lu=await json(`https://soccer.highlightly.net/lineups/${matchId}`,{headers:HL_HEADERS}).catch(e=>({error:e.message}));
  r.json({matchId,match:raw,lineups:lu});
 }catch(e){r.json({error:e.message})}
});
app.get('/api/match-detail',async(q,r)=>{
 try{
  const{id,home,away}=q.query;
  if(!id)return r.json({available:false,message:'No match id provided.'});
  const m=await fdThrottled(`https://api.football-data.org/v4/matches/${id}`,{headers:{'X-Unfold-Goals':'true','X-Unfold-Bookings':'true','X-Unfold-Subs':'true','X-Unfold-Lineups':'true'}});
  if(!m||!m.id)return r.json({available:false,message:'Match detail not found for this fixture yet.'});
  const notStarted=['SCHEDULED','TIMED','POSTPONED','CANCELLED','SUSPENDED'].includes(String(m.status||'').toUpperCase());
  if(notStarted&&!m.goals?.length&&!m.homeTeam?.lineup?.length){
   return r.json({available:false,message:'Match details (lineups, goals, cards) become available once the match is closer to kickoff or has started.'});
  }
  const shouldHaveDetail=['IN_PLAY','PAUSED','FINISHED','AWARDED','EXTRA_TIME','PENALTY_SHOOTOUT'].includes(String(m.status||'').toUpperCase());
  let hasAnyDetail=!!((m.goals&&m.goals.length)||(m.bookings&&m.bookings.length)||(m.homeTeam?.lineup&&m.homeTeam.lineup.length)||(m.awayTeam?.lineup&&m.awayTeam.lineup.length));
  let goalsOut=m.goals||[],bookingsOut=m.bookings||[],subsOut=m.substitutions||[];
  let lineupsOut=[
   {team:{name:m.homeTeam?.name},formation:m.homeTeam?.formation,startXI:m.homeTeam?.lineup||[],bench:m.homeTeam?.bench||[],statistics:m.homeTeam?.statistics||null},
   {team:{name:m.awayTeam?.name},formation:m.awayTeam?.formation,startXI:m.awayTeam?.lineup||[],bench:m.awayTeam?.bench||[],statistics:m.awayTeam?.statistics||null}
  ];
  if(shouldHaveDetail&&!hasAnyDetail&&home&&away){
   try{
    const matchId=await hlFindMatchId(home,away,m.utcDate);
    if(matchId){
     const hl=await hlMatchDetail(matchId);
     if(hl){goalsOut=hl.goals;bookingsOut=hl.bookings;subsOut=hl.substitutions;lineupsOut=hl.lineups;hasAnyDetail=true}
    }
   }catch(e){console.error('hl fallback',e.message)}
  }
  r.json({
   available:true,
   status:m.status,
   minute:m.minute??null,
   limited:shouldHaveDetail&&!hasAnyDetail,
   score:{home:{total:m.score?.fullTime?.home??null},away:{total:m.score?.fullTime?.away??null}},
   goals:goalsOut,
   bookings:bookingsOut,
   substitutions:subsOut,
   lineups:lineupsOut
  });
 }catch(e){r.json({available:false,message:'Could not load match details right now: '+e.message})}
});
(async()=>{await Promise.allSettled([refresh(),news()]);await live()})();cron.schedule('*/30 * * * * *',live);cron.schedule('*/5 * * * *',refresh);cron.schedule('*/5 * * * *',news);app.listen(PORT,()=>console.log('Matchday backend v3 on '+PORT));
                                                                                              
