import { useState, useEffect } from 'react';
import { corbQuestions } from './corbQuestions';
import { easyQuestions } from './easyQuestions';
import { generalQuestions } from './generalQuestions';
import { pittsburghQuestions } from './pittsburghQuestions';
import { cloudSaveProfile, cloudCreateProfile, cloudCheckNameExists, cloudLoadProfile } from './supabase';
import { LeaderboardScreen, LeaderboardTicker, fetchLeaderboard } from './Leaderboard';
 
const TIMER_SECONDS = 15;
const EXPERIENCE_LEVELS = ['Beginner','Intermediate','Advanced','Scratch'];
const ALL_CATEGORIES = ['Golf','Pittsburgh','Wrestling','Sidney Sweeney','Monster Squad','Charles Barkley','East Pittsburgh'];
 
// ─── TYPES ────────────────────────────────────────────────────────
type Questionnaire = {
  q1: string; q2: string; q3: string; q4: string; q5: string;
  q6: string; q7: string; q8: string; q9: string; q10: string;
};
 
type Profile = {
  name: string;
  experience: string;
  favCats: string[];
  owgtr: number;
  triviaHandicap: number;
  sbr: number;
  roundsPlayed: number;
  correctAnswers: number;
  totalAnswers: number;
  questionnaire?: Questionnaire;
  courseTier?: string;
  pin?: string;
};
 
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
 
// ─── HANDICAP CALCULATOR ─────────────────────────────────────────
function calcSBR(q: Questionnaire): number {
  let ageScore = 0;
  if (q.q7 === 'Under 18') ageScore = 820;
  else if (q.q7 === '18–34') ageScore = 1100;
  else if (q.q7 === '35–54') ageScore = 1250;
  else ageScore = 1150;
  let triviaScore = 0;
  if (q.q9 === 'Expert — I win every time') triviaScore = 300;
  else if (q.q9 === 'Above average — I hold my own') triviaScore = 150;
  else if (q.q9 === 'Average — I know a little of everything') triviaScore = 50;
  return Math.min(1800, ageScore + triviaScore);
}
 
function calcHandicapFromQ(q: Questionnaire): { handicap: number; tier: string; owgtr: number } {
  let score = 0;
  if (q.q1 === 'Every day / Multiple times a week') score += 4;
  else if (q.q1 === 'Once a week') score += 3;
  else if (q.q1 === 'Occasionally') score += 2;
  else score += 1;
  if (q.q2 === 'Private / Country Club') score += 4;
  else if (q.q2 === 'Semi-private') score += 3;
  else if (q.q2 === 'Public / Municipal') score += 2;
  else score += 1;
  if (q.q3 === 'Scratch or better (0 and under)') score += 5;
  else if (q.q3 === 'Low (1–9)') score += 4;
  else if (q.q3 === 'Mid (10–18)') score += 3;
  else if (q.q3 === 'High (19–36+)') score += 2;
  else score += 1;
  if (q.q9 === 'Expert — I win every time') score += 4;
  else if (q.q9 === 'Above average — I hold my own') score += 3;
  else if (q.q9 === 'Average — I know a little of everything') score += 2;
  else score += 1;
  let handicap: number; let tier: string; let owgtr: number;
  if (score >= 15) { handicap = 2; tier = 'Championship'; owgtr = 1800; }
  else if (score >= 12) { handicap = 8; tier = 'Advanced'; owgtr = 1400; }
  else if (score >= 9) { handicap = 16; tier = 'Intermediate'; owgtr = 1000; }
  else if (score >= 6) { handicap = 24; tier = 'Recreational'; owgtr = 700; }
  else { handicap = 36; tier = 'Beginner'; owgtr = 500; }
  return { handicap, tier, owgtr };
}
 
// ─── STORAGE ─────────────────────────────────────────────────────
function loadProfile(): Profile | null {
  try { const s = localStorage.getItem('sb_profile'); return s ? JSON.parse(s) : null; } catch { return null; }
}
function saveProfile(p: Profile) {
  try { localStorage.setItem('sb_profile', JSON.stringify(p)); } catch {}
}
function loadQuestionnaire(): Questionnaire | null {
  try { const s = localStorage.getItem('sb_questionnaire'); return s ? JSON.parse(s) : null; } catch { return null; }
}
function saveQuestionnaire(q: Questionnaire) {
  try { localStorage.setItem('sb_questionnaire', JSON.stringify(q)); } catch {}
}
 
// ─── RANKING SYSTEM ──────────────────────────────────────────────
const TIER_EXPECTED_PCT: Record<string,number> = {
  Championship: 0.85, Advanced: 0.70, Intermediate: 0.55, Recreational: 0.40, Beginner: 0.25,
};
 
function calcProjectedRanking(profile: Profile, roundCorrect: number, roundTotal: number): { projectedHandicap: number; projectedOwgtr: number; movement: string } {
  if (roundTotal === 0) return { projectedHandicap: profile.triviaHandicap, projectedOwgtr: profile.owgtr, movement: 'none' };
  const pct = roundCorrect / roundTotal;
  const expected = TIER_EXPECTED_PCT[profile.courseTier || 'Intermediate'] || 0.55;
  const diff = pct - expected;
  let hcpChange = 0; let owgtrChange = 0;
  if (diff > 0.15) { hcpChange = -2; owgtrChange = 75; }
  else if (diff > 0.05) { hcpChange = -1; owgtrChange = 35; }
  else if (diff < -0.15) { hcpChange = 2; owgtrChange = -75; }
  else if (diff < -0.05) { hcpChange = 1; owgtrChange = -35; }
  const projectedHandicap = Math.max(0, Math.min(36, profile.triviaHandicap + hcpChange));
  const projectedOwgtr = Math.max(100, profile.owgtr + owgtrChange);
  const movement = hcpChange < 0 ? 'improved' : hcpChange > 0 ? 'declined' : 'held';
  return { projectedHandicap, projectedOwgtr, movement };
}
 
function getNextTuesdayNoon(): Date {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const daysUntilTuesday = (2 - day + 7) % 7 || 7;
  const next = new Date(et);
  next.setDate(et.getDate() + daysUntilTuesday);
  next.setHours(12, 0, 0, 0);
  return next;
}
 
function checkAndApplyTuesdayUpdate(profile: Profile): Profile {
  try {
    const lastUpdate = localStorage.getItem('sb_last_ranking_update');
    const pending = localStorage.getItem('sb_pending_ranking');
    if (!pending) return profile;
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const lastTuesday = getNextTuesdayNoon();
    lastTuesday.setDate(lastTuesday.getDate() - 7);
    if (!lastUpdate || new Date(lastUpdate) < lastTuesday) {
      if (nowET >= lastTuesday) {
        const { projectedHandicap, projectedOwgtr } = JSON.parse(pending);
        const updated = { ...profile, triviaHandicap: projectedHandicap, owgtr: projectedOwgtr };
        saveProfile(updated);
        localStorage.setItem('sb_last_ranking_update', nowET.toISOString());
        localStorage.removeItem('sb_pending_ranking');
        return updated;
      }
    }
  } catch {}
  return profile;
}
 
const CLUBS: any = {
  driver:   { name: 'Driver',         yards: 180, emoji: '🏌️' },
  wood3:    { name: '3-Wood',         yards: 160, emoji: '🌲' },
  wood5:    { name: '5-Wood',         yards: 148, emoji: '🌲' },
  hybrid4:  { name: '4-Hybrid',       yards: 143, emoji: '🔧' },
  iron4:    { name: '4-Iron',         yards: 135, emoji: '⛳' },
  iron5:    { name: '5-Iron',         yards: 126, emoji: '⛳' },
  iron6:    { name: '6-Iron',         yards: 120, emoji: '⛳' },
  iron7:    { name: '7-Iron',         yards: 115, emoji: '⛳' },
  iron8:    { name: '8-Iron',         yards: 108, emoji: '⛳' },
  iron9:    { name: '9-Iron',         yards: 100, emoji: '⛳' },
  pw:       { name: 'Pitching Wedge', yards: 85,  emoji: '🪁' },
  gw:       { name: 'Gap Wedge',      yards: 75,  emoji: '🪁' },
  sw:       { name: 'Sand Wedge',     yards: 62,  emoji: '🏖️' },
  lw:       { name: 'Lob Wedge',      yards: 50,  emoji: '🏖️' },
  wedge64:  { name: '64° Wedge',      yards: 38,  emoji: '🏖️' },
  putter:   { name: 'Putter',         yards: 0,   emoji: '🏳️' },
};
 
const COURSE = [
  { number: 1,  par: 4, yards: 380, name: 'Opening Drive',    water: false, ob: false },
  { number: 2,  par: 5, yards: 530, name: 'The Long Haul',    water: true,  ob: false },
  { number: 3,  par: 4, yards: 410, name: 'Uphill Battle',    water: false, ob: false },
  { number: 4,  par: 3, yards: 165, name: 'Island Green',     water: true,  ob: false },
  { number: 5,  par: 5, yards: 555, name: 'Back Nine Warm Up',water: false, ob: false },
  { number: 6,  par: 4, yards: 395, name: 'Dogleg Left',      water: false, ob: false },
  { number: 7,  par: 3, yards: 185, name: 'Cliff Edge',       water: true,  ob: false },
  { number: 8,  par: 4, yards: 425, name: 'The Gauntlet',     water: false, ob: false },
  { number: 9,  par: 5, yards: 510, name: 'Turn Home',        water: true,  ob: false },
  { number: 10, par: 4, yards: 400, name: 'Back Nine Opener', water: false, ob: false },
  { number: 11, par: 3, yards: 170, name: 'Short but Deadly', water: false, ob: false },
  { number: 12, par: 5, yards: 545, name: 'The Grind',        water: true,  ob: false },
  { number: 13, par: 4, yards: 415, name: 'Lucky 13',         water: false, ob: false },
  { number: 14, par: 3, yards: 155, name: 'Postage Stamp',    water: false, ob: false },
  { number: 15, par: 5, yards: 560, name: 'The Stretch',      water: false, ob: false },
  { number: 16, par: 4, yards: 390, name: 'Risk and Reward',  water: true,  ob: false },
  { number: 17, par: 3, yards: 195, name: 'Island Breeze',    water: true,  ob: false },
  { number: 18, par: 5, yards: 520, name: 'Grand Finale',     water: true,  ob: false },
];
 
function getAvailableClubs(remaining: number): string[] {
  if (remaining > 160) return ['driver', 'wood3', 'wood5'];
  if (remaining > 140) return ['wood3', 'wood5', 'hybrid4'];
  if (remaining > 120) return ['hybrid4', 'iron4', 'iron5'];
  if (remaining > 105) return ['iron5', 'iron6', 'iron7'];
  if (remaining > 90)  return ['iron7', 'iron8', 'iron9'];
  if (remaining > 70)  return ['iron9', 'pw', 'gw'];
  if (remaining > 50)  return ['pw', 'gw', 'sw'];
  if (remaining > 35)  return ['gw', 'sw', 'lw'];
  return ['sw', 'lw', 'wedge64'];
}
 
function getMultiplier(secondsLeft: number) {
  if (secondsLeft >= 10) return 1.05;
  if (secondsLeft >= 5)  return 0.9;
  if (secondsLeft > 0)   return 0.75;
  return 0.65;
}
 
function getBucket(remaining: number) {
  if (remaining > 160) return 'Long Shot';
  if (remaining > 120) return 'Long Approach';
  if (remaining > 75)  return 'Mid Approach';
  if (remaining > 20)  return 'Short Game';
  return 'Putting Range';
}
 
function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
 
const WIND_DIRS = ['N','NE','E','SE','S','SW','W','NW'];
const WIND_ARROWS: Record<string,string> = { N:'↓', NE:'↙', E:'←', SE:'↖', S:'↑', SW:'↗', W:'→', NW:'↘' };
 
function generateWind(): { speed: number; dir: string } {
  if (Math.random() < 0.2) return { speed: 0, dir: 'N' };
  const speed = rand(3, 18);
  const dir = WIND_DIRS[rand(0, WIND_DIRS.length - 1)];
  return { speed, dir };
}
 
function applyWind(clubYards: number, wind: { speed: number; dir: string }): number {
  if (wind.speed === 0) return clubYards;
  const headwindDirs = ['N'];
  const tailwindDirs = ['S'];
  const crossDirs    = ['NE','NW','SE','SW','E','W'];
  let factor = 0;
  if (headwindDirs.includes(wind.dir))      factor = -0.025 * wind.speed;
  else if (tailwindDirs.includes(wind.dir)) factor =  0.022 * wind.speed;
  else if (crossDirs.includes(wind.dir))    factor = -0.010 * wind.speed;
  return Math.round(clubYards * (1 + factor));
}
 
function calcShot(remaining: number, clubYards: number, correct: boolean, secondsLeft: number): { newRemaining: number; landNote: string; onGreen: boolean } {
  const shotDist = Math.round(clubYards * getMultiplier(secondsLeft));
  const raw = remaining - shotDist;
  if (!correct) {
    if (raw <= 0)  { const ft = rand(30,65); return { newRemaining: ft, landNote: `Mishit — ${ft} ft short of the hole`, onGreen: false }; }
    if (raw <= 30) { const ft = rand(35,70); return { newRemaining: ft, landNote: `Chunked it — ${ft} ft from the hole`, onGreen: false }; }
    const penalty = rand(12,28);
    return { newRemaining: raw+penalty, landNote: `${raw+penalty} yds remaining`, onGreen: false };
  }
  if (raw <= 0) {
    let ft: number, speedNote: string;
    if (secondsLeft >= 10)     { ft = rand(3,8);   speedNote = 'Great shot — tight to the flag!'; }
    else if (secondsLeft >= 5) { ft = rand(9,18);  speedNote = 'Solid contact — on the green.'; }
    else if (secondsLeft > 0)  { ft = rand(19,30); speedNote = 'Got there — longer putt ahead.'; }
    else                       { ft = rand(31,45); speedNote = 'Just made it — long putt remaining.'; }
    return { newRemaining: ft, landNote: `${speedNote} ${ft} ft from the hole`, onGreen: true };
  }
  if (raw <= 20) {
    const ft = secondsLeft >= 10 ? rand(8,15) : secondsLeft >= 5 ? rand(16,25) : rand(26,40);
    return { newRemaining: ft, landNote: `Rolled up — ${ft} ft from the hole`, onGreen: true };
  }
  const variation = rand(-8,8);
  const newRemaining = Math.max(21, raw+variation);
  return { newRemaining, landNote: `${newRemaining} yds remaining`, onGreen: false };
}
 
