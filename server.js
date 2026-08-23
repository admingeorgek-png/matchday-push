const express=require("express");
const webpush=require("web-push");
const cron=require("node-cron");
const cors=require("cors");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");

let compression;
try{compression=require("compression")}catch{compression=null}

const app=express();
app.use(cors());
if(compression)app.use(compression());
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public"),{maxAge:"1d"}));

const PORT=process.env.PORT||3000;
const FD=(process.env.FOOTBALL_DATA_API_KEY||"").trim();
const AF=(process.env.API_FOOTBALL_KEY||"").trim();
const VP=(process.env.VAPID_PUBLIC_KEY||"").trim();
const VR=(process.env.VAPID_PRIVATE_KEY||"").trim();
const VE=(process.env.VAPID_CONTACT_EMAIL||"mailto:you@example.com").trim();

const L={
 epl:["Premier League","EPL","PL",20,39],
 laliga:["La Liga","ESP","PD",20,140],
 seriea:["Serie A","ITA","SA",20,135],
 bundesliga:["Bundesliga","GER","BL1",18,78],
 ligue1:["Ligue 1","FRA","FL1",18,61],
 ucl:["Champions League","UCL","CL",36,2]
};

const DATA=path.join(__dirname,"site-data.json");
const SUB=path.join(__dirname,"subscriptions.json");
const SCO=path.join(__dirname,"last-scores.json");
const USR=path.join(__dirname,"users.json");

const read=(f,d)=>{
 try{return JSON.parse(fs.readFileSync(f,"utf8"))}
 catch{return d}
};

const write=(f,x)=>{
 try{fs.writeFileSync(f,JSON.stringify(x,null,2))}
 catch(e){console.error(e.message)}
};

let data=read(DATA,{
 leagues:{},
 transfers:[],
 staleLeagues:Object.keys(L)
});

let subs=read(SUB,[]);
let scores=read(SCO,{});
let users=read(USR,{});
let lastPoll=null;
let busy=0;
let pushEnabled=false;

if(VP&&VR){
 try{
  webpush.setVapidDetails(VE,VP,VR);
  pushEnabled=true;
 }catch(e){
  console.error("Invalid VAPID keys:",e.message);
 }
}else{
 console.error("VAPID keys missing; push disabled.");
}


/* =========================================================
   SERVICE WORKER
========================================================= */

const SW_JS=`self.addEventListener("push",e=>{
 let d={title:"MATCHDAY PUSH",body:"Live match update"};
 try{d=JSON.parse(e.data.text())}catch{}
 e.waitUntil(
  self.registration.showNotification(d.title,{
   body:d.body,
   data:{url:"/"}
  })
 );
});

self.addEventListener("notificationclick",e=>{
 e.notification.close();

 e.waitUntil(
  clients.matchAll({
   type:"window",
   includeUncontrolled:true
  }).then(cs=>{
   for(const c of cs){
    if("focus"in c)return c.focus();
   }

   return clients.openWindow(
    e.notification.data?.url||"/"
   );
  })
 );
});`;

app.get("/sw.js",(q,r)=>{
 r.type("application/javascript")
  .set("Service-Worker-Allowed","/")
  .set("Cache-Control","no-cache")
  .send(SW_JS);
});


/* =========================================================
   GENERIC JSON REQUEST
========================================================= */

async function json(u,o={}){
 const r=await fetch(u,{
  ...o,
  headers:{
   Accept:"application/json",
   ...(o.headers||{})
  }
 });

 const t=await r.text();
 let b;

 try{
  b=JSON.parse(t);
 }catch{}

 if(!r.ok){
  throw Error(`${r.status} ${t.slice(0,180)}`);
 }

 return b;
}


/* =========================================================
   BASIC DATA HELPERS
========================================================= */

const team=t=>({
 id:t?.id??null,
 name:t?.name||"Unknown",
 shortName:t?.shortName||t?.tla||t?.name||"",
 logo:t?.crest||t?.logo||""
});

const match=m=>{
 const f=m.score?.fullTime||{};
 const h=m.score?.halfTime||{};

 return{
  id:m.id,
  date:m.utcDate,
  utcDate:m.utcDate,
  status:m.status,
  statusShort:m.status,
  homeTeam:team(m.homeTeam),
  awayTeam:team(m.awayTeam),
  homeScore:f.home??null,
  awayScore:f.away??null,
  halftimeHome:h.home??null,
  halftimeAway:h.away??null,
  competition:m.competition?.name||"",
  matchday:m.matchday??null,
  venue:m.venue||""
 };
};

