import { useState, useEffect, useRef } from 'react';
import { corbQuestions } from './corbQuestions';
import { easyQuestions } from './easyQuestions';
import { supabase, cloudSaveProfile, cloudCreateProfile, cloudCheckNameExists, cloudLoadProfile } from './supabase';

const TIMER_SECONDS = 15;
const EXPERIENCE_LEVELS = ['Beginner','Intermediate','Advanced','Scratch'];

// ─── FUNDRAISER CONFIG ────────────────────────────────────────────
const fundraiserConfig = {
  eventName: 'Ashlyn G. Volleyball Fundraiser',
  categories: ['Pittsburgh'],
  deadline: new Date('2026-04-30T12:00:00-04:00').getTime(),
};

function getFundraiserConfig() {
  try { const r = localStorage.getItem('sb_fundraiser_config'); return r ? JSON.parse(r) : fundraiserConfig; } catch { return fundraiserConfig; }
}
function isFundraiserExpired(): boolean { return Date.now() > getFundraiserConfig().deadline; }

// ─── TYPES ────────────────────────────────────────────────────────
type Questionnaire = {
  q1:string; q2:string; q3:string; q4:string; q5:string;
  q6:string; q7:string; q8:string; q9:string; q10:string;
};

type Profile = {
  name:string; experience:string; favCats:string[];
  owgtr:number; triviaHandicap:number; sbr:number;
  roundsPlayed:number; correctAnswers:number; totalAnswers:number;
  questionnaire?:Questionnaire; courseTier?:string; pin?:string;
  division?:string; sbIndex?:number; calibrated?:boolean; eventPar?:number;
};

// ─── MULTI-PROFILE STORAGE ────────────────────────────────────────
function loadProfiles(): Record<string, Profile> {
  try { const r = localStorage.getItem('sb_profiles'); return r ? JSON.parse(r) : {}; } catch { return {}; }
}
function saveProfiles(profiles: Record<string, Profile>) {
  try { localStorage.setItem('sb_profiles', JSON.stringify(profiles)); } catch {}
}
function loadActiveProfileName(): string | null { return localStorage.getItem('sb_active_profile'); }
function saveActiveProfileName(name: string) { localStorage.setItem('sb_active_profile', name); }
function removeActiveProfile() { localStorage.removeItem('sb_active_profile'); }

function loadProfile(): Profile | null {
  try {
    // Support both old single-profile and new multi-profile
    const name = loadActiveProfileName();
    if (name) {
      const profiles = loadProfiles();
      if (profiles[name]) return profiles[name];
    }
    // Migrate old single profile
    const old = localStorage.getItem('sb_profile');
    if (old) {
      const p: Profile = JSON.parse(old);
      const profiles = loadProfiles();
      profiles[p.name] = p;
      saveProfiles(profiles);
      saveActiveProfileName(p.name);
      localStorage.removeItem('sb_profile');
      return p;
    }
    return null;
  } catch { return null; }
}

function saveProfile(p: Profile) {
  try {
    const profiles = loadProfiles();
    profiles[p.name] = p;
    saveProfiles(profiles);
    saveActiveProfileName(p.name);
  } catch {}
}

function loadQuestionnaire(): Questionnaire | null {
  try { const s = localStorage.getItem('sb_questionnaire'); return s ? JSON.parse(s) : null; } catch { return null; }
}
function saveQuestionnaire(q: Questionnaire) {
  try { localStorage.setItem('sb_questionnaire', JSON.stringify(q)); } catch {}
}
type FundraiserLeaderboardEntry = {
  id: string;
  name: string;
  division: string;
  eventName: string;
  roundsCompleted: number;
  totalCorrect: number;
  totalQuestions: number;
  totalScore: number;
  totalScoreVsPar: number;
  accuracy: number;
  completedAt: number;
};

async function loadFundraiserLeaderboard(eventName: string): Promise<FundraiserLeaderboardEntry[]> {
  try {
    const { data, error } = await supabase
      .from('fundraiser_leaderboard')
      .select('*')
      .eq('event_name', eventName)
      .order('total_score_vs_par', { ascending: true });

    if (error || !data) return [];

    return data.map((r: any) => ({
      id: r.id,
      name: r.name,
      division: r.division,
      eventName: r.event_name,
      roundsCompleted: r.rounds_completed,
      totalCorrect: r.total_correct,
      totalQuestions: r.total_questions,
      totalScore: r.total_score,
      totalScoreVsPar: r.total_score_vs_par,
      accuracy: r.accuracy,
      completedAt: r.completed_at,
    }));
  } catch {
    return [];
  }
}

async function saveFundraiserLeaderboard(
  eventName: string,
  entries: FundraiserLeaderboardEntry[]
) {
  try {
    for (const entry of entries) {
      await supabase.from('fundraiser_leaderboard').upsert({
        id: entry.id,
        name: entry.name,
        division: entry.division,
        event_name: entry.eventName,
        rounds_completed: entry.roundsCompleted,
        total_correct: entry.totalCorrect,
        total_questions: entry.totalQuestions,
        total_score: entry.totalScore,
        total_score_vs_par: entry.totalScoreVsPar,
        accuracy: entry.accuracy,
        completed_at: entry.completedAt,
      });
    }
  } catch {}
}

async function updateFundraiserLeaderboard(
  eventName: string,
  profile: Profile,
  roundCorrect: number,
  roundTotal: number,
  roundScore: number,
  roundScoreVsPar: number
) {
  const entries = await loadFundraiserLeaderboard(eventName);

  const existingIndex = entries.findIndex(
    (entry) =>
      entry.name.toLowerCase().trim() === profile.name.toLowerCase().trim() &&
      entry.division.toLowerCase().trim() === (profile.division || 'Open').toLowerCase().trim()
  );

  if (existingIndex >= 0 && entries[existingIndex].roundsCompleted >= 4) {
    const currentProfile = loadProfile();
    if (currentProfile) {
      const updated = {
        ...currentProfile,
        roundsPlayed: (currentProfile.roundsPlayed || 0) + 1,
        correctAnswers: (currentProfile.correctAnswers || 0) + roundCorrect,
        totalAnswers: (currentProfile.totalAnswers || 0) + roundTotal,
      };
      saveProfile(updated);
    }
    return;
  }

  if (existingIndex >= 0) {
    const existing = entries[existingIndex];

    entries[existingIndex] = {
      ...existing,
      roundsCompleted: existing.roundsCompleted + 1,
      totalCorrect: existing.totalCorrect + roundCorrect,
      totalQuestions: existing.totalQuestions + roundTotal,
      totalScore: existing.totalScore + roundScore,
      totalScoreVsPar: existing.totalScoreVsPar + roundScoreVsPar,
      accuracy: Math.round(
        ((existing.totalCorrect + roundCorrect) /
          (existing.totalQuestions + roundTotal)) *
          100
      ),
      completedAt: Date.now(),
    };
  } else {
    entries.push({
      id: `${Date.now()}_${profile.name}`,
      name: profile.name,
      division: profile.division || 'Open',
      eventName,
      roundsCompleted: 1,
      totalCorrect: roundCorrect,
      totalQuestions: roundTotal,
      totalScore: roundScore,
      totalScoreVsPar: roundScoreVsPar,
      accuracy: roundTotal
        ? Math.round((roundCorrect / roundTotal) * 100)
        : 0,
      completedAt: Date.now(),
    });
  }

  entries.sort((a, b) => {
    if (a.roundsCompleted !== b.roundsCompleted) {
      return b.roundsCompleted - a.roundsCompleted;
    }
    if (a.totalScore !== b.totalScore) {
      return a.totalScore - b.totalScore;
    }
    if (b.totalCorrect !== a.totalCorrect) {
      return b.totalCorrect - a.totalCorrect;
    }
    return b.completedAt - a.completedAt;
  });

  await saveFundraiserLeaderboard(eventName, entries);
}

// ─── QUESTIONNAIRE DATA ───────────────────────────────────────────
const QUESTIONS_Q = [
  { id:'q1', question:'How often do you play golf?', options:['Every day / Multiple times a week','Once a week','Occasionally','Never'] },
  { id:'q2', question:'What type of course do you typically play?', options:['Private / Country Club','Semi-private','Public / Municipal','Simulator / Driving Range only'] },
  { id:'q3', question:'What is your real golf handicap?', options:['Scratch or better (0 and under)','Low (1–9)','Mid (10–18)','High (19–36+)','Charity / Business Events Only'] },
  { id:'q4', question:'What are your strongest trivia subjects?', options:['Sports & Athletics','Pop Culture & Entertainment','History & Geography','Science & Technology'] },
  { id:'q5', question:'What region of the US are you from?', options:['Northeast (PA, NY, NJ, New England)','South (TX, FL, GA, Carolinas)','Midwest (OH, IL, MI, MN)','West (CA, AZ, CO, Pacific NW)'] },
  { id:'q6', question:'What are your hobbies outside of golf?', options:['Fitness / Outdoor sports / Hunting & Fishing','Gaming / Technology / Movies & TV','Music / Art / Food & Cooking','Reading / History / Travel'] },
  { id:'q7', question:'What age group are you in?', options:['Under 18','18–34','35–54','55+'] },
  { id:'q8', question:'What sports do you follow most?', options:['Football (NFL / College)','Baseball / Hockey / Basketball','Golf / Tennis / Individual sports','Combat sports / Motorsports / Extreme sports'] },
  { id:'q9', question:'How would you rate your general trivia knowledge?', options:['Expert — I win every time','Above average — I hold my own','Average — I know a little of everything','Beginner — I\'m here to learn'] },
  { id:'q10', question:'What pop culture era are you most knowledgeable in?', options:['60s / 70s / 80s','90s / Early 2000s','2010s / Current','I don\'t follow pop culture'] },
];

// ─── CALIBRATION ──────────────────────────────────────────────────
const CALIBRATION_QUESTIONS = [
  { text:'How many players are on a basketball team on the court?', answers:['4','5','6','7'], correct:1 },
  { text:'Which planet is closest to the Sun?', answers:['Earth','Venus','Mercury','Mars'], correct:2 },
  { text:'What is 12 × 12?', answers:['132','144','124','148'], correct:1 },
  { text:'Which ocean is the largest?', answers:['Atlantic','Indian','Arctic','Pacific'], correct:3 },
  { text:'What is the chemical formula for water?', answers:['H2O2','HO','H2O','H3O'], correct:2 },
  { text:'In what year did World War II end?', answers:['1943','1944','1945','1946'], correct:2 },
  { text:'What is the chemical symbol for gold?', answers:['Go','Gd','Au','Ag'], correct:2 },
  { text:'Who painted the Mona Lisa?', answers:['Michelangelo','Raphael','Leonardo da Vinci','Caravaggio'], correct:2 },
  { text:'What is the approximate speed of light?', answers:['150,000 km/s','300,000 km/s','450,000 km/s','600,000 km/s'], correct:1 },
  { text:'Which element has atomic number 79?', answers:['Silver','Platinum','Gold','Copper'], correct:2 },
];

function calcSBIndex(correct:number, total:number, avgTime:number): number {
  const acc = correct/total;
  let base = acc>0.9?4:acc>=0.75?8:acc>=0.6?12:acc>=0.45?18:24;
  const speed = avgTime<10&&acc>0.75?-1:avgTime>25?1:0;
  return Math.max(0,Math.min(30,base+speed));
}
function getEventPar(sbIndex:number): number {
  if(sbIndex<=5)return 56; if(sbIndex<=10)return 58; if(sbIndex<=15)return 61;
  if(sbIndex<=20)return 64; if(sbIndex<=25)return 68; return 72;
}
function calcFundraiserRoundScore(correct:number,incorrect:number,roundPar:number):number {
  const net=correct-incorrect;
  const raw=roundPar-Math.round(net*0.5);
  return Math.max(roundPar-9,Math.min(roundPar+9,raw));
}
function formatVsPar(score:number,par:number):string {
  const d=score-par; return d===0?'E':d<0?`${d}`:`+${d}`;
}
function getFundraiserFeedback(isCorrect:boolean,difficulty:string):string {
  if(isCorrect){if(difficulty==='hard')return'🦅 Eagle!';if(difficulty==='medium')return'🐦 Birdie!';return'✅ Par!';}
  if(difficulty==='hard')return'🎯 Double Bogey.';if(difficulty==='medium')return'⛳ Bogey.';return'📌 Bogey.';
}

// ─── HANDICAP CALCULATOR ─────────────────────────────────────────
function calcSBR(q:Questionnaire):number {
  let a=0;
  if(q.q7==='Under 18')a=820;else if(q.q7==='18–34')a=1100;else if(q.q7==='35–54')a=1250;else a=1150;
  let t=0;
  if(q.q9==='Expert — I win every time')t=300;else if(q.q9==='Above average — I hold my own')t=150;else if(q.q9==='Average — I know a little of everything')t=50;
  return Math.min(1800,a+t);
}

function calcHandicapFromQ(q:Questionnaire):{handicap:number;tier:string;owgtr:number} {
  let s=0;
  if(q.q1==='Every day / Multiple times a week')s+=4;else if(q.q1==='Once a week')s+=3;else if(q.q1==='Occasionally')s+=2;else s+=1;
  if(q.q2==='Private / Country Club')s+=4;else if(q.q2==='Semi-private')s+=3;else if(q.q2==='Public / Municipal')s+=2;else s+=1;
  if(q.q3==='Scratch or better (0 and under)')s+=5;else if(q.q3==='Low (1–9)')s+=4;else if(q.q3==='Mid (10–18)')s+=3;else if(q.q3==='High (19–36+)')s+=2;else s+=1;
  if(q.q9==='Expert — I win every time')s+=4;else if(q.q9==='Above average — I hold my own')s+=3;else if(q.q9==='Average — I know a little of everything')s+=2;else s+=1;
  let handicap:number,tier:string,owgtr:number;
  if(s>=15){handicap=2;tier='Championship';owgtr=1800;}
  else if(s>=12){handicap=8;tier='Advanced';owgtr=1400;}
  else if(s>=9){handicap=16;tier='Intermediate';owgtr=1000;}
  else if(s>=6){handicap=24;tier='Recreational';owgtr=700;}
  else{handicap=36;tier='Beginner';owgtr=500;}
  return{handicap,tier,owgtr};
}

// ─── RANKING SYSTEM ──────────────────────────────────────────────
const TIER_EXPECTED_PCT:Record<string,number>={Championship:0.85,Advanced:0.70,Intermediate:0.55,Recreational:0.40,Beginner:0.25};

function calcProjectedRanking(profile:Profile,roundCorrect:number,roundTotal:number):{projectedHandicap:number;projectedOwgtr:number;movement:string} {
  if(roundTotal===0)return{projectedHandicap:profile.triviaHandicap,projectedOwgtr:profile.owgtr,movement:'none'};
  const pct=roundCorrect/roundTotal,expected=TIER_EXPECTED_PCT[profile.courseTier||'Intermediate']||0.55,diff=pct-expected;
  let hcpChange=0,owgtrChange=0;
  if(diff>0.15){hcpChange=-2;owgtrChange=75;}else if(diff>0.05){hcpChange=-1;owgtrChange=35;}
  else if(diff<-0.15){hcpChange=2;owgtrChange=-75;}else if(diff<-0.05){hcpChange=1;owgtrChange=-35;}
  return{projectedHandicap:Math.max(0,Math.min(36,profile.triviaHandicap+hcpChange)),projectedOwgtr:Math.max(100,profile.owgtr+owgtrChange),movement:hcpChange<0?'improved':hcpChange>0?'declined':'held'};
}

function getNextTuesdayNoon():Date {
  const now=new Date(),et=new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'})),day=et.getDay(),dtu=(2-day+7)%7||7,next=new Date(et);
  next.setDate(et.getDate()+dtu);next.setHours(12,0,0,0);return next;
}

// ─── CLUBS & COURSE ──────────────────────────────────────────────
const CLUBS:any={
  driver:{name:'Driver',yards:260,emoji:'🏌️'},wood3:{name:'3-Wood',yards:235,emoji:'🌲'},wood5:{name:'5-Wood',yards:215,emoji:'🌲'},
  hybrid4:{name:'4-Hybrid',yards:200,emoji:'🔧'},iron4:{name:'4-Iron',yards:185,emoji:'⛳'},iron5:{name:'5-Iron',yards:170,emoji:'⛳'},
  iron6:{name:'6-Iron',yards:160,emoji:'⛳'},iron7:{name:'7-Iron',yards:150,emoji:'⛳'},iron8:{name:'8-Iron',yards:140,emoji:'⛳'},
  iron9:{name:'9-Iron',yards:130,emoji:'⛳'},pw:{name:'Pitching Wedge',yards:115,emoji:'🪁'},gw:{name:'Gap Wedge',yards:100,emoji:'🪁'},
  sw:{name:'Sand Wedge',yards:80,emoji:'🏖️'},lw:{name:'Lob Wedge',yards:65,emoji:'🏖️'},wedge64:{name:'64° Wedge',yards:50,emoji:'🏖️'},
  putter:{name:'Putter',yards:0,emoji:'🏳️'},
};

const COURSE=[
  {number:1,par:4,yards:380,name:'Opening Drive',water:false,ob:false},{number:2,par:5,yards:530,name:'The Long Haul',water:true,ob:false},
  {number:3,par:4,yards:410,name:'Uphill Battle',water:false,ob:false},{number:4,par:3,yards:165,name:'Island Green',water:true,ob:false},
  {number:5,par:5,yards:555,name:'Back Nine Warm Up',water:false,ob:false},{number:6,par:4,yards:395,name:'Dogleg Left',water:false,ob:false},
  {number:7,par:3,yards:185,name:'Cliff Edge',water:true,ob:false},{number:8,par:4,yards:425,name:'The Gauntlet',water:false,ob:false},
  {number:9,par:5,yards:510,name:'Turn Home',water:true,ob:false},{number:10,par:4,yards:400,name:'Back Nine Opener',water:false,ob:false},
  {number:11,par:3,yards:170,name:'Short but Deadly',water:false,ob:false},{number:12,par:5,yards:545,name:'The Grind',water:true,ob:false},
  {number:13,par:4,yards:415,name:'Lucky 13',water:false,ob:false},{number:14,par:3,yards:155,name:'Postage Stamp',water:false,ob:false},
  {number:15,par:5,yards:560,name:'The Stretch',water:false,ob:false},{number:16,par:4,yards:390,name:'Risk and Reward',water:true,ob:false},
  {number:17,par:3,yards:195,name:'Island Breeze',water:true,ob:false},{number:18,par:5,yards:520,name:'Grand Finale',water:true,ob:false},
];

