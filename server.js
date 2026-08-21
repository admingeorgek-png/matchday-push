const express=require('express');const webpush=require('web-push');const cron=require('node-cron');const cors=require('cors');const fs=require('fs');const path=require('path');const crypto=require('crypto');
const app=express();app.use(cors());app.use(express.json({limit:'1mb'}));app.use(express.static(path.join(__dirname,'public')));
const PORT=process.env.PORT||3000,FD=process.env.FOOTBALL_DATA_API_KEY||'',AF=process.env.API_FOOTBALL_KEY||'',VP=process.env.VAPID_PUBLIC_KEY||'',VR=process.env.VAPID_PRIVATE_KEY||'',VE=process.env.VAPID_CONTACT_EMAIL||'mailto:you@example.com';
const L={epl:['Premier League','EPL','PL',20,39],laliga:['La Liga','ESP','PD',20,140],seriea:['Serie A','ITA','SA',20,135],bundesliga:['Bundesliga','GER','BL1',18,78],ligue1:['Ligue 1','FRA','FL1',18,61],ucl:['Champions League','UCL','CL',36,2]};
const DATA=path.join(__dirname,'site-data.json'),SUB=path.join(__dirname,'subscriptions.json'),SCO=path.join(__dirname,'last-scores.json'),USR=path.join(__dirname,'users.json');const read=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}},write=(f,x)=>{try{fs.writeFileSync(f,JSON.stringify(x,null,2))}catch(e){console.error(e.message)}};
let data=read(DATA,{leagues:{},transfers:[],staleLeagues:Object.keys(L)}),subs=read(SUB,[]),scores=read(SCO,{}),users=read(USR,{}),lastPoll=null,busy=0;
const hash=(pw,salt)=>crypto.scryptSync(pw,salt,32).toString('hex');
function findUserByToken(token){for(const email in users){if(users[email].token===token)return{email,...users[email]}}return null}
if(!VP||!VR){console.error('Missing VAPID keys');process.exit(1)}webpush.setVapidDetails(VE,VP,VR);
async function json(u,o={}){let r=await fetch(u,{...o,headers:{Accept:'application/json',...(o.headers||{})}}),t=await r.text(),b;try{b=JSON.parse(t)}catch{}if(!r.ok)throw Error(`${r.status} ${t.slice(0,160)}`);return b}
const team=t=>({id:t?.id??null,name:t?.name||'Unknown',shortName:t?.shortName||t?.tla||t?.name||'',logo:t?.crest||t?.logo||''});
const match=m=>{let f=m.score?.fullTime||{},h=m.score?.halfTime||{};return{id:m.id,date:m.utcDate,utcDate:m.utcDate,status:m.status,statusShort:m.status,homeTeam:team(m.homeTeam),awayTeam:team(m.awayTeam),homeScore:f.home??null,awayScore:f.away??null,halftimeHome:h.home??null,halftimeAway:h.away??null,competition:m.competition?.name||'',matchday:m.matchday??null,venue:m.venue||''}};
const row=r=>({position:r.position,team:team(r.team),played:r.playedGames||0,won:r.won||0,draw:r.draw||0,lost:r.lost||0,goalsFor:r.goalsFor||0,goalsAgainst:r.goalsAgainst||0,goalDifference:r.goalDifference||0,points:r.points||0});
const day=d=>d.toISOString().slice(0,10);
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
async function fixtures(k){let c=L[k][2],n=new Date(),a=new Date(n),b=new Date(n);a.setDate(a.getDate()-3);b.setDate(b.getDate()+60);let x=await json(`https://api.football-data.org/v4/competitions/${c}/matches?dateFrom=${day(a)}&dateTo=${day(b)}`,{headers:{'X-Auth-Token':FD}});return(x.matches||[]).map(match).sort((a,b)=>new Date(a.date)-new Date(b.date))}
async function standings(k){let x=await json(`https://api.football-data.org/v4/competitions/${L[k][2]}/standings`,{headers:{'X-Auth-Token':FD}});return((x.standings||[]).find(s=>s.type==='TOTAL')?.table||x.standings?.[0]?.table||[]).map(row)}
async function refresh(){let stale=new Set(Object.keys(L));let first=true;for(let k in L){try{if(!first)await sleep(7000);first=false;let f=await fixtures(k);await sleep(7000);let s=await standings(k);data.leagues[k]={name:L[k][0],short:L[k][1],fixtures:f,standings:s};if(f.length&&((k==='ucl'&&s.length===36)||s.length===L[k][3]))stale.delete(k)}catch(e){console.error(k,e.message)}}data.staleLeagues=[...stale];data.lastUpdated=new Date().toISOString();data.fixturesLastUpdated=data.lastUpdated;data.standingsLastUpdated=data.lastUpdated;write(DATA,data)}
async function news(){try{let r=await fetch('https://feeds.bbci.co.uk/sport/football/rss.xml');let x=await r.text();let arr=[...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m=>{let z=m[1],v=n=>((z.match(new RegExp(`<${n}>([\\s\\S]*?)<\\/${n}>`,'i'))||[])[1]||'').replace(/<!\[CDATA\[|\]\]>/g,'').trim();return{headline:v('title'),body:v('description'),link:v('link')}}).filter(x=>/transfer|sign|deal|loan|move|joins|medical|contract/i.test(x.headline)).slice(0,20);data.transfers=arr;data.transfersLastUpdated=new Date().toISOString();data.lastUpdated=data.transfersLastUpdated;write(DATA,data)}catch(e){console.error('news',e.message)}}
const codeToKey=Object.fromEntries(Object.entries(L).map(([k,v])=>[v[2],k]));
async function live(){
 lastPoll=new Date().toISOString();
 try{
  const x=await json(`https://api.football-data.org/v4/matches?status=LIVE`,{headers:{'X-Auth-Token':FD}});
  const liveStatuses=['IN_PLAY','PAUSED','LIVE','HALFTIME','EXTRA_TIME','PENALTY_SHOOTOUT'];
  for(const m of (x.matches||[])){
   const k=codeToKey[m.competition?.code];
   if(!k)continue;
   const f=match(m);
   if(!liveStatuses.includes(String(f.status).toUpperCase())||f.homeScore==null||f.awayScore==null)continue;
   const q=k+':'+f.id, prev=scores[q];
   if(prev && (prev.home!==f.homeScore||prev.away!==f.awayScore)){
    for(const sub of subs){
     try{await webpush.sendNotification(sub,JSON.stringify({title:`⚽ ${f.homeTeam.name} ${f.homeScore}–${f.awayScore} ${f.awayTeam.name}`,body:L[k][0]+' · live score update'}));}
     catch(e){if(e.statusCode===404||e.statusCode===410){} }
    }
   }
   scores[q]={home:f.homeScore,away:f.awayScore};
  }
 }catch(e){console.error('live',e.message)}
 write(SCO,scores);
}
app.get('/health',async(q,r)=>{let t=null;try{let x=await json('https://api.football-data.org/v4/competitions/PL',{headers:{'X-Auth-Token':FD}});t={ok:true,httpStatus:200,competition:x.name}}catch(e){t={ok:false,error:e.message}}r.json({ok:true,buildMarker:'matchday-backend-v2',subscribers:subs.length,lastPoll,lastDataRefresh:data.lastUpdated,footballDataKeySet:!!FD,apiFootballKeySet:!!AF,footballDataTest:t,staleLeagues:data.staleLeagues||[]})});
app.get('/api/data',(q,r)=>r.set('Cache-Control','no-store').json({...data,serverTime:new Date().toISOString(),expectedTableSizes:Object.fromEntries(Object.entries(L).map(([k,v])=>[k,v[3]])),refreshIntervals:{liveScoresSeconds:30,fixturesSeconds:300,standingsSeconds:300,transfersSeconds:300}}));
app.get('/api/refresh-now',async(q,r)=>{if(!busy){busy=1;await refresh();await news();busy=0}r.json({ok:true,staleLeagues:data.staleLeagues,lastUpdated:data.lastUpdated})});app.post('/api/refresh-now',async(q,r)=>{if(!busy){busy=1;await refresh();await news();busy=0}r.json({ok:true,staleLeagues:data.staleLeagues,lastUpdated:data.lastUpdated})});
app.get('/vapid-public-key',(q,r)=>r.json({publicKey:VP}));app.post('/subscribe',(q,r)=>{if(!q.body?.endpoint)return r.status(400).json({error:'Invalid subscription'});if(!subs.some(x=>x.endpoint===q.body.endpoint))subs.push(q.body);write(SUB,subs);r.status(201).json({ok:true})});app.post('/unsubscribe',(q,r)=>{subs=subs.filter(x=>x.endpoint!==q.body?.endpoint);write(SUB,subs);r.json({ok:true})});
app.post('/api/signup',(q,r)=>{const{email,password}=q.body||{};if(!email||!password)return r.status(400).json({error:'Email and password are required.'});const key=String(email).toLowerCase().trim();if(users[key])return r.status(409).json({error:'An account with this email already exists.'});const salt=crypto.randomBytes(16).toString('hex'),token=crypto.randomBytes(24).toString('hex'),createdAt=new Date().toISOString();users[key]={salt,passwordHash:hash(password,salt),token,createdAt,teams:[]};write(USR,users);r.status(201).json({ok:true,token,email:key,createdAt})});
app.post('/api/login',(q,r)=>{const{email,password}=q.body||{};const key=String(email||'').toLowerCase().trim();const u=users[key];if(!u||hash(password||'',u.salt)!==u.passwordHash)return r.status(401).json({error:'Incorrect email or password.'});const token=crypto.randomBytes(24).toString('hex');u.token=token;write(USR,users);r.json({ok:true,token,email:key,createdAt:u.createdAt})});
app.get('/api/user/me',(q,r)=>{const u=findUserByToken(q.query.token);if(!u)return r.status(401).json({error:'Not signed in.'});r.json({email:u.email,createdAt:u.createdAt,teams:u.teams||[]})});
app.post('/api/user/teams',(q,r)=>{const{token,teams}=q.body||{};const u=findUserByToken(token);if(!u)return r.status(401).json({error:'Not signed in.'});users[u.email].teams=Array.isArray(teams)?teams:[];write(USR,users);r.json({ok:true,teams:users[u.email].teams})});
app.get('/api/match-detail',async(q,r)=>{
 if(!AF)return r.json({available:false,message:'Match detail source is not configured yet.'});
 try{
  const{home,away,date,league}=q.query;
  const day=(date||new Date().toISOString()).slice(0,10);
  const matchYear=parseInt(day.slice(0,4),10),matchMonth=parseInt(day.slice(5,7),10);
  const season=matchMonth>=7?matchYear:matchYear-1;
  const norm=s=>String(s||'').toLowerCase().replace(/[^a-z]/g,'');
  const fuzzy=(a,b)=>{a=norm(a);b=norm(b);if(!a||!b)return false;return a.includes(b)||b.includes(a)||a.includes(b.slice(0,Math.min(6,b.length)))||b.includes(a.slice(0,Math.min(6,a.length)))};
  let fx=null;
  const leagueId=L[league]?.[4];
  if(leagueId){
   try{
    const byLeague=await json(`https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=${season}&date=${day}`,{headers:{'x-apisports-key':AF}});
    fx=(byLeague.response||[]).find(m=>fuzzy(m.teams?.home?.name,home)&&fuzzy(m.teams?.away?.name,away))||null;
    if(!fx){
     const d0=new Date(day);d0.setDate(d0.getDate()-2);const d1=new Date(day);d1.setDate(d1.getDate()+2);
     const byLeagueRange=await json(`https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=${season}&from=${d0.toISOString().slice(0,10)}&to=${d1.toISOString().slice(0,10)}`,{headers:{'x-apisports-key':AF}});
     fx=(byLeagueRange.response||[]).find(m=>fuzzy(m.teams?.home?.name,home)&&fuzzy(m.teams?.away?.name,away))||null;
    }
   }catch(e){console.error('match-detail league lookup',e.message)}
  }
  if(!fx){
   const d0=new Date(day);d0.setDate(d0.getDate()-2);const d1=new Date(day);d1.setDate(d1.getDate()+2);
   const list=await json(`https://v3.football.api-sports.io/fixtures?from=${d0.toISOString().slice(0,10)}&to=${d1.toISOString().slice(0,10)}`,{headers:{'x-apisports-key':AF}});
   fx=(list.response||[]).find(m=>fuzzy(m.teams?.home?.name,home)&&fuzzy(m.teams?.away?.name,away))||null;
  }
  if(!fx)return r.json({available:false,message:'Match detail not found for this fixture yet. This usually means the match has not been picked up by the stats provider, or hasn\'t kicked off.'});
  const id=fx.fixture.id;
  const[lu,ev,st]=await Promise.all([
   json(`https://v3.football.api-sports.io/fixtures/lineups?fixture=${id}`,{headers:{'x-apisports-key':AF}}).catch(()=>({response:[]})),
   json(`https://v3.football.api-sports.io/fixtures/events?fixture=${id}`,{headers:{'x-apisports-key':AF}}).catch(()=>({response:[]})),
   json(`https://v3.football.api-sports.io/fixtures/statistics?fixture=${id}`,{headers:{'x-apisports-key':AF}}).catch(()=>({response:[]})),
  ]);
  r.json({available:true,score:{home:{total:fx.goals?.home},away:{total:fx.goals?.away}},lineups:lu.response||[],events:ev.response||[],statistics:st.response||[]});
 }catch(e){r.json({available:false,message:e.message})}
});
(async()=>{await Promise.allSettled([refresh(),news()]);await live()})();cron.schedule('*/30 * * * * *',live);cron.schedule('*/5 * * * *',refresh);cron.schedule('*/5 * * * *',news);app.listen(PORT,()=>console.log('Matchday backend v3 on '+PORT));
 