const row=r=>({
 position:r.position,
 team:team(r.team),
 played:r.playedGames||0,
 won:r.won||0,
 draw:r.draw||0,
 lost:r.lost||0,
 goalsFor:r.goalsFor||0,
 goalsAgainst:r.goalsAgainst||0,
 goalDifference:r.goalDifference||0,
 points:r.points||0
});

const day=d=>d.toISOString().slice(0,10);

const sleep=ms=>new Promise(res=>setTimeout(res,ms));


/* =========================================================
   FOOTBALL-DATA.ORG REQUEST QUEUE
========================================================= */

let fdQueue=Promise.resolve();
let fdLastCall=0;

function fdThrottled(u,o={}){
 const run=fdQueue.then(async()=>{
  const wait=Math.max(
   0,
   fdLastCall+6500-Date.now()
  );

  if(wait)await sleep(wait);

  fdLastCall=Date.now();

  return json(u,{
   ...o,
   headers:{
    "X-Auth-Token":FD,
    ...(o.headers||{})
   }
  });
 });

 fdQueue=run.catch(()=>{});

 return run;
}

const codeToKey=Object.fromEntries(
 Object.entries(L).map(([k,v])=>[v[2],k])
);


/* =========================================================
   FIXTURES
========================================================= */

async function fixtures(k){
 let c=L[k][2];
 let n=new Date();
 let a=new Date(n);
 let b=new Date(n);

 a.setDate(a.getDate()-3);
 b.setDate(b.getDate()+60);

 let x=await fdThrottled(
  `https://api.football-data.org/v4/competitions/${c}/matches?dateFrom=${day(a)}&dateTo=${day(b)}`
 );

 return(x.matches||[])
  .map(match)
  .sort(
   (a,b)=>new Date(a.date)-new Date(b.date)
  );
}


/* =========================================================
   STANDINGS
========================================================= */

async function standings(k){
 let x=await fdThrottled(
  `https://api.football-data.org/v4/competitions/${L[k][2]}/standings`
 );

 return(
  (x.standings||[])
   .find(s=>s.type==="TOTAL")?.table||
  x.standings?.[0]?.table||
  []
 ).map(row);
}


/* =========================================================
   REFRESH LEAGUE DATA
========================================================= */

async function refresh(){
 let stale=new Set(Object.keys(L));

 for(const k of Object.keys(L)){
  try{

   const [f,s]=await Promise.all([
    fixtures(k),
    standings(k)
   ]);

   data.leagues[k]={
    name:L[k][0],
    short:L[k][1],
    fixtures:f,
    standings:s
   };

   if(
    f.length&&
    (
     (k==="ucl"&&s.length===36)||
     s.length===L[k][3]
    )
   ){
    stale.delete(k);
   }

  }catch(e){
   console.error("refresh",k,e.message);
  }
 }

 data.staleLeagues=[...stale];

 data.lastUpdated=new Date().toISOString();
 data.fixturesLastUpdated=data.lastUpdated;
 data.standingsLastUpdated=data.lastUpdated;

 write(DATA,data);
}


/* =========================================================
   TRANSFER NEWS
========================================================= */

async function news(){
 try{

  const x=await(
   await fetch(
    "https://feeds.bbci.co.uk/sport/football/rss.xml"
   )
  ).text();

  data.transfers=[
   ...x.matchAll(
    /<item>([\s\S]*?)<\/item>/g
   )
  ]
  .map(m=>{

   const z=m[1];

   const v=n=>(
    (
     z.match(
      new RegExp(
       `<${n}>([\\s\\S]*?)<\\/${n}>`,
       "i"
      )
     )||[]
    )[1]||""
   )
   .replace(/<!\[CDATA\[|\]\]>/g,"")
   .trim();

   return{
    headline:v("title"),
    body:v("description"),
    link:v("link")
   };

  })
  .filter(x=>
   /transfer|sign|deal|loan|move|joins|medical|contract/i
   .test(x.headline)
  )
  .slice(0,20);

  data.transfersLastUpdated=
   new Date().toISOString();

  data.lastUpdated=
   data.transfersLastUpdated;

  write(DATA,data);

 }catch(e){
  console.error("news",e.message);
 }
}