function getAvailableClubs(remaining:number):string[]{
  if(remaining>160)return['driver','wood3','wood5'];if(remaining>140)return['wood3','wood5','hybrid4'];
  if(remaining>120)return['hybrid4','iron4','iron5'];if(remaining>105)return['iron5','iron6','iron7'];
  if(remaining>90)return['iron7','iron8','iron9'];if(remaining>70)return['iron9','pw','gw'];
  if(remaining>50)return['pw','gw','sw'];if(remaining>35)return['gw','sw','lw'];return['sw','lw','wedge64'];
}
function getMultiplier(s:number){return s>=10?1.05:s>=5?0.9:s>0?0.75:0.65;}
function getBucket(r:number){return r>160?'Long Shot':r>120?'Long Approach':r>75?'Mid Approach':r>20?'Short Game':'Putting Range';}
function rand(min:number,max:number){return Math.floor(Math.random()*(max-min+1))+min;}
const WIND_DIRS=['N','NE','E','SE','S','SW','W','NW'];
const WIND_ARROWS:Record<string,string>={N:'↓',NE:'↙',E:'←',SE:'↖',S:'↑',SW:'↗',W:'→',NW:'↘'};
function generateWind():{speed:number;dir:string}{
  if(Math.random()<0.2)return{speed:0,dir:'N'};
  return{speed:rand(3,18),dir:WIND_DIRS[rand(0,WIND_DIRS.length-1)]};
}
function applyWind(clubYards:number,wind:{speed:number;dir:string}):number{
  if(wind.speed===0)return clubYards;
  let factor=0;
  if(['N'].includes(wind.dir))factor=-0.025*wind.speed;
  else if(['S'].includes(wind.dir))factor=0.022*wind.speed;
  else factor=-0.010*wind.speed;
  return Math.round(clubYards*(1+factor));
}
function calcShot(remaining:number,clubYards:number,correct:boolean,secondsLeft:number):{newRemaining:number;landNote:string;onGreen:boolean}{
  const shotDist=Math.round(clubYards*getMultiplier(secondsLeft)),raw=remaining-shotDist;
  if(!correct){
    if(raw<=0){const ft=rand(30,65);return{newRemaining:ft,landNote:`Mishit — ${ft} ft short`,onGreen:false};}
    if(raw<=30){const ft=rand(35,70);return{newRemaining:ft,landNote:`Chunked — ${ft} ft from hole`,onGreen:false};}
    const p=rand(12,28);return{newRemaining:raw+p,landNote:`${raw+p} yds remaining`,onGreen:false};
  }
  if(raw<=0){
    let ft:number,sn:string;
    if(secondsLeft>=10){ft=rand(3,8);sn='Great shot!';}
    else if(secondsLeft>=5){ft=rand(9,18);sn='On the green.';}
    else if(secondsLeft>0){ft=rand(19,30);sn='Got there.';}
    else{ft=rand(31,45);sn='Just made it.';}
    return{newRemaining:ft,landNote:`${sn} ${ft} ft from hole`,onGreen:true};
  }
  if(raw<=20){const ft=secondsLeft>=10?rand(8,15):secondsLeft>=5?rand(16,25):rand(26,40);return{newRemaining:ft,landNote:`Rolled up — ${ft} ft`,onGreen:true};}
  const v=rand(-8,8);return{newRemaining:Math.max(21,raw+v),landNote:`${Math.max(21,raw+v)} yds remaining`,onGreen:false};
}
function calcPenalty(remaining:number,clubKey:string,correct:boolean,secondsLeft:number,hole:{water?:boolean;ob?:boolean}):{penaltyStrokes:number;penaltyNote:string;newRemaining:number;newLie:string}|null{
  if(correct)return null;
  const long=['driver','wood3','wood5','hybrid4','iron4'],mid=['iron5','iron6','iron7','iron8','iron9'];
  const isLong=long.includes(clubKey),isMid=mid.includes(clubKey);
  let wc=0,oc=0,uc=0;
  if(isLong){wc=hole.water?0.28:0;oc=hole.ob?0.22:0;uc=0.15;}
  else if(isMid){wc=hole.water?0.15:0;oc=hole.ob?0.12:0;uc=0.10;}
  else{wc=hole.water?0.08:0;oc=hole.ob?0.06:0;uc=0.05;}
  if(secondsLeft<5){wc*=1.4;oc*=1.4;uc*=1.3;}if(secondsLeft===0){wc*=1.8;oc*=1.8;uc*=1.5;}
  const total=wc+oc+uc;if(Math.random()>total)return null;
  const hr=Math.random();
  if(hr<wc/total){const d=Math.min(remaining+rand(15,30),remaining+20);return{penaltyStrokes:1,penaltyNote:`🌊 Water! +1 stroke. ${d} yds remaining.`,newRemaining:d,newLie:'Rough'};}
  if(hr<(wc+oc)/total)return{penaltyStrokes:1,penaltyNote:`🚩 OB! +1 stroke. ${remaining} yds remaining.`,newRemaining:remaining,newLie:'Rough'};
  const d=remaining+rand(5,15);return{penaltyStrokes:1,penaltyNote:`😬 Unplayable! +1 stroke. ${d} yds remaining.`,newRemaining:d,newLie:'Rough'};
}
function getLie(correct:boolean,onGreen:boolean){
  if(onGreen)return correct?'Green':'Fringe';if(correct)return'Fairway';
  return['Rough','Bunker','Rough','Rough'][Math.floor(Math.random()*4)];
}
function getPuttResult(correct:boolean,secondsLeft:number):{feetLeft:number;note:string}{
  if(correct){let n='Putt drops!';if(secondsLeft>=10)n='Perfect read!';else if(secondsLeft>=5)n='Rattles in!';return{feetLeft:0,note:n};}
  const ft=rand(2,5),m=['Lipped out','Slid by','Wrong break','Hit back of cup'];
  return{feetLeft:ft,note:`${m[rand(0,m.length-1)]} — ${ft} ft left.`};
}
function scoreLabel(strokes:number,par:number){const d=strokes-par;if(d<=-2)return'Eagle 🦅';if(d===-1)return'Birdie 🐦';if(d===0)return'Par ✅';if(d===1)return'Bogey';if(d===2)return'Double Bogey';return`+${d} Over`;}
function totalLabel(diff:number){if(diff<0)return`${diff} Under Par 🔥`;if(diff===0)return'Even Par ✅';return`+${diff} Over Par`;}

// ─── PITTSBURGH QUESTIONS ─────────────────────────────────────────
const PITTSBURGH_QUESTIONS:any[]=[
  {cat:'Sports',text:'What color are the Pittsburgh Steelers helmets?',answers:['Red and white','Black and gold','Blue and silver','Green and gold'],correct:1},
  {cat:'Geography',text:'What two rivers meet near downtown Pittsburgh to form the Ohio River?',answers:['Susquehanna and Delaware','Allegheny and Monongahela','Yough and Turtle Creek','Ohio and Erie'],correct:1},
  {cat:'Food & Culture',text:'What famous amusement park is located in West Mifflin near east Allegheny County?',answers:['Hersheypark','Six Flags','Kennywood Park','Idlewild'],correct:2},
  {cat:'History & Landmarks',text:'What is the name of the famous steep cable railway on the south side of Pittsburgh?',answers:['The Skyway','Duquesne Incline','Pittsburgh Tram','Mon Valley Lift'],correct:1},
  {cat:'Sports',text:'What sport do the Pittsburgh Pirates play?',answers:['Football','Hockey','Baseball','Basketball'],correct:2},
  {cat:'Food & Culture',text:'What unusual items does Primanti Brothers stuff inside their sandwiches?',answers:['Pickles and mustard','Coleslaw and french fries','Cheese and bacon','Onions and peppers'],correct:1},
  {cat:'Geography',text:'What county is Irwin PA located in?',answers:['Allegheny','Butler','Westmoreland','Fayette'],correct:2},
  {cat:'History & Landmarks',text:'What is the name of Kennywood\'s famous wooden roller coaster?',answers:['Steel Curtain','The Phantom','The Racer','Jack Rabbit'],correct:3},
  {cat:'Geography',text:'What town in the 15642 zip code is sometimes called the Gateway to Westmoreland County?',answers:['Export','Murrysville','Irwin','North Huntingdon'],correct:2},
  {cat:'Sports',text:'What is the name of the Pittsburgh Penguins mascot?',answers:['Penguin Pete','Iceburgh','Chilly','Frosty'],correct:1},
  {cat:'Food & Culture',text:'What Pittsburgh dairy brand is famous for its Klondike bars and chipped ham?',answers:['Turkey Hill','Isaly\'s','Eat\'n Park','Giant Eagle'],correct:1},
  {cat:'History & Landmarks',text:'Kennywood has what special federal designation shared by very few amusement parks?',answers:['World Heritage Site','National Historic Landmark','State Park','Cultural District'],correct:1},
  {cat:'Sports',text:'The Pittsburgh Penguins won back-to-back Stanley Cups in which two years?',answers:['2012 and 2013','2014 and 2015','2016 and 2017','2018 and 2019'],correct:2},
  {cat:'History & Landmarks',text:'What industrialist\'s name does Westmoreland County honor?',answers:['Benjamin Franklin','George Westinghouse','Andrew Carnegie','Henry Clay Frick'],correct:1},
  {cat:'Geography',text:'What is the name of the big mall near Monroeville?',answers:['Ross Park Mall','South Hills Village','Monroeville Mall','Century III Mall'],correct:2},
  {cat:'Sports',text:'What is the current name of the stadium where the Pittsburgh Steelers play?',answers:['Three Rivers Stadium','PNC Park','Acrisure Stadium','PPG Paints Arena'],correct:2},
  {cat:'Geography',text:'What major highway runs through the 15642 area connecting Pittsburgh to the east?',answers:['US Route 22','US Route 30','PA Route 8','US Route 40'],correct:1},
  {cat:'Sports',text:'What jersey number does Sidney Crosby wear?',answers:['66','71','87','59'],correct:2},
  {cat:'History & Landmarks',text:'What famous trail passes through Westmoreland County for biking and hiking?',answers:['Appalachian Trail','Great Allegheny Passage','Pine Creek Rail Trail','Laurel Highlands Trail'],correct:1},
  {cat:'Food & Culture',text:'What Pittsburgh-made product involves thinly sliced luncheon meat?',answers:['Pittsburgh Steak','Chipped Ham','Pepperoni Rolls','Iron City Chips'],correct:1},
  {cat:'History & Landmarks',text:'What fort stood at the forks of the Ohio River during the French and Indian War?',answers:['Fort Necessity','Fort Ligonier','Fort Pitt','Fort Bedford'],correct:2},
  {cat:'Sports',text:'What Pittsburgh Steelers quarterback won four Super Bowls in the 1970s?',answers:['Ben Roethlisberger','Terry Bradshaw','Kordell Stewart','Neil O\'Donnell'],correct:1},
  {cat:'Nature & Parks',text:'What river in Westmoreland County is popular for white-water rafting?',answers:['Allegheny River','Monongahela River','Youghiogheny River','Beaver River'],correct:2},
  {cat:'Sports',text:'Who made the famous Immaculate Reception for the Steelers in 1972?',answers:['Lynn Swann','John Stallworth','Rocky Bleier','Franco Harris'],correct:3},
  {cat:'History & Landmarks',text:'What was the military road General Forbes built through Westmoreland County in 1758?',answers:['Braddock\'s Road','Forbes Road','Lincoln Highway','National Road'],correct:1},
  {cat:'Sports',text:'What year did PNC Park open as the new home of the Pittsburgh Pirates?',answers:['1999','2001','2003','1997'],correct:1},
  {cat:'History & Landmarks',text:'What catastrophic flood devastated Johnstown in 1889?',answers:['Susquehanna Flood','Johnstown Flood','Ohio Valley Flood','Conemaugh Flood'],correct:1},
  {cat:'Sports',text:'What Pittsburgh Steelers running back was nicknamed The Bus?',answers:['Franco Harris','Rocky Bleier','Jerome Bettis','Willie Parker'],correct:2},
  {cat:'Geography',text:'What is the county seat of Westmoreland County?',answers:['Latrobe','Greensburg','Connellsville','Jeannette'],correct:1},
  {cat:'Sports',text:'What arena did the Penguins play in before PPG Paints Arena?',answers:['Mellon Arena','Civic Arena','Pittsburgh Coliseum','The Dome'],correct:1},
  {cat:'History & Landmarks',text:'What massive steel company had major plants in Homestead, Duquesne, and Braddock?',answers:['Bethlehem Steel','U.S. Steel','Republic Steel','Armco Steel'],correct:1},
  {cat:'Food & Culture',text:'What Pittsburgh bakery is famous for its burnt almond torte?',answers:['Prantl\'s Bakery','Oakmont Bakery','Prestogeorge Coffee','La Gourmandine'],correct:0},
  {cat:'Nature & Parks',text:'What state park in Westmoreland County offers boating and a public beach?',answers:['Laurel Hill State Park','Keystone State Park','Ohiopyle State Park','Kooser State Park'],correct:1},
  {cat:'History & Landmarks',text:'What bloody 1892 labor battle took place at a steel mill just west of Westmoreland County?',answers:['Pullman Strike','Homestead Strike','Coal Strike of 1902','McKees Rocks Strike'],correct:1},
  {cat:'Geography',text:'What river does Turtle Creek ultimately flow into?',answers:['Allegheny River','Ohio River','Monongahela River','Youghiogheny River'],correct:2},
  {cat:'Food & Culture',text:'What Pittsburgh-area company made chipped ham and Klondike bars?',answers:['Eat\'n Park','Isaly\'s','Clark Bar Company','Pittsburgh Brewing'],correct:1},
  {cat:'Sports',text:'What was the name of Pittsburgh\'s baseball stadium before PNC Park?',answers:['Forbes Field','Three Rivers Stadium','Exposition Park','Mellon Arena'],correct:1},
  {cat:'History & Landmarks',text:'What beloved Pittsburgh department store was once on Fifth Avenue downtown?',answers:['Sears','Kaufmann\'s','JCPenney','Gimbels'],correct:1},
  {cat:'Geography',text:'What tunnel do Westmoreland County commuters pass through on the Parkway East?',answers:['Fort Pitt Tunnel','Liberty Tunnel','Squirrel Hill Tunnel','Allegheny Tunnel'],correct:2},
  {cat:'Sports',text:'What Pittsburgh Pirate died in a plane crash on New Year\'s Eve 1972?',answers:['Bill Mazeroski','Willie Stargell','Roberto Clemente','Dave Parker'],correct:2},
  {cat:'History & Landmarks',text:'What Pittsburgh-born pop artist grew up in the Oakland neighborhood?',answers:['Roy Lichtenstein','Andy Warhol','Keith Haring','Jasper Johns'],correct:1},
  {cat:'Food & Culture',text:'What Pittsburgh brewery produced Iron City Beer?',answers:['Duquesne Brewing','Pittsburgh Brewing Company','Penn Brewery','Straub Brewery'],correct:1},
  {cat:'Sports',text:'What was the nickname of the Steelers dominant defense of the 1970s?',answers:['The Iron Curtain','The Steel Curtain','The Black Wall','The Gold Defense'],correct:1},
  {cat:'Nature & Parks',text:'What fish is the Youghiogheny River most famous for among anglers?',answers:['Walleye','Catfish','Smallmouth Bass','Rainbow Trout'],correct:2},
  {cat:'Food & Culture',text:'What Westmoreland County arts festival celebrates the region\'s heritage each summer?',answers:['Ligonier Highland Games','Westmoreland Arts & Heritage Festival','Laurel Festival','Three Rivers Arts Festival'],correct:1},
  {cat:'Sports',text:'What year did the Pirates win their last World Series?',answers:['1971','1975','1979','1983'],correct:2},
  {cat:'Food & Culture',text:'What Westmoreland County town known as the Glass City was home to major glass manufacturers?',answers:['Latrobe','Connellsville','Monessen','Jeannette'],correct:3},
  {cat:'History & Landmarks',text:'What Revolutionary War-era fort in Westmoreland County played a key role in western PA defense?',answers:['Fort Necessity','Fort Pitt','Fort Ligonier','Fort Bedford'],correct:2},
  {cat:'Sports',text:'What Pittsburgh boxer nicknamed The Pittsburgh Kid famously fought Joe Louis?',answers:['Harry Greb','Fritzie Zivic','Billy Conn','Paul Spadafora'],correct:2},
];

