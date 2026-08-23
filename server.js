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
app.get('/health',(q,r)=>{r.json({ok:true,buildMarker:'matchday-backend-v3',subscribers:subs.length,lastPoll,lastDataRefresh:data.lastUpdated,footballDataKeySet:!!FD,apiFootballKeySet:!!AF,leaguesLoaded:Object.keys(data.leagues||{}).length,staleLeagues:data.staleLeagues||[]})});
app.get('/api/data',(q,r)=>r.set('Cache-Control','no-store').json({...data,serverTime:new Date().toISOString(),expectedTableSizes:Object.fromEntries(Object.entries(L).map(([k,v])=>[k,v[3]])),refreshIntervals:{liveScoresSeconds:30,fixturesSeconds:300,standingsSeconds:300,transfersSeconds:300}}));
app.get('/api/refresh-now',async(q,r)=>{if(!busy){busy=1;await refresh();await news();busy=0}r.json({ok:true,staleLeagues:data.staleLeagues,lastUpdated:data.lastUpdated})});app.post('/api/refresh-now',async(q,r)=>{if(!busy){busy=1;await refresh();await news();busy=0}r.json({ok:true,staleLeagues:data.staleLeagues,lastUpdated:data.lastUpdated})});
app.get('/vapid-public-key',(q,r)=>pushEnabled?r.json({publicKey:VP}):r.status(503).json({error:'Push notifications are not configured on the server yet.'}));app.post('/subscribe',(q,r)=>{if(!q.body?.endpoint)return r.status(400).json({error:'Invalid subscription'});if(!subs.some(x=>x.endpoint===q.body.endpoint))subs.push(q.body);write(SUB,subs);r.status(201).json({ok:true})});app.post('/unsubscribe',(q,r)=>{subs=subs.filter(x=>x.endpoint!==q.body?.endpoint);write(SUB,subs);r.json({ok:true})});
app.post('/api/signup',(q,r)=>{const{email,password}=q.body||{};if(!email||!password)return r.status(400).json({error:'Email and password are required.'});const key=String(email).toLowerCase().trim();if(users[key])return r.status(409).json({error:'An account with this email already exists.'});const salt=crypto.randomBytes(16).toString('hex'),token=crypto.randomBytes(24).toString('hex'),createdAt=new Date().toISOString();users[key]={salt,passwordHash:hash(password,salt),token,createdAt,teams:[]};write(USR,users);r.status(201).json({ok:true,token,email:key,createdAt})});
app.post('/api/login',(q,r)=>{const{email,password}=q.body||{};const key=String(email||'').toLowerCase().trim();const u=users[key];if(!u||hash(password||'',u.salt)!==u.passwordHash)return r.status(401).json({error:'Incorrect email or password.'});const token=crypto.randomBytes(24).toString('hex');u.token=token;write(USR,users);r.json({ok:true,token,email:key,createdAt:u.createdAt})});
app.get('/api/user/me',(q,r)=>{const u=findUserByToken(q.query.token);if(!u)return r.status(401).json({error:'Not signed in.'});r.json({email:u.email,createdAt:u.createdAt,teams:u.teams||[]})});
app.post('/api/user/teams',(q,r)=>{const{token,teams}=q.body||{};const u=findUserByToken(token);if(!u)return r.status(401).json({error:'Not signed in.'});users[u.email].teams=Array.isArray(teams)?teams:[];write(USR,users);r.json({ok:true,teams:users[u.email].teams})});
function sofaFuzzy(a,b){const norm=s=>String(s||'').toLowerCase().replace(/[^a-z]/g,'');a=norm(a);b=norm(b);if(!a||!b)return false;return a.includes(b)||b.includes(a)||a.includes(b.slice(0,Math.min(6,b.length)))||b.includes(a.slice(0,Math.min(6,a.length)))}
async function sofaFindEventId(home,away,isoDate){
 if(!isoDate)return null;
 const base=new Date(isoDate);
 const ymd=x=>`${x.getUTCFullYear()}-${String(x.getUTCMonth()+1).padStart(2,'0')}-${String(x.getUTCDate()).padStart(2,'0')}`;
 const tryDates=[base,new Date(base.getTime()-86400000),new Date(base.getTime()+86400000)];
 for(const dt of tryDates){
  try{
   const sb=await json(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${ymd(dt)}`);
   const ev=(sb.events||[]).find(e=>sofaFuzzy(e.homeTeam?.name,home)&&sofaFuzzy(e.awayTeam?.name,away));
   if(ev)return ev.id;
  }catch(e){}
 }
 return null;
}
async function sofaMatchDetail(eventId,homeName,awayName){
 const goals=[],bookings=[],subs=[];
 try{
  const inc=await json(`https://api.sofascore.com/api/v1/event/${eventId}/incidents`);
  for(const i of(inc.incidents||[])){
   const teamName=i.isHome?homeName:awayName;
   const player=i.player?.name||i.playerName||null;
   if(i.incidentType==='goal'){
    goals.push({minute:i.time??null,injuryTime:i.addedTime||null,scorer:{name:player},assist:i.assist1?{name:i.assist1.name}:null,team:{name:teamName}});
   }else if(i.incidentType==='card'){
    const card=i.incidentClass==='red'?'RED':i.incidentClass==='yellowRed'?'YELLOW_RED':'YELLOW';
    bookings.push({minute:i.time??null,card,player:{name:player},team:{name:teamName}});
   }else if(i.incidentType==='substitution'){
    subs.push({minute:i.time??null,playerOut:{name:i.playerOut?.name},playerIn:{name:i.playerIn?.name},team:{name:teamName}});
   }
  }
 }catch(e){console.error('sofa incidents',e.message)}
 let lineups=[{team:{name:homeName},formation:null,startXI:[],bench:[],statistics:null},{team:{name:awayName},formation:null,startXI:[],bench:[],statistics:null}];
 try{
  const lu=await json(`https://api.sofascore.com/api/v1/event/${eventId}/lineups`);
  const build=side=>{
   const players=(side?.players||[]);
   return{
    startXI:players.filter(p=>!p.substitute).map(p=>({shirtNumber:p.shirtNumber||p.jerseyNumber||null,name:p.player?.name||p.player?.shortName})),
    bench:players.filter(p=>p.substitute).map(p=>({shirtNumber:p.shirtNumber||p.jerseyNumber||null,name:p.player?.name||p.player?.shortName})),
    formation:side?.formation||null
   };
  };
  const h=build(lu.home),a=build(lu.away);
  lineups=[{team:{name:homeName},formation:h.formation,startXI:h.startXI,bench:h.bench,statistics:null},{team:{name:awayName},formation:a.formation,startXI:a.startXI,bench:a.bench,statistics:null}];
 }catch(e){console.error('sofa lineups',e.message)}
 try{
  const st=await json(`https://api.sofascore.com/api/v1/event/${eventId}/statistics`);
  const all=(st.statistics||[]).find(p=>p.period==='ALL')||st.statistics?.[0];
  const items=(all?.groups||[]).flatMap(g=>g.statisticsItems||[]);
  const nameMap={'Ball possession':'ball_possession','Total shots':'shots','Shots on target':'shots_on_goal','Corner kicks':'corner_kicks','Fouls':'fouls','Yellow cards':'yellow_cards','Red cards':'red_cards'};
  const homeStats={},awayStats={};
  for(const it of items){
   const key=nameMap[it.name];
   if(!key)continue;
   const numOf=v=>{const n=parseFloat(String(v||'').replace('%',''));return isNaN(n)?0:n};
   homeStats[key]=numOf(it.home);
   awayStats[key]=numOf(it.away);
  }
  if(lineups[0])lineups[0].statistics=Object.keys(homeStats).length?homeStats:null;
  if(lineups[1])lineups[1].statistics=Object.keys(awayStats).length?awayStats:null;
 }catch(e){console.error('sofa statistics',e.message)}
 const hasAny=goals.length||bookings.length||subs.length||lineups.some(t=>t.startXI.length);
 return hasAny?{goals,bookings,substitutions:subs,lineups}:null;
}
app.get('/api/debug-sofascore',async(q,r)=>{
 try{
  const{home,away,date}=q.query;
  const eventId=await sofaFindEventId(home,away,date);
  if(!eventId)return r.json({error:'No matching Sofascore event found for those team names/date.'});
  const [inc,lu,st]=await Promise.all([
   json(`https://api.sofascore.com/api/v1/event/${eventId}/incidents`).catch(e=>({error:e.message})),
   json(`https://api.sofascore.com/api/v1/event/${eventId}/lineups`).catch(e=>({error:e.message})),
   json(`https://api.sofascore.com/api/v1/event/${eventId}/statistics`).catch(e=>({error:e.message})),
  ]);
  r.json({source:'sofascore',eventId,incidents:inc,lineups:lu,statistics:st});
 }catch(e){r.json({error:e.message})}
});
function fotFuzzy(a,b){const norm=s=>String(s||'').toLowerCase().replace(/[^a-z]/g,'');a=norm(a);b=norm(b);if(!a||!b)return false;return a.includes(b)||b.includes(a)||a.includes(b.slice(0,Math.min(6,b.length)))||b.includes(a.slice(0,Math.min(6,a.length)))}
async function fotFindMatchId(home,away,isoDate){
 if(!isoDate)return null;
 const base=new Date(isoDate);
 const ymd=x=>`${x.getUTCFullYear()}${String(x.getUTCMonth()+1).padStart(2,'0')}${String(x.getUTCDate()).padStart(2,'0')}`;
 const tryDates=[base,new Date(base.getTime()-86400000),new Date(base.getTime()+86400000)];
 for(const dt of tryDates){
  try{
   const day=await json(`https://www.fotmob.com/api/matches?date=${ymd(dt)}`);
   for(const lg of(day.leagues||[])){
    const m=(lg.matches||[]).find(x=>fotFuzzy(x.home?.name,home)&&fotFuzzy(x.away?.name,away));
    if(m)return m.id;
   }
  }catch(e){}
 }
 return null;
}
async function fotMatchDetail(matchId,homeName,awayName){
 try{
  const d=await json(`https://www.fotmob.com/api/matchDetails?matchId=${matchId}`);
  const goals=[],bookings=[],subs=[];
  const events=d.content?.matchFacts?.events?.events||d.content?.matchFacts?.highlights?.events||[];
  for(const ev of events){
   const type=String(ev.type||'').toLowerCase();
   const minute=ev.time??ev.min??null;
   const teamName=ev.isHome===true?homeName:ev.isHome===false?awayName:(ev.teamId&&d.general?.homeTeam?.id===ev.teamId?homeName:awayName);
   const playerName=ev.player?.name||ev.playerName||ev.nameStr||null;
   if(type.includes('goal')&&!type.includes('miss')){
    goals.push({minute,scorer:{name:playerName},assist:ev.assistStr?{name:ev.assistStr}:null,team:{name:teamName}});
   }else if(type.includes('yellowred')||type==='yellowred'){
    bookings.push({minute,card:'YELLOW_RED',player:{name:playerName},team:{name:teamName}});
   }else if(type.includes('yellow')){
    bookings.push({minute,card:'YELLOW',player:{name:playerName},team:{name:teamName}});
   }else if(type.includes('red')){
    bookings.push({minute,card:'RED',player:{name:playerName},team:{name:teamName}});
   }else if(type.includes('sub')){
    subs.push({minute,playerOut:{name:ev.swapedPlayerName||ev.playerOut?.name},playerIn:{name:playerName},team:{name:teamName}});
   }
  }
  const lu=d.content?.lineup?.lineup||d.content?.lineup;
  const buildSide=side=>{
   const players=(side?.starters||side?.players||[]).map(p=>({shirtNumber:p.shirtNumber||p.jerseyNumber||null,name:p.name||p.playerName}));
   const bench=(side?.bench||side?.subs||[]).map(p=>({shirtNumber:p.shirtNumber||p.jerseyNumber||null,name:p.name||p.playerName}));
   return{players,bench,formation:side?.formation||null};
  };
  const homeSide=lu?.[0]||lu?.home,awaySide=lu?.[1]||lu?.away;
  const h=buildSide(homeSide),a=buildSide(awaySide);
  const lineups=[
   {team:{name:homeName},formation:h.formation,startXI:h.players,bench:h.bench,statistics:null},
   {team:{name:awayName},formation:a.formation,startXI:a.players,bench:a.bench,statistics:null}
  ];
  const statCats=d.content?.stats?.stats||[];
  const nameMap={'ball possession':'ball_possession','total shots':'shots','shots on target':'shots_on_goal','corners':'corner_kicks','fouls committed':'fouls','yellow cards':'yellow_cards','red cards':'red_cards'};
  const homeStats={},awayStats={};
  for(const cat of statCats){
   for(const item of(cat.stats||[])){
    const key=nameMap[String(item.title||item.key||'').toLowerCase()];
    if(!key)continue;
    const vals=item.stats||[];
    const numOf=v=>{const n=parseFloat(String(v||'').replace('%',''));return isNaN(n)?0:n};
    homeStats[key]=numOf(vals[0]);
    awayStats[key]=numOf(vals[1]);
   }
  }
  if(lineups[0])lineups[0].statistics=Object.keys(homeStats).length?homeStats:null;
  if(lineups[1])lineups[1].statistics=Object.keys(awayStats).length?awayStats:null;
  const hasAny=goals.length||bookings.length||subs.length||lineups.some(t=>t.startXI.length);
  return hasAny?{goals,bookings,substitutions:subs,lineups}:null;
 }catch(e){console.error('fotmob detail',e.message);return null}
}
app.get('/api