/* =========================================================
   FAST MATCH DETAILS
=========================================================

   API-Football is used as the primary detail source.

   It provides:
   - Goals
   - Assists
   - Cards
   - Substitutions
   - Starting XI
   - Bench
   - Formations
   - Match statistics

   Details are cached in memory so reopening a match is fast.
========================================================= */

const AF_BASE=
 "https://v3.football.api-sports.io";

const detailCache=new Map();
const detailInflight=new Map();
const fixtureMapCache=new Map();


/* =========================================================
   TEAM NAME NORMALIZATION
========================================================= */

const norm=s=>
 String(s||"")
 .toLowerCase()
 .normalize("NFD")
 .replace(/[\u0300-\u036f]/g,"")
 .replace(/[^a-z0-9]/g,"");

function sameTeam(a,b){

 const x=norm(a);
 const y=norm(b);

 if(!x||!y)return false;

 return(
  x===y||
  x.includes(y)||
  y.includes(x)||
  x.slice(0,7)===y.slice(0,7)
 );
}


/* =========================================================
   API-FOOTBALL REQUEST
========================================================= */

function afJson(u){

 if(!AF){
  throw Error(
   "API_FOOTBALL_KEY is not configured"
  );
 }

 return json(u,{
  headers:{
   "x-apisports-key":AF
  }
 });
}


/* =========================================================
   API-FOOTBALL SEASON
========================================================= */

function afSeasonForDate(iso){

 const d=new Date(iso);

 const y=d.getUTCFullYear();
 const month=d.getUTCMonth()+1;

 return month>=7?y:y-1;
}


/* =========================================================
   MATCH MINUTE
========================================================= */

function minute(e){

 const m=e?.time?.elapsed;
 const x=e?.time?.extra;

 if(m==null)return null;

 return x?`${m}+${x}`:m;
}


/* =========================================================
   PLAYER NAME
========================================================= */

function playerName(p){
 return p?.name||p?.player?.name||null;
}


/* =========================================================
   FIND API-FOOTBALL FIXTURE
========================================================= */

async function findAFFixture(
 home,
 away,
 isoDate,
 leagueId
){

 const key=
  `${norm(home)}|${norm(away)}|${isoDate}|${leagueId||""}`;

 const cached=fixtureMapCache.get(key);

 if(cached)return cached;

 const base=new Date(isoDate);

 const dates=[0,-1,1].map(n=>{
  const d=new Date(base);

  d.setUTCDate(
   d.getUTCDate()+n
  );

  return d.toISOString().slice(0,10);
 });

 const seasons=[
  afSeasonForDate(isoDate),
  afSeasonForDate(isoDate)-1
 ];


 /* ---------------------------------------------------------
    Search helper
 --------------------------------------------------------- */

 async function searchUrls(urls){

  const results=await Promise.allSettled(
   [...new Set(urls)].map(
    u=>afJson(u)
   )
  );

  for(const rr of results){

   if(rr.status!=="fulfilled")continue;

   const found=
    (rr.value.response||[])
    .find(f=>
     sameTeam(
      f.teams?.home?.name,
      home
     )&&
     sameTeam(
      f.teams?.away?.name,
      away
     )
    );

   if(found?.fixture?.id){
    return found;
   }
  }

  return null;
 }


 /* ---------------------------------------------------------
    FAST PATH
    Search the exact date first.
 --------------------------------------------------------- */

 let found=await searchUrls(

  seasons.map(s=>
   leagueId

    ? `${AF_BASE}/fixtures?league=${leagueId}&season=${s}&date=${dates[0]}`

    : `${AF_BASE}/fixtures?date=${dates[0]}`
  )

 );


 /* ---------------------------------------------------------
    FALLBACK
    Handles timezone/date-edge cases.
 --------------------------------------------------------- */

 if(!found){

  const fallback=[];

  for(const d of dates.slice(1)){

   for(const s of seasons){

    fallback.push(

     leagueId

      ? `${AF_BASE}/fixtures?league=${leagueId}&season=${s}&date=${d}`

      : `${AF_BASE}/fixtures?date=${d}`

    );

   }

  }

  found=await searchUrls(fallback);
 }


 if(found?.fixture?.id){

  fixtureMapCache.set(
   key,
   found
  );

  setTimeout(
   ()=>fixtureMapCache.delete(key),
   30*60*1000
  );

  return found;
 }

 return null;
}