const QUESTIONS:any={
  driver:[
    {text:'What is the maximum legal driver head size in cubic centimeters?',answers:['360cc','460cc','500cc','420cc'],correct:1},
    {text:'Which golfer holds the PGA Tour record for the longest drive at 515 yards?',answers:['John Daly','Bubba Watson','Mike Austin','Tiger Woods'],correct:2},
    {text:'What does "driving for show, putting for dough" mean?',answers:['Long drives win tournaments','Putting matters more than driving','Always use a driver','Driving is the hardest skill'],correct:1},
    {text:'What is a driver shot curving left to right for a right-hander called?',answers:['Hook','Draw','Slice','Fade'],correct:2},
    {text:'What is the legal maximum driver shaft length on the PGA Tour?',answers:['46 inches','48 inches','44 inches','50 inches'],correct:0},
    {text:'Bubba Watson is known for hitting what type of driver shot?',answers:['Straight bomb','Hard hook around corners','High fade over trees','Low punch draw'],correct:1},
    {text:'Which golfer famously said "grip it and rip it"?',answers:['Tiger Woods','Phil Mickelson','John Daly','Dustin Johnson'],correct:2},
  ],
  wood3:[
    {text:'When would a golfer choose a 3-wood over a driver off the tee?',answers:['More distance','Narrow holes needing accuracy','Par 3s only','Wind behind them'],correct:1},
    {text:'What loft range does a typical 3-wood have?',answers:['8-10 degrees','15-18 degrees','20-23 degrees','12-14 degrees'],correct:1},
    {text:'What does "hitting it off the deck" mean?',answers:['From a tee peg','Fairway wood from the ground','Out of a bunker','From a cart path'],correct:1},
    {text:'Which golfer is considered one of the best 3-wood players of all time?',answers:['Jack Nicklaus','Phil Mickelson','Seve Ballesteros','Gary Player'],correct:1},
  ],
  wood5:[
    {text:'A 5-wood is often used as an alternative to which iron?',answers:['3-iron','5-iron','2-iron','7-iron'],correct:0},
    {text:'What advantage does a 5-wood have over a long iron in the rough?',answers:['Goes shorter','Higher launch and more forgiveness','Lower ball flight','Less spin'],correct:1},
    {text:'What is the typical loft of a 5-wood?',answers:['12-14 degrees','18-19 degrees','20-22 degrees','25-27 degrees'],correct:2},
    {text:'Why do senior golfers prefer a 5-wood over a 3-iron?',answers:['Goes shorter','Easier to launch high with slower swing speeds','It is lighter','Rules require it'],correct:1},
  ],
  hybrid4:[
    {text:'Hybrid clubs were designed to replace which difficult clubs?',answers:['Short irons','Long irons and fairway woods','Wedges','Putters'],correct:1},
    {text:'What is the main advantage of a hybrid over a long iron?',answers:['Lower center of gravity for easier launch','More distance always','Smaller clubface','Heavier head'],correct:0},
    {text:'A 4-hybrid typically replaces which iron?',answers:['2-iron','6-iron','4-iron','8-iron'],correct:2},
    {text:'What lie is a hybrid especially useful from?',answers:['Tight fairway only','Thick rough where irons snag','Bunkers only','Fringe only'],correct:1},
  ],
  iron4:[
    {text:'What is the typical loft of a 4-iron?',answers:['18-20 degrees','24-27 degrees','30-34 degrees','40 degrees'],correct:1},
    {text:'Why is the 4-iron hard for amateurs?',answers:['Too short','Low loft makes it hard to get airborne','Too light','Shaft too flexible'],correct:1},
    {text:'Which golfer was nicknamed "The Iron Byron"?',answers:['Byron Nelson','Ben Hogan','Sam Snead','Arnold Palmer'],correct:0},
    {text:'What is a "stinger" shot hit with a 4-iron?',answers:['High-launching power shot','Low penetrating shot under wind','Bunker shot','Flop shot'],correct:1},
  ],
  iron5:[
    {text:'Approximate carry distance of a 5-iron for a PGA Tour pro?',answers:['150 yards','195 yards','220 yards','170 yards'],correct:1},
    {text:'What does "taking a divot" indicate?',answers:['A mistake','Ball-first contact compressing properly','Hitting too hard','Hitting from sand'],correct:1},
    {text:'Which Hall of Famer won 18 majors known for precise mid-iron play?',answers:['Arnold Palmer','Gary Player','Jack Nicklaus','Tom Watson'],correct:2},
    {text:'Proper ball position for a 5-iron?',answers:['Off back foot','Center of stance','Slightly forward of center','Off front heel'],correct:2},
  ],
  iron6:[
    {text:'What does "working the ball" mean?',answers:['Practicing on range','Intentionally shaping shots left or right','Hitting only straight','Extra spin on putts'],correct:1},
    {text:'A 6-iron is classified as what type of iron?',answers:['Long iron','Short iron','Mid iron','Wedge'],correct:2},
    {text:'What does AoA stand for in iron fitting?',answers:['Angle of Attack','Accuracy of Alignment','Axis of Approach','Arc of Arc'],correct:0},
    {text:'What is "compression" when hitting an iron?',answers:['How hard you grip','Trapping ball between clubface and ground','Club weight','Sound ball makes'],correct:1},
  ],
  iron7:[
    {text:'Approximate loft of a 7-iron?',answers:['25 degrees','34 degrees','42 degrees','20 degrees'],correct:1},
    {text:'What is a "punch shot" with a 7-iron?',answers:['High flop shot','Low-trajectory shot under wind','Full swing power','Chip from fringe'],correct:1},
    {text:'Why is a 7-iron recommended for beginners?',answers:['Goes farthest','Mid-loft makes it most forgiving','Shortest club','Rules require it'],correct:1},
    {text:"Rory McIlroy's average 7-iron distance?",answers:['155 yards','185 yards','205 yards','170 yards'],correct:1},
  ],
  iron8:[
    {text:'Approximate loft of an 8-iron?',answers:['28 degrees','37-39 degrees','45 degrees','22 degrees'],correct:1},
    {text:'What does "hitting it fat" mean?',answers:['Hitting too far','Hitting ground before ball','Too high','Too much speed'],correct:1},
    {text:'Which iron player was known as "The Mechanic"?',answers:['Sam Snead','Moe Norman','Chi Chi Rodriguez','Billy Casper'],correct:1},
    {text:'On a downhill lie with an 8-iron, what adjustment?',answers:['Aim further left','Club down — hill reduces loft','Swing harder','Move ball back, expect lower flight'],correct:3},
  ],
  iron9:[
    {text:'Primary use of a 9-iron?',answers:['Long par 5 seconds','Short approaches inside 130 yards','Long par 3 tees','Thick rough only'],correct:1},
    {text:'What does "hitting it thin" mean?',answers:['Ball went left','Clubface hit above center — low screamer','Perfect shot','Ball landed soft'],correct:1},
    {text:'Typical spin rate of a 9-iron on Tour?',answers:['3,000 rpm','8,500 rpm','12,000 rpm','6,000 rpm'],correct:2},
    {text:'What causes backspin on a 9-iron?',answers:['Forward roll after landing','Grooves gripping ball at impact','Wind effect','Ball hitting slope'],correct:1},
  ],
  pw:[
    {text:'Typical loft of a pitching wedge?',answers:['35 degrees','44-48 degrees','56 degrees','60 degrees'],correct:1},
    {text:'What is a "knockdown" pitching wedge shot?',answers:['Full swing','Controlled half-swing, low ball flight','Flop shot','Bump and run'],correct:1},
    {text:'Purpose of grooves on a pitching wedge?',answers:['Decoration','Create friction for backspin','Make club lighter','Help aim'],correct:1},
    {text:'When do Tour pros switch from PW to gap wedge?',answers:['Over 160 yards','Under 100 yards','Around 130-140 yards','Under 50 yards'],correct:2},
  ],
  gw:[
    {text:'What does "gap wedge" fill?',answers:['Space between bunkers','Distance gap between PW and SW','A putting wedge','Wind-only wedge'],correct:1},
    {text:'What is a "bump and run" with a gap wedge?',answers:['High flop','Low shot, lands short and rolls to hole','Bunker blast','Full swing'],correct:1},
    {text:'What is "distance gapping" with wedges?',answers:['How far you stand','Consistent yardage gaps between wedges','Aiming from bunkers','Stance width'],correct:1},
    {text:'Typical loft of a gap wedge?',answers:['44 degrees','50-52 degrees','56 degrees','60 degrees'],correct:1},
  ],
  sw:[
    {text:'Who invented the sand wedge in the early 1930s?',answers:['Arnold Palmer','Gene Sarazen','Bobby Jones','Walter Hagen'],correct:1},
    {text:'What is "bounce" on a sand wedge?',answers:['How high ball bounces','Angle of sole preventing digging into sand','Shaft flex','Carry distance'],correct:1},
    {text:'Proper greenside bunker technique?',answers:['Hit ball directly','Open face, aim left, splash sand 2 inches behind ball','Putting stroke','Hit down hard'],correct:1},
    {text:'What is a "plugged lie" in a bunker?',answers:['Ball rolled to flag','Ball buried deep like fried egg','Unplayable in water','Ball on top of sand'],correct:1},
  ],
  lw:[
    {text:'What is a "flop shot"?',answers:['Low running chip','High soft shot that lands and stops','Bump and run','Full swing punch'],correct:1},
    {text:'Typical loft of a lob wedge?',answers:['50-52 degrees','54-56 degrees','58-64 degrees','44-48 degrees'],correct:2},
    {text:'When is a lob wedge preferred over a sand wedge?',answers:['From 150 yards','Maximum height with minimal roll near pin','Fairway bunkers only','Into the wind'],correct:1},
    {text:'Which Tour pro is known for creative lob wedge shots in majors?',answers:['Tiger Woods','Jack Nicklaus','Phil Mickelson','Seve Ballesteros'],correct:2},
  ],
  wedge64:[
    {text:'Main use of a 64-degree wedge?',answers:['Long approaches','Ultra-high soft shots from tight lies','Short par 3 tees','Putting from off green'],correct:1},
    {text:'Who popularized extreme high-lofted wedge shots on Tour?',answers:['Tiger Woods','Phil Mickelson','Vijay Singh','Ernie Els'],correct:1},
    {text:'Why do fitters caution against a 64-degree wedge?',answers:['Illegal in competition','Distance overlap makes it redundant for most','Too expensive','Only works on soft courses'],correct:1},
    {text:'What does "grind" mean on a specialty wedge?',answers:['Practicing chips','Material removed from sole to customize bounce','How rusty it is','Hitting from hard ground'],correct:1},
  ],
  putter:[
    {text:'What does "reading the green" mean?',answers:['Looking at course map','Studying slope and speed to predict roll','Reading pin placement sheet','Measuring distance to hole'],correct:1},
    {text:'Which golfer holds the record for most career PGA Tour wins?',answers:['Tiger Woods','Jack Nicklaus','Sam Snead','Ben Hogan'],correct:2},
    {text:'What is a "yip" in putting?',answers:['A perfect putt','Involuntary muscle spasm ruining the stroke','A long putt made','A putting technique'],correct:1},
    {text:'Jack Nicklaus won how many majors?',answers:['14','16','18','15'],correct:2},
    {text:'What tool measures green speed?',answers:['GPS device','Stimpmeter — ramp rolling a ball','A ruler','A golf ball'],correct:1},
    {text:'Which holes at Augusta are "Amen Corner"?',answers:['Holes 1-3','Holes 11-13','Holes 15-17','Holes 16-18'],correct:1},
    {text:'What is a "lag putt"?',answers:['Putt you expect to make','Long putt aimed to get close not make','Putt hit too hard','Short tap-in'],correct:1},
    {text:'What does "plumb bobbing" mean?',answers:['Measuring hole depth','Holding putter vertically to read slope','A grip type','A warm-up technique'],correct:1},
  ],
};

function getProfilePool(profile:Profile|null):any[]{
  const allGolf=Object.values(QUESTIONS).flat() as any[];
  const sbr=profile?.sbr||1000;
  const easyPool=sbr<950?easyQuestions.filter((q:any)=>q.difficulty==='easy'):sbr<1200?easyQuestions:[];
  if(!profile||!profile.questionnaire)return[...allGolf,...easyPool];
  const q=profile.questionnaire;
  let pool:any[]=[...allGolf];
  if(q.q4==='Sports & Athletics')pool=[...pool,...PITTSBURGH_QUESTIONS.filter((x:any)=>x.cat==='Sports')];
  if(q.q4==='History & Geography')pool=[...pool,...PITTSBURGH_QUESTIONS.filter((x:any)=>x.cat==='History & Landmarks'||x.cat==='Geography')];
  if(q.q4==='Pop Culture & Entertainment')pool=[...pool,...PITTSBURGH_QUESTIONS.filter((x:any)=>x.cat==='Food & Culture')];
  if(q.q6==='Gaming / Technology / Movies & TV')pool=[...pool,...corbQuestions.filter((x:any)=>x.cat==='90s Wrestling'||x.cat==='Monster Squad'||x.cat==='Sidney Sweeney')];
  if(q.q6==='Fitness / Outdoor sports / Hunting & Fishing')pool=[...pool,...PITTSBURGH_QUESTIONS.filter((x:any)=>x.cat==='Nature & Parks'||x.cat==='Sports')];
  if(q.q6==='Music / Art / Food & Cooking')pool=[...pool,...PITTSBURGH_QUESTIONS.filter((x:any)=>x.cat==='Food & Culture')];
  if(q.q8==='Football (NFL / College)')pool=[...pool,...PITTSBURGH_QUESTIONS.filter((x:any)=>x.cat==='Sports')];
  if(q.q8==='Baseball / Hockey / Basketball')pool=[...pool,...PITTSBURGH_QUESTIONS.filter((x:any)=>x.cat==='Sports')];
  if(q.q8==='Combat sports / Motorsports / Extreme sports')pool=[...pool,...corbQuestions.filter((x:any)=>x.cat==='90s Wrestling'||x.cat==='Charles Barkley')];
  if(q.q5==='Northeast (PA, NY, NJ, New England)')pool=[...pool,...PITTSBURGH_QUESTIONS];
  if(profile.favCats?.includes('Wrestling'))pool=[...pool,...corbQuestions.filter((x:any)=>x.cat==='90s Wrestling')];
  if(profile.favCats?.includes('Sidney Sweeney'))pool=[...pool,...corbQuestions.filter((x:any)=>x.cat==='Sidney Sweeney')];
  if(profile.favCats?.includes('Monster Squad'))pool=[...pool,...corbQuestions.filter((x:any)=>x.cat==='Monster Squad')];
  if(profile.favCats?.includes('Charles Barkley'))pool=[...pool,...corbQuestions.filter((x:any)=>x.cat==='Charles Barkley')];
  if(profile.favCats?.includes('East Pittsburgh'))pool=[...pool,...corbQuestions.filter((x:any)=>x.cat==='East Pittsburgh')];
  if(profile.favCats?.includes('Pittsburgh'))pool=[...pool,...PITTSBURGH_QUESTIONS];
  if(profile.favCats?.includes('Golf'))pool=[...pool,...allGolf];
  return[...pool,...easyPool];
}

const SPONSOR_NAME='Your Brand';