function calcPenalty(remaining: number, clubKey: string, correct: boolean, secondsLeft: number, hole: { water?: boolean; ob?: boolean }): { penaltyStrokes: number; penaltyNote: string; newRemaining: number; newLie: string } | null {
  if (correct) return null;
  const longClubs = ['driver','wood3','wood5','hybrid4','iron4'];
  const midClubs  = ['iron5','iron6','iron7','iron8','iron9'];
  const isLong = longClubs.includes(clubKey);
  const isMid  = midClubs.includes(clubKey);
  let waterChance = 0, obChance = 0, unplayableChance = 0;
  if (isLong) { waterChance = hole.water ? 0.28 : 0; obChance = hole.ob ? 0.22 : 0; unplayableChance = 0.15; }
  else if (isMid) { waterChance = hole.water ? 0.15 : 0; obChance = hole.ob ? 0.12 : 0; unplayableChance = 0.10; }
  else { waterChance = hole.water ? 0.08 : 0; obChance = hole.ob ? 0.06 : 0; unplayableChance = 0.05; }
  if (secondsLeft < 5)   { waterChance *= 1.4; obChance *= 1.4; unplayableChance *= 1.3; }
  if (secondsLeft === 0) { waterChance *= 1.8; obChance *= 1.8; unplayableChance *= 1.5; }
  const total = waterChance + obChance + unplayableChance;
  const roll = Math.random();
  if (roll > total) return null;
  const hazardRoll = Math.random();
  if (hazardRoll < waterChance / total) {
    const dropYards = Math.min(remaining + rand(15,30), remaining + 20);
    return { penaltyStrokes: 1, penaltyNote: `🌊 Water hazard! +1 penalty stroke. Dropping back — ${dropYards} yds remaining.`, newRemaining: dropYards, newLie: 'Rough' };
  }
  if (hazardRoll < (waterChance + obChance) / total) {
    return { penaltyStrokes: 1, penaltyNote: `🚩 Out of bounds! +1 penalty stroke. Replaying from same spot — ${remaining} yds remaining.`, newRemaining: remaining, newLie: 'Rough' };
  }
  const dropYards = remaining + rand(5,15);
  return { penaltyStrokes: 1, penaltyNote: `😬 Unplayable lie! +1 penalty stroke. Auto-dropped — ${dropYards} yds remaining.`, newRemaining: dropYards, newLie: 'Rough' };
}
 
function getLie(correct: boolean, onGreen: boolean) {
  if (onGreen) return correct ? 'Green' : 'Fringe';
  if (correct) return 'Fairway';
  const bad = ['Rough','Bunker','Rough','Rough'];
  return bad[Math.floor(Math.random() * bad.length)];
}
 
function getPuttResult(correct: boolean, secondsLeft: number): { feetLeft: number; note: string } {
  if (correct) {
    let note = 'Putt drops! Holed out.';
    if (secondsLeft >= 10) note = 'Perfect read — drops right in the center!';
    else if (secondsLeft >= 5) note = 'Good pace — rattles in!';
    return { feetLeft: 0, note };
  }
  const ft = rand(2,5);
  const misses = ['Lipped out','Slid by the edge','Caught the wrong break','Hit the back of the cup and popped out'];
  return { feetLeft: ft, note: `${misses[rand(0,misses.length-1)]} — ${ft} ft comeback putt.` };
}
 
function scoreLabel(strokes: number, par: number) {
  const d = strokes - par;
  if (d <= -2) return 'Eagle 🦅';
  if (d === -1) return 'Birdie 🐦';
  if (d === 0)  return 'Par ✅';
  if (d === 1)  return 'Bogey';
  if (d === 2)  return 'Double Bogey';
  return `+${d} Over`;
}
 
function totalLabel(diff: number) {
  if (diff < 0) return `${diff} Under Par 🔥`;
  if (diff === 0) return 'Even Par ✅';
  return `+${diff} Over Par`;
}
 
const PITTSBURGH_QUESTIONS: any[] = [
  { cat:'Sports', text:'What color are the Pittsburgh Steelers helmets?', answers:['Red and white','Black and gold','Blue and silver','Green and gold'], correct:1 },
  { cat:'Geography', text:'What two rivers meet near downtown Pittsburgh to form the Ohio River?', answers:['Susquehanna and Delaware','Allegheny and Monongahela','Yough and Turtle Creek','Ohio and Erie'], correct:1 },
  { cat:'Food & Culture', text:'What famous amusement park is located in West Mifflin near east Allegheny County?', answers:['Hersheypark','Six Flags','Kennywood Park','Idlewild'], correct:2 },
  { cat:'History & Landmarks', text:'What is the name of the famous steep cable railway on the south side of Pittsburgh?', answers:['The Skyway','Duquesne Incline','Pittsburgh Tram','Mon Valley Lift'], correct:1 },
  { cat:'Sports', text:'What sport do the Pittsburgh Pirates play?', answers:['Football','Hockey','Baseball','Basketball'], correct:2 },
  { cat:'Food & Culture', text:'What unusual items does Primanti Brothers stuff inside their sandwiches?', answers:['Pickles and mustard','Coleslaw and french fries','Cheese and bacon','Onions and peppers'], correct:1 },
  { cat:'Geography', text:'What county is Irwin PA located in?', answers:['Allegheny','Butler','Westmoreland','Fayette'], correct:2 },
  { cat:'History & Landmarks', text:'What is the name of Kennywood\'s famous wooden roller coaster?', answers:['Steel Curtain','The Phantom','The Racer','Jack Rabbit'], correct:3 },
  { cat:'Geography', text:'What town in the 15642 zip code is sometimes called the Gateway to Westmoreland County?', answers:['Export','Murrysville','Irwin','North Huntingdon'], correct:2 },
  { cat:'Sports', text:'What is the name of the Pittsburgh Penguins mascot?', answers:['Penguin Pete','Iceburgh','Chilly','Frosty'], correct:1 },
  { cat:'Food & Culture', text:'What Pittsburgh dairy brand is famous for its Klondike bars and chipped ham?', answers:['Turkey Hill','Isaly\'s','Eat\'n Park','Giant Eagle'], correct:1 },
  { cat:'History & Landmarks', text:'Kennywood has what special federal designation shared by very few amusement parks?', answers:['World Heritage Site','National Historic Landmark','State Park','Cultural District'], correct:1 },
  { cat:'Sports', text:'The Pittsburgh Penguins won back-to-back Stanley Cups in which two years?', answers:['2012 and 2013','2014 and 2015','2016 and 2017','2018 and 2019'], correct:2 },
  { cat:'History & Landmarks', text:'What industrialist\'s name does Westmoreland County honor?', answers:['Benjamin Franklin','George Westinghouse','Andrew Carnegie','Henry Clay Frick'], correct:1 },
  { cat:'Geography', text:'What is the name of the big mall near Monroeville?', answers:['Ross Park Mall','South Hills Village','Monroeville Mall','Century III Mall'], correct:2 },
  { cat:'Sports', text:'What is the current name of the stadium where the Pittsburgh Steelers play?', answers:['Three Rivers Stadium','PNC Park','Acrisure Stadium','PPG Paints Arena'], correct:2 },
  { cat:'Geography', text:'What major highway runs through the 15642 area connecting Pittsburgh to the east?', answers:['US Route 22','US Route 30','PA Route 8','US Route 40'], correct:1 },
  { cat:'Sports', text:'What jersey number does Sidney Crosby wear?', answers:['66','71','87','59'], correct:2 },
  { cat:'History & Landmarks', text:'What famous trail passes through Westmoreland County along a river for biking and hiking?', answers:['Appalachian Trail','Great Allegheny Passage','Pine Creek Rail Trail','Laurel Highlands Trail'], correct:1 },
  { cat:'Food & Culture', text:'What Pittsburgh-made product involves thinly sliced luncheon meat?', answers:['Pittsburgh Steak','Chipped Ham','Pepperoni Rolls','Iron City Chips'], correct:1 },
  { cat:'History & Landmarks', text:'What fort stood at the forks of the Ohio River during the French and Indian War?', answers:['Fort Necessity','Fort Ligonier','Fort Pitt','Fort Bedford'], correct:2 },
  { cat:'Sports', text:'What Pittsburgh Steelers quarterback won four Super Bowls in the 1970s?', answers:['Ben Roethlisberger','Terry Bradshaw','Kordell Stewart','Neil O\'Donnell'], correct:1 },
  { cat:'Nature & Parks', text:'What river in Westmoreland County is popular for white-water rafting?', answers:['Allegheny River','Monongahela River','Youghiogheny River','Beaver River'], correct:2 },
  { cat:'Sports', text:'Who made the famous Immaculate Reception for the Steelers in 1972?', answers:['Lynn Swann','John Stallworth','Rocky Bleier','Franco Harris'], correct:3 },
  { cat:'History & Landmarks', text:'What was the military road General Forbes built through Westmoreland County in 1758?', answers:['Braddock\'s Road','Forbes Road','Lincoln Highway','National Road'], correct:1 },
  { cat:'Sports', text:'What year did PNC Park open as the new home of the Pittsburgh Pirates?', answers:['1999','2001','2003','1997'], correct:1 },
  { cat:'History & Landmarks', text:'What catastrophic flood devastated Johnstown in 1889?', answers:['Susquehanna Flood','Johnstown Flood','Ohio Valley Flood','Conemaugh Flood'], correct:1 },
  { cat:'Sports', text:'What Pittsburgh Steelers running back was nicknamed The Bus?', answers:['Franco Harris','Rocky Bleier','Jerome Bettis','Willie Parker'], correct:2 },
  { cat:'Geography', text:'What is the county seat of Westmoreland County?', answers:['Latrobe','Greensburg','Connellsville','Jeannette'], correct:1 },
  { cat:'Sports', text:'What arena did the Penguins play in before PPG Paints Arena, nicknamed The Igloo?', answers:['Mellon Arena','Civic Arena','Pittsburgh Coliseum','The Dome'], correct:1 },
  { cat:'History & Landmarks', text:'What massive steel company had major plants in Homestead, Duquesne, and Braddock?', answers:['Bethlehem Steel','U.S. Steel','Republic Steel','Armco Steel'], correct:1 },
  { cat:'Sports', text:'What Pittsburgh Pirate hit the first home run at Three Rivers Stadium?', answers:['Roberto Clemente','Willie Stargell','Dave Parker','Bill Mazeroski'], correct:1 },
  { cat:'Food & Culture', text:'What Pittsburgh bakery is famous for its burnt almond torte?', answers:['Prantl\'s Bakery','Oakmont Bakery','Prestogeorge Coffee','La Gourmandine'], correct:0 },
  { cat:'Nature & Parks', text:'What state park in Westmoreland County offers boating and a public beach?', answers:['Laurel Hill State Park','Keystone State Park','Ohiopyle State Park','Kooser State Park'], correct:1 },
  { cat:'History & Landmarks', text:'What bloody 1892 labor battle took place at a steel mill just west of Westmoreland County?', answers:['Pullman Strike','Homestead Strike','Coal Strike of 1902','McKees Rocks Strike'], correct:1 },
  { cat:'Geography', text:'What river does Turtle Creek ultimately flow into?', answers:['Allegheny River','Ohio River','Monongahela River','Youghiogheny River'], correct:2 },
  { cat:'Food & Culture', text:'What Pittsburgh-area company made chipped ham and Klondike bars?', answers:['Eat\'n Park','Isaly\'s','Clark Bar Company','Pittsburgh Brewing'], correct:1 },
  { cat:'Sports', text:'What was the name of Pittsburgh\'s baseball stadium before PNC Park?', answers:['Forbes Field','Three Rivers Stadium','Exposition Park','Mellon Arena'], correct:1 },
  { cat:'History & Landmarks', text:'What beloved Pittsburgh department store was once on Fifth Avenue downtown?', answers:['Sears','Kaufmann\'s','JCPenney','Gimbels'], correct:1 },
  { cat:'Geography', text:'What tunnel do Westmoreland County commuters pass through on the Parkway East?', answers:['Fort Pitt Tunnel','Liberty Tunnel','Squirrel Hill Tunnel','Allegheny Tunnel'], correct:2 },
  { cat:'Sports', text:'What Pittsburgh Pirate died in a plane crash on New Year\'s Eve 1972 delivering aid?', answers:['Bill Mazeroski','Willie Stargell','Roberto Clemente','Dave Parker'], correct:2 },
  { cat:'History & Landmarks', text:'What Pittsburgh-born pop artist grew up in the Oakland neighborhood?', answers:['Roy Lichtenstein','Andy Warhol','Keith Haring','Jasper Johns'], correct:1 },
  { cat:'Food & Culture', text:'What Pittsburgh brewery produced Iron City Beer?', answers:['Duquesne Brewing','Pittsburgh Brewing Company','Penn Brewery','Straub Brewery'], correct:1 },
  { cat:'Sports', text:'What was the nickname of the Steelers dominant defense of the 1970s?', answers:['The Iron Curtain','The Steel Curtain','The Black Wall','The Gold Defense'], correct:1 },
  { cat:'Nature & Parks', text:'What fish is the Youghiogheny River most famous for among anglers?', answers:['Walleye','Catfish','Smallmouth Bass','Rainbow Trout'], correct:2 },
  { cat:'Food & Culture', text:'What Westmoreland County arts festival celebrates the region\'s heritage each summer?', answers:['Ligonier Highland Games','Westmoreland Arts & Heritage Festival','Laurel Festival','Three Rivers Arts Festival'], correct:1 },
  { cat:'Sports', text:'What year did the Pirates win their last World Series with the We Are Family team?', answers:['1971','1975','1979','1983'], correct:2 },
  { cat:'Food & Culture', text:'What Westmoreland County town known as the Glass City was home to major glass manufacturers?', answers:['Latrobe','Connellsville','Monessen','Jeannette'], correct:3 },
  { cat:'History & Landmarks', text:'What Revolutionary War-era fort in Westmoreland County played a key role in western PA defense?', answers:['Fort Necessity','Fort Pitt','Fort Ligonier','Fort Bedford'], correct:2 },
  { cat:'Sports', text:'What Pittsburgh boxer nicknamed The Pittsburgh Kid famously fought Joe Louis?', answers:['Harry Greb','Fritzie Zivic','Billy Conn','Paul Spadafora'], correct:2 },
];
 