/* =========================================================
   NORMALIZE API-FOOTBALL MATCH DATA
========================================================= */

function normalizeAF(f){

 const ev=
  Array.isArray(f.events)
   ?f.events
   :[];

 const lus=
  Array.isArray(f.lineups)
   ?f.lineups
   :[];

 const stats=
  Array.isArray(f.statistics)
   ?f.statistics
   :[];


 /* ---------------------------------------------------------
    GOALS
 --------------------------------------------------------- */

 const goals=
  ev
   .filter(e=>e.type==="Goal")
   .map(e=>({

    minute:minute(e),

    injuryTime:
     e.time?.extra??null,

    scorer:{
     name:playerName(e.player)
    },

    assist:
     e.assist?.name
      ?{name:e.assist.name}
      :null,

    team:{
     name:e.team?.name||null
    },

    detail:e.detail||null

   }));


 /* ---------------------------------------------------------
    CARDS
 --------------------------------------------------------- */

 const bookings=
  ev
   .filter(e=>e.type==="Card")
   .map(e=>({

    minute:minute(e),

    card:
     e.detail==="Red Card"
      ?"RED"
      :e.detail==="Yellow-Red Card"
       ?"YELLOW_RED"
       :"YELLOW",

    player:{
     name:playerName(e.player)
    },

    team:{
     name:e.team?.name||null
    }

   }));


 /* ---------------------------------------------------------
    SUBSTITUTIONS
 --------------------------------------------------------- */

 const substitutions=
  ev
   .filter(e=>e.type==="subst")
   .map(e=>({

    minute:minute(e),

    playerOut:{
     name:playerName(e.player)
    },

    playerIn:{
     name:playerName(e.assist)
    },

    team:{
     name:e.team?.name||null
    }

   }));


 /* ---------------------------------------------------------
    LINEUPS
 --------------------------------------------------------- */

 const lineups=
  lus.map(s=>({

   team:{
    name:s.team?.name||null,
    logo:s.team?.logo||""
   },

   formation:
    s.formation||null,

   startXI:
    (s.startXI||[])
     .map(p=>({

      shirtNumber:
       p.player?.number??null,

      name:
       p.player?.name||null,

      position:
       p.player?.pos||null,

      grid:
       p.player?.grid||null

     })),

   bench:
    (s.substitutes||[])
     .map(p=>({

      shirtNumber:
       p.player?.number??null,

      name:
       p.player?.name||null,

      position:
       p.player?.pos||null

     })),

   statistics:null

  }));


 /* ---------------------------------------------------------
    STATISTICS
 --------------------------------------------------------- */

 for(const s of stats){

  const target=
   lineups.find(x=>
    sameTeam(
     x.team.name,
     s.team?.name
    )
   );

  if(!target)continue;

  target.statistics={};

  for(const item of s.statistics||[]){

   let v=item.value;

   if(
    typeof v==="string"&&
    v.endsWith("%")
   ){

    const n=parseFloat(v);

    v=Number.isFinite(n)
     ?n
     :v;
   }

   target.statistics[
    String(item.type||"")
     .toLowerCase()
     .replace(/[^a-z0-9]+/g,"_")
   ]=v;
  }
 }


 /* ---------------------------------------------------------
    FINAL MATCH DETAIL OBJECT
 --------------------------------------------------------- */

 return{

  available:true,

  source:"api-football",

  fixtureId:
   f.fixture?.id||null,

  status:
   f.fixture?.status?.short||null,

  minute:
   f.fixture?.status?.elapsed??null,

  score:{
   home:{
    total:f.goals?.home??null
   },
   away:{
    total:f.goals?.away??null
   }
  },

  goals,

  bookings,

  substitutions,

  lineups,

  /* Only these tabs belong to Match Details. */
  tabs:[
   "timeline",
   "lineups",
   "stats"
  ],

  limited:
   !(ev.length||lus.length||stats.length)

 };
}


/* =========================================================
   LOAD API-FOOTBALL DETAIL
========================================================= */