// ─── HOLE GRAPHIC ─────────────────────────────────────────────────
function HoleGraphic({holeYards,remaining,lie,par,strokes,scorecard,playerName,activePlayers,multiScores,multiHoleIdx,isMulti}:{
  holeYards:number;remaining:number;lie:string;par:number;strokes:number;
  scorecard:number[];playerName:string;activePlayers?:string[];multiScores?:number[][];multiHoleIdx?:number;isMulti?:boolean;
}){
  const W=320,H=140;
  const currentPar=COURSE.slice(0,scorecard.length).reduce((s,h)=>s+h.par,0);
  const scoreToPar=scorecard.reduce((a,b)=>a+b,0)+strokes-currentPar-par;
  const scoreStr=scoreToPar<0?`${scoreToPar}`:scoreToPar===0?'E':`+${scoreToPar}`;
  const scoreColor=scoreToPar<0?'#c8a84b':scoreToPar===0?'#ffffff':'#c0392b';
  const progress=remaining<=0?1:1-remaining/holeYards;
  const teeX=22,greenX=278,centerY=70;
  const ballX=teeX+(greenX-teeX)*Math.min(progress,lie==='Holed'?1:0.94);
  const ballY=lie==='Green'||lie==='Fringe'?centerY:lie==='Bunker'?centerY+16:lie==='Rough'?(ballX%3===0?centerY-16:centerY+16):centerY;
  const leaders:{name:string;total:number}[]=isMulti&&activePlayers&&multiScores?activePlayers.map((n,i)=>({name:n,total:(multiScores[i]||[]).reduce((a,b)=>a+b,0)})).sort((a,b)=>a.total-b.total):[];
  const soloDiff=scorecard.reduce((a,b)=>a+b,0)-COURSE.slice(0,scorecard.length).reduce((s,h)=>s+h.par,0);
  const toGoStr=remaining>20?`${remaining}y`:remaining>0?`${remaining}ft`:'–';
  const lieStr=lie==='Tee Box'?'TEE':lie==='Fairway'?'FAIRWAY':lie==='Green'?'GREEN':lie==='Fringe'?'FRINGE':lie==='Bunker'?'BUNKER':lie==='Rough'?'ROUGH':lie==='Holed'?'HOLED':lie.toUpperCase();
  return(
    <svg width={W} height={H} style={{display:'block',margin:'0 auto 14px',borderRadius:10,overflow:'hidden'}}>
      <rect width={W} height={H} fill="#061008"/>
      <rect x="0" y="15" width={W} height="32" fill="#0d1f0b"/>
      <rect x="0" y="93" width={W} height="32" fill="#0d1f0b"/>
      <path d="M 22 50 C 60 48 120 47 180 49 C 230 51 262 52 278 51 L 278 89 C 262 88 230 89 180 91 C 120 93 60 92 22 90 Z" fill="#276620"/>
      <rect x="18" y="58" width="16" height="24" rx="2" fill="#2e7a22"/>
      <ellipse cx="289" cy={centerY} rx="26" ry="21" fill="#248f24"/>
      <ellipse cx="289" cy="65" rx="18" ry="7" fill="#32cc32" opacity="0.35"/>
      <line x1="289" y1="57" x2="289" y2="34" stroke="#c8c8c8" strokeWidth="1.5"/>
      <path d="M 290 34 L 306 39 L 306 48 L 290 48 Z" fill="#c8a84b"/>
      <ellipse cx="289" cy="68" rx="3.5" ry="2.5" fill="#030806"/>
      {progress>0.05&&progress<0.97&&<path d={`M ${teeX+12} ${centerY} C ${teeX+60} ${centerY-4} ${ballX-40} ${ballY-4} ${ballX} ${ballY}`} fill="none" stroke="rgba(200,168,75,0.35)" strokeWidth="1.4" strokeDasharray="5,5"/>}
      {lie!=='Holed'&&<><circle cx={ballX} cy={ballY} r="6" fill="#f8f8f8" stroke="#1a1a1a" strokeWidth="1"/><circle cx={ballX-2} cy={ballY-2} r="2.2" fill="rgba(255,255,255,0.7)"/></>}
      {lie==='Holed'&&<text x="289" y={centerY+4} textAnchor="middle" fontSize={12} fill="#c8a84b">⛳</text>}
      <rect x="0" y="0" width={W} height="15" fill="rgba(0,0,0,0.88)"/>
      <text x="7" y="10" fontSize={7} fill="#c8a84b" fontFamily="Georgia,serif">HOLE {COURSE[scorecard.length]?.number||'—'}</text>
      <text x="46" y="10" fontSize={7} fill="rgba(255,255,255,0.4)" fontFamily="Georgia,serif">PAR {par}</text>
      <text x="77" y="10" fontSize={6.5} fill="rgba(255,255,255,0.35)" fontFamily="Georgia,serif">YDS {holeYards}</text>
      <text x="117" y="10" fontSize={6.5} fill="rgba(255,255,255,0.35)" fontFamily="Georgia,serif">TO GO</text>
      <text x="144" y="10" fontSize={7} fill="#c8a84b" fontFamily="Georgia,serif">{toGoStr}</text>
      <text x="169" y="10" fontSize={6.5} fill="rgba(255,255,255,0.35)" fontFamily="Georgia,serif">SCORE</text>
      <text x="198" y="10" fontSize={7} fill={scoreColor} fontFamily="Georgia,serif">{scoreStr}</text>
      <text x="215" y="10" fontSize={6.5} fill="rgba(255,255,255,0.35)" fontFamily="Georgia,serif">{lieStr}</text>
      <rect x="0" y="125" width={W} height="15" fill="rgba(0,0,0,0.92)"/>
      <rect x="0" y="125" width="60" height="15" fill="#c8a84b"/>
      <text x="4" y="135" fontSize={6.5} fill="#061008" fontFamily="Georgia,serif">LEADERBOARD</text>
      {isMulti&&leaders.slice(0,4).map((p,i)=>{const holesPar=COURSE.slice(0,multiHoleIdx||0).reduce((s,h)=>s+h.par,0);const diff=p.total-holesPar;const col=diff<0?'#c8a84b':diff===0?'rgba(255,255,255,0.7)':'#c0392b';const diffStr=diff<0?`${diff}`:diff===0?'E':`+${diff}`;const x=64+i*36;return <g key={p.name}><text x={x} y="133" fontSize={6} fill={i===0?'#c8a84b':'rgba(255,255,255,0.55)'} fontFamily="Georgia,serif">{i+1}.{p.name.slice(0,5)}</text><text x={x} y="139" fontSize={6.5} fill={col} fontFamily="Georgia,serif">{diffStr}</text></g>;})}
      {!isMulti&&scorecard.length>0&&<><text x="64" y="133" fontSize={6} fill="rgba(255,255,255,0.55)" fontFamily="Georgia,serif">{playerName.slice(0,8)}</text><text x="64" y="139" fontSize={6.5} fill={soloDiff<0?'#c8a84b':soloDiff===0?'#ffffff':'#c0392b'} fontFamily="Georgia,serif">{soloDiff<0?soloDiff:soloDiff===0?'E':`+${soloDiff}`}</text></>}
      <text x="317" y="139" textAnchor="end" fontSize={7} fill="#c8a84b" fontFamily="Georgia,serif" fontStyle="italic">{SPONSOR_NAME}</text>
    </svg>
  );
}