const QUESTIONS: any = {
  driver: [
    { text:'What is the maximum legal driver head size in cubic centimeters according to USGA rules?', answers:['360cc','460cc','500cc','420cc'], correct:1 },
    { text:'Which golfer holds the PGA Tour record for the longest drive in competition at 515 yards?', answers:['John Daly','Bubba Watson','Mike Austin','Tiger Woods'], correct:2 },
    { text:'What does "driving for show, putting for dough" mean?', answers:['Long drives win tournaments','Putting matters more than driving for scoring','You should always use a driver','Driving is the hardest skill'], correct:1 },
    { text:'What is the term for hitting a driver shot that curves dramatically from left to right for a right-handed golfer?', answers:['Hook','Draw','Slice','Fade'], correct:2 },
    { text:'Which major championship course is famous for its narrow fairways that make driver accuracy critical?', answers:['Augusta National','Pebble Beach','Carnoustie','Pinehurst No. 2'], correct:2 },
    { text:'What is the legal maximum length for a driver shaft on the PGA Tour?', answers:['46 inches','48 inches','44 inches','50 inches'], correct:0 },
    { text:'Bubba Watson is known for hitting what type of driver shot as his signature move?', answers:['Straight bomb down the middle','Hard hook around corners','High fade over trees','Low punch draw'], correct:1 },
    { text:'Which golfer famously said "grip it and rip it" as his driving philosophy?', answers:['Tiger Woods','Phil Mickelson','John Daly','Dustin Johnson'], correct:2 },
  ],
  wood3: [
    { text:'When would a golfer typically choose a 3-wood over a driver off the tee?', answers:['When they want more distance','On narrow holes requiring more accuracy','On par 3s only','When the wind is behind them'], correct:1 },
    { text:'What is a "fairway wood" primarily designed to do?', answers:['Only used from the tee box','Hit long shots from the fairway or tee','Replace a putter on long greens','Only used in the rough'], correct:1 },
    { text:'Which Hall of Fame golfer was nicknamed "The Walrus" and was known for his long 3-wood?', answers:['Lee Trevino','Craig Stadler','Tom Watson','Fuzzy Zoeller'], correct:1 },
    { text:'What loft range does a typical 3-wood have?', answers:['8-10 degrees','15-18 degrees','20-23 degrees','12-14 degrees'], correct:1 },
    { text:'Tiger Woods famously hit a 3-wood second shot to set up an eagle on which iconic par 5 hole?', answers:['The 13th at Augusta','The 18th at Pebble Beach','The 15th at Augusta','The 18th at St Andrews'], correct:2 },
    { text:'What does "hitting it off the deck" mean in golf?', answers:['Hitting from a tee peg','Hitting a fairway wood from the ground','Hitting out of a bunker','Hitting from a cart path'], correct:1 },
    { text:'Which golfer is considered one of the best 3-wood players of all time due to his ability to hit it from anywhere?', answers:['Jack Nicklaus','Phil Mickelson','Seve Ballesteros','Gary Player'], correct:1 },
  ],
  wood5: [
    { text:'A 5-wood is often used as an alternative to which iron?', answers:['3-iron','5-iron','2-iron','7-iron'], correct:0 },
    { text:'What advantage does a 5-wood have over a long iron from the rough?', answers:['It goes shorter','Higher launch and more forgiveness through thick grass','Lower ball flight','Less spin'], correct:1 },
    { text:'Which LPGA legend was famous for her consistent 5-wood play throughout her career?', answers:['Annika Sorenstam','Nancy Lopez','Kathy Whitworth','Se Ri Pak'], correct:0 },
    { text:'What is the typical loft of a 5-wood?', answers:['12-14 degrees','18-19 degrees','20-22 degrees','25-27 degrees'], correct:2 },
    { text:'Why do many senior golfers prefer a 5-wood over a 3-iron?', answers:['It goes shorter distances','Easier to launch high with slower swing speeds','It is lighter','Rules require it'], correct:1 },
    { text:'What type of shot is a 5-wood particularly useful for on a par 5?', answers:['A layup shot','A bunker shot','A second shot trying to reach in two','A chip around the green'], correct:2 },
  ],
  hybrid4: [
    { text:'Hybrid clubs were designed to replace which traditionally difficult clubs to hit?', answers:['Short irons','Long irons and fairway woods','Wedges','Putters'], correct:1 },
    { text:'What year were hybrid clubs first widely introduced on the PGA Tour?', answers:['1985','1990','Early 2000s','2010'], correct:2 },
    { text:'What is the main design advantage of a hybrid club over a long iron?', answers:['Lower center of gravity for easier launch','More distance always','Smaller clubface','Heavier head weight'], correct:0 },
    { text:'Which player famously won a major using hybrids to replace all their long irons?', answers:['Tiger Woods','Vijay Singh','Ernie Els','Retief Goosen'], correct:1 },
    { text:'A 4-hybrid typically replaces which iron in a standard set?', answers:['2-iron','6-iron','4-iron','8-iron'], correct:2 },
    { text:'What type of lie is a hybrid club especially useful from?', answers:['Tight fairway lies only','Thick rough where irons would snag','Bunkers only','Putting green fringe only'], correct:1 },
  ],
  iron4: [
    { text:'What is the typical loft of a 4-iron?', answers:['18-20 degrees','24-27 degrees','30-34 degrees','40 degrees'], correct:1 },
    { text:'Ben Hogan was considered the best iron player of his era. Which major did he win after a near-fatal car accident?', answers:['The Masters','1950 US Open','The Open Championship','PGA Championship'], correct:1 },
    { text:'Why is the 4-iron considered one of the hardest clubs to hit for amateurs?', answers:['It is too short','Low loft makes it difficult to get the ball airborne','It is too light','The shaft is too flexible'], correct:1 },
    { text:'What does "hitting it pure" mean when describing an iron shot?', answers:['Hitting the ball in the rough','Making perfect contact in the center of the clubface','Hitting a high shot','Hitting it soft'], correct:1 },
    { text:'Which legendary golfer was nicknamed "The Iron Byron"?', answers:['Byron Nelson','Ben Hogan','Sam Snead','Arnold Palmer'], correct:0 },
    { text:'What is a "stinger" shot often hit with a 4-iron?', answers:['A high-launching power shot','A low penetrating shot to keep the ball under the wind','A shot out of the bunker','A flop shot'], correct:1 },
  ],
  iron5: [
    { text:'What is the approximate carry distance of a 5-iron for a PGA Tour pro?', answers:['150 yards','195 yards','220 yards','170 yards'], correct:1 },
    { text:'Which golfer is famous for his textbook iron swing often used in instructional videos?', answers:['John Daly','Ben Hogan','Phil Mickelson','Lee Trevino'], correct:1 },
    { text:'What does "taking a divot" indicate about a good iron shot?', answers:['A mistake that costs a stroke','Ball-first contact compressing the ball properly','Hitting too hard','Hitting from sand'], correct:1 },
    { text:"Augusta National's par-3 12th hole — Golden Bell — requires what club for most pros?", answers:['Driver','5 or 6-iron','Putter','Sand wedge'], correct:1 },
    { text:'What is the proper ball position for a standard 5-iron shot?', answers:['Off the back foot','Center of stance','Slightly forward of center','Off the front heel'], correct:2 },
    { text:'Which Hall of Famer won 18 majors and was known for his precise mid-iron play?', answers:['Arnold Palmer','Gary Player','Jack Nicklaus','Tom Watson'], correct:2 },
  ],
  iron6: [
    { text:'What is the name of the famous iron shot Tiger Woods hit on the 16th hole at the 2005 Masters that almost went in?', answers:['The Chip','The Flop','The Stinger','The Dunk'], correct:0 },
    { text:'In golf, what does "working the ball" mean?', answers:['Practicing on the range','Intentionally shaping shots left or right','Hitting straight shots only','Using extra spin on putts'], correct:1 },
    { text:'A 6-iron is classified as what type of iron?', answers:['Long iron','Short iron','Mid iron','Wedge'], correct:2 },
    { text:'What is "compression" in the context of hitting an iron shot?', answers:['How hard you grip the club','Trapping the ball between the clubface and ground at impact','The weight of the club','The sound the ball makes'], correct:1 },
    { text:'Which famous par 3 hole at Pebble Beach often requires a 6-iron due to ocean winds?', answers:['7th hole','3rd hole','18th hole','12th hole'], correct:0 },
    { text:'What does AoA stand for in modern iron fitting?', answers:['Angle of Attack','Accuracy of Alignment','Axis of Approach','Arc of Arc'], correct:0 },
  ],
  iron7: [
    { text:'The 7-iron is often called the most versatile club. What is its approximate loft?', answers:['25 degrees','34 degrees','42 degrees','20 degrees'], correct:1 },
    { text:'Which golfer hit a famous 7-iron to 6 feet on the 72nd hole to win the 1972 US Open at Pebble Beach?', answers:['Arnold Palmer','Jack Nicklaus','Lee Trevino','Tom Watson'], correct:1 },
    { text:'What is a "punch shot" typically hit with a 7-iron?', answers:['A high flop shot','A low-trajectory shot under the wind with abbreviated follow-through','A full swing power shot','A chip from the fringe'], correct:1 },
    { text:'Why is a 7-iron recommended for beginners to learn with?', answers:['It goes the farthest','Its mid-loft and length make it the most forgiving to learn swing mechanics','It is the shortest club','Rules require beginners to use it'], correct:1 },
    { text:'What does "flight the ball" mean when hitting a 7-iron?', answers:['Hit it as high as possible','Control trajectory intentionally lower than normal','Spin the ball sideways','Hit a flop shot'], correct:1 },
    { text:"Rory McIlroy's average 7-iron distance is approximately how far?", answers:['155 yards','185 yards','205 yards','170 yards'], correct:1 },
  ],
  iron8: [
    { text:'What is the approximate loft of an 8-iron?', answers:['28 degrees','37-39 degrees','45 degrees','22 degrees'], correct:1 },
    { text:'What type of shot is an 8-iron most commonly used for?', answers:['Tee shots on par 3s over 200 yards','Approach shots inside 150 yards','Bunker shots only','Putting from the fringe'], correct:1 },
    { text:'What does "hitting it fat" mean on an iron shot?', answers:['Hitting it too far','Hitting the ground before the ball causing a heavy shot','Hitting it too high','Hitting with too much speed'], correct:1 },
    { text:'Which legendary iron player was known as "The Mechanic" for his precise ball-striking?', answers:['Sam Snead','Moe Norman','Chi Chi Rodriguez','Billy Casper'], correct:1 },
    { text:'What is "spin loft" and why does it matter for an 8-iron?', answers:['How far the ball goes','The difference between attack angle and dynamic loft that creates spin','The color of the ball','How the club looks at address'], correct:1 },
    { text:'On a downhill lie, what adjustment should a golfer make with an 8-iron?', answers:['Aim further left','Club down as the hill reduces effective loft','Swing harder','Move ball back in stance and expect lower flight'], correct:3 },
  ],
  iron9: [
    { text:'What is a 9-iron primarily used for?', answers:['Long par 5 second shots','Short approach shots inside 130 yards needing height','Tee shots on long par 3s','Chipping from thick rough only'], correct:1 },
    { text:'Who is known for his famous quote: "The most important shot in golf is the next one"?', answers:['Jack Nicklaus','Ben Hogan','Arnold Palmer','Sam Snead'], correct:1 },
    { text:'What does "hitting it thin" mean on a 9-iron?', answers:['The ball went too far left','The clubface contacted the ball above center, causing a low screamer','The shot was perfect','The ball landed soft'], correct:1 },
    { text:'What is the typical spin rate of a 9-iron on the PGA Tour?', answers:['3,000 rpm','8,500 rpm','12,000 rpm','6,000 rpm'], correct:2 },
    { text:'Which Masters champion was famous for his high soft 9-iron approach shots that stopped on a dime?', answers:['Tiger Woods','Seve Ballesteros','Fred Couples','Bubba Watson'], correct:1 },
    { text:'What is "backspin" on a 9-iron shot and what causes it?', answers:['Forward roll after landing','Ball spinning backward due to grooves gripping the ball at impact','Wind effect','Ball hitting a slope'], correct:1 },
  ],
  pw: [
    { text:'What is the typical loft of a pitching wedge?', answers:['35 degrees','44-48 degrees','56 degrees','60 degrees'], correct:1 },
    { text:'What does "pitching" in golf refer to?', answers:['Throwing the ball','A medium-distance lofted shot that flies more than it rolls','Hitting from the sand','A full driver swing'], correct:1 },
    { text:'Who is known as one of the greatest pitching wedge players for his consistent approach play?', answers:['John Daly','Sergio Garcia','Luke Donald','Pat Perez'], correct:2 },
    { text:'What is a "knockdown" pitching wedge shot?', answers:['A full swing shot','A controlled half-swing shot that keeps the ball flight low','A flop shot','A bump and run'], correct:1 },
    { text:'At what distance do most Tour pros switch from a pitching wedge to a gap wedge?', answers:['Over 160 yards','Under 100 yards','Around 130-140 yards','Under 50 yards'], correct:2 },
    { text:'What is the purpose of grooves on a pitching wedge?', answers:['Decoration only','Create friction to generate backspin and control','Make the club lighter','Help aim the shot'], correct:1 },
  ],
  gw: [
    { text:'What does "gap wedge" refer to?', answers:['A wedge used only in gaps between bunkers','A wedge that fills the distance gap between pitching and sand wedge','A putting wedge','A wedge used only in wind'], correct:1 },
    { text:'What is the typical loft of a gap wedge?', answers:['44 degrees','50-52 degrees','56 degrees','60 degrees'], correct:1 },
    { text:'Which major championship requires the most precise wedge play due to its small, undulating greens?', answers:['The Open Championship','The Masters at Augusta National','US Open at Winged Foot','PGA Championship at Whistling Straits'], correct:1 },
    { text:'What is a "bump and run" shot with a gap wedge?', answers:['A high lofted flop shot','A low-trajectory shot that lands short and rolls to the hole','A bunker blast','A full swing shot'], correct:1 },
    { text:'Phil Mickelson is famous for practicing 3-hour wedge sessions. What drill does he recommend?', answers:['Hitting full shots only','Clock drill hitting to different distances with partial swings','Only flop shots','Hitting out of bunkers'], correct:1 },
    { text:'What is "distance gapping" and why is it important with wedges?', answers:['How far apart you stand from the ball','Ensuring consistent yardage gaps between each wedge for precision','Aiming away from bunkers','The width of your stance'], correct:1 },
  ],
  sw: [
    { text:'Who invented the sand wedge in the early 1930s?', answers:['Arnold Palmer','Gene Sarazen','Bobby Jones','Walter Hagen'], correct:1 },
    { text:'What is "bounce" on a sand wedge and what does it do?', answers:['How high the ball bounces after landing','The angle of the sole that prevents the club from digging into sand','The flex in the shaft','How far the ball carries'], correct:1 },
    { text:'What is the typical loft of a sand wedge?', answers:['44 degrees','50 degrees','54-56 degrees','64 degrees'], correct:2 },
    { text:'What is the proper technique for a greenside bunker shot?', answers:['Hit the ball directly','Open the face, aim left, and splash the sand 2 inches behind the ball','Use a putting stroke','Hit down as hard as possible'], correct:1 },
    { text:'What does "plugged lie" mean in a bunker?', answers:['The ball rolled perfectly to the flag','The ball buried deep in the sand like a fried egg','An unplayable lie in water','The ball on top of the sand'], correct:1 },
    { text:'Seve Ballesteros was legendary for his bunker play. How many times did he win The Open Championship?', answers:['Once','Twice','Three times','Four times'], correct:2 },
  ],
  lw: [
    { text:'Phil Mickelson is famous for his "Phil Flop" shot. What club does he use?', answers:['Sand wedge','Gap wedge','Lob wedge','Pitching wedge'], correct:2 },
    { text:'What is a "flop shot" in golf?', answers:['A low running chip','A high soft shot that lands and stops quickly','A bump and run','A full swing punch shot'], correct:1 },
    { text:'What is the typical loft range of a lob wedge?', answers:['50-52 degrees','54-56 degrees','58-64 degrees','44-48 degrees'], correct:2 },
    { text:'When is a lob wedge the preferred choice over a sand wedge?', answers:['From 150 yards out','When needing maximum height with minimal roll around tight pin positions','Only from fairway bunkers','When hitting into the wind'], correct:1 },
    { text:'What risk does the lob wedge carry that makes it difficult to use under pressure?', answers:['It goes too far','Thin contact sends the ball screaming across the green','It is too heavy','It cannot hit from sand'], correct:1 },
    { text:'Which Tour pro is known for the most creative lob wedge shots in major championship history?', answers:['Tiger Woods','Jack Nicklaus','Phil Mickelson','Seve Ballesteros'], correct:2 },
  ],
  wedge64: [
    { text:'A 64-degree wedge is considered an extreme specialty club. What is its main use?', answers:['Long approach shots','Ultra-high soft shots from very tight lies or bunkers','Tee shots on short par 3s','Putting from off the green'], correct:1 },
    { text:'What is "spin milling" on high-lofted wedges and why was it banned?', answers:['A decorative finish','Sharp face milling that created too much spin, banned by USGA in 2010','A type of practice drill','The way grooves are cleaned'], correct:1 },
    { text:'Who popularized extreme high-lofted wedge shots on Tour in the 1990s and 2000s?', answers:['Tiger Woods','Phil Mickelson','Vijay Singh','Ernie Els'], correct:1 },
    { text:'What is "face angle" on a 64-degree wedge and why does it matter?', answers:['Where you look at address','How open or closed the face is at impact, determining shot height and spin','The color of the face','The shaft angle'], correct:1 },
    { text:'Why do most club fitters caution against carrying a 64-degree wedge?', answers:['It is illegal in competition','Distance overlap with other wedges makes it redundant for most players','It is too expensive','It only works on soft courses'], correct:1 },
    { text:'What does "grind" mean when referring to a specialty wedge sole?', answers:['Practicing chip shots','Material removed from the sole to customize bounce and turf interaction','How rusty the club is','Hitting from hard ground'], correct:1 },
  ],
  putter: [
    { text:'What is the most putts ever recorded in a single round at a PGA Tour event?', answers:['32','40','28','45'], correct:1 },
    { text:'What does "reading the green" mean?', answers:['Looking at a map of the course','Studying the slope, grain, and speed to predict how the ball will roll','Reading the pin placement sheet','Measuring the distance to the hole'], correct:1 },
    { text:'Which golfer holds the record for most career wins on the PGA Tour?', answers:['Tiger Woods','Jack Nicklaus','Sam Snead','Ben Hogan'], correct:2 },
    { text:'What is a "yip" in putting?', answers:['A perfect putt','An involuntary muscle spasm or flinch that ruins the putting stroke','A long putt made','A putting technique'], correct:1 },
    { text:'What is "green speed" measured by and what tool is used?', answers:['A GPS device','A Stimpmeter — a ramp that rolls a ball to measure how far it travels','A ruler','A golf ball'], correct:1 },
    { text:'Jack Nicklaus won how many major championships in his career?', answers:['14','16','18','15'], correct:2 },
    { text:'What putting style did Tiger Woods use for most of his career?', answers:['The claw grip','Conventional grip with a slight forward press','Belly putter','Cross-handed grip'], correct:1 },
    { text:'Which hole at Augusta National is known as "Amen Corner"?', answers:['Holes 1-3','Holes 11-13','Holes 15-17','Holes 16-18'], correct:1 },
    { text:'What is a "lag putt"?', answers:['A putt you expect to make','A long putt aimed to get close to the hole rather than make','A putt hit too hard','A short tap-in putt'], correct:1 },
    { text:'What does "plumb bobbing" mean in putting?', answers:['Measuring the hole depth','Holding the putter vertically in front of your eye to read slope','A type of putting grip','A warm-up technique'], correct:1 },
  ],
};
 
