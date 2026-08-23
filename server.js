const HL_CACHE = new Map();
const HL_CACHE_TTL = 60 * 1000;

function cleanName(s){
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]/g,'');
}

function teamNamesMatch(a,b){
  const x=cleanName(a);
  const y=cleanName(b);

  if(!x || !y) return false;
  if(x===y) return true;
  if(x.includes(y) || y.includes(x)) return true;

  return false;
}

async function hlFindMatchId(home,away,isoDate){
  if(!HL || !home || !away || !isoDate) return null;

  const date=isoDate.slice(0,10);

  try{
    const url=
      `https://soccer.highlightly.net/matches`+
      `?date=${encodeURIComponent(date)}`;

    const raw=await json(url,{
      headers:HL_HEADERS
    });

    const list=Array.isArray(raw)
      ? raw
      : (Array.isArray(raw?.data) ? raw.data : []);

    if(!list.length){
      console.error('Highlightly returned no matches for',date);
      return null;
    }

    const exact=list.find(m=>{
      const h=m.homeTeam?.name || '';
      const a=m.awayTeam?.name || '';

      return teamNamesMatch(h,home) &&
             teamNamesMatch(a,away);
    });

    if(exact){
      console.log(
        'Highlightly match found:',
        exact.id,
        exact.homeTeam?.name,
        'vs',
        exact.awayTeam?.name
      );

      return exact.id;
    }

    console.error(
      'Highlightly match not found:',
      home,
      'vs',
      away,
      date
    );

    return null;

  }catch(e){
    console.error('Highlightly match search error:',e.message);
    return null;
  }
}


async function hlGet(url){
  return json(url,{
    headers:HL_HEADERS
  });
}


function normalizeHighlightlyEvents(raw){

  const list=Array.isArray(raw)
    ? raw
    : (Array.isArray(raw?.data) ? raw.data : []);

  return list.map(ev=>{

    const time=String(
      ev.time ??
      ev.minute ??
      ''
    );

    let minute=null;
    let injuryTime=null;

    if(time.includes('+')){
      const parts=time.split('+');

      minute=parseInt(parts[0],10);
      injuryTime=parseInt(parts[1],10);

    }else{
      const n=parseInt(time,10);
      minute=Number.isFinite(n) ? n : null;
    }

    return {
      minute,
      injuryTime,
      type:String(ev.type || ''),
      player:ev.player
        ? {name:ev.player}
        : null,
      assist:ev.assist
        ? {name:ev.assist}
        : null,
      substituted:ev.substituted
        ? {name:ev.substituted}
        : null,
      team:ev.team
        ? {
            id:ev.team.id ?? null,
            name:ev.team.name || ''
          }
        : null
    };

  });
}


function normalizeLineupSide(side){

  if(!side){
    return {
      team:{name:''},
      formation:null,
      startXI:[],
      bench:[]
    };
  }

  const initial=Array.isArray(side.initialLineup)
    ? side.initialLineup
    : [];

  const startXI=initial
    .flat()
    .map(p=>({
      id:p.id ?? p.playerId ?? null,
      shirtNumber:p.number ?? p.shirtNumber ?? null,
      name:p.name || '',
      position:p.position || null
    }));

  const substitutes=Array.isArray(side.substitutes)
    ? side.substitutes
    : [];

  const bench=substitutes.map(p=>({
    id:p.id ?? p.playerId ?? null,
    shirtNumber:p.number ?? p.shirtNumber ?? null,
    name:p.name || '',
    position:p.position || null
  }));

  return {
    team:{
      id:side.id ?? side.team?.id ?? null,
      name:side.name || side.team?.name || ''
    },
    formation:side.formation || null,
    startXI,
    bench
  };
}


function normalizeStatistics(raw){

  const list=Array.isArray(raw)
    ? raw
    : (Array.isArray(raw?.data) ? raw.data : []);

  return list.map(team=>({

    team:{
      id:team.team?.id ?? null,
      name:team.team?.name || ''
    },

    statistics:(team.statistics || []).map(stat=>({
      displayName:stat.displayName || '',
      value:stat.value ?? null
    }))

  }));
}