// ─── CALIBRATION SCREEN ───────────────────────────────────────────
function CalibrationScreen({onComplete}:{onComplete:(sbIndex:number)=>void}){
  const [idx,setIdx]=useState(0);
  const [picked,setPicked]=useState<number|null>(null);
  const [correct,setCorrect]=useState(0);
  const [timeLeft,setTimeLeft]=useState(20);
  const [times,setTimes]=useState<number[]>([]);
  const [startTime,setStartTime]=useState(Date.now());
  const q=CALIBRATION_QUESTIONS[idx];
  useEffect(()=>{
    if(picked!==null)return;
    setTimeLeft(20);setStartTime(Date.now());
    const t=setInterval(()=>setTimeLeft(n=>{if(n<=1){clearInterval(t);handleAnswer(-1);return 0;}return n-1;}),1000);
    return()=>clearInterval(t);
  },[idx]);
  function handleAnswer(i:number){
    if(picked!==null)return;
    const elapsed=(Date.now()-startTime)/1000;
    const newTimes=[...times,elapsed];setTimes(newTimes);
    const isCorrect=i===q.correct;setPicked(i);
    const newCorrect=isCorrect?correct+1:correct;if(isCorrect)setCorrect(newCorrect);
    setTimeout(()=>{
      if(idx+1>=CALIBRATION_QUESTIONS.length){
        const avg=newTimes.reduce((a,b)=>a+b,0)/newTimes.length;
        onComplete(calcSBIndex(newCorrect,CALIBRATION_QUESTIONS.length,avg));
      }else{setPicked(null);setIdx(i=>i+1);}
    },1200);
  }
  return(
    <div className="screen center">
      <p style={{fontSize:'0.65rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:8}}>Calibration · {idx+1}/{CALIBRATION_QUESTIONS.length}</p>
      <div style={{height:3,background:'var(--border)',borderRadius:2,marginBottom:20,width:'100%',maxWidth:340,overflow:'hidden'}}>
        <div style={{height:'100%',background:'var(--gold)',width:`${((idx+1)/CALIBRATION_QUESTIONS.length)*100}%`,transition:'width 0.3s'}}/>
      </div>
      <div className="timer-wrap" style={{marginBottom:12}}>
        <div className={`timer-bar ${timeLeft<=5?'danger':''}`} style={{width:`${(timeLeft/20)*100}%`}}/>
        <span className={`timer-label ${timeLeft<=5?'danger':''}`}>{timeLeft}s</span>
      </div>
      <div className="card">
        <p className="q-text">{q.text}</p>
        <div className="answers">
          {q.answers.map((a:string,i:number)=>{
            let cls='ans';if(picked!==null&&i===q.correct)cls+=' correct';else if(picked===i)cls+=' wrong';
            return<button key={i} className={cls} onClick={()=>handleAnswer(i)} disabled={picked!==null}><span className="ans-letter">{String.fromCharCode(65+i)}</span>{a}</button>;
          })}
        </div>
      </div>
    </div>
  );
}

// ─── PROFILE PICKER ───────────────────────────────────────────────
function ProfilePickerScreen({onSelect,onNew,onBack}:{onSelect:(p:Profile)=>void;onNew:()=>void;onBack:()=>void}){
  const profiles=loadProfiles();
  const names=Object.keys(profiles);
  const [pinTarget,setPinTarget]=useState<string|null>(null);
  const [pinInput,setPinInput]=useState('');
  const [pinError,setPinError]=useState('');

  function attemptSelect(name:string){
    const p=profiles[name];
    if(p.pin){setPinTarget(name);setPinInput('');setPinError('');}
    else{saveActiveProfileName(name);onSelect(p);}
  }
  function confirmPin(){
    if(!pinTarget)return;
    const p=profiles[pinTarget];
    if(pinInput===p.pin){saveActiveProfileName(pinTarget);onSelect(p);}
    else setPinError('Wrong PIN — try again');
  }

  if(pinTarget){
    if(pinTarget==='__find__')return(
      <div className="screen center">
        <div style={{width:60,height:60,borderRadius:'50%',border:'2px solid var(--gold)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.6rem',marginBottom:16,background:'radial-gradient(circle,#1a2e20 0%,var(--bg) 100%)'}}>🔍</div>
        <h2 style={{fontFamily:'Georgia,serif',color:'var(--gold)',marginBottom:4}}>Find My Profile</h2>
        <p style={{fontSize:'0.72rem',color:'var(--muted)',marginBottom:24}}>Enter your name and PIN</p>
        <input placeholder="Your Name" value={pinInput} onChange={e=>setPinInput(e.target.value)}
          style={{background:'transparent',border:'none',borderBottom:'1px solid var(--gold)',color:'var(--text)',padding:'10px 8px',fontFamily:'Georgia,serif',fontSize:'1rem',textAlign:'center',outline:'none',marginBottom:16,width:'100%',maxWidth:280}}/>
        <input type="password" maxLength={4} placeholder="4-digit PIN" value={pinError} onChange={e=>setPinError(e.target.value.replace(/\D/g,'').slice(0,4))}
          style={{background:'transparent',border:'none',borderBottom:'1px solid var(--gold)',color:'var(--text)',padding:'10px 8px',fontFamily:'Georgia,serif',fontSize:'1.4rem',textAlign:'center',outline:'none',marginBottom:16,width:'100%',maxWidth:200,letterSpacing:'8px'}}/>
        <button className="btn" style={{width:'100%',maxWidth:280,marginBottom:10}} onClick={async()=>{
          const found=await cloudLoadProfile(pinInput.trim(),pinError.trim());
          if(!found){setPinInput('');setPinError('');alert('Name or PIN not found');return;}
          saveProfile(found);onSelect(found);
        }} disabled={!pinInput.trim()||pinError.length!==4}>Find Profile →</button>
        <button onClick={()=>{setPinTarget(null);}} style={{background:'transparent',border:'none',color:'var(--muted)',fontFamily:'Georgia,serif',fontSize:'0.8rem',cursor:'pointer'}}>← Back</button>
      </div>
    );
    return(
      <div className="screen center">
        <div style={{width:60,height:60,borderRadius:'50%',border:'2px solid var(--gold)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.6rem',marginBottom:16,background:'radial-gradient(circle,#1a2e20 0%,var(--bg) 100%)'}}>🔒</div>
        <h2 style={{fontFamily:'Georgia,serif',color:'var(--gold)',marginBottom:4}}>{pinTarget}</h2>
        <p style={{fontSize:'0.72rem',color:'var(--muted)',marginBottom:24}}>Enter your PIN to continue</p>
        <input type="password" maxLength={4} placeholder="4-digit PIN" value={pinInput} onChange={e=>setPinInput(e.target.value.replace(/\D/g,'').slice(0,4))}
          style={{background:'transparent',border:'none',borderBottom:'1px solid var(--gold)',color:'var(--text)',padding:'10px 8px',fontFamily:'Georgia,serif',fontSize:'1.4rem',textAlign:'center',outline:'none',marginBottom:16,width:'100%',maxWidth:200,letterSpacing:'8px'}}/>
        {pinError&&<p style={{color:'var(--red)',fontSize:'0.78rem',marginBottom:12}}>{pinError}</p>}
        <button className="btn" style={{width:'100%',maxWidth:280,marginBottom:10}} onClick={confirmPin} disabled={pinInput.length!==4}>Enter →</button>
        <button onClick={()=>{setPinTarget(null);setPinError('');}} style={{background:'transparent',border:'none',color:'var(--muted)',fontFamily:'Georgia,serif',fontSize:'0.8rem',cursor:'pointer'}}>← Back</button>
      </div>
    );
  }

  return(
    <div className="screen center">
      <div style={{width:60,height:60,borderRadius:'50%',border:'2px solid var(--gold)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.6rem',marginBottom:16,background:'radial-gradient(circle,#1a2e20 0%,var(--bg) 100%)'}}>👥</div>
      <h2 style={{fontFamily:'Georgia,serif',color:'var(--gold)',marginBottom:4}}>Who's Playing?</h2>
      <p style={{fontSize:'0.72rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:24}}>Select or create a profile</p>
      <div style={{width:'100%',maxWidth:300,display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
        {names.length===0&&<p style={{color:'var(--muted)',textAlign:'center',fontSize:'0.88rem',marginBottom:8}}>No saved players yet.</p>}
        {names.map(name=>{
          const p=profiles[name];
          return(
            <button key={name} onClick={()=>attemptSelect(name)} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer'}}>
              <div style={{textAlign:'left'}}>
                <div style={{fontFamily:'Georgia,serif',color:'var(--gold)',fontSize:'1rem'}}>{name}</div>
                <div style={{fontSize:'0.7rem',color:'var(--muted)',marginTop:2}}>
                  {p.division?`🏫 ${p.division}`:p.courseTier?`📍 ${p.courseTier} Tee`:'No tier set'}
                  {p.calibrated?` · SBI ${p.sbIndex?.toFixed(1)}`:''}
                </div>
              </div>
              <div style={{fontSize:'0.75rem',color:'var(--muted)'}}>{p.pin?'🔒':'→'}</div>
            </button>
          );
        })}
      </div>
      <button className="btn" style={{width:'100%',maxWidth:300,marginBottom:10,background:'var(--gold)',color:'var(--bg)',border:'none'}} onClick={onNew}>+ Create New Player</button>
<button onClick={()=>setPinTarget('__find__')} style={{width:'100%',maxWidth:300,background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',padding:'11px',borderRadius:8,fontFamily:'Georgia,serif',fontSize:'0.82rem',cursor:'pointer',marginBottom:10}}>🔍 Find My Profile</button>
<button onClick={onBack} style={{background:'transparent',border:'none',color:'var(--muted)',fontFamily:'Georgia,serif',fontSize:'0.8rem',cursor:'pointer'}}>← Back</button>
    </div>
  );
}

// ─── QUESTIONNAIRE SCREEN ─────────────────────────────────────────
function QuestionnaireScreen({onComplete,onSkip,existing}:{onComplete:(q:Questionnaire)=>void;onSkip:()=>void;existing?:Questionnaire|null}){
  const blank:Questionnaire={q1:'',q2:'',q3:'',q4:'',q5:'',q6:'',q7:'',q8:'',q9:'',q10:''};
  const [answers,setAnswers]=useState<Questionnaire>(existing||blank);
  const [step,setStep]=useState(0);
  const current=QUESTIONS_Q[step];
  const currentKey=current.id as keyof Questionnaire;
  const answered=answers[currentKey]!=='';
  const allDone=Object.values(answers).every(v=>v!=='');
  function selectOption(opt:string){setAnswers(prev=>({...prev,[currentKey]:opt}));}
  function next(){if(step<QUESTIONS_Q.length-1)setStep(s=>s+1);}
  function prev(){if(step>0)setStep(s=>s-1);}
  return(
    <div className="screen center" style={{gap:0}}>
      <div style={{width:'100%',maxWidth:340}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
          <p style={{fontSize:'0.65rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)'}}>Interest Profile</p>
          <p style={{fontSize:'0.65rem',color:'var(--muted)'}}>{step+1} / {QUESTIONS_Q.length}</p>
        </div>
        <div style={{height:3,background:'var(--border)',borderRadius:2,marginBottom:24,overflow:'hidden'}}>
          <div style={{height:'100%',background:'var(--gold)',borderRadius:2,width:`${((step+1)/QUESTIONS_Q.length)*100}%`,transition:'width 0.3s'}}/>
        </div>
        <p style={{fontFamily:'Georgia,serif',fontSize:'1.05rem',color:'var(--text)',marginBottom:20,lineHeight:1.5}}>{current.question}</p>
        <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:24}}>
          {current.options.map(opt=>(
            <button key={opt} onClick={()=>selectOption(opt)} style={{background:answers[currentKey]===opt?'rgba(200,168,75,0.15)':'var(--surface)',border:`1px solid ${answers[currentKey]===opt?'var(--gold)':'var(--border)'}`,color:answers[currentKey]===opt?'var(--gold)':'var(--text)',padding:'12px 16px',borderRadius:8,fontFamily:'Georgia,serif',fontSize:'0.88rem',textAlign:'left',cursor:'pointer',display:'flex',alignItems:'center',gap:10}}>
              <span style={{width:18,height:18,borderRadius:'50%',flexShrink:0,border:`2px solid ${answers[currentKey]===opt?'var(--gold)':'var(--border)'}`,background:answers[currentKey]===opt?'var(--gold)':'transparent',display:'flex',alignItems:'center',justifyContent:'center'}}>
                {answers[currentKey]===opt&&<span style={{width:6,height:6,borderRadius:'50%',background:'var(--bg)'}}/>}
              </span>
              {opt}
            </button>
          ))}
        </div>
        <div style={{display:'flex',gap:10}}>
          {step>0&&<button onClick={prev} style={{flex:1,background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',padding:'11px',borderRadius:8,fontFamily:'Georgia,serif',fontSize:'0.85rem',cursor:'pointer'}}>← Back</button>}
          {step<QUESTIONS_Q.length-1
            ?<button onClick={next} disabled={!answered} style={{flex:2,background:answered?'var(--green)':'var(--surface)',border:'none',color:answered?'#fff':'var(--muted)',padding:'11px',borderRadius:8,fontFamily:'Georgia,serif',fontSize:'0.85rem',cursor:answered?'pointer':'default'}}>Next →</button>
            :<button onClick={()=>{if(allDone)onComplete(answers);}} disabled={!allDone} style={{flex:2,background:allDone?'var(--gold)':'var(--surface)',border:'none',color:allDone?'var(--bg)':'var(--muted)',padding:'11px',borderRadius:8,fontFamily:'Georgia,serif',fontSize:'0.85rem',fontWeight:'bold',cursor:allDone?'pointer':'default'}}>Build My Profile ⛳</button>
          }
        </div>
        <button onClick={onSkip} style={{width:'100%',background:'transparent',border:'none',color:'var(--border)',fontFamily:'Georgia,serif',fontSize:'0.75rem',cursor:'pointer',marginTop:16}}>Skip for now</button>
      </div>
    </div>
  );
}

// ─── PROFILE SCREEN ───────────────────────────────────────────────
function ProfileScreen({onBack,onSwitchPlayer}:{onBack:()=>void;onSwitchPlayer:()=>void}){
  const [mode,setMode]=useState<'create'|'view'|'questionnaire'|'calibration'>(() => loadProfile()?'view':'create');
  const [profile,setProfile]=useState<Profile|null>(loadProfile);
  const [name,setName]=useState(profile?.name||'');
  const [experience,setExperience]=useState(profile?.experience||'Beginner');
  const [pin,setPin]=useState(profile?.pin||'');
  const [pinError,setPinError]=useState('');
  const [cloudSyncing,setCloudSyncing]=useState(false);
  
  const [ptaDivision,setPtaDivision]=useState(profile?.division||'');

  async function handleSave(){
    if(!name.trim())return;
    if(pin.length!==4||!/^\d{4}$/.test(pin)){setPinError('PIN must be exactly 4 digits');return;}
    setPinError('');setCloudSyncing(true);
    const p:Profile={
      name:name.trim(),experience,favCats:profile?.favCats||[],pin,
      owgtr:profile?.owgtr||1000,triviaHandicap:profile?.triviaHandicap||36,sbr:profile?.sbr||1000,
      roundsPlayed:profile?.roundsPlayed||0,correctAnswers:profile?.correctAnswers||0,totalAnswers:profile?.totalAnswers||0,
      questionnaire:profile?.questionnaire,courseTier:profile?.courseTier,
      division:ptaDivision||profile?.division,sbIndex:profile?.sbIndex,calibrated:profile?.calibrated,eventPar:profile?.eventPar,
    };
    const nameExists=await cloudCheckNameExists(name.trim());
    if(nameExists&&!profile){setPinError('That name is taken — try a different one');setCloudSyncing(false);return;}
    if(!nameExists){await cloudCreateProfile(p,pin);}else{await cloudSaveProfile(p,pin);}
    saveProfile(p);setProfile(p);setCloudSyncing(false);setMode('questionnaire');
  }

  function handleQuestionnaireComplete(q:Questionnaire){
    saveQuestionnaire(q);
    const{handicap,tier,owgtr}=calcHandicapFromQ(q);const sbr=calcSBR(q);
    const updated:Profile={...profile!,triviaHandicap:handicap,courseTier:tier,owgtr,sbr,questionnaire:q};
    saveProfile(updated);setProfile(updated);setMode('view');
  }

  function handleCalibrationComplete(sbIndex:number){
    const eventPar=getEventPar(sbIndex);
    const updated:Profile={...profile!,sbIndex,calibrated:true,eventPar};
    saveProfile(updated);setProfile(updated);setMode('view');
  }

  function handleDelete(){
    const profiles=loadProfiles();
    if(profile)delete profiles[profile.name];
    saveProfiles(profiles);removeActiveProfile();
    localStorage.removeItem('sb_questionnaire');
    setProfile(null);setName('');setExperience('Beginner');setMode('menu');
    onBack();
  }

  const inputStyle:any={background:'transparent',border:'none',borderBottom:'1px solid var(--gold)',color:'var(--text)',padding:'10px 8px',fontFamily:'Georgia,serif',fontSize:'0.95rem',width:'100%',outline:'none',marginBottom:14};
  const tierColors:Record<string,string>={Championship:'#c8a84b',Advanced:'#3fa36b',Intermediate:'#4a90d9',Recreational:'#9b59b6',Beginner:'#7a9485'};

  if(mode==='calibration')return<CalibrationScreen onComplete={handleCalibrationComplete}/>;
  if(mode==='questionnaire')return<QuestionnaireScreen existing={loadQuestionnaire()} onComplete={handleQuestionnaireComplete} onSkip={()=>setMode('view')}/>;

  if(mode==='view'&&profile){
    const tierColor=tierColors[profile.courseTier||'Intermediate'];
    return(
      <div className="screen center">
        <div style={{width:60,height:60,borderRadius:'50%',border:'2px solid var(--gold)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.6rem',marginBottom:16,background:'radial-gradient(circle,#1a2e20 0%,var(--bg) 100%)'}}>🏌️</div>
        <h2 style={{fontFamily:'Georgia,serif',color:'var(--gold)',marginBottom:4}}>{profile.name}</h2>
        <p style={{fontSize:'0.72rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:4}}>{profile.experience} · Scramble Brains Player</p>
        {profile.division&&<p style={{fontSize:'0.72rem',color:'var(--gold)',marginBottom:4}}>🏫 {profile.division}</p>}
        {profile.courseTier&&<p style={{fontSize:'0.72rem',letterSpacing:'2px',color:tierColor,marginBottom:20}}>📍 {profile.courseTier} Tee</p>}
        <div style={{width:'100%',maxWidth:300,display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:20}}>
        {([
  ['Rounds Played', profile.roundsPlayed || 0],
  [
    'Answer %',
    profile.totalAnswers
      ? `${Math.round((profile.correctAnswers / profile.totalAnswers) * 100)}%`
      : '—',
  ],
  ['Correct', profile.correctAnswers || 0],
  ['Total Answered', profile.totalAnswers || 0],
] as [string, any][]).map(([label, value]) => (
  <div
    key={label}
    style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '12px',
      textAlign: 'center',
    }}
  >
    <div
      style={{
        fontSize: '0.62rem',
        letterSpacing: '2px',
        textTransform: 'uppercase',
        color: 'var(--muted)',
        marginBottom: 6,
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontFamily: 'Georgia, serif',
        fontSize: '1.1rem',
        color: 'var(--gold)',
      }}
    >
      {value}
    </div>
  </div>
))}
        </div>
        {!profile.calibrated&&(
          <div style={{background:'rgba(200,168,75,0.08)',border:'1px solid var(--gold)',borderRadius:8,padding:'10px 14px',marginBottom:16,width:'100%',maxWidth:300,textAlign:'center'}}>
            <p style={{fontSize:'0.78rem',color:'var(--gold)',marginBottom:8}}>⚠️ No SB Index — needed for Fundraiser Mode</p>
            <div style={{display:'flex',flexWrap:'wrap',gap:6,justifyContent:'center',marginBottom:8}}>
              {['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Middle School','High School','Parent','Teacher','Community'].map(d=>(
                <button key={d} onClick={()=>setPtaDivision(d)} style={{background:ptaDivision===d?'var(--gold)':'transparent',color:ptaDivision===d?'var(--bg)':'var(--muted)',border:`1px solid ${ptaDivision===d?'var(--gold)':'var(--border)'}`,padding:'4px 10px',borderRadius:20,fontFamily:'Georgia,serif',fontSize:'0.68rem',cursor:'pointer'}}>{d}</button>
              ))}
            </div>
            <button className="btn" style={{width:'100%'}} disabled={!ptaDivision} onClick={()=>{
              const updated={...profile,division:ptaDivision};saveProfile(updated);setProfile(updated);setMode('calibration');
            }}>Set Division & Calibrate →</button>
          </div>
        )}
        <div style={{display:'flex',gap:10,width:'100%',maxWidth:300,flexWrap:'wrap'}}>
          <button className="btn" style={{flex:1}} onClick={()=>{setName(profile.name);setExperience(profile.experience);setPin(profile.pin||'');setMode('create');}}>Edit Profile</button>
          <button className="btn" style={{flex:1,background:'transparent',color:'var(--muted)',borderColor:'var(--border)'}} onClick={onBack}>← Back</button>
          <button className="btn" style={{width:'100%',background:'transparent',color:'var(--gold)',border:'1px solid var(--gold)'}} onClick={()=>setMode('questionnaire')}>🎯 Retake Interest Profile</button>
          <button onClick={onSwitchPlayer} style={{width:'100%',background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',padding:'8px',borderRadius:6,fontFamily:'Georgia,serif',fontSize:'0.75rem',cursor:'pointer'}}>🔄 Change Player</button>
          <button onClick={handleDelete} style={{width:'100%',background:'transparent',border:'1px solid var(--red)',color:'var(--red)',padding:'8px',borderRadius:6,fontFamily:'Georgia,serif',fontSize:'0.75rem',cursor:'pointer',marginTop:4}}>Delete Profile</button>
        </div>
      </div>
    );
  }

  if(mode==='create')return(
    <div className="screen center">
      <p className="eyebrow">{profile?'Edit Profile':'Create Your Profile'}</p>
      <div style={{width:'100%',maxWidth:300}}>
        <input style={inputStyle} placeholder="Your Name" value={name} onChange={e=>setName(e.target.value)} maxLength={20}/>
        <input style={inputStyle} placeholder="4-Digit PIN" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,4))} maxLength={4} type="password"/>
        {pinError&&<p style={{color:'var(--red)',fontSize:'0.75rem',marginBottom:8}}>{pinError}</p>}
        {cloudSyncing&&<p style={{color:'var(--gold)',fontSize:'0.75rem',marginBottom:8}}>☁️ Saving to cloud...</p>}
        <p style={{fontSize:'0.65rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:8}}>Golf Experience</p>
        <div style={{display:'flex',gap:6,marginBottom:20,flexWrap:'wrap'}}>
          {EXPERIENCE_LEVELS.map(l=>(
            <button key={l} onClick={()=>setExperience(l)} style={{background:experience===l?'var(--gold)':'transparent',color:experience===l?'var(--bg)':'var(--muted)',border:`1px solid ${experience===l?'var(--gold)':'var(--border)'}`,padding:'6px 12px',borderRadius:20,fontFamily:'Georgia,serif',fontSize:'0.72rem',cursor:'pointer'}}>{l}</button>
          ))}
        </div>
        <button className="btn" style={{width:'100%',marginBottom:10}} onClick={handleSave} disabled={!name.trim()}>Next — Interest Profile →</button>
        <button onClick={()=>setMode(profile?'view':'menu')} style={{background:'transparent',border:'none',color:'var(--muted)',fontFamily:'Georgia,serif',fontSize:'0.8rem',cursor:'pointer',width:'100%'}}>← Back</button>
      </div>
    </div>
  );

  return(
    <div className="screen center">
      <div style={{width:60,height:60,borderRadius:'50%',border:'2px solid var(--gold)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.6rem',marginBottom:16,background:'radial-gradient(circle,#1a2e20 0%,var(--bg) 100%)'}}>🏌️</div>
      <h2 style={{fontFamily:'Georgia,serif',color:'var(--gold)',marginBottom:4}}>Player Profile</h2>
      <p style={{fontSize:'0.72rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:24}}>Your Golf Trivia Identity</p>
      <div style={{width:'100%',maxWidth:280,display:'flex',flexDirection:'column',gap:10}}>
        <button className="btn" onClick={()=>setMode('create')} style={{background:'var(--gold)',color:'var(--bg)',border:'none'}}>✨ Create New Profile</button>
        <button onClick={onBack} style={{background:'transparent',border:'none',color:'var(--muted)',fontFamily:'Georgia,serif',fontSize:'0.8rem',cursor:'pointer'}}>← Back</button>
      </div>
    </div>
  );
}

// ─── FUNDRAISER GAME ──────────────────────────────────────────────
function FundraiserGame({profile,onComplete,onExit}:{
  profile:Profile;
  onComplete:(correct:number,total:number)=>void;
  onExit:()=>void;
}){
  const [questions,setQuestions]=useState<any[]>([]);
  const [holeIdx,setHoleIdx]=useState(0);
  const [answered,setAnswered]=useState(false);
  const [picked,setPicked]=useState<number|null>(null);
  const [feedback,setFeedback]=useState('');
  const [timeLeft,setTimeLeft]=useState(15);
  const [correct,setCorrect]=useState(0);
  const [phase,setPhase]=useState<'question'|'feedback'>('question');
  const timerRef=useRef<any>(null);
  const startTimeRef=useRef(Date.now());

  const eventPar=profile.eventPar||getEventPar(profile.sbIndex||12);
  const roundPar=Math.round(eventPar/4);
  const isLoadingQuestions = questions.length === 0;
  const q=questions[holeIdx];

  useEffect(() => {
    const shuffled = [...PITTSBURGH_QUESTIONS]
      .sort(() => Math.random() - 0.5)
      .slice(0, 18);
    setQuestions(shuffled);
  }, []);

  useEffect(()=>{
    if(isLoadingQuestions) return;
    if(phase!=='question') return;

    setAnswered(false);
    setPicked(null);
    setTimeLeft(15);
    startTimeRef.current=Date.now();

    if(timerRef.current) clearInterval(timerRef.current);

    timerRef.current=setInterval(()=>{
      setTimeLeft(prev=>{
        if(prev<=1){
          clearInterval(timerRef.current);
          return 0;
        }
        return prev-1;
      });
    },1000);

    return()=>{
      if(timerRef.current) clearInterval(timerRef.current);
    };
  },[holeIdx,phase,isLoadingQuestions]);

  useEffect(()=>{
    if(isLoadingQuestions) return;
    if(timeLeft===0&&phase==='question'&&!answered) submitAnswer(-1);
  },[timeLeft,isLoadingQuestions,phase,answered]);

  function submitAnswer(i:number){
    if(isLoadingQuestions) return;
    if(!q) return;
    if(answered) return;

    setAnswered(true);
    if(timerRef.current) clearInterval(timerRef.current);

    const isCorrect=i!==-1&&i===q.correct;
    setPicked(i===-1?-99:i);

    if(isCorrect) setCorrect(c=>c+1);

    setFeedback(
      i===-1
        ? `⏱️ Time's up! Answer: ${q.answers[q.correct]}`
        : getFundraiserFeedback(isCorrect,q.difficulty||'medium')
    );

    setPhase('feedback');
  }

  function nextHole(){
    if(holeIdx+1>=18){
      onComplete(correct,18);
    } else {
      setHoleIdx(i=>i+1);
      setPhase('question');
      setFeedback('');
    }
  }

  if (isLoadingQuestions) {
    return (
      <div className="screen center">
        <h2 style={{fontFamily:'Georgia,serif',color:'var(--gold)',marginBottom:8}}>
          Loading Fundraiser
        </h2>
        <p style={{color:'var(--muted)',textAlign:'center',marginBottom:20}}>
          Getting questions ready...
        </p>
        <button
          onClick={onExit}
          style={{
            background:'transparent',
            border:'none',
            color:'var(--muted)',
            fontFamily:'Georgia,serif',
            fontSize:'0.8rem',
            cursor:'pointer'
          }}
        >
          ← Back
        </button>
      </div>
    );
  }

  const vsPar=formatVsPar(
    calcFundraiserRoundScore(correct,holeIdx-correct,roundPar),
    roundPar
  );

  return(
    <div className="screen">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:'rgba(6,15,10,0.95)',border:'1px solid var(--border)',borderRadius:10,padding:'10px 14px',marginBottom:14}}>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:'0.58rem',textTransform:'uppercase',letterSpacing:'2px',color:'var(--muted)'}}>HOLE</div>
          <div style={{fontFamily:'Georgia,serif',fontSize:'1.8rem',color:'var(--gold)',lineHeight:1}}>{holeIdx+1}</div>
          <div style={{fontSize:'0.65rem',color:'var(--muted)'}}>of 18</div>
        </div>

        <div style={{textAlign:'center',flex:1}}>
          {profile.division&&<div style={{fontSize:'0.65rem',color:'var(--gold)',marginBottom:2}}>🏫 {profile.division}</div>}
          <div style={{fontSize:'0.72rem',color:'var(--muted)',letterSpacing:'2px',textTransform:'uppercase'}}>{getFundraiserConfig().eventName}</div>
          <div style={{fontSize:'0.85rem',color:'var(--text)',fontFamily:'Georgia,serif'}}>Par {roundPar} · Event Par {eventPar}</div>
        </div>

        <div style={{textAlign:'center'}}>
          <div style={{fontSize:'0.58rem',textTransform:'uppercase',letterSpacing:'2px',color:'var(--muted)'}}>SCORE</div>
          <div style={{fontFamily:'Georgia,serif',fontSize:'1.2rem',color:'var(--green-lt)',lineHeight:1}}>{correct}/{holeIdx}</div>
          <button onClick={onExit} style={{background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',padding:'2px 8px',borderRadius:4,fontSize:'0.65rem',cursor:'pointer',marginTop:4}}>✕</button>
        </div>
      </div>

      <div style={{height:4,background:'var(--border)',borderRadius:2,marginBottom:14,overflow:'hidden'}}>
        <div style={{height:'100%',background:'linear-gradient(90deg,var(--green),var(--green-lt))',width:`${(holeIdx/18)*100}%`,transition:'width 0.4s'}}/>
      </div>

      {phase==='question'&&q&&(
        <>
          <div className="timer-wrap">
            <div className={`timer-bar ${timeLeft<=5?'danger':''}`} style={{width:`${(timeLeft/15)*100}%`}}/>
            <span className={`timer-label ${timeLeft<=5?'danger':''}`}>{timeLeft}s</span>
          </div>

          {q.cat&&<p style={{fontSize:'0.65rem',letterSpacing:'2px',textTransform:'uppercase',color:'var(--muted)',textAlign:'center',marginBottom:8}}>{q.cat}</p>}

          <div className="card">
            <p className="q-text">{q.text}</p>
            <div className="answers">
              {q.answers.map((a:string,i:number)=>(
                <button key={i} className="ans" onClick={()=>submitAnswer(i)} disabled={answered}>
                  <span className="ans-letter">{String.fromCharCode(65+i)}</span>{a}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {phase==='feedback'&&q&&(
        <div className="feedback">
          <div style={{textAlign:'center',marginBottom:12}}>
            <p style={{fontFamily:'Georgia,serif',fontSize:'1.1rem',color:picked===q.correct?'var(--green-lt)':'var(--red)',marginBottom:4}}>{feedback}</p>
            {picked!==q.correct&&<p style={{fontSize:'0.82rem',color:'var(--muted)'}}>Correct: {q.answers[q.correct]}</p>}
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:16}}>
            {[['Hole',`${holeIdx+1}/18`],['Correct',`${correct}`],['Running',vsPar]].map(([l,v])=>(
              <div key={l} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:6,padding:'8px',textAlign:'center'}}>
                <div style={{fontSize:'0.6rem',textTransform:'uppercase',letterSpacing:'1px',color:'var(--muted)',marginBottom:4}}>{l}</div>
                <div style={{fontFamily:'Georgia,serif',fontSize:'1rem',color:'var(--gold)'}}>{v}</div>
              </div>
            ))}
          </div>

          <button className="btn-next" onClick={nextHole}>
            {holeIdx+1>=18?'Finish Round →':`Hole ${holeIdx+2} →`}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────
export default function App(){
  const [screen,setScreen]=useState('splash');
  const [fundraiserLeaderboard,setFundraiserLeaderboard]=useState<FundraiserLeaderboardEntry[]>([]);
  const [whoTab,setWhoTab]=useState<'member'|'guest'>('member');
  const [whoName,setWhoName]=useState('');
  const [whoPin,setWhoPin]=useState('');
  const [whoError,setWhoError]=useState('');
  const [whoLoading,setWhoLoading]=useState(false);
  const [showProfile,setShowProfile]=useState(false);
  const [showPicker,setShowPicker]=useState(false);
  const [isGuest,setIsGuest]=useState(false);
  const [fundraiserCorrect,setFundraiserCorrect]=useState(0);
  const [playerNames,setPlayerNames]=useState<string[]>([loadProfile()?.name||'']);
  const playerName=playerNames[0];
  function updateName(i:number,val:string){setPlayerNames(prev=>{const u=[...prev];u[i]=val;return u;});}
  function removeName(i:number){setPlayerNames(prev=>prev.filter((_,idx)=>idx!==i));}
  const [holeIdx,setHoleIdx]=useState(0);
  const [remaining,setRemaining]=useState(0);
  const [strokes,setStrokes]=useState(0);
  const [lie,setLie]=useState('Tee Box');
  const [feedback,setFeedback]=useState('');
  const [club,setClub]=useState<string|null>(null);
  const [question,setQuestion]=useState<any>(null);
  const [qIdx,setQIdx]=useState(-1);
  const [usedQ,setUsedQ]=useState<Record<string,number[]>>({});
  const [roundPool,setRoundPool]=useState<any[]>([]);
  const [roundPoolIdx,setRoundPoolIdx]=useState(0);
  const [picked,setPicked]=useState<number|null>(null);
  const [timeLeft,setTimeLeft]=useState<number|null>(null);
  const [phase,setPhase]=useState<'club'|'question'|'feedback'>('club');
  const [isPutting,setIsPutting]=useState(false);
  const [scorecard,setScorecard]=useState<number[]>([]);
  const [roundCorrect,setRoundCorrect]=useState(0);
  const [roundTotal,setRoundTotal]=useState(0);
  const [wind,setWind]=useState<{speed:number;dir:string}>({speed:0,dir:'N'});
  const [roundLength,setRoundLength]=useState<9|18>(18);
  const isMulti=playerNames.filter(n=>n.trim()).length>1;
  const activePlayers=playerNames.filter(n=>n.trim());
  const [multiScores,setMultiScores]=useState<number[][]>([]);
  const [multiHoleIdx,setMultiHoleIdx]=useState(0);
  const [multiPlayerIdx,setMultiPlayerIdx]=useState(0);
  const [multiAnsweredCount,setMultiAnsweredCount]=useState(0);
  const [multiHoleResults,setMultiHoleResults]=useState<{name:string;strokes:number}[]>([]);
  const [multiPhase,setMultiPhase]=useState<'question'|'hole_results'|'end'>('question');
  const [multiQuestion,setMultiQuestion]=useState<any>(null);
  const [multiPicked,setMultiPicked]=useState<number|null>(null);
  const [multiTimeLeft,setMultiTimeLeft]=useState<number|null>(null);
  const [multiUsedQ,setMultiUsedQ]=useState<number[]>([]);
  const hole=COURSE[holeIdx];
  const multiHole=COURSE[multiHoleIdx];

  useEffect(()=>{
    if(!isMulti||multiPhase!=='question'||multiPicked!==null||multiTimeLeft===null)return;
    if(multiTimeLeft===0){handleMultiAnswer(-1);return;}
    const t=setTimeout(()=>setMultiTimeLeft(n=>(n??1)-1),1000);
    return()=>clearTimeout(t);
  },[multiTimeLeft,multiPhase,multiPicked,isMulti]);

  useEffect(()=>{
    if(phase!=='question'||picked!==null||timeLeft===null)return;
    if(timeLeft===0){handleAnswer(-1);return;}
    const t=setTimeout(()=>setTimeLeft(n=>(n??1)-1),1000);
    return()=>clearTimeout(t);
  },[timeLeft,phase,picked]);

  useEffect(()=>{
    if(screen==='fundraiser_result'){
      loadFundraiserLeaderboard(getFundraiserConfig().eventName).then(setFundraiserLeaderboard);
    }
  },[screen]);


  function handleSwitchPlayer(){removeActiveProfile();setShowProfile(false);setShowPicker(true);}

  function startMultiRound(){
    const pool=Object.values(QUESTIONS).flat() as any[];
    const idx=Math.floor(Math.random()*pool.length);
    setMultiQuestion(pool[idx]);setMultiUsedQ([idx]);setMultiPicked(null);setMultiTimeLeft(TIMER_SECONDS);
    setMultiPhase('question');setMultiPlayerIdx(0);setMultiAnsweredCount(0);setMultiHoleResults([]);
    setMultiScores(activePlayers.map(()=>[]));setMultiHoleIdx(0);setScreen('multi');
  }

  function loadNextMultiQuestion(){
    const pool=Object.values(QUESTIONS).flat() as any[];
    const available=pool.map((_:any,i:number)=>i).filter((i:number)=>!multiUsedQ.includes(i));
    const idx=available.length>0?available[Math.floor(Math.random()*available.length)]:Math.floor(Math.random()*pool.length);
    setMultiQuestion(pool[idx]);setMultiUsedQ(prev=>[...prev,idx]);
    setMultiPicked(null);setMultiTimeLeft(TIMER_SECONDS);setMultiPhase('question');
  }

  function handleMultiAnswer(i:number){
    if(multiPicked!==null)return;
    setMultiTimeLeft(null);setMultiPicked(i);
    const correct=i===multiQuestion.correct,secondsLeft=multiTimeLeft??0;
    const s=correct?(secondsLeft>=10?3:secondsLeft>=5?4:5):7;
    const newResults=[...multiHoleResults,{name:activePlayers[multiPlayerIdx],strokes:s}];
    setMultiHoleResults(newResults);
    const nextAnswered=multiAnsweredCount+1;setMultiAnsweredCount(nextAnswered);
    if(nextAnswered>=activePlayers.length){
      setMultiScores(prev=>{const updated=[...prev];newResults.forEach((r,pi)=>{if(!updated[pi])updated[pi]=[];updated[pi]=[...updated[pi],r.strokes];});return updated;});
      setTimeout(()=>setMultiPhase('hole_results'),400);
    }else{setTimeout(()=>{setMultiPlayerIdx(multiPlayerIdx+1);loadNextMultiQuestion();},400);}
  }

  function nextMultiHole(){
    if(multiHoleIdx>=COURSE.length-1){setMultiPhase('end');return;}
    const next=multiHoleIdx+1;
    setMultiHoleIdx(next);setMultiPlayerIdx(0);setMultiAnsweredCount(0);setMultiHoleResults([]);
    loadNextMultiQuestion();setMultiPhase('question');
  }

  function buildRoundPool():any[]{
    const profile=loadProfile();
    let pool:any[]=isGuest||!profile||!profile.questionnaire?Object.values(QUESTIONS).flat() as any[]:getProfilePool(profile);
    pool=pool.map(q=>{
      if(q.cat&&!Object.keys(QUESTIONS).includes(q.cat)){
        const ca=q.answers[q.correct],sh=[...q.answers].sort(()=>Math.random()-0.5);
        return{...q,answers:sh,correct:sh.indexOf(ca)};
      }return q;
    });
    for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
    return pool;
  }

  function startRound(){
    if(!playerNames[0].trim())return;
    if(isMulti){startMultiRound();return;}
    const pool=buildRoundPool();
    setRoundPool(pool);setRoundPoolIdx(0);setRoundCorrect(0);setRoundTotal(0);
    setScreen('game');setHoleIdx(0);setScorecard([]);resetHole(0);
  }

  function resetHole(idx:number){
    const h=COURSE[idx];
    setRemaining(h.yards);setStrokes(0);setLie('Tee Box');setFeedback('');
    setClub(null);setQuestion(null);setPicked(null);setTimeLeft(null);
    setUsedQ({});setPhase('club');setIsPutting(false);setWind(generateWind());
  }

  function getNextFromPool():any{
    if(roundPool.length===0){const fb=Object.values(QUESTIONS).flat() as any[];return fb[Math.floor(Math.random()*fb.length)];}
    const idx=roundPoolIdx%roundPool.length,q=roundPool[idx];setRoundPoolIdx(idx+1);return q;
  }

  function chooseClub(c:string){
    const q=getNextFromPool();
    setClub(c);setQuestion(q);setQIdx(roundPoolIdx);setPicked(null);setFeedback('');setTimeLeft(TIMER_SECONDS);setPhase('question');
  }

  function loadPutt(){
    const q=getNextFromPool();
    setClub('putter');setQuestion(q);setQIdx(roundPoolIdx);setPicked(null);setFeedback('');
    setTimeLeft(TIMER_SECONDS);setIsPutting(true);setPhase('question');
  }

  function handleAnswer(i:number){
    if(picked!==null)return;
    const secondsLeft=timeLeft??0;setTimeLeft(null);setPicked(i);
    const correct=i===question.correct,clubData=CLUBS[club!];
    if(club==='putter'){
      setStrokes(s=>s+1);setUsedQ(prev=>({...prev,putter:[...(prev['putter']||[]),qIdx]}));
      const{feetLeft,note}=getPuttResult(correct,secondsLeft);
      if(feetLeft===0){setLie('Holed');setRemaining(0);}else{setLie('Green');setRemaining(feetLeft);}
      setFeedback(note);setPhase('feedback');return;
    }
    const{newRemaining,landNote,onGreen}=calcShot(remaining,applyWind(clubData.yards,wind),correct,secondsLeft);
    const penalty=calcPenalty(remaining,club!,correct,secondsLeft,hole);
    const finalRemaining=penalty?penalty.newRemaining:newRemaining;
    const finalLie=penalty?penalty.newLie:getLie(correct,onGreen);
    const penaltyCount=penalty?penalty.penaltyStrokes:0;
    setStrokes(s=>s+1+penaltyCount);setRemaining(finalRemaining);setLie(finalLie);
    setUsedQ(prev=>({...prev,[club!]:[...(prev[club!]||[]),qIdx]}));
    setRoundTotal(t=>t+1);if(correct)setRoundCorrect(c=>c+1);
    const shotNote=correct?`✅ ${clubData.name} — ${landNote}.`:`❌ Wrong! ${clubData.name} — ${landNote}.`;
    setFeedback(shotNote+(penalty?`\n\n${penalty.penaltyNote}`:''));setPhase('feedback');
  }

  function nextShot(){
    if(lie==='Holed'){
      const newCard=[...scorecard,strokes];setScorecard(newCard);
      if(holeIdx<roundLength-1){setScreen('hole_leaderboard');setScorecard(newCard);}
      else setScreen('end');return;
    }
    if(lie==='Green'&&isPutting){loadPutt();return;}
    if(remaining<=20){loadPutt();return;}
    setClub(null);setQuestion(null);setPicked(null);setFeedback('');setPhase('club');
  }

  if(showPicker)return(
    <ProfilePickerScreen
      onSelect={p=>{setPlayerNames([p.name]);setShowPicker(false);setScreen('modes');}}
      onNew={()=>{setShowPicker(false);setShowProfile(true);}}
      onBack={()=>{setShowPicker(false);setScreen('modes');}}
    />
  );

  if(showProfile)return(
    <ProfileScreen
      onBack={()=>{setShowProfile(false);setScreen('modes');}}
      onSwitchPlayer={handleSwitchPlayer}
    />
  );

  if(screen==='fundraiser'){
    const profile=loadProfile();
    if(!profile?.calibrated)return(
      <div className="screen center">
        <h2 style={{fontFamily:'Georgia,serif',color:'var(--gold)',marginBottom:8}}>SB Index Required</h2>
        <p style={{color:'var(--muted)',textAlign:'center',marginBottom:20}}>Complete calibration first to play fundraiser mode.</p>
        <button className="btn" onClick={()=>setShowProfile(true)}>Set Up Profile →</button>
        <button onClick={()=>setScreen('modes')} style={{background:'transparent',border:'none',color:'var(--muted)',fontFamily:'Georgia,serif',fontSize:'0.8rem',cursor:'pointer',marginTop:16}}>← Back</button>
      </div>
    );
    if(isFundraiserExpired())return(
      <div className="screen center">
        <div style={{fontSize:'3rem',marginBottom:16}}>🏁</div>
        <h2 style={{fontFamily:'Georgia,serif',color:'var(--gold)',marginBottom:8}}>Fundraiser Ended</h2>
        <p style={{color:'var(--muted)',textAlign:'center',marginBottom:24}}>{getFundraiserConfig().eventName} has ended. Thank you for playing!</p>
        <button onClick={()=>setScreen('modes')} style={{background:'transparent',border:'none',color:'var(--muted)',fontFamily:'Georgia,serif',fontSize:'0.8rem',cursor:'pointer'}}>← Back to Home</button>
      </div>
    );
    return(
      <FundraiserGame
        profile={profile}
        onComplete={(correct,total)=>{setFundraiserCorrect(correct);setScreen('fundraiser_result');}}
        onExit={()=>setScreen('modes')}
      />
    );
  }

  if(screen==='fundraiser_result'){
    const profile=loadProfile();
    const eventPar=profile?.eventPar||getEventPar(profile?.sbIndex||12);
    const roundPar=Math.round(eventPar/4);
    const rawScore=calcFundraiserRoundScore(fundraiserCorrect,18-fundraiserCorrect,roundPar);
    const vsPar=rawScore-roundPar;
    const parLabel=vsPar<0?`${vsPar}`:vsPar===0?'E':`+${vsPar}`;
    const parColor=vsPar<0?'var(--gold)':vsPar===0?'var(--green-lt)':'var(--red)';
    const msg =
  vsPar <= -3
    ? { emoji: '🦅', label: 'Eagle Round!' }
    : vsPar <= -1
    ? { emoji: '🐦', label: 'Under Par!' }
    : vsPar === 0
    ? { emoji: '⛳', label: 'Even Par' }
    : { emoji: '📌', label: 'Over Par' };

    if (profile) {
      const roundScore = rawScore;
      const roundScoreVsPar = vsPar;
      void updateFundraiserLeaderboard(
        getFundraiserConfig().eventName,
        profile,
        fundraiserCorrect,
        18,
        roundScore,
        roundScoreVsPar
      );
      const updatedProfile = {
        ...profile,
        roundsPlayed: (profile.roundsPlayed || 0) + 1,
        correctAnswers: (profile.correctAnswers || 0) + fundraiserCorrect,
        totalAnswers: (profile.totalAnswers || 0) + 18,
      };
      saveProfile(updatedProfile);
      if (updatedProfile.pin) {
        cloudSaveProfile(updatedProfile, updatedProfile.pin).catch(() => {});
      }
    }
    return(
      <div className="screen center">
        <p style={{fontSize:'0.6rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:4}}>Fundraiser Complete</p>
        {profile?.division&&<p style={{fontSize:'0.72rem',color:'var(--gold)',marginBottom:16}}>🏫 {profile.division}</p>}
        <div style={{fontSize:'3.5rem',marginBottom:8}}>{msg.emoji}</div>
        <div style={{fontFamily:'Georgia,serif',fontSize:'2rem',color:parColor,marginBottom:20}}>{msg.label}</div>
        <div style={{width:'100%',maxWidth:300,display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:24}}>
          {([['Score vs Par',parLabel,parColor],['Correct',`${fundraiserCorrect}/18`,'var(--green-lt)'],['Accuracy',`${Math.round(fundraiserCorrect/18*100)}%`,'var(--gold)'],['Event Par',eventPar,'var(--muted)']] as [string,any,string][]).map(([l,v,c])=>(
            <div key={l} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,padding:'12px',textAlign:'center'}}>
              <div style={{fontSize:'0.6rem',letterSpacing:'2px',textTransform:'uppercase',color:'var(--muted)',marginBottom:4}}>{l}</div>
              <div style={{fontFamily:'Georgia,serif',fontSize:'1.3rem',color:c}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{width:'100%',maxWidth:320,marginBottom:20}}>
          <p style={{fontSize:'0.62rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:10,textAlign:'center'}}>
            {profile?.division||'Open'} Leaderboard
          </p>
          {(() => {
            const allEntries=fundraiserLeaderboard;
            const divLB=allEntries.filter(e=>e.division===(profile?.division||'Open'));
            const myEntry=divLB.find(e=>e.name===profile?.name);
            const myRank=myEntry?divLB.indexOf(myEntry)+1:0;
            return(<>
              {myEntry&&myRank>0&&(
                <div style={{background:'rgba(200,168,75,0.08)',border:'1px solid var(--gold)',borderRadius:8,padding:'10px 12px',marginBottom:10,textAlign:'center'}}>
                  <div style={{fontSize:'0.65rem',letterSpacing:'2px',textTransform:'uppercase',color:'var(--muted)',marginBottom:4}}>Your Rank</div>
                  <div style={{fontFamily:'Georgia,serif',fontSize:'1.4rem',color:'var(--gold)'}}>#{myRank}</div>
                  <div style={{fontSize:'0.72rem',color:'var(--muted)',marginTop:4}}>{myEntry.roundsCompleted} rounds · {myEntry.totalCorrect}/{myEntry.totalQuestions} · {myEntry.accuracy}%</div>
                </div>
              )}
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {divLB.slice(0,5).map((entry,idx)=>(
                  <div key={entry.id} style={{background:'var(--surface)',border:`1px solid ${idx===0?'var(--gold)':'var(--border)'}`,borderRadius:8,padding:'10px 12px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div>
                      <div style={{fontFamily:'Georgia,serif',color:idx===0?'var(--gold)':'var(--text)',fontSize:'0.95rem'}}>#{idx+1} {entry.name}</div>
                      <div style={{fontSize:'0.68rem',color:'var(--muted)',marginTop:2}}>{entry.roundsCompleted} rounds · {entry.accuracy}%</div>
                    </div>
                    <div style={{fontFamily:'Georgia,serif',color:entry.totalScoreVsPar<0?'var(--gold)':entry.totalScoreVsPar===0?'var(--green-lt)':'var(--red)',fontSize:'1rem'}}>
                      {entry.totalScoreVsPar<0?entry.totalScoreVsPar:entry.totalScoreVsPar===0?'E':`+${entry.totalScoreVsPar}`}
                    </div>
                  </div>
                ))}
                {divLB.length===0&&<p style={{color:'var(--muted)',textAlign:'center',fontSize:'0.82rem'}}>You're first on the board!</p>}
              </div>
            </>);
          })()}
        </div>
        <div style={{display:'flex',gap:10,width:'100%',maxWidth:300}}>
        {(() => {
  const allE=fundraiserLeaderboard;
  const myE=allE.find(e=>e.name===profile?.name&&e.division===(profile?.division||'Open'));
  const completed=(myE?.roundsCompleted||0)>=4;
  return completed?(
    <div style={{display:'flex',gap:8,flex:1}}>
      <button className="btn" style={{flex:1,fontSize:'0.72rem'}} onClick={()=>setScreen('fundraiser')}>Practice Round</button>
      <button className="btn" style={{flex:1,fontSize:'0.72rem',background:'transparent',border:'1px solid var(--gold)',color:'var(--gold)'}} onClick={()=>setScreen('start')}>Regular Golf →</button>
    </div>
  ):(
    <button className="btn" style={{flex:1}} onClick={()=>setScreen('fundraiser')}>Play Again</button>
  );
})()}
          <button className="btn" style={{flex:1,background:'transparent',color:'var(--muted)',borderColor:'var(--border)'}} onClick={()=>setScreen('modes')}>← Home</button>
        </div>
      </div>
    );
  }

  if(screen==='splash')return(
    <div className="screen center" style={{gap:0,justifyContent:'center'}}>
      <img src="/logo.png" alt="Scramble Brains" style={{width:160,height:160,objectFit:'contain',marginBottom:32}}/>
      <h1 style={{fontFamily:'Georgia,serif',fontSize:'clamp(2.4rem,9vw,3.8rem)',color:'var(--gold)',letterSpacing:'2px',lineHeight:1.1,textAlign:'center',marginBottom:12}}>Scramble<br/>Brains</h1>
      <div style={{width:60,height:1,background:'var(--gold)',opacity:0.4,margin:'12px auto'}}/>
      <p style={{fontSize:'0.72rem',letterSpacing:'4px',textTransform:'uppercase',color:'var(--muted)',marginBottom:48}}>Golf · Trivia · Strategy</p>
      <button onClick={()=>setScreen('who')} style={{background:'transparent',border:'1px solid var(--gold)',color:'var(--gold)',padding:'14px 56px',borderRadius:2,fontFamily:'Georgia,serif',fontSize:'0.85rem',letterSpacing:'4px',textTransform:'uppercase',cursor:'pointer'}}
        onMouseEnter={e=>{(e.target as HTMLButtonElement).style.background='var(--gold)';(e.target as HTMLButtonElement).style.color='var(--bg)';}}
        onMouseLeave={e=>{(e.target as HTMLButtonElement).style.background='transparent';(e.target as HTMLButtonElement).style.color='var(--gold)';}}>
        Enter
      </button>
    </div>
  );

  if(screen==='who'){
    
    return(
      <div className="screen center" style={{gap:0}}>
        <img src="/logo.png" alt="Scramble Brains" style={{width:64,height:64,objectFit:'contain',marginBottom:20}}/>
        <div style={{display:'flex',width:'100%',maxWidth:320,marginBottom:28,borderRadius:10,overflow:'hidden',border:'1px solid var(--border)'}}>
          <button onClick={()=>setWhoTab('member')} style={{flex:1,padding:'13px',fontFamily:'Georgia,serif',fontSize:'0.9rem',border:'none',cursor:'pointer',background:whoTab==='member'?'var(--gold)':'var(--surface)',color:whoTab==='member'?'var(--bg)':'var(--muted)',letterSpacing:'1px',transition:'all 0.2s'}}>Member</button>
          <button onClick={()=>setWhoTab('guest')} style={{flex:1,padding:'13px',fontFamily:'Georgia,serif',fontSize:'0.9rem',border:'none',cursor:'pointer',background:whoTab==='guest'?'var(--gold)':'var(--surface)',color:whoTab==='guest'?'var(--bg)':'var(--muted)',letterSpacing:'1px',transition:'all 0.2s'}}>Guest</button>
        </div>
        {whoTab==='member'&&(
          <div style={{width:'100%',maxWidth:300,display:'flex',flexDirection:'column',gap:14}}>
            <input placeholder="Your Name" value={whoName} onChange={e=>setWhoName(e.target.value)}
              style={{background:'transparent',border:'none',borderBottom:'1px solid var(--gold)',color:'var(--text)',padding:'12px 8px',fontFamily:'Georgia,serif',fontSize:'1rem',textAlign:'center',outline:'none',letterSpacing:'1px'}}/>
            <input type="password" maxLength={4} placeholder="4-Digit PIN" value={whoPin} onChange={e=>setWhoPin(e.target.value.replace(/\D/g,'').slice(0,4))}
              style={{background:'transparent',border:'none',borderBottom:'1px solid var(--gold)',color:'var(--text)',padding:'12px 8px',fontFamily:'Georgia,serif',fontSize:'1.4rem',textAlign:'center',outline:'none',letterSpacing:'8px'}}/>
            {whoError&&<p style={{color:'var(--red)',fontSize:'0.78rem',textAlign:'center',margin:0}}>{whoError}</p>}
            <button className="btn" disabled={!whoName.trim()||whoPin.length!==4||whoLoading} onClick={async()=>{
              setWhoLoading(true);setWhoError('');
              const profiles=loadProfiles();
              const local=profiles[whoName.trim()];
              if(local&&local.pin===whoPin.trim()){saveActiveProfileName(whoName.trim());setIsGuest(false);setScreen('modes');setWhoLoading(false);return;}
              const found=await cloudLoadProfile(whoName.trim(),whoPin);
              if(!found){setWhoError('Name or PIN not found — try again');setWhoLoading(false);return;}
              saveProfile(found);setIsGuest(false);setScreen('modes');setWhoLoading(false);
            }}>{whoLoading?'Loading...':'Sign In →'}</button>
            <button onClick={()=>{setShowProfile(true);}} style={{background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',padding:'11px',borderRadius:8,fontFamily:'Georgia,serif',fontSize:'0.82rem',cursor:'pointer'}}>✨ Create New Profile</button>
          </div>
        )}
        {whoTab==='guest'&&(
          <div style={{width:'100%',maxWidth:300,display:'flex',flexDirection:'column',gap:14,alignItems:'center'}}>
            <p style={{color:'var(--muted)',fontFamily:'Georgia,serif',fontSize:'0.88rem',textAlign:'center',lineHeight:1.6}}>Play without a profile. Stats won't be saved.</p>
            <button className="btn" style={{width:'100%'}} onClick={()=>{setIsGuest(true);setScreen('start');}}>Play as Guest →</button>
          </div>
        )}
        <button onClick={()=>setScreen('splash')} style={{background:'transparent',border:'none',color:'var(--muted)',fontFamily:'Georgia,serif',fontSize:'0.8rem',cursor:'pointer',marginTop:24}}>← Back</button>
      </div>
    );
  }

  if(screen==='modes'){
    const profile=loadProfile();
    const config=getFundraiserConfig();
    const expired=isFundraiserExpired();
    return(
      <div className="screen center" style={{gap:0}}>
        <img src="/logo.png" alt="Scramble Brains" style={{width:64,height:64,objectFit:'contain',marginBottom:20}}/>
        <div style={{width:'100%',maxWidth:300,display:'flex',flexDirection:'column',gap:14}}>
          <button className="btn" onClick={()=>{setIsGuest(false);setScreen('start');}} style={{width:'100%',padding:'22px',fontSize:'1.1rem',letterSpacing:'2px',display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
            <span style={{fontSize:'1.6rem'}}>⛳</span>
            <span>Play Golf</span>
            {profile?.courseTier&&<span style={{fontSize:'0.65rem',opacity:0.7,fontFamily:'Georgia,serif'}}>Playing as {profile.name}</span>}
          </button>
          <button onClick={()=>setScreen('fundraiser_menu')} style={{width:'100%',padding:'22px',fontSize:'1.1rem',letterSpacing:'2px',display:'flex',flexDirection:'column',alignItems:'center',gap:6,background:'rgba(200,168,75,0.08)',border:'1px solid var(--gold)',color:'var(--gold)',borderRadius:8,fontFamily:'Georgia,serif',cursor:'pointer'}}>
            <span style={{fontSize:'1.6rem'}}>🏫</span>
            <span>Fundraiser</span>
          </button>
          <div style={{display:'flex',gap:10}}>
            <button onClick={()=>setShowPicker(true)} style={{flex:1,background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',padding:'11px',borderRadius:8,fontFamily:'Georgia,serif',fontSize:'0.78rem',cursor:'pointer'}}>👥 Change Player</button>
            <button onClick={()=>setShowProfile(true)} style={{flex:1,background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',padding:'11px',borderRadius:8,fontFamily:'Georgia,serif',fontSize:'0.78rem',cursor:'pointer'}}>✏️ Profile</button>
          </div>
        </div>
        <button onClick={()=>setScreen('who')} style={{background:'transparent',border:'none',color:'var(--muted)',fontFamily:'Georgia,serif',fontSize:'0.8rem',cursor:'pointer',marginTop:20}}>← Back</button>
      </div>
    );
  }

  if(screen==='fundraiser_menu'){
    const config=getFundraiserConfig();
    const expired=isFundraiserExpired();
    const profile=loadProfile();
    const deadlineStr=new Date(config.deadline).toLocaleDateString('en-US',{month:'short',day:'numeric'});
    return(
      <div className="screen center" style={{gap:0}}>
        <img src="/logo.png" alt="Scramble Brains" style={{width:64,height:64,objectFit:'contain',marginBottom:20}}/>
        <p style={{fontSize:'0.65rem',letterSpacing:'4px',textTransform:'uppercase',color:'var(--muted)',marginBottom:24}}>Select Event</p>
        <div style={{width:'100%',maxWidth:300,display:'flex',flexDirection:'column',gap:12}}>
          {expired?(
            <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,padding:'20px',textAlign:'center'}}>
              <p style={{fontFamily:'Georgia,serif',color:'var(--muted)',fontSize:'0.9rem'}}>Ashlyn G. Volleyball Fundraiser</p>
              <p style={{fontSize:'0.75rem',color:'var(--red)',marginTop:8}}>Event Ended</p>
            </div>
          ):(
            <button onClick={()=>{
              if(!profile?.calibrated){setShowProfile(true);return;}
              setScreen('fundraiser');
            }} style={{width:'100%',padding:'20px',background:'rgba(200,168,75,0.08)',border:'1px solid var(--gold)',borderRadius:10,cursor:'pointer',textAlign:'center'}}>
              <p style={{fontFamily:'Georgia,serif',fontSize:'1.05rem',color:'var(--gold)',marginBottom:6}}>Ashlyn G. Volleyball Fundraiser</p>
              <p style={{fontSize:'0.7rem',color:'var(--muted)'}}>Deadline {deadlineStr}</p>
              {profile?.division&&<p style={{fontSize:'0.7rem',color:'var(--gold)',marginTop:4}}>🏫 {profile.division}</p>}
              {!profile?.calibrated&&<p style={{fontSize:'0.7rem',color:'var(--red)',marginTop:6}}>⚠️ Profile setup required</p>}
            </button>
          )}
        </div>
        <button onClick={()=>setScreen('modes')} style={{background:'transparent',border:'none',color:'var(--muted)',fontFamily:'Georgia,serif',fontSize:'0.8rem',cursor:'pointer',marginTop:24}}>← Back</button>
      </div>
    );
  }

  if(screen==='landing'){
    return <div/>;
  }

  if(screen==='hole_leaderboard'){
    const completedHole=COURSE[holeIdx],isLastHole=holeIdx>=roundLength-1;
    const totalPar=COURSE.slice(0,scorecard.length).reduce((s,h)=>s+h.par,0);
    const totalStrokes=scorecard.reduce((a,b)=>a+b,0),totalDiff=totalStrokes-totalPar;
    const holeScore=scorecard[scorecard.length-1],holePar=completedHole.par,holeDiff=holeScore-holePar;
    const holeResult=scoreLabel(holeScore,holePar);
    const diffColor=totalDiff<0?'var(--gold)':totalDiff===0?'var(--green-lt)':'var(--red)';
    const holeDiffColor=holeDiff<0?'var(--gold)':holeDiff===0?'var(--green-lt)':'var(--red)';
    const nextHole=COURSE[holeIdx+1];
    function proceedToNextHole(){const n=holeIdx+1;setHoleIdx(n);resetHole(n);setScreen('game');}
    return(
      <div className="screen center" style={{gap:0}}>
        <div style={{width:'100%',background:'var(--surface)',border:'1px solid var(--gold)',borderRadius:8,padding:'10px 16px',marginBottom:20,textAlign:'center'}}>
          <p style={{fontSize:'0.6rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:2}}>Presented by</p>
          <p style={{fontFamily:'Georgia,serif',fontSize:'1.1rem',color:'var(--gold)',letterSpacing:'1px'}}>{SPONSOR_NAME}</p>
        </div>
        <p style={{fontSize:'0.65rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:4}}>Hole {completedHole.number} Complete — Par {holePar}</p>
        <div style={{fontFamily:'Georgia,serif',fontSize:'2.2rem',color:holeDiffColor,marginBottom:4}}>{holeResult}</div>
        <p style={{fontSize:'0.85rem',color:'var(--muted)',marginBottom:20}}>{holeScore} strokes · {holeDiff>0?`+${holeDiff}`:holeDiff===0?'E':holeDiff} on the hole</p>
        <div style={{width:'100%',marginBottom:20}}>
          <p style={{fontSize:'0.65rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:10,textAlign:'center'}}>Scorecard</p>
          <div style={{display:'flex',gap:4,flexWrap:'wrap',justifyContent:'center'}}>
            {scorecard.map((s,i)=>{const d=s-COURSE[i].par,color=d<0?'var(--gold)':d===0?'var(--green-lt)':'var(--red)';return(<div key={i} style={{background:'var(--surface)',border:`1px solid ${color}`,borderRadius:6,padding:'6px 8px',textAlign:'center',minWidth:38}}><div style={{color:'var(--muted)',fontSize:'0.6rem'}}>H{i+1}</div><div style={{color,fontSize:'0.9rem',fontFamily:'Georgia,serif'}}>{s}</div></div>);})}
          </div>
        </div>
        <div style={{background:'var(--surface)',border:`1px solid ${diffColor}`,borderRadius:8,padding:'12px 24px',marginBottom:24,textAlign:'center'}}>
          <p style={{fontSize:'0.6rem',letterSpacing:'2px',textTransform:'uppercase',color:'var(--muted)',marginBottom:4}}>Total Score</p>
          <p style={{fontFamily:'Georgia,serif',fontSize:'1.6rem',color:diffColor}}>{totalDiff<0?totalDiff:totalDiff===0?'E':`+${totalDiff}`}</p>
          <p style={{fontSize:'0.75rem',color:'var(--muted)'}}>{totalStrokes} strokes · Par {totalPar}</p>
        </div>
        <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,padding:'12px 16px',marginBottom:20,width:'100%',textAlign:'center'}}>
          <p style={{fontSize:'0.6rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:4}}>Up Next</p>
          <p style={{fontFamily:'Georgia,serif',fontSize:'1rem',color:'var(--text)'}}>Hole {nextHole.number} — {nextHole.name}</p>
          <p style={{fontSize:'0.78rem',color:'var(--muted)'}}>Par {nextHole.par} · {nextHole.yards} yards{nextHole.water?' · 🌊 Water':''}</p>
        </div>
        <button className="btn" style={{width:'100%'}} onClick={proceedToNextHole}>{isLastHole?'Finish Round →':`Tee Off Hole ${nextHole.number} →`}</button>
      </div>
    );
  }

  if(screen==='start')return(
    <div className="screen center" style={{gap:0,justifyContent:'center'}}>
      <div style={{width:80,height:80,borderRadius:'50%',border:'2px solid var(--gold)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'2rem',marginBottom:24,background:'radial-gradient(circle,#1a2e20 0%,var(--bg) 100%)',boxShadow:'0 0 32px rgba(200,168,75,0.15)'}}>⛳</div>
      <h1 style={{fontFamily:'Georgia,serif',fontSize:'clamp(2.4rem,9vw,3.8rem)',color:'var(--gold)',letterSpacing:'2px',lineHeight:1.1,textAlign:'center',marginBottom:8}}>Scramble<br/>Brains</h1>
      <div style={{width:60,height:1,background:'var(--gold)',opacity:0.4,margin:'16px auto'}}/>
      <p style={{fontSize:'0.72rem',letterSpacing:'4px',textTransform:'uppercase',color:'var(--muted)',marginBottom:16}}>Golf · Trivia · Strategy</p>
      {isGuest&&<div style={{width:'100%',maxWidth:300,background:'rgba(200,168,75,0.1)',border:'1px solid var(--gold)',borderRadius:8,padding:'10px 14px',marginBottom:16,textAlign:'center'}}>
        <p style={{fontSize:'0.72rem',color:'var(--gold)',fontFamily:'Georgia,serif'}}>⚠️ Guest mode — no handicap or ranking will be tracked</p>
      </div>}
      {(!loadProfile()||isGuest)&&<div style={{width:'100%',maxWidth:280,display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
        {playerNames.map((name,i)=>(
          <div key={i} style={{display:'flex',gap:8,alignItems:'center'}}>
            <input type="text" placeholder={i===0?'Your name':'Player '+(i+1)+' name'} value={name} onChange={e=>updateName(i,e.target.value)} maxLength={20}
              style={{flex:1,background:'transparent',border:'none',borderBottom:'1px solid var(--gold)',color:'var(--text)',padding:'10px 8px',fontFamily:'Georgia,serif',fontSize:'1rem',letterSpacing:'2px',textAlign:'center',outline:'none'}}/>
            {i>0&&<button onClick={()=>removeName(i)} style={{background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',padding:'6px 10px',borderRadius:6,cursor:'pointer',fontFamily:'Georgia,serif',fontSize:'0.8rem'}}>✕</button>}
          </div>
        ))}
        {playerNames.length<4&&<button onClick={()=>setPlayerNames(n=>[...n,''])} style={{background:'transparent',border:'1px dashed var(--border)',color:'var(--muted)',padding:'8px',borderRadius:6,fontFamily:'Georgia,serif',fontSize:'0.78rem',cursor:'pointer'}}>+ Add Player</button>}
      </div>}
      {loadProfile()&&!isGuest&&<div style={{background:'var(--surface)',border:'1px solid var(--gold)',borderRadius:8,padding:'12px 16px',marginBottom:16,width:'100%',maxWidth:280,textAlign:'center'}}>
        <p style={{fontSize:'0.65rem',letterSpacing:'2px',textTransform:'uppercase',color:'var(--muted)',marginBottom:4}}>Playing as</p>
        <p style={{fontFamily:'Georgia,serif',fontSize:'1.1rem',color:'var(--gold)'}}>{loadProfile()?.name}</p>
      </div>}
      <p style={{fontSize:'0.65rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:10}}>How many holes?</p>
      <div style={{display:'flex',gap:8,marginBottom:6,width:'100%',maxWidth:280}}>
        {([9,18] as const).map(n=>(
          <button key={n} onClick={()=>setRoundLength(n)} style={{flex:1,background:roundLength===n?'var(--gold)':'transparent',color:roundLength===n?'var(--bg)':'var(--muted)',border:`1px solid ${roundLength===n?'var(--gold)':'var(--border)'}`,padding:'12px',borderRadius:6,fontFamily:'Georgia,serif',fontSize:'1rem',cursor:'pointer'}}>{n} Holes</button>
        ))}
      </div>
      <p style={{fontSize:'0.7rem',letterSpacing:'2px',textTransform:'uppercase',color:'var(--border)',marginBottom:16}}>Par {COURSE.slice(0,roundLength).reduce((s,h)=>s+h.par,0)}</p>
      <button onClick={startRound}
        style={{background:'transparent',border:`1px solid ${playerNames[0].trim()?'var(--gold)':'var(--border)'}`,color:playerNames[0].trim()?'var(--gold)':'var(--muted)',padding:'14px 48px',borderRadius:2,fontFamily:'Georgia,serif',fontSize:'0.85rem',letterSpacing:'4px',textTransform:'uppercase',cursor:'pointer'}}
        onMouseEnter={e=>{if(!playerNames[0].trim())return;(e.target as HTMLButtonElement).style.background='var(--gold)';(e.target as HTMLButtonElement).style.color='var(--bg)';}}
        onMouseLeave={e=>{(e.target as HTMLButtonElement).style.background='transparent';(e.target as HTMLButtonElement).style.color=playerNames[0].trim()?'var(--gold)':'var(--muted)';}}>
        {playerNames.filter(n=>n.trim()).length>1?'Start Multiplayer →':'Enter'}
      </button>
      <button onClick={()=>setShowProfile(true)} style={{marginTop:16,background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',padding:'8px 24px',borderRadius:6,fontFamily:'Georgia,serif',fontSize:'0.75rem',letterSpacing:'2px',cursor:'pointer'}}>🏌️ Player Profiles</button>
      <button onClick={()=>setScreen('modes')} style={{marginTop:8,background:'transparent',border:'none',color:'var(--muted)',fontFamily:'Georgia,serif',fontSize:'0.8rem',cursor:'pointer'}}>← Back</button>
    </div>
  );

  if(screen==='multi'){
    const totalPar=COURSE.reduce((s,h)=>s+h.par,0);
    if(multiPhase==='end'){
      const totals=multiScores.map(sc=>sc.reduce((a,b)=>a+b,0));
      const sorted=activePlayers.map((name,i)=>({name,total:totals[i]})).sort((a,b)=>a.total-b.total);
      return(
        <div className="screen center">
          <p className="eyebrow">Final Leaderboard</p>
          <div style={{width:'100%',marginBottom:24,display:'flex',flexDirection:'column',gap:8}}>
            {sorted.map((p,rank)=>{const diff=p.total-totalPar;return(<div key={p.name} style={{background:'var(--surface)',border:`1px solid ${rank===0?'var(--gold)':'var(--border)'}`,borderRadius:8,padding:'12px 16px',display:'flex',alignItems:'center',gap:12}}>
              <span style={{fontSize:'1.2rem'}}>{rank===0?'🏆':`#${rank+1}`}</span>
              <span style={{flex:1,color:rank===0?'var(--gold)':'var(--text)',fontFamily:'Georgia,serif'}}>{p.name}</span>
              <span style={{color:'var(--muted)',fontSize:'0.85rem'}}>{p.total} strokes</span>
              <span style={{color:diff<0?'var(--gold)':diff===0?'var(--green-lt)':'var(--red)',fontSize:'0.85rem'}}>{diff>0?`+${diff}`:diff===0?'E':diff}</span>
            </div>);})}
          </div>
          <button className="btn" onClick={()=>setScreen('modes')}>Play Again</button>
        </div>
      );
    }
    if(multiPhase==='hole_results')return(
      <div className="screen center">
        <p className="eyebrow">Hole {multiHoleIdx+1} Results</p>
        <div style={{width:'100%',display:'flex',flexDirection:'column',gap:8,marginBottom:24}}>
          {[...multiHoleResults].sort((a,b)=>a.strokes-b.strokes).map((r,i)=>(
            <div key={r.name} style={{background:'var(--surface)',border:`1px solid ${i===0?'var(--gold)':'var(--border)'}`,borderRadius:8,padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{color:i===0?'var(--gold)':'var(--text)',fontFamily:'Georgia,serif'}}>{r.name}</span>
              <span style={{color:'var(--gold)'}}>{r.strokes} strokes</span>
            </div>
          ))}
        </div>
        <button className="btn" onClick={nextMultiHole}>{multiHoleIdx>=COURSE.length-1?'See Final Results →':`Hole ${multiHoleIdx+2} →`}</button>
      </div>
    );
    return(
      <div className="screen">
        <div className="scoreboard">
          {[['Hole',`${multiHoleIdx+1}/18`],['Par',multiHole.par],['Up',activePlayers[multiPlayerIdx]]].map(([l,v])=>(
            <div className="sc" key={String(l)}><span className="sc-label">{l}</span><span className="sc-val">{v}</span></div>
          ))}
        </div>
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
          <button onClick={()=>setScreen('start')} style={{background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',padding:'4px 10px',borderRadius:6,fontSize:'0.75rem',cursor:'pointer'}}>✕ Exit</button>
        </div>
        <div style={{textAlign:'center',marginBottom:12}}>
          <p style={{fontSize:'0.72rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:4}}>{multiHole.name}</p>
          <p style={{fontSize:'1rem',color:'var(--gold)',fontFamily:'Georgia,serif'}}>{activePlayers[multiPlayerIdx]}'s turn</p>
          <p style={{fontSize:'0.78rem',color:'var(--muted)'}}>Player {multiPlayerIdx+1} of {activePlayers.length}</p>
        </div>
        {multiPhase==='question'&&multiPicked===null&&multiTimeLeft!==null&&<div className="timer-wrap"><div className={`timer-bar ${multiTimeLeft<=5?'danger':''}`} style={{width:`${(multiTimeLeft/TIMER_SECONDS)*100}%`}}/><span className={`timer-label ${multiTimeLeft<=5?'danger':''}`}>{multiTimeLeft}s</span></div>}
        {multiQuestion&&<div className="card">
          <p className="q-text">{multiQuestion.text}</p>
          <div className="answers">
            {multiQuestion.answers.map((a:string,i:number)=>{let cls='ans';if(multiPicked!==null&&i===multiQuestion.correct)cls+=' correct';else if(multiPicked===i)cls+=' wrong';return<button key={i} className={cls} onClick={()=>handleMultiAnswer(i)} disabled={multiPicked!==null}><span className="ans-letter">{String.fromCharCode(65+i)}</span>{a}</button>;})}
          </div>
        </div>}
      </div>
    );
  }

  if(screen==='end'){
    const totalPar=COURSE.slice(0,roundLength).reduce((s,h)=>s+h.par,0);
    const totalStrokes=scorecard.reduce((a,b)=>a+b,0),diff=totalStrokes-totalPar;
    const profile=loadProfile();
    const answerPct=roundTotal>0?Math.round(roundCorrect/roundTotal*100):0;
    const projected=profile?calcProjectedRanking(profile,roundCorrect,roundTotal):null;
    const nextTuesday=getNextTuesdayNoon();
    const tuesdayStr=nextTuesday.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
    if(profile&&projected){
      try{
        localStorage.setItem('sb_pending_ranking',JSON.stringify({projectedHandicap:projected.projectedHandicap,projectedOwgtr:projected.projectedOwgtr}));
        const up={...profile,roundsPlayed:(profile.roundsPlayed||0)+1,correctAnswers:(profile.correctAnswers||0)+roundCorrect,totalAnswers:(profile.totalAnswers||0)+roundTotal};
        saveProfile(up);
      }catch{}
    }
    const tierColors:Record<string,string>={Championship:'#c8a84b',Advanced:'#3fa36b',Intermediate:'#4a90d9',Recreational:'#9b59b6',Beginner:'#7a9485'};
    const tierColor=tierColors[profile?.courseTier||'Intermediate'];
    const movementColor=projected?.movement==='improved'?'var(--green-lt)':projected?.movement==='declined'?'var(--red)':'var(--muted)';
    const movementEmoji=projected?.movement==='improved'?'📈':projected?.movement==='declined'?'📉':'➡️';
    const movementLabel=projected?.movement==='improved'?'Improving':projected?.movement==='declined'?'Declining':'Holding Steady';
    return(
      <div className="screen center">
        <p className="eyebrow">{playerName?`${playerName}'s Round`:'Round Complete'}</p>
        <div className="score-big">{totalLabel(diff)}</div>
        <p className="muted" style={{marginBottom:16}}>{totalStrokes} strokes · Par {totalPar}</p>
        <div className="scorecard">
          <div className="sc-row header"><span>Hole</span><span>Par</span><span>Score</span><span>Result</span></div>
          {COURSE.map((h,i)=><div className="sc-row" key={h.number}><span>{h.number}</span><span>{h.par}</span><span>{scorecard[i]??'—'}</span><span>{scorecard[i]!=null?scoreLabel(scorecard[i],h.par):'—'}</span></div>)}
          <div className="sc-row" style={{fontWeight:'bold',borderTop:'2px solid var(--border)'}}><span>Total</span><span>{totalPar}</span><span>{totalStrokes}</span><span>{diff>0?`+${diff}`:diff===0?'E':diff}</span></div>
        </div>
        {profile&&projected&&<div style={{width:'100%',marginBottom:20}}>
          <p style={{fontSize:'0.65rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:12,textAlign:'center'}}>Trivia — {answerPct}% ({roundCorrect}/{roundTotal})</p>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
            {([['Current Handicap',profile.triviaHandicap,tierColor],['Current O.W.G.T.R.',profile.owgtr,'var(--gold)'],['Projected Handicap',projected.projectedHandicap,movementColor],['Projected O.W.G.T.R.',projected.projectedOwgtr,movementColor]] as [string,any,string][]).map(([label,val,color])=>(
              <div key={label} style={{background:'var(--surface)',border:`1px solid ${color}`,borderRadius:8,padding:'10px',textAlign:'center'}}>
                <div style={{fontSize:'0.58rem',letterSpacing:'1.5px',textTransform:'uppercase',color:'var(--muted)',marginBottom:4}}>{label}</div>
                <div style={{fontSize:'1.2rem',fontFamily:'Georgia,serif',color}}>{val}</div>
              </div>
            ))}
          </div>
          <div style={{background:'var(--surface)',border:`1px solid ${movementColor}`,borderLeft:`3px solid ${movementColor}`,borderRadius:8,padding:'12px 16px',textAlign:'center'}}>
            <p style={{fontSize:'1rem',color:movementColor,fontFamily:'Georgia,serif',marginBottom:4}}>{movementEmoji} {movementLabel}</p>
            <p style={{fontSize:'0.72rem',color:'var(--muted)'}}>Rankings update <strong style={{color:'var(--text)'}}>Tuesday, {tuesdayStr}</strong> at 12:00 PM ET</p>
          </div>
        </div>}
        <button className="btn" onClick={()=>setScreen('modes')}>Play Again</button>
      </div>
    );
  }

  const availableClubs=getAvailableClubs(remaining),bucket=getBucket(remaining);
  return(
    <div className="screen">
      <div className="scoreboard">
        {[['Hole',`${hole.number}/18`],['Par',hole.par],['Strokes',strokes],['Lie',lie],['To Go',remaining>20?`${remaining}yd`:remaining>0?`${remaining}ft`:'—']].map(([l,v])=>(
          <div className="sc" key={String(l)}><span className="sc-label">{l}</span><span className="sc-val">{v}</span></div>
        ))}
        <div className="sc"><span className="sc-label">Wind</span><span className="sc-val" style={{fontSize:'0.78rem'}}>{wind.speed===0?'—':`${WIND_ARROWS[wind.dir]}${wind.speed}`}</span></div>
      </div>
      <HoleGraphic holeYards={hole.yards} remaining={remaining} lie={lie} par={hole.par} strokes={strokes} scorecard={scorecard} playerName={playerName} isMulti={false}/>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <p className="phase-label" style={{margin:0}}>{hole.name} · {bucket} · {remaining>20?`${remaining} yards`:`${remaining} feet`} to go</p>
        <button onClick={()=>setScreen('start')} style={{background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',padding:'4px 10px',borderRadius:6,fontSize:'0.75rem',cursor:'pointer'}}>✕ Exit</button>
      </div>
      {scorecard.length>0&&<div style={{display:'flex',gap:4,marginBottom:14,flexWrap:'wrap'}}>
        {scorecard.map((s,i)=>{const d=s-COURSE[i].par,color=d<0?'var(--gold)':d===0?'var(--green-lt)':'var(--red)';return<div key={i} style={{background:'var(--surface)',border:`1px solid ${color}`,borderRadius:6,padding:'4px 8px',textAlign:'center',fontSize:'0.78rem',minWidth:36}}><div style={{color:'var(--muted)',fontSize:'0.65rem'}}>H{i+1}</div><div style={{color}}>{s}</div></div>;})}
      </div>}
      {phase==='club'&&<>
        <p className="phase-label">Select Your Club</p>
        {wind.speed>0&&<p style={{fontSize:'0.72rem',color:'var(--muted)',marginBottom:8,textAlign:'center'}}>{WIND_ARROWS[wind.dir]} {wind.speed} mph {wind.dir} wind{['S','SW','SE'].includes(wind.dir)?' — tailwind':['N'].includes(wind.dir)?' — headwind':' — crosswind'}</p>}
        <div className="strategy-row">
          {availableClubs.map(c=><button key={c} className="strat-btn" onClick={()=>chooseClub(c)}>{CLUBS[c].emoji} {CLUBS[c].name}<span style={{display:'block',fontSize:'0.75rem',color:'var(--muted)',marginTop:3}}>~{CLUBS[c].yards} yds</span></button>)}
        </div>
      </>}
      {phase==='question'&&picked===null&&timeLeft!==null&&<div className="timer-wrap"><div className={`timer-bar ${timeLeft<=5?'danger':''}`} style={{width:`${(timeLeft/TIMER_SECONDS)*100}%`}}/><span className={`timer-label ${timeLeft<=5?'danger':''}`}>{timeLeft}s</span></div>}
      {phase==='question'&&question&&<div className="card">
        <p className="q-text">{question.text}</p>
        <div className="answers">
          {question.answers.map((a:string,i:number)=>{let cls='ans';if(picked!==null&&i===question.correct)cls+=' correct';else if(picked===i)cls+=' wrong';return<button key={i} className={cls} onClick={()=>handleAnswer(i)} disabled={picked!==null}><span className="ans-letter">{String.fromCharCode(65+i)}</span>{a}</button>;})}
        </div>
      </div>}
      {phase==='feedback'&&feedback&&<div className="feedback">
        {feedback.split('\n\n').map((line,i)=><p key={i} style={i>0?{color:'var(--gold)',fontWeight:'bold',borderTop:'1px solid var(--border)',paddingTop:8}:{}}>{line}</p>)}
        <button className="btn-next" onClick={nextShot}>{lie==='Holed'?(holeIdx<COURSE.length-1?'Next Hole →':'Finish Round →'):remaining<=20?'Putt →':'Next Shot →'}</button>
      </div>}
    </div>
  );
}