async function loadAFDetail(
 home,
 away,
 isoDate,
 leagueId
){

 const found=
  await findAFFixture(
   home,
   away,
   isoDate,
   leagueId
  );

 if(!found?.fixture?.id){
  return null;
 }

 const full=
  await afJson(
   `${AF_BASE}/fixtures?id=${found.fixture.id}`
  );

 const f=
  full.response?.[0];

 return f
  ?normalizeAF(f)
  :null;
}


/* =========================================================
   FOOTBALL-DATA.ORG FALLBACK
========================================================= */

async function loadFDBDetail(id){

 if(!FD||!id)return null;

 try{

  const m=
   await fdThrottled(
    `https://api.football-data.org/v4/matches/${id}`,
    {
     headers:{
      "X-Unfold-Goals":"true",
      "X-Unfold-Bookings":"true",
      "X-Unfold-Subs":"true",
      "X-Unfold-Lineups":"true"
     }
    }
   );


  if(!m?.id)return null;


  const goals=
   (m.goals||[])
    .map(g=>({

     minute:
      g.minute??null,

     injuryTime:
      g.injuryTime??null,

     scorer:{
      name:
       g.scorer?.name||null
     },

     assist:
      g.assist?.name
       ?{
        name:g.assist.name
       }
       :null,

     team:{
      name:g.team?.name||null
     }

    }));


  const bookings=
   (m.bookings||[])
    .map(b=>({

     minute:
      b.minute??null,

     card:
      b.card||"YELLOW",

     player:{
      name:
       b.player?.name||null
     },

     team:{
      name:
       b.team?.name||null
     }

    }));


  const substitutions=
   (m.substitutions||[])
    .map(s=>({

     minute:
      s.minute??null,

     playerOut:{
      name:
       s.playerOut?.name||null
     },

     playerIn:{
      name:
       s.playerIn?.name||null
     },

     team:{
      name:
       s.team?.name||null
     }

    }));


  const lineups=[

   {
    team:{
     name:m.homeTeam?.name
    },

    formation:
     m.homeTeam?.formation||null,

    startXI:
     m.homeTeam?.lineup||[],

    bench:
     m.homeTeam?.bench||[],

    statistics:
     m.homeTeam?.statistics||null
   },

   {
    team:{
     name:m.awayTeam?.name
    },

    formation:
     m.awayTeam?.formation||null,

    startXI:
     m.awayTeam?.lineup||[],

    bench:
     m.awayTeam?.bench||[],

    statistics:
     m.awayTeam?.statistics||null
   }

  ];


  return{

   available:true,

   source:"football-data",

   status:m.status,

   minute:
    m.minute??null,

   score:{
    home:{
     total:
      m.score?.fullTime?.home??null
    },

    away:{
     total:
      m.score?.fullTime?.away??null
    }
   },

   goals,

   bookings,

   substitutions,

   lineups,

   tabs:[
    "timeline",
    "lineups",
    "stats"
   ],

   limited:
    !(
     goals.length||
     bookings.length||
     substitutions.length||
     lineups.some(
      x=>x.startXI?.length
     )
    )

  };

 }catch(e){

  return null;

 }
}


/* =========================================================
   CACHE TIME
========================================================= */

function cacheTTL(detail){

 const live=[
  "1H",
  "HT",
  "2H",
  "ET",
  "P",
  "LIVE",
  "IN_PLAY",
  "PAUSED"
 ].includes(
  String(
   detail?.status||""
  ).toUpperCase()
 );

 return live
  ?30*1000
  :30*60*1000;
}


/* =========================================================
   MATCH DETAILS API
========================================================= */

app.get(
 "/api/match-detail",
 async(q,r)=>{

  const{
   id,
   home,
   away,
   date,
   utcDate,
   leagueKey,
   leagueId
  }=q.query;


  if(
   !home||
   !away||
   !(date||utcDate)
  ){

   return r.json({

    available:false,

    message:
     "Home team, away team and match date are required.",

    tabs:[
     "timeline",
     "lineups",
     "stats"
    ]

   });

  }


  const iso=
   date||utcDate;


  const cacheKey=
   `${norm(home)}|${norm(away)}|${iso}|${leagueKey||""}|${leagueId||""}`;


  /* ---------------------------------------------------------
     RETURN CACHE IMMEDIATELY
  --------------------------------------------------------- */

  const hit=
   detailCache.get(cacheKey);

  if(
   hit&&
   Date.now()-hit.time<h