function getProfilePool(profile: Profile | null): any[] {
  const allGolf = Object.values(QUESTIONS).flat() as any[];
  const sbr = profile?.sbr || 1000;
  const easyPool = sbr < 950 ? easyQuestions.filter((q:any) => q.difficulty === 'easy') :
                   sbr < 1200 ? easyQuestions : [];
  if (!profile || !profile.questionnaire) return [...allGolf, ...generalQuestions, ...easyPool];
  const q = profile.questionnaire;
  let pool: any[] = [...allGolf, ...generalQuestions];

  // Sports
  if (q.q4 === 'Sports & Athletics') pool = [...pool, ...generalQuestions.filter(x=>x.cat==='Sports'), ...pittsburghQuestions.filter(x=>x.cat==='Pittsburgh')];
  // History & Geography
  if (q.q4 === 'History & Geography') pool = [...pool, ...generalQuestions.filter(x=>x.cat==='History'||x.cat==='Geography'), ...pittsburghQuestions.filter(x=>x.cat==='Pittsburgh')];
  // Pop Culture
  if (q.q4 === 'Pop Culture & Entertainment') pool = [...pool, ...generalQuestions.filter(x=>x.cat==='Pop Culture'||x.cat==='Movies & TV'||x.cat==='Music')];
  // Hobbies
  if (q.q6 === 'Gaming / Technology / Movies & TV') pool = [...pool, ...generalQuestions.filter(x=>x.cat==='Movies & TV'||x.cat==='Pop Culture'), ...corbQuestions.filter((x:any)=>x.cat==='90s Wrestling'||x.cat==='Monster Squad'||x.cat==='Sidney Sweeney')];
  if (q.q6 === 'Fitness / Outdoor sports / Hunting & Fishing') pool = [...pool, ...generalQuestions.filter(x=>x.cat==='Sports'||x.cat==='Science & Nature')];
  if (q.q6 === 'Music / Art / Food & Cooking') pool = [...pool, ...generalQuestions.filter(x=>x.cat==='Music'||x.cat==='Food & Drink')];
  if (q.q6 === 'Reading / History / Travel') pool = [...pool, ...generalQuestions.filter(x=>x.cat==='History'||x.cat==='Geography')];
  // Sports followed
  if (q.q8 === 'Football (NFL / College)') pool = [...pool, ...generalQuestions.filter(x=>x.cat==='Sports'), ...pittsburghQuestions.filter(x=>x.cat==='Pittsburgh')];
  if (q.q8 === 'Baseball / Hockey / Basketball') pool = [...pool, ...generalQuestions.filter(x=>x.cat==='Sports'), ...pittsburghQuestions.filter(x=>x.cat==='Pittsburgh')];
  if (q.q8 === 'Combat sports / Motorsports / Extreme sports') pool = [...pool, ...corbQuestions.filter((x:any)=>x.cat==='90s Wrestling'||x.cat==='Charles Barkley')];
  // Region
  if (q.q5 === 'Northeast (PA, NY, NJ, New England)') pool = [...pool, ...pittsburghQuestions];
  // Pop culture era
  if (q.q10 === '90s / Early 2000s') pool = [...pool, ...generalQuestions.filter(x=>x.cat==='Nostalgia'), ...corbQuestions.filter((x:any)=>x.cat==='90s Wrestling'||x.cat==='Monster Squad')];
  if (q.q10 === '60s / 70s / 80s') pool = [...pool, ...generalQuestions.filter(x=>x.cat==='Nostalgia'||x.cat==='Music')];
  // Fav cats
  if (profile.favCats?.includes('Wrestling')) pool = [...pool, ...corbQuestions.filter((x:any)=>x.cat==='90s Wrestling')];
  if (profile.favCats?.includes('Sidney Sweeney')) pool = [...pool, ...corbQuestions.filter((x:any)=>x.cat==='Sidney Sweeney')];
  if (profile.favCats?.includes('Monster Squad')) pool = [...pool, ...corbQuestions.filter((x:any)=>x.cat==='Monster Squad')];
  if (profile.favCats?.includes('Charles Barkley')) pool = [...pool, ...corbQuestions.filter((x:any)=>x.cat==='Charles Barkley')];
  if (profile.favCats?.includes('East Pittsburgh')) pool = [...pool, ...corbQuestions.filter((x:any)=>x.cat==='East Pittsburgh')];
  if (profile.favCats?.includes('Pittsburgh')) pool = [...pool, ...pittsburghQuestions];
  if (profile.favCats?.includes('Golf')) pool = [...pool, ...allGolf];
  pool = [...pool, ...easyPool];
  return pool;
}
 
const SPONSOR_NAME = 'Your Brand';
 