async function hlMatchDetail(matchId){

  if(!HL || !matchId) return null;

  const cacheKey=String(matchId);
  const cached=HL_CACHE.get(cacheKey);

  if(
    cached &&
    Date.now()-cached.time < HL_CACHE_TTL
  ){
    return cached.data;
  }

  try{

    /*
     * IMPORTANT:
     * Highlightly provides these as separate endpoints.
     * Request them together so Match Details loads faster.
     */

    const results=await Promise.allSettled([

      hlGet(
        `https://soccer.highlightly.net/matches/${matchId}`
      ),

      hlGet(
        `https://soccer.highlightly.net/events/${matchId}`
      ),

      hlGet(
        `https://soccer.highlightly.net/lineups/${matchId}`
      ),

      hlGet(
        `https://soccer.highlightly.net/statistics/${matchId}`
      )

    ]);

    const matchRaw=
      results[0].status==='fulfilled'
        ? results[0].value
        : null;

    const eventsRaw=
      results[1].status==='fulfilled'
        ? results[1].value
        : [];

    const lineupsRaw=
      results[2].status==='fulfilled'
        ? results[2].value
        : null;

    const statsRaw=
      results[3].status==='fulfilled'
        ? results[3].value
        : [];

    if(results[0].status==='rejected'){
      console.error(
        'Highlightly match endpoint:',
        results[0].reason?.message
      );
    }

    if(results[1].status==='rejected'){
      console.error(
        'Highlightly events endpoint:',
        results[1].reason?.message
      );
    }

    if(results[2].status==='rejected'){
      console.error(
        'Highlightly lineups endpoint:',
        results[2].reason?.message
      );
    }

    if(results[3].status==='rejected'){
      console.error(
        'Highlightly statistics endpoint:',
        results[3].reason?.message
      );
    }

    const match=Array.isArray(matchRaw)
      ? matchRaw[0]
      : (matchRaw?.data?.[0] || matchRaw);

    const events=normalizeHighlightlyEvents(eventsRaw);

    const homeLineup=
      lineupsRaw?.homeTeam ||
      lineupsRaw?.home ||
      null;

    const awayLineup=
      lineupsRaw?.awayTeam ||
      lineupsRaw?.away ||
      null;

    const lineups=[
      normalizeLineupSide(homeLineup),
      normalizeLineupSide(awayLineup)
    ];

    const statistics=normalizeStatistics(statsRaw);

    const hasDetails=
      events.length > 0 ||
      lineups.some(x=>x.startXI.length > 0) ||
      statistics.length > 0;

    const result={
      matchId,
      match,
      events,
      lineups,
      statistics,
      hasDetails
    };

    HL_CACHE.set(cacheKey,{
      time:Date.now(),
      data:result
    });

    return result;

  }catch(e){

    console.error(
      'Highlightly detail error:',
      e.message
    );

    return null;
  }
}


app.get('/api/match-detail',async(q,r)=>{

  try{

    const {
      id,
      home,
      away,
      date
    }=q.query;

    if(!HL){
      return r.status(503).json({
        available:false,
        source:'highlightly',
        message:
          'HIGHLIGHTLY_API_KEY is not configured on the server.'
      });
    }

    if(!home || !away || !date){

      return r.status(400).json({
        available:false,
        message:
          'Match home team, away team and date are required.'
      });

    }

    /*
     * First find the Highlightly match ID.
     * The ID from Football-Data.org is NOT guaranteed
     * to be the same as Highlightly's ID.
     */

    const highlightlyId=
      await hlFindMatchId(
        home,
        away,
        date
      );

    if(!highlightlyId){

      return r.json({
        available:false,
        source:'highlightly',
        message:
          'Highlightly could not find this match.'
      });

    }

    const detail=
      await hlMatchDetail(highlightlyId);

    if(!detail){

      return r.json({
        available:false,
        source:'highlightly',
        highlightlyMatchId:highlightlyId,
        message:
          'Highlightly could not load the match details.'
      });

    }

    const m=detail.match || {};

    const state=
      m.state ||
      {};

    const score=
      state.score ||
      {};

    const currentScore=
      String(score.current || '')
        .split('-')
        .map(x=>parseInt(x.trim(),10));

    const homeScore=
      Number.isFinite(currentScore[0])
        ? currentScore[0]
        : null;

    const awayScore=
      Number.isFinite(currentScore[1])
        ? currentScore[1]
        : null;

    return r.json({

      available:true,

      source:'highlightly',

      highlightlyMatchId:highlightlyId,

      status:
        state.description ||
        m.status ||
        null,

      minute:
        state.clock ??
        null,

      score:{
        home:{
          total:homeScore
        },
        away:{
          total:awayScore
        }
      },

      goals:
        detail.events.filter(e=>
          /goal|penalty/i.test(e.type)
        ),

      bookings:
        detail.events.filter(e=>
          /yellow|red/i.test(e.type)
        ),

      substitutions:
        detail.events.filter(e=>
          /substitution/i.test(e.type)
        ),

      events:
        detail.events,

      lineups:
        detail.lineups,

      statistics:
        detail.statistics,

      limited:
        !detail.hasDetails

    });

  }catch(e){

    console.error(
      'MATCH DETAIL ROUTE ERROR:',
      e
    );

    return r.status(500).json({
      available:false,
      source:'highlightly',
      message:
        'Could not load match details: '+
        e.message
    });

  }

});