function HoleGraphic({ holeYards, remaining, lie, par, strokes, scorecard, playerName, activePlayers, multiScores, multiHoleIdx, isMulti }: {
  holeYards:number; remaining:number; lie:string; par:number; strokes:number;
  scorecard:number[]; playerName:string; activePlayers?:string[]; multiScores?:number[][]; multiHoleIdx?:number; isMulti?:boolean;
}) {
  const W=320, H=140;
  const currentPar = COURSE.slice(0,scorecard.length).reduce((s,h)=>s+h.par,0);
  const scoreToPar = scorecard.reduce((a,b)=>a+b,0) + strokes - currentPar - par;
  const scoreStr = scoreToPar < 0 ? `${scoreToPar}` : scoreToPar === 0 ? 'E' : `+${scoreToPar}`;
  const scoreColor = scoreToPar < 0 ? '#c8a84b' : scoreToPar === 0 ? '#ffffff' : '#c0392b';
  const progress = remaining<=0 ? 1 : 1-remaining/holeYards;
  const teeX=22, greenX=278, centerY=70;
  const ballX = teeX+(greenX-teeX)*Math.min(progress, lie==='Holed'?1:0.94);
  const ballY = lie==='Green'||lie==='Fringe' ? centerY : lie==='Bunker' ? centerY+16 : lie==='Rough' ? (ballX%3===0 ? centerY-16 : centerY+16) : centerY;
  const leaders: {name:string;total:number}[] = isMulti&&activePlayers&&multiScores ? activePlayers.map((n,i)=>({name:n,total:(multiScores[i]||[]).reduce((a,b)=>a+b,0)})).sort((a,b)=>a.total-b.total) : [];
  const soloDiff = scorecard.reduce((a,b)=>a+b,0) - COURSE.slice(0,scorecard.length).reduce((s,h)=>s+h.par,0);
  const toGoStr = remaining>20?`${remaining}y`:remaining>0?`${remaining}ft`:'–';
  const lieStr = lie==='Tee Box'?'TEE':lie==='Fairway'?'FAIRWAY':lie==='Green'?'GREEN':lie==='Fringe'?'FRINGE':lie==='Bunker'?'BUNKER':lie==='Rough'?'ROUGH':lie==='Holed'?'HOLED':lie.toUpperCase();
  return (
    <svg width={W} height={H} style={{display:'block',margin:'0 auto 14px',borderRadius:10,overflow:'hidden'}}>
      <rect width={W} height={H} fill="#061008"/>
      <rect x="0" y="15" width={W} height="32" fill="#0d1f0b"/>
      <line x1="0" y1="19" x2={W} y2="19" stroke="#112410" strokeWidth="1.5"/><line x1="0" y1="24" x2={W} y2="24" stroke="#0f210e" strokeWidth="1"/><line x1="0" y1="29" x2={W} y2="29" stroke="#132612" strokeWidth="1.5"/><line x1="0" y1="34" x2={W} y2="34" stroke="#112410" strokeWidth="1"/><line x1="0" y1="39" x2={W} y2="39" stroke="#132612" strokeWidth="1.5"/><line x1="0" y1="44" x2={W} y2="44" stroke="#0f200e" strokeWidth="1"/>
      <rect x="0" y="93" width={W} height="32" fill="#0d1f0b"/>
      <line x1="0" y1="97" x2={W} y2="97" stroke="#112410" strokeWidth="1.5"/><line x1="0" y1="102" x2={W} y2="102" stroke="#0f210e" strokeWidth="1"/><line x1="0" y1="107" x2={W} y2="107" stroke="#132612" strokeWidth="1.5"/><line x1="0" y1="112" x2={W} y2="112" stroke="#112410" strokeWidth="1"/><line x1="0" y1="117" x2={W} y2="117" stroke="#132612" strokeWidth="1.5"/><line x1="0" y1="122" x2={W} y2="122" stroke="#0f200e" strokeWidth="1"/>
      <path d="M 14 44 Q 160 42 306 44 L 306 50 Q 160 48 14 50 Z" fill="#1a3a15"/>
      <path d="M 14 90 Q 160 92 306 90 L 306 96 Q 160 94 14 96 Z" fill="#1a3a15"/>
      <path d="M 22 50 C 60 48 120 47 180 49 C 230 51 262 52 278 51 L 278 89 C 262 88 230 89 180 91 C 120 93 60 92 22 90 Z" fill="#276620"/>
      <path d="M 22 51 C 120 49 230 51 278 52 L 278 55 C 230 54 120 52 22 54 Z" fill="#2d7224" opacity="0.8"/><path d="M 22 55 C 120 53 230 55 278 56 L 278 59 C 230 58 120 56 22 58 Z" fill="#256020" opacity="0.6"/><path d="M 22 59 C 120 57 230 59 278 60 L 278 63 C 230 62 120 60 22 62 Z" fill="#2d7224" opacity="0.8"/><path d="M 22 63 C 120 61 230 63 278 64 L 278 67 C 230 66 120 64 22 66 Z" fill="#256020" opacity="0.6"/><path d="M 22 67 C 120 65 230 67 278 68 L 278 71 C 230 70 120 68 22 70 Z" fill="#2d7224" opacity="0.8"/><path d="M 22 71 C 120 69 230 71 278 72 L 278 75 C 230 74 120 72 22 74 Z" fill="#256020" opacity="0.6"/><path d="M 22 75 C 120 73 230 75 278 76 L 278 79 C 230 78 120 76 22 78 Z" fill="#2d7224" opacity="0.8"/><path d="M 22 79 C 120 77 230 79 278 80 L 278 84 C 230 83 120 81 22 83 Z" fill="#256020" opacity="0.6"/><path d="M 22 84 C 120 82 230 84 278 85 L 278 89 C 230 88 120 86 22 88 Z" fill="#2d7224" opacity="0.7"/>
      <path d="M 22 50 C 120 48 230 50 278 51" fill="none" stroke="#1e5519" strokeWidth="1.2"/><path d="M 22 90 C 120 92 230 90 278 89" fill="none" stroke="#1e5519" strokeWidth="1.2"/>
      <rect x="18" y="58" width="16" height="24" rx="2" fill="#2e7a22"/><rect x="20" y="60" width="12" height="20" rx="1" fill="#3c9430"/>
      <line x1="20" y1="63" x2="32" y2="63" stroke="#44a836" strokeWidth="0.8"/><line x1="20" y1="67" x2="32" y2="67" stroke="#44a836" strokeWidth="0.8"/><line x1="20" y1="71" x2="32" y2="71" stroke="#44a836" strokeWidth="0.8"/><line x1="20" y1="75" x2="32" y2="75" stroke="#44a836" strokeWidth="0.8"/>
      <circle cx="25" cy="61" r="2" fill="#c8a84b"/><circle cx="29" cy="61" r="2" fill="#c8a84b"/>
      <ellipse cx="55" cy="47" rx="14" ry="5" fill="#061008" opacity="0.7"/><ellipse cx="55" cy="42" rx="13" ry="10" fill="#071a05"/><ellipse cx="55" cy="38" rx="10" ry="8" fill="#0c2409"/><ellipse cx="55" cy="34" rx="7" ry="6" fill="#112e0d"/><ellipse cx="55" cy="31" rx="4" ry="4" fill="#163612"/>
      <ellipse cx="70" cy="46" rx="12" ry="4" fill="#061008" opacity="0.7"/><ellipse cx="70" cy="41" rx="11" ry="9" fill="#071a05"/><ellipse cx="70" cy="37" rx="8" ry="7" fill="#0c2409"/><ellipse cx="70" cy="33" rx="5" ry="5" fill="#112e0d"/>
      <ellipse cx="84" cy="47" rx="11" ry="4" fill="#061008" opacity="0.6"/><ellipse cx="84" cy="43" rx="10" ry="8" fill="#071a05"/><ellipse cx="84" cy="39" rx="7" ry="6" fill="#0c2409"/><ellipse cx="84" cy="36" rx="4" ry="4" fill="#163612"/>
      <ellipse cx="160" cy="47" rx="12" ry="4" fill="#061008" opacity="0.6"/><ellipse cx="160" cy="42" rx="11" ry="8" fill="#071a05"/><ellipse cx="160" cy="38" rx="8" ry="7" fill="#0c2409"/><ellipse cx="160" cy="34" rx="5" ry="5" fill="#112e0d"/>
      <ellipse cx="174" cy="46" rx="10" ry="4" fill="#061008" opacity="0.6"/><ellipse cx="174" cy="42" rx="9" ry="7" fill="#071a05"/><ellipse cx="174" cy="38" rx="6" ry="6" fill="#0c2409"/>
      <ellipse cx="58" cy="93" rx="13" ry="4" fill="#061008" opacity="0.7"/><ellipse cx="58" cy="98" rx="12" ry="9" fill="#071a05"/><ellipse cx="58" cy="102" rx="9" ry="7" fill="#0c2409"/><ellipse cx="58" cy="106" rx="6" ry="5" fill="#112e0d"/>
      <ellipse cx="73" cy="93" rx="11" ry="4" fill="#061008" opacity="0.6"/><ellipse cx="73" cy="97" rx="10" ry="8" fill="#071a05"/><ellipse cx="73" cy="101" rx="7" ry="6" fill="#0c2409"/>
      <ellipse cx="162" cy="93" rx="11" ry="4" fill="#061008" opacity="0.6"/><ellipse cx="162" cy="97" rx="10" ry="8" fill="#071a05"/><ellipse cx="162" cy="101" rx="7" ry="6" fill="#0c2409"/>
      <ellipse cx="176" cy="93" rx="10" ry="3" fill="#061008" opacity="0.6"/><ellipse cx="176" cy="97" rx="9" ry="7" fill="#071a05"/>
      {par===5&&<><ellipse cx="130" cy="48" rx="20" ry="7" fill="#0e3d6e"/><ellipse cx="130" cy="48" rx="15" ry="5" fill="#1252a0"/><ellipse cx="129" cy="47" rx="9" ry="3" fill="#1a66c4" opacity="0.7"/><line x1="118" y1="46" x2="142" y2="46" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/></>}
      <ellipse cx="200" cy="49" rx="18" ry="7" fill="#6b4e14"/><ellipse cx="200" cy="49" rx="15" ry="5" fill="#9a7020"/><ellipse cx="200" cy="48" rx="10" ry="3.5" fill="#b8882a"/><ellipse cx="199" cy="47" rx="6" ry="2" fill="#cca040" opacity="0.7"/>
      <path d="M 182 49 Q 200 44 218 49" fill="none" stroke="#4a3608" strokeWidth="1.5"/>
      {lie==='Bunker'&&<><ellipse cx={ballX} cy={ballY} rx="16" ry="8" fill="#6b4e14"/><ellipse cx={ballX} cy={ballY} rx="12" ry="6" fill="#9a7020"/><ellipse cx={ballX} cy={ballY} rx="8" ry="4" fill="#b8882a"/></>}
      <ellipse cx="291" cy="72" rx="24" ry="19" fill="#1a5c1a" opacity="0.6"/>
      <ellipse cx="289" cy={centerY} rx="26" ry="21" fill="#248f24"/><ellipse cx="289" cy={centerY} rx="21" ry="17" fill="#2db82d"/>
      <ellipse cx="289" cy="65" rx="18" ry="7" fill="#32cc32" opacity="0.35"/><ellipse cx="289" cy="72" rx="16" ry="6" fill="#28a828" opacity="0.35"/><ellipse cx="283" cy="64" rx="9" ry="5" fill="#3ad43a" opacity="0.25"/>
      <ellipse cx="300" cy="54" rx="11" ry="5" fill="#6b4e14"/><ellipse cx="300" cy="54" rx="8" ry="3.5" fill="#9a7020"/><ellipse cx="300" cy="53" rx="5" ry="2.2" fill="#b8882a"/>
      <path d="M 289 54 Q 300 50 311 54" fill="none" stroke="#4a3608" strokeWidth="1.2"/>
      <ellipse cx="274" cy="88" rx="14" ry="5" fill="#6b4e14"/><ellipse cx="274" cy="88" rx="10" ry="3.5" fill="#9a7020"/>
      <path d="M 260 88 Q 274 84 288 88" fill="none" stroke="#4a3608" strokeWidth="1.2"/>
      <line x1="289" y1="57" x2="289" y2="34" stroke="#c8c8c8" strokeWidth="1.5"/>
      <path d="M 290 34 L 306 39 L 306 48 L 290 48 Z" fill="#c8a84b"/>
      <line x1="290" y1="34" x2="290" y2="48" stroke="#a88838" strokeWidth="0.5"/>
      <ellipse cx="289" cy="68" rx="3.5" ry="2.5" fill="#030806"/>
      {holeYards>=200&&(()=>{const pct=1-200/holeYards;const dx=teeX+(greenX-teeX)*pct;return(<g><circle cx={dx} cy={centerY} r="4" fill="#1a55a0" stroke="#2a72d0" strokeWidth="0.5"/><text x={dx} y={centerY+1.5} textAnchor="middle" fontSize={3.5} fill="#fff" fontFamily="Georgia,serif" fontWeight="bold">200</text></g>);})()}
      {holeYards>=150&&(()=>{const pct=1-150/holeYards;const dx=teeX+(greenX-teeX)*pct;return(<g><circle cx={dx} cy={centerY} r="4" fill="#e8e8e8" stroke="#aaa" strokeWidth="0.5"/><text x={dx} y={centerY+1.5} textAnchor="middle" fontSize={3.5} fill="#222" fontFamily="Georgia,serif" fontWeight="bold">150</text></g>);})()}
      {holeYards>=100&&(()=>{const pct=1-100/holeYards;const dx=teeX+(greenX-teeX)*pct;return(<g><circle cx={dx} cy={centerY} r="4" fill="#b02020" stroke="#e03030" strokeWidth="0.5"/><text x={dx} y={centerY+1.5} textAnchor="middle" fontSize={3.5} fill="#fff" fontFamily="Georgia,serif" fontWeight="bold">100</text></g>);})()}
      {progress>0.05&&progress<0.97&&<><path d={`M ${teeX+12} ${centerY} C ${teeX+60} ${centerY-4} ${ballX-40} ${ballY-4} ${ballX} ${ballY}`} fill="none" stroke="rgba(200,168,75,0.35)" strokeWidth="1.4" strokeDasharray="5,5"/><circle cx={teeX+12} cy={centerY} r="2" fill="rgba(200,168,75,0.3)"/></>}
      {lie!=='Holed'&&<><circle cx={ballX} cy={ballY} r="6" fill="#f8f8f8" stroke="#1a1a1a" strokeWidth="1"/><circle cx={ballX-2} cy={ballY-2} r="2.2" fill="rgba(255,255,255,0.7)"/></>}
      {lie==='Holed'&&<text x="289" y={centerY+4} textAnchor="middle" fontSize={12} fill="#c8a84b">⛳</text>}
      <rect x="0" y="0" width={W} height="15" fill="rgba(0,0,0,0.88)"/>
      <line x1="0" y1="15" x2={W} y2="15" stroke="#c8a84b" strokeWidth="0.8" opacity="0.7"/>
      <rect x="0" y="0" width="3" height="15" fill="#c8a84b"/>
      <text x="7" y="10" fontSize={7} fill="#c8a84b" fontFamily="Georgia,serif">HOLE {COURSE[scorecard.length]?.number||'—'}</text>
      <text x="46" y="10" fontSize={7} fill="rgba(255,255,255,0.4)" fontFamily="Georgia,serif">PAR {par}</text>
      <line x1="72" y1="3" x2="72" y2="12" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5"/>
      <text x="77" y="10" fontSize={6.5} fill="rgba(255,255,255,0.35)" fontFamily="Georgia,serif">YDS {holeYards}</text>
      <line x1="112" y1="3" x2="112" y2="12" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5"/>
      <text x="117" y="10" fontSize={6.5} fill="rgba(255,255,255,0.35)" fontFamily="Georgia,serif">TO GO</text>
      <text x="144" y="10" fontSize={7} fill="#c8a84b" fontFamily="Georgia,serif">{toGoStr}</text>
      <line x1="164" y1="3" x2="164" y2="12" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5"/>
      <text x="169" y="10" fontSize={6.5} fill="rgba(255,255,255,0.35)" fontFamily="Georgia,serif">SCORE</text>
      <text x="198" y="10" fontSize={7} fill={scoreColor} fontFamily="Georgia,serif">{scoreStr}</text>
      <line x1="210" y1="3" x2="210" y2="12" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5"/>
      <text x="215" y="10" fontSize={6.5} fill="rgba(255,255,255,0.35)" fontFamily="Georgia,serif">{lieStr}</text>
      <rect x="0" y="125" width={W} height="15" fill="rgba(0,0,0,0.92)"/>
      <line x1="0" y1="125" x2={W} y2="125" stroke="#c8a84b" strokeWidth="0.8" opacity="0.5"/>
      <rect x="0" y="125" width="60" height="15" fill="#c8a84b"/>
      <text x="4" y="135" fontSize={6.5} fill="#061008" fontFamily="Georgia,serif">LEADERBOARD</text>
      <line x1="60" y1="125" x2="60" y2="140" stroke="rgba(255,255,255,0.2)" strokeWidth="0.5"/>
      {isMulti&&leaders.slice(0,4).map((p,i)=>{const holesPar=COURSE.slice(0,multiHoleIdx||0).reduce((s,h)=>s+h.par,0);const diff=p.total-holesPar;const col=diff<0?'#c8a84b':diff===0?'rgba(255,255,255,0.7)':'#c0392b';const diffStr=diff<0?`${diff}`:diff===0?'E':`+${diff}`;const x=64+i*36;return <g key={p.name}>{i>0&&<line x1={x-2} y1="128" x2={x-2} y2="137" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5"/>}<text x={x} y="133" fontSize={6} fill={i===0?'#c8a84b':'rgba(255,255,255,0.55)'} fontFamily="Georgia,serif">{i+1}.{p.name.slice(0,5)}</text><text x={x} y="139" fontSize={6.5} fill={col} fontFamily="Georgia,serif">{diffStr}</text></g>;})}
      {!isMulti&&scorecard.length>0&&<><text x="64" y="133" fontSize={6} fill="rgba(255,255,255,0.55)" fontFamily="Georgia,serif">{playerName.slice(0,8)}</text><text x="64" y="139" fontSize={6.5} fill={soloDiff<0?'#c8a84b':soloDiff===0?'#ffffff':'#c0392b'} fontFamily="Georgia,serif">{soloDiff<0?soloDiff:soloDiff===0?'E':`+${soloDiff}`}</text></>}
      <line x1="200" y1="125" x2="200" y2="140" stroke="#c8a84b" strokeWidth="0.5" opacity="0.5"/>
      <rect x="200" y="125" width="120" height="15" fill="rgba(200,168,75,0.07)"/>
      <text x="204" y="132" fontSize={5.5} fill="rgba(255,255,255,0.3)" fontFamily="Georgia,serif">TODAY'S TRIVIA</text>
      <text x="204" y="139" fontSize={5.5} fill="rgba(255,255,255,0.28)" fontFamily="Georgia,serif">BROUGHT TO YOU BY</text>
      <text x="317" y="139" textAnchor="end" fontSize={7} fill="#c8a84b" fontFamily="Georgia,serif" fontStyle="italic">{SPONSOR_NAME}</text>
    </svg>
  );
}
 
// ─── QUESTIONNAIRE SCREEN ─────────────────────────────────────────
function QuestionnaireScreen({ onComplete, onSkip, existing }: {
  onComplete: (q: Questionnaire) => void; onSkip: () => void; existing?: Questionnaire | null;
}) {
  const blank: Questionnaire = { q1:'',q2:'',q3:'',q4:'',q5:'',q6:'',q7:'',q8:'',q9:'',q10:'' };
  const [answers, setAnswers] = useState<Questionnaire>(existing || blank);
  const [step, setStep] = useState(0);
  const current = QUESTIONS_Q[step];
  const currentKey = current.id as keyof Questionnaire;
  const answered = answers[currentKey] !== '';
  const allDone = Object.values(answers).every(v => v !== '');
  function selectOption(opt: string) { setAnswers(prev => ({ ...prev, [currentKey]: opt })); }
  function next() { if (step < QUESTIONS_Q.length - 1) setStep(s => s + 1); }
  function prev() { if (step > 0) setStep(s => s - 1); }
  return (
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
          {current.options.map(opt => (
            <button key={opt} onClick={() => selectOption(opt)} style={{background:answers[currentKey]===opt?'rgba(200,168,75,0.15)':'var(--surface)',border:`1px solid ${answers[currentKey]===opt?'var(--gold)':'var(--border)'}`,color:answers[currentKey]===opt?'var(--gold)':'var(--text)',padding:'12px 16px',borderRadius:8,fontFamily:'Georgia,serif',fontSize:'0.88rem',textAlign:'left',cursor:'pointer',display:'flex',alignItems:'center',gap:10}}>
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
            ? <button onClick={next} disabled={!answered} style={{flex:2,background:answered?'var(--green)':'var(--surface)',border:'none',color:answered?'#fff':'var(--muted)',padding:'11px',borderRadius:8,fontFamily:'Georgia,serif',fontSize:'0.85rem',cursor:answered?'pointer':'default'}}>Next →</button>
            : <button onClick={()=>{if(allDone)onComplete(answers);}} disabled={!allDone} style={{flex:2,background:allDone?'var(--gold)':'var(--surface)',border:'none',color:allDone?'var(--bg)':'var(--muted)',padding:'11px',borderRadius:8,fontFamily:'Georgia,serif',fontSize:'0.85rem',fontWeight:'bold',cursor:allDone?'pointer':'default'}}>Build My Profile ⛳</button>
          }
        </div>
        <button onClick={onSkip} style={{width:'100%',background:'transparent',border:'none',color:'var(--border)',fontFamily:'Georgia,serif',fontSize:'0.75rem',cursor:'pointer',marginTop:16}}>Skip for now</button>
      </div>
    </div>
  );
}
 
// ─── PROFILE SCREEN ───────────────────────────────────────────────
function ProfileScreen({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<'menu'|'create'|'view'|'questionnaire'>(() => loadProfile() ? 'view' : 'menu');
  const [profile, setProfile] = useState<Profile | null>(loadProfile);
  const [name, setName] = useState(profile?.name || '');
  const [experience, setExperience] = useState(profile?.experience || 'Beginner');
  const [favCats, setFavCats] = useState<string[]>(profile?.favCats || []);
  const [pin, setPin] = useState(profile?.pin || '');
  const [pinError, setPinError] = useState('');
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [loginName, setLoginName] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
 
  function toggleCat(cat: string) {
    setFavCats(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  }
 
  async function handleLogin() {
    if (!loginName.trim() || loginPin.length !== 4) return;
    setLoginLoading(true);
    setLoginError('');
    const found = await cloudLoadProfile(loginName.trim(), loginPin);
    if (!found) {
      setLoginError('Name or PIN not found — try again');
      setLoginLoading(false);
      return;
    }
    saveProfile(found);
    setProfile(found);
    setLoginLoading(false);
    setMode('view');
  }
 
  async function handleSave() {
    if (!name.trim()) return;
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      setPinError('PIN must be exactly 4 digits');
      return;
    }
    setPinError('');
    setCloudSyncing(true);
    const p: Profile = {
      name: name.trim(), experience, favCats, pin,
      owgtr: profile?.owgtr || 1000,
      triviaHandicap: profile?.triviaHandicap || 36,
      sbr: profile?.sbr || 1000,
      roundsPlayed: profile?.roundsPlayed || 0,
      correctAnswers: profile?.correctAnswers || 0,
      totalAnswers: profile?.totalAnswers || 0,
      questionnaire: profile?.questionnaire,
      courseTier: profile?.courseTier,
    };
    const nameExists = await cloudCheckNameExists(name.trim());
    if (nameExists && !profile) {
      setPinError('That name is taken — try a different one');
      setCloudSyncing(false);
      return;
    }
    if (!nameExists) { await cloudCreateProfile(p, pin); }
    else { await cloudSaveProfile(p, pin); }
    saveProfile(p);
    setProfile(p);
    setCloudSyncing(false);
    setMode('questionnaire');
  }
 
  function handleQuestionnaireComplete(q: Questionnaire) {
    saveQuestionnaire(q);
    const { handicap, tier, owgtr } = calcHandicapFromQ(q);
    const sbr = calcSBR(q);
    const updated: Profile = { ...profile!, triviaHandicap: handicap, courseTier: tier, owgtr, sbr, questionnaire: q };
    saveProfile(updated);
    setProfile(updated);
    setMode('view');
  }
 
  function handleDelete() {
    localStorage.removeItem('sb_profile');
    localStorage.removeItem('sb_questionnaire');
    setProfile(null); setName(''); setExperience('Beginner'); setFavCats([]); setMode('menu');
  }
 
  const inputStyle: any = {
    background:'transparent', border:'none', borderBottom:'1px solid var(--gold)',
    color:'var(--text)', padding:'10px 8px', fontFamily:'Georgia,serif',
    fontSize:'0.95rem', width:'100%', outline:'none', marginBottom:14,
  };
 
  const tierColors: Record<string,string> = {
    Championship:'#c8a84b', Advanced:'#3fa36b', Intermediate:'#4a90d9', Recreational:'#9b59b6', Beginner:'#7a9485',
  };
 
  if (mode === 'questionnaire') return (
    <QuestionnaireScreen existing={loadQuestionnaire()} onComplete={handleQuestionnaireComplete} onSkip={() => setMode('view')}/>
  );
 
  if (mode === 'view' && profile) {
    const tierColor = tierColors[profile.courseTier || 'Intermediate'];
    return (
      <div className="screen center">
        <div style={{width:60,height:60,borderRadius:'50%',border:'2px solid var(--gold)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.6rem',marginBottom:16,background:'radial-gradient(circle,#1a2e20 0%,var(--bg) 100%)'}}>🏌️</div>
        <h2 style={{fontFamily:'Georgia,serif',color:'var(--gold)',marginBottom:4}}>{profile.name}</h2>
        <p style={{fontSize:'0.72rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:4}}>{profile.experience} · Scramble Brains Player</p>
        {profile.courseTier&&<p style={{fontSize:'0.72rem',letterSpacing:'2px',color:tierColor,marginBottom:20}}>📍 {profile.courseTier} Tee</p>}
        <div style={{width:'100%',maxWidth:300,display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:20}}>
          {([
            ['O.W.G.T.R.', profile.owgtr, 'var(--gold)'],
            ['Trivia Handicap', profile.triviaHandicap, tierColor],
            ['SBR', profile.sbr || '—', '#4a90d9'],
            ['Rounds Played', profile.roundsPlayed, 'var(--text)'],
            ['Answer %', profile.totalAnswers > 0 ? `${Math.round(profile.correctAnswers/profile.totalAnswers*100)}%` : '—', 'var(--green-lt)'],
          ] as [string,any,string][]).map(([label,val,color])=>(
            <div key={label} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,padding:'12px',textAlign:'center'}}>
              <div style={{fontSize:'0.62rem',letterSpacing:'2px',textTransform:'uppercase',color:'var(--muted)',marginBottom:6}}>{label}</div>
              <div style={{fontSize:'1.3rem',fontFamily:'Georgia,serif',color}}>{val}</div>
            </div>
          ))}
        </div>
        {profile.favCats.length > 0 && (
          <div style={{width:'100%',maxWidth:300,marginBottom:20}}>
            <p style={{fontSize:'0.65rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:8}}>Favorite Categories</p>
            <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
              {profile.favCats.map(c=>(
                <span key={c} style={{background:'var(--surface)',border:'1px solid var(--gold)',borderRadius:20,padding:'4px 12px',fontSize:'0.72rem',color:'var(--gold)',fontFamily:'Georgia,serif'}}>{c}</span>
              ))}
            </div>
          </div>
        )}
        <div style={{display:'flex',gap:10,width:'100%',maxWidth:300,flexWrap:'wrap'}}>
          <button className="btn" style={{flex:1}} onClick={()=>{setName(profile.name);setExperience(profile.experience);setFavCats(profile.favCats);setPin(profile.pin||'');setMode('create');}}>Edit Profile</button>
          <button className="btn" style={{flex:1,background:'transparent',color:'var(--muted)',borderColor:'var(--border)'}} onClick={onBack}>← Back</button>
          <button className="btn" style={{width:'100%',background:'transparent',color:tierColor,border:`1px solid ${tierColor}`}} onClick={()=>setMode('questionnaire')}>🎯 Retake Interest Profile</button>
          <button onClick={handleDelete} style={{width:'100%',background:'transparent',border:'1px solid var(--red)',color:'var(--red)',padding:'8px',borderRadius:6,fontFamily:'Georgia,serif',fontSize:'0.75rem',cursor:'pointer',marginTop:4}}>Delete Profile</button>
        </div>
      </div>
    );
  }
 
  if (mode === 'create') return (
    <div className="screen center">
      <p className="eyebrow">{profile ? 'Edit Profile' : 'Create Your Profile'}</p>
      <div style={{width:'100%',maxWidth:300}}>
        <input style={inputStyle} placeholder="Your Name" value={name} onChange={e=>setName(e.target.value)} maxLength={20}/>
        <input style={inputStyle} placeholder="4-Digit PIN" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,4))} maxLength={4} type="password"/>
        {pinError&&<p style={{color:'var(--red)',fontSize:'0.75rem',marginBottom:8}}>{pinError}</p>}
        {cloudSyncing&&<p style={{color:'var(--gold)',fontSize:'0.75rem',marginBottom:8}}>☁️ Saving to cloud...</p>}
        <p style={{fontSize:'0.65rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:8}}>Golf Experience</p>
        <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
          {EXPERIENCE_LEVELS.map(l=>(
            <button key={l} onClick={()=>setExperience(l)} style={{background:experience===l?'var(--gold)':'transparent',color:experience===l?'var(--bg)':'var(--muted)',border:`1px solid ${experience===l?'var(--gold)':'var(--border)'}`,padding:'6px 12px',borderRadius:20,fontFamily:'Georgia,serif',fontSize:'0.72rem',cursor:'pointer'}}>{l}</button>
          ))}
        </div>
        <p style={{fontSize:'0.65rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:8}}>Favorite Trivia Categories</p>
        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:20}}>
          {ALL_CATEGORIES.map(cat=>(
            <button key={cat} onClick={()=>toggleCat(cat)} style={{background:favCats.includes(cat)?'var(--green)':'transparent',color:favCats.includes(cat)?'#fff':'var(--muted)',border:`1px solid ${favCats.includes(cat)?'var(--green)':'var(--border)'}`,padding:'5px 10px',borderRadius:20,fontFamily:'Georgia,serif',fontSize:'0.68rem',cursor:'pointer'}}>{cat}</button>
          ))}
        </div>
        <button className="btn" style={{width:'100%',marginBottom:10}} onClick={handleSave} disabled={!name.trim()}>Next — Interest Profile →</button>
        <button onClick={()=>setMode(profile?'view':'menu')} style={{background:'transparent',border:'none',color:'var(--muted)',fontFamily:'Georgia,serif',fontSize:'0.8rem',cursor:'pointer',width:'100%'}}>← Back</button>
      </div>
    </div>
  );
 
  // ─── LOGIN / MENU SCREEN ──────────────────────────────────────
  return (
    <div className="screen center">
      <div style={{width:60,height:60,borderRadius:'50%',border:'2px solid var(--gold)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.6rem',marginBottom:16,background:'radial-gradient(circle,#1a2e20 0%,var(--bg) 100%)'}}>🏌️</div>
      <h2 style={{fontFamily:'Georgia,serif',color:'var(--gold)',marginBottom:4}}>Player Profile</h2>
      <p style={{fontSize:'0.72rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:24}}>Your Golf Trivia Identity</p>
      <div style={{width:'100%',maxWidth:280,display:'flex',flexDirection:'column',gap:10,marginBottom:16}}>
        <input
          placeholder="Your Name"
          value={loginName}
          onChange={e=>setLoginName(e.target.value)}
          style={{background:'transparent',border:'none',borderBottom:'1px solid var(--gold)',color:'var(--text)',padding:'10px 8px',fontFamily:'Georgia,serif',fontSize:'1rem',textAlign:'center',outline:'none'}}
        />
        <input
          placeholder="Your 4-Digit PIN"
          value={loginPin}
          onChange={e=>setLoginPin(e.target.value.replace(/\D/g,'').slice(0,4))}
          type="password"
          maxLength={4}
          style={{background:'transparent',border:'none',borderBottom:'1px solid var(--gold)',color:'var(--text)',padding:'10px 8px',fontFamily:'Georgia,serif',fontSize:'1rem',textAlign:'center',outline:'none'}}
        />
        {loginError&&<p style={{color:'var(--red)',fontSize:'0.75rem',textAlign:'center'}}>{loginError}</p>}
        <button className="btn" onClick={handleLogin} disabled={loginLoading||!loginName.trim()||loginPin.length!==4}>
          {loginLoading?'Loading...':'🔓 Log In'}
        </button>
      </div>
      <div style={{width:'100%',maxWidth:280,display:'flex',flexDirection:'column',gap:8}}>
        <div style={{height:1,background:'var(--border)',margin:'4px 0'}}/>
        <button className="btn" onClick={()=>setMode('create')} style={{background:'transparent',border:'1px solid var(--gold)',color:'var(--gold)'}}>
          ✨ New Player — Create Profile
        </button>
        <button onClick={onBack} style={{background:'transparent',border:'none',color:'var(--muted)',fontFamily:'Georgia,serif',fontSize:'0.8rem',cursor:'pointer'}}>← Back to Menu</button>
      </div>
    </div>
  );
}
 
// ─── MAIN APP ─────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState('landing');
const [leaderboardData, setLeaderboardData] = useState<any>(null);
useEffect(() => { fetchLeaderboard().then(setLeaderboardData); }, []);
  const [isGuest, setIsGuest] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [playerNames, setPlayerNames] = useState<string[]>([loadProfile()?.name || '']);
  const playerName = playerNames[0];
  function updateName(i:number,val:string){setPlayerNames(prev=>{const u=[...prev];u[i]=val;return u;});}
  function removeName(i:number){setPlayerNames(prev=>prev.filter((_,idx)=>idx!==i));}
  const [questionBank, setQuestionBank] = useState<'golf'|'pittsburgh'|'mixed'|'corb'>('golf');
  const [pittsburghCat, setPittsburghCat] = useState('All');
  const [holeIdx, setHoleIdx] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [strokes, setStrokes] = useState(0);
  const [lie, setLie] = useState('Tee Box');
  const [feedback, setFeedback] = useState('');
  const [club, setClub] = useState<string|null>(null);
  const [question, setQuestion] = useState<any>(null);
  const [qIdx, setQIdx] = useState(-1);
  const [usedQ, setUsedQ] = useState<Record<string,number[]>>({});
  const [roundPool, setRoundPool] = useState<any[]>([]);
  const [roundPoolIdx, setRoundPoolIdx] = useState(0);
  const [lastQuestionCat, setLastQuestionCat] = useState<string|null>(null);
  const [picked, setPicked] = useState<number|null>(null);
  const [timeLeft, setTimeLeft] = useState<number|null>(null);
  const [phase, setPhase] = useState<'club'|'question'|'feedback'>('club');
  const [isPutting, setIsPutting] = useState(false);
  const [scorecard, setScorecard] = useState<number[]>([]);
  const [roundCorrect, setRoundCorrect] = useState(0);
  const [roundTotal, setRoundTotal] = useState(0);
  const [wind, setWind] = useState<{speed:number;dir:string}>({speed:0,dir:'N'});
  const [roundLength, setRoundLength] = useState<9|18>(18);
 
  const isMulti = playerNames.filter(n=>n.trim()).length > 1;
  const activePlayers = playerNames.filter(n=>n.trim());
  const [multiScores, setMultiScores] = useState<number[][]>([]);
  const [multiHoleIdx, setMultiHoleIdx] = useState(0);
  const [multiPlayerIdx, setMultiPlayerIdx] = useState(0);
  const [multiAnsweredCount, setMultiAnsweredCount] = useState(0);
  const [multiHoleResults, setMultiHoleResults] = useState<{name:string;strokes:number}[]>([]);
  const [multiPhase, setMultiPhase] = useState<'question'|'hole_results'|'end'>('question');
  const [multiQuestion, setMultiQuestion] = useState<any>(null);
  const [multiPicked, setMultiPicked] = useState<number|null>(null);
  const [multiTimeLeft, setMultiTimeLeft] = useState<number|null>(null);
  const [multiUsedQ, setMultiUsedQ] = useState<number[]>([]);
  const hole = COURSE[holeIdx];
  const multiHole = COURSE[multiHoleIdx];
 
  useEffect(()=>{
    if(!isMulti||multiPhase!=='question'||multiPicked!==null||multiTimeLeft===null)return;
    if(multiTimeLeft===0){handleMultiAnswer(-1);return;}
    const t=setTimeout(()=>setMultiTimeLeft(n=>(n??1)-1),1000);
    return()=>clearTimeout(t);
  },[multiTimeLeft,multiPhase,multiPicked,isMulti]);
 
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
    const correct=i===multiQuestion.correct;
    const secondsLeft=multiTimeLeft??0;
    const strokes=correct?(secondsLeft>=10?3:secondsLeft>=5?4:5):7;
    const newResults=[...multiHoleResults,{name:activePlayers[multiPlayerIdx],strokes}];
    setMultiHoleResults(newResults);
    const nextAnswered=multiAnsweredCount+1;
    setMultiAnsweredCount(nextAnswered);
    if(nextAnswered>=activePlayers.length){
      setMultiScores(prev=>{const updated=[...prev];newResults.forEach((r,pi)=>{if(!updated[pi])updated[pi]=[];updated[pi]=[...updated[pi],r.strokes];});return updated;});
      setTimeout(()=>setMultiPhase('hole_results'),400);
    } else {
      setTimeout(()=>{setMultiPlayerIdx(multiPlayerIdx+1);loadNextMultiQuestion();},400);
    }
  }
 
  function nextMultiHole(){
    if(multiHoleIdx>=COURSE.length-1){setMultiPhase('end');return;}
    const next=multiHoleIdx+1;
    setMultiHoleIdx(next);setMultiPlayerIdx(0);setMultiAnsweredCount(0);setMultiHoleResults([]);
    loadNextMultiQuestion();setMultiPhase('question');
  }
 
  useEffect(()=>{
    if(phase!=='question'||picked!==null||timeLeft===null)return;
    if(timeLeft===0){handleAnswer(-1);return;}
    const t=setTimeout(()=>setTimeLeft(n=>(n??1)-1),1000);
    return()=>clearTimeout(t);
  },[timeLeft,phase,picked]);
 
  function buildRoundPool(): any[] {
    const profile = loadProfile();
    let pool: any[] = [];
    if (isGuest || !profile || !profile.questionnaire) {
      pool = Object.values(QUESTIONS).flat() as any[];
    } else {
      pool = getProfilePool(profile);
    }
    pool = pool.map(q => {
      if (q.cat && !Object.keys(QUESTIONS).includes(q.cat)) {
        const correctAnswer = q.answers[q.correct];
        const shuffled = [...q.answers].sort(() => Math.random() - 0.5);
        return { ...q, answers: shuffled, correct: shuffled.indexOf(correctAnswer) };
      }
      return q;
    });
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let i = 1; i < pool.length; i++) {
      if (pool[i].cat && pool[i].cat === pool[i-1].cat) {
        for (let j = i + 1; j < pool.length; j++) {
          if (pool[j].cat !== pool[i-1].cat) { [pool[i], pool[j]] = [pool[j], pool[i]]; break; }
        }
      }
    }
    return pool;
  }
 
  function startRound(){
    const profile = loadProfile();
    if(!playerNames[0].trim() && !profile) return;
    if(profile && !isGuest) setPlayerNames([profile.name]);
    if(isMulti){startMultiRound();return;}
    const pool = buildRoundPool();
    setRoundPool(pool);setRoundPoolIdx(0);setLastQuestionCat(null);
    setRoundCorrect(0);setRoundTotal(0);
    setScreen('game');setHoleIdx(0);setScorecard([]);resetHole(0);
  }
 
  function resetHole(idx:number){
    const h=COURSE[idx];
    setRemaining(h.yards);setStrokes(0);setLie('Tee Box');setFeedback('');
    setClub(null);setQuestion(null);setPicked(null);setTimeLeft(null);
    setUsedQ({});setPhase('club');setIsPutting(false);setWind(generateWind());
  }
 
  function getNextFromPool(): any {
    if (roundPool.length === 0) {
      const fallback = Object.values(QUESTIONS).flat() as any[];
      return fallback[Math.floor(Math.random() * fallback.length)];
    }
    const idx = roundPoolIdx % roundPool.length;
    const q = roundPool[idx];
    setRoundPoolIdx(idx + 1);
    setLastQuestionCat(q.cat || null);
    return q;
  }
 
  function chooseClub(c:string){
    const q = getNextFromPool();
    setClub(c);setQuestion(q);setQIdx(roundPoolIdx);setPicked(null);setFeedback('');setTimeLeft(TIMER_SECONDS);setPhase('question');
  }
 
  function loadPutt(){
    const q = getNextFromPool();
    setClub('putter');setQuestion(q);setQIdx(roundPoolIdx);setPicked(null);setFeedback('');
    setTimeLeft(TIMER_SECONDS);setIsPutting(true);setPhase('question');
  }
 
  function handleAnswer(i:number){
    if(picked!==null)return;
    const secondsLeft=timeLeft??0;
    setTimeLeft(null);setPicked(i);
    const correct=i===question.correct;
    const clubData=CLUBS[club!];
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
    setStrokes(s=>s+1+penaltyCount);
    setRemaining(finalRemaining);setLie(finalLie);
    setUsedQ(prev=>({...prev,[club!]:[...(prev[club!]||[]),qIdx]}));
    setRoundTotal(t => t + 1);
    if (correct) setRoundCorrect(c => c + 1);
    const shotNote=correct?`✅ ${clubData.name} — ${landNote}.`:`❌ Wrong! ${clubData.name} — ${landNote}.`;
    const penaltyNote=penalty?`\n\n${penalty.penaltyNote}`:'';
    setFeedback(shotNote+penaltyNote);setPhase('feedback');
  }
 
  function nextShot(){
    if(lie==='Holed'){
      const newCard=[...scorecard,strokes];setScorecard(newCard);
      if(holeIdx<roundLength-1){setScreen('hole_leaderboard');setScorecard(newCard);}
      else setScreen('end');
      return;
    }
    if(lie==='Green'&&isPutting){loadPutt();return;}
    if(remaining<=20){loadPutt();return;}
    setClub(null);setQuestion(null);setPicked(null);setFeedback('');setPhase('club');
  }
 
  if(showProfile) return <ProfileScreen onBack={()=>{setShowProfile(false);setScreen('landing');}}/>;
  if(screen==='leaderboard') return <LeaderboardScreen onBack={()=>setScreen('landing')}/>;
 
  if(screen==='landing'){
    const profile = loadProfile();
    const tierColors: Record<string,string> = {Championship:'#c8a84b',Advanced:'#3fa36b',Intermediate:'#4a90d9',Recreational:'#9b59b6',Beginner:'#7a9485'};
    const tierColor = tierColors[profile?.courseTier||'Intermediate'];
    return(
      <div className="screen center" style={{gap:0}}>
        <div style={{width:80,height:80,borderRadius:'50%',border:'2px solid var(--gold)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'2rem',marginBottom:24,background:'radial-gradient(circle,#1a2e20 0%,var(--bg) 100%)',boxShadow:'0 0 32px rgba(200,168,75,0.15)'}}>⛳</div>
        <h1 style={{fontFamily:'Georgia,serif',fontSize:'clamp(2.4rem,9vw,3.8rem)',color:'var(--gold)',letterSpacing:'2px',lineHeight:1.1,textAlign:'center',marginBottom:8}}>Scramble<br/>Brains</h1>
        <div style={{width:60,height:1,background:'var(--gold)',opacity:0.4,margin:'16px auto'}}/>
        <p style={{fontSize:'0.72rem',letterSpacing:'4px',textTransform:'uppercase',color:'var(--muted)',marginBottom:32}}>Golf · Trivia · Strategy</p>
        <div style={{width:'100%',maxWidth:300,display:'flex',flexDirection:'column',gap:12}}>
          {profile ? (
            <button className="btn" onClick={()=>{setIsGuest(false);setScreen('start');}} style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'14px 20px',gap:4}}>
              <span style={{fontSize:'0.65rem',letterSpacing:'2px',textTransform:'uppercase',color:'rgba(255,255,255,0.6)',marginBottom:2}}>Continue as</span>
              <span style={{fontSize:'1.1rem'}}>{profile.name}</span>
              {profile.courseTier&&<span style={{fontSize:'0.68rem',color:tierColor,letterSpacing:'1px'}}>📍 {profile.courseTier} Tee · OWGTR {profile.owgtr}</span>}
            </button>
          ) : null}
          <button onClick={()=>setShowProfile(true)} style={{background:'transparent',border:'1px solid var(--gold)',color:'var(--gold)',padding:'13px',borderRadius:8,fontFamily:'Georgia,serif',fontSize:'0.85rem',cursor:'pointer'}}>
            {profile ? '✏️ Switch / Edit Profile' : '🏌️ Create Profile'}
          </button>
          <button onClick={()=>{setIsGuest(true);setScreen('start');}} style={{background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',padding:'13px',borderRadius:8,fontFamily:'Georgia,serif',fontSize:'0.85rem',cursor:'pointer'}}>
            Play as Guest
          </button>
          <button onClick={()=>setScreen('leaderboard')} style={{background:'transparent',border:'1px solid rgba(200,168,75,0.3)',color:'rgba(200,168,75,0.7)',padding:'13px',borderRadius:8,fontFamily:'Georgia,serif',fontSize:'0.85rem',cursor:'pointer',letterSpacing:'2px'}}>
            🏆 Leaderboard
          </button>
        </div>
      </div>
    );
  }
 
  if(screen==='hole_leaderboard'){
    const completedHole = COURSE[holeIdx];
    const isLastHole = holeIdx >= roundLength - 1;
    const totalPar = COURSE.slice(0, scorecard.length).reduce((s,h)=>s+h.par,0);
    const totalStrokes = scorecard.reduce((a,b)=>a+b,0);
    const totalDiff = totalStrokes - totalPar;
    const holeScore = scorecard[scorecard.length-1];
    const holePar = completedHole.par;
    const holeDiff = holeScore - holePar;
    const holeResult = scoreLabel(holeScore, holePar);
    const diffColor = totalDiff < 0 ? 'var(--gold)' : totalDiff === 0 ? 'var(--green-lt)' : 'var(--red)';
    const holeDiffColor = holeDiff < 0 ? 'var(--gold)' : holeDiff === 0 ? 'var(--green-lt)' : 'var(--red)';
    const nextHole = COURSE[holeIdx+1];
    function proceedToNextHole(){ const n=holeIdx+1; setHoleIdx(n); resetHole(n); setScreen('game'); }
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
            {scorecard.map((s,i)=>{
              const d=s-COURSE[i].par;
              const color=d<0?'var(--gold)':d===0?'var(--green-lt)':'var(--red)';
              return(<div key={i} style={{background:'var(--surface)',border:`1px solid ${color}`,borderRadius:6,padding:'6px 8px',textAlign:'center',minWidth:38}}><div style={{color:'var(--muted)',fontSize:'0.6rem'}}>H{i+1}</div><div style={{color,fontSize:'0.9rem',fontFamily:'Georgia,serif'}}>{s}</div></div>);
            })}
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
 
  if(screen==='start') return (
    <div className="screen center" style={{gap:0,justifyContent:'center'}}>
      <div style={{width:80,height:80,borderRadius:'50%',border:'2px solid var(--gold)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'2rem',marginBottom:24,background:'radial-gradient(circle,#1a2e20 0%,var(--bg) 100%)',boxShadow:'0 0 32px rgba(200,168,75,0.15)'}}>⛳</div>
      <h1 style={{fontFamily:'Georgia,serif',fontSize:'clamp(2.4rem,9vw,3.8rem)',color:'var(--gold)',letterSpacing:'2px',lineHeight:1.1,textAlign:'center',marginBottom:8}}>Scramble<br/>Brains</h1>
      <div style={{width:60,height:1,background:'var(--gold)',opacity:0.4,margin:'16px auto'}}/>
      <p style={{fontSize:'0.72rem',letterSpacing:'4px',textTransform:'uppercase',color:'var(--muted)',marginBottom:16}}>Golf · Trivia · Strategy</p>
      {isGuest&&(
        <div style={{width:'100%',maxWidth:300,background:'rgba(200,168,75,0.1)',border:'1px solid var(--gold)',borderRadius:8,padding:'10px 14px',marginBottom:16,textAlign:'center'}}>
          <p style={{fontSize:'0.72rem',color:'var(--gold)',fontFamily:'Georgia,serif'}}>⚠️ Guest mode — no handicap or ranking will be tracked</p>
        </div>
      )}
      {(!loadProfile()||isGuest)&&(
        <div style={{width:'100%',maxWidth:280,display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
          {playerNames.map((name,i)=>(
            <div key={i} style={{display:'flex',gap:8,alignItems:'center'}}>
              <input type="text" placeholder={i===0?'Your name':'Player '+(i+1)+' name'} value={name} onChange={e=>updateName(i,e.target.value)} maxLength={20}
                style={{flex:1,background:'transparent',border:'none',borderBottom:'1px solid var(--gold)',color:'var(--text)',padding:'10px 8px',fontFamily:'Georgia,serif',fontSize:'1rem',letterSpacing:'2px',textAlign:'center',outline:'none'}}/>
              {i>0&&<button onClick={()=>removeName(i)} style={{background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',padding:'6px 10px',borderRadius:6,cursor:'pointer',fontFamily:'Georgia,serif',fontSize:'0.8rem'}}>✕</button>}
            </div>
          ))}
          {playerNames.length<4&&(
            <button onClick={()=>setPlayerNames(n=>[...n,''])} style={{background:'transparent',border:'1px dashed var(--border)',color:'var(--muted)',padding:'8px',borderRadius:6,fontFamily:'Georgia,serif',fontSize:'0.78rem',cursor:'pointer'}}>+ Add Player</button>
          )}
        </div>
      )}
      {loadProfile()&&!isGuest&&(
        <div style={{background:'var(--surface)',border:'1px solid var(--gold)',borderRadius:8,padding:'12px 16px',marginBottom:16,width:'100%',maxWidth:280,textAlign:'center'}}>
          <p style={{fontSize:'0.65rem',letterSpacing:'2px',textTransform:'uppercase',color:'var(--muted)',marginBottom:4}}>Playing as</p>
          <p style={{fontFamily:'Georgia,serif',fontSize:'1.1rem',color:'var(--gold)'}}>{loadProfile()?.name}</p>
        </div>
      )}
      <p style={{fontSize:'0.65rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:10}}>How many holes?</p>
      <div style={{display:'flex',gap:8,marginBottom:6,width:'100%',maxWidth:280}}>
        {([9,18] as const).map(n=>(
          <button key={n} onClick={()=>setRoundLength(n)} style={{flex:1,background:roundLength===n?'var(--gold)':'transparent',color:roundLength===n?'var(--bg)':'var(--muted)',border:`1px solid ${roundLength===n?'var(--gold)':'var(--border)'}`,padding:'12px',borderRadius:6,fontFamily:'Georgia,serif',fontSize:'1rem',cursor:'pointer'}}>
            {n} Holes
          </button>
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
            {sorted.map((p,rank)=>{
              const diff=p.total-totalPar;
              return(<div key={p.name} style={{background:'var(--surface)',border:`1px solid ${rank===0?'var(--gold)':'var(--border)'}`,borderRadius:8,padding:'12px 16px',display:'flex',alignItems:'center',gap:12}}>
                <span style={{fontSize:'1.2rem'}}>{rank===0?'🏆':`#${rank+1}`}</span>
                <span style={{flex:1,color:rank===0?'var(--gold)':'var(--text)',fontFamily:'Georgia,serif'}}>{p.name}</span>
                <span style={{color:'var(--muted)',fontSize:'0.85rem'}}>{p.total} strokes</span>
                <span style={{color:diff<0?'var(--gold)':diff===0?'var(--green-lt)':'var(--red)',fontSize:'0.85rem'}}>{diff>0?`+${diff}`:diff===0?'E':diff}</span>
              </div>);
            })}
          </div>
          <button className="btn" onClick={()=>setScreen('landing')}>Play Again</button>
        </div>
      );
    }
    if(multiPhase==='hole_results'){
      return(
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
    }
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
        {multiPhase==='question'&&multiPicked===null&&multiTimeLeft!==null&&(
          <div className="timer-wrap">
            <div className={`timer-bar ${multiTimeLeft<=5?'danger':''}`} style={{width:`${(multiTimeLeft/TIMER_SECONDS)*100}%`}}/>
            <span className={`timer-label ${multiTimeLeft<=5?'danger':''}`}>{multiTimeLeft}s</span>
          </div>
        )}
        {multiQuestion&&(
          <div className="card">
            <p className="q-text">{multiQuestion.text}</p>
            <div className="answers">
              {multiQuestion.answers.map((a:string,i:number)=>{
                let cls='ans';
                if(multiPicked!==null&&i===multiQuestion.correct)cls+=' correct';
                else if(multiPicked===i)cls+=' wrong';
                return <button key={i} className={cls} onClick={()=>handleMultiAnswer(i)} disabled={multiPicked!==null}><span className="ans-letter">{String.fromCharCode(65+i)}</span>{a}</button>;
              })}
            </div>
          </div>
        )}
      </div>
    );
  }
 
  if(screen==='end'){
    const totalPar=COURSE.slice(0,roundLength).reduce((s,h)=>s+h.par,0);
    const totalStrokes=scorecard.reduce((a,b)=>a+b,0);
    const diff=totalStrokes-totalPar;
    const profile = loadProfile();
    const answerPct = roundTotal > 0 ? Math.round(roundCorrect/roundTotal*100) : 0;
    const projected = profile ? calcProjectedRanking(profile, roundCorrect, roundTotal) : null;
    const nextTuesday = getNextTuesdayNoon();
    const tuesdayStr = nextTuesday.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
    if (profile && projected) {
      try {
        localStorage.setItem('sb_pending_ranking', JSON.stringify({ projectedHandicap: projected.projectedHandicap, projectedOwgtr: projected.projectedOwgtr }));
        const updatedProfile = { ...profile, roundsPlayed: (profile.roundsPlayed||0)+1, correctAnswers: (profile.correctAnswers||0)+roundCorrect, totalAnswers: (profile.totalAnswers||0)+roundTotal };
        saveProfile(updatedProfile);
        if (profile.pin) { cloudSaveProfile(updatedProfile, profile.pin).catch(()=>{}); }
      } catch {}
    }
    const tierColors: Record<string,string> = { Championship:'#c8a84b', Advanced:'#3fa36b', Intermediate:'#4a90d9', Recreational:'#9b59b6', Beginner:'#7a9485' };
    const tierColor = tierColors[profile?.courseTier || 'Intermediate'];
    const movementColor = projected?.movement==='improved'?'var(--green-lt)':projected?.movement==='declined'?'var(--red)':'var(--muted)';
    const movementEmoji = projected?.movement==='improved'?'📈':projected?.movement==='declined'?'📉':'➡️';
    const movementLabel = projected?.movement==='improved'?'Improving':projected?.movement==='declined'?'Declining':'Holding Steady';
    return(
      <div className="screen center">
        <p className="eyebrow">{playerName?`${playerName}'s Round`:'Round Complete'}</p>
        <div className="score-big">{totalLabel(diff)}</div>
        <p className="muted" style={{marginBottom:16}}>{totalStrokes} strokes · Par {totalPar}</p>
        <div className="scorecard">
          <div className="sc-row header"><span>Hole</span><span>Par</span><span>Score</span><span>Result</span></div>
          {COURSE.map((h,i)=>(
            <div className="sc-row" key={h.number}>
              <span>{h.number}</span><span>{h.par}</span><span>{scorecard[i]??'—'}</span>
              <span>{scorecard[i]!=null?scoreLabel(scorecard[i],h.par):'—'}</span>
            </div>
          ))}
          <div className="sc-row" style={{fontWeight:'bold',borderTop:'2px solid var(--border)'}}>
            <span>Total</span><span>{totalPar}</span><span>{totalStrokes}</span>
            <span>{diff>0?`+${diff}`:diff===0?'E':diff}</span>
          </div>
        </div>
        {profile && projected && (
          <div style={{width:'100%',marginBottom:20}}>
            <p style={{fontSize:'0.65rem',letterSpacing:'3px',textTransform:'uppercase',color:'var(--muted)',marginBottom:12,textAlign:'center'}}>
              Trivia Performance — {answerPct}% correct ({roundCorrect}/{roundTotal})
            </p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
              {([
                ['Current Handicap', profile.triviaHandicap, tierColor],
                ['Current O.W.G.T.R.', profile.owgtr, 'var(--gold)'],
                ['Projected Handicap', projected.projectedHandicap, movementColor],
                ['Projected O.W.G.T.R.', projected.projectedOwgtr, movementColor],
              ] as [string,any,string][]).map(([label,val,color])=>(
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
          </div>
        )}
        <button className="btn" onClick={()=>setScreen('landing')}>Play Again</button>
      </div>
    );
  }
 
  const availableClubs=getAvailableClubs(remaining);
  const bucket=getBucket(remaining);
 
  return(
    <div className="screen">
      <div className="scoreboard">
        {[['Hole',`${hole.number}/18`],['Par',hole.par],['Strokes',strokes],['Lie',lie],['To Go',remaining>20?`${remaining}yd`:remaining>0?`${remaining}ft`:'—']].map(([l,v])=>(
          <div className="sc" key={String(l)}><span className="sc-label">{l}</span><span className="sc-val">{v}</span></div>
        ))}
        <div className="sc">
          <span className="sc-label">Wind</span>
          <span className="sc-val" style={{fontSize:'0.78rem'}}>{wind.speed===0?'—':`${WIND_ARROWS[wind.dir]}${wind.speed}`}</span>
        </div>
      </div>
      <HoleGraphic holeYards={hole.yards} remaining={remaining} lie={lie} par={hole.par} strokes={strokes} scorecard={scorecard} playerName={playerName} isMulti={false}/>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <p className="phase-label" style={{margin:0}}>{hole.name} · {bucket} · {remaining>20?`${remaining} yards`:`${remaining} feet`} to go</p>
        <button onClick={()=>setScreen('start')} style={{background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',padding:'4px 10px',borderRadius:6,fontSize:'0.75rem',cursor:'pointer'}}>✕ Exit</button>
      </div>
      {scorecard.length>0&&(
        <div style={{display:'flex',gap:4,marginBottom:14,flexWrap:'wrap'}}>
          {scorecard.map((s,i)=>{
            const d=s-COURSE[i].par;
            const color=d<0?'var(--gold)':d===0?'var(--green-lt)':'var(--red)';
            return <div key={i} style={{background:'var(--surface)',border:`1px solid ${color}`,borderRadius:6,padding:'4px 8px',textAlign:'center',fontSize:'0.78rem',minWidth:36}}><div style={{color:'var(--muted)',fontSize:'0.65rem'}}>H{i+1}</div><div style={{color}}>{s}</div></div>;
          })}
        </div>
      )}
      {phase==='club'&&(
        <>
          <p className="phase-label">Select Your Club</p>
          {wind.speed>0&&(
            <p style={{fontSize:'0.72rem',color:'var(--muted)',marginBottom:8,textAlign:'center'}}>
              {WIND_ARROWS[wind.dir]} {wind.speed} mph {wind.dir} wind
              {['S','SW','SE'].includes(wind.dir)?' — tailwind, ball flies farther':['N'].includes(wind.dir)?' — headwind, ball falls short':' — crosswind, slight distance loss'}
            </p>
          )}
          <div className="strategy-row">
            {availableClubs.map(c=>(
              <button key={c} className="strat-btn" onClick={()=>chooseClub(c)}>
                {CLUBS[c].emoji} {CLUBS[c].name}
                <span style={{display:'block',fontSize:'0.75rem',color:'var(--muted)',marginTop:3}}>~{CLUBS[c].yards} yds</span>
              </button>
            ))}
          </div>
        </>
      )}
      {phase==='question'&&picked===null&&timeLeft!==null&&(
        <div className="timer-wrap">
          <div className={`timer-bar ${timeLeft<=5?'danger':''}`} style={{width:`${(timeLeft/TIMER_SECONDS)*100}%`}}/>
          <span className={`timer-label ${timeLeft<=5?'danger':''}`}>{timeLeft}s</span>
        </div>
      )}
      {phase==='question'&&question&&(
        <div className="card">
          <p className="q-text">{question.text}</p>
          <div className="answers">
            {question.answers.map((a:string,i:number)=>{
              let cls='ans';
              if(picked!==null&&i===question.correct)cls+=' correct';
              else if(picked===i)cls+=' wrong';
              return <button key={i} className={cls} onClick={()=>handleAnswer(i)} disabled={picked!==null}><span className="ans-letter">{String.fromCharCode(65+i)}</span>{a}</button>;
            })}
          </div>
        </div>
      )}
      {phase==='feedback'&&feedback&&(
        <div className="feedback">
          {feedback.split('\n\n').map((line,i)=>(
            <p key={i} style={i>0?{color:'var(--gold)',fontWeight:'bold',borderTop:'1px solid var(--border)',paddingTop:8}:{}}>{line}</p>
          ))}
          <button className="btn-next" onClick={nextShot}>
            {lie==='Holed'?(holeIdx<COURSE.length-1?'Next Hole →':'Finish Round →'):remaining<=20?'Putt →':'Next Shot →'}
          </button>
        </div>
      )}
    </div>
  );
}
