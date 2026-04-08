import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zfzyyvoogywkmzlcbjvs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpmenl5dm9vZ3l3a216bGNianZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxODIwNjAsImV4cCI6MjA5MDc1ODA2MH0.vcsV11cdFSgKB64NhE9Z1PAcra9h7dtyEeC_RBJv2EM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function cloudLoadProfile(name: string, pin: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('name', name.trim())
    .eq('pin', pin.trim())
    .single();
  if (error || !data) return null;
  return cloudToProfile(data);
}

export async function cloudCreateProfile(profile: any, pin: string): Promise<boolean> {
  const { error } = await supabase
    .from('players')
    .insert([profileToCloud(profile, pin)]);
  return !error;
}

export async function cloudSaveProfile(profile: any, pin: string): Promise<boolean> {
  const { error } = await supabase
    .from('players')
    .update({ ...profileToCloud(profile, pin), updated_at: new Date().toISOString() })
    .eq('name', profile.name)
    .eq('pin', pin);
  return !error;
}

export async function cloudCheckNameExists(name: string): Promise<boolean> {
  const { data } = await supabase
    .from('players')
    .select('name')
    .eq('name', name.trim())
    .single();
  return !!data;
}

function profileToCloud(profile: any, pin: string) {
  return {
    name: profile.name,
    pin: pin,
    owgtr: profile.owgtr || 1000,
    trivia_handicap: profile.triviaHandicap || 36,
    sbr: profile.sbr || 1000,
    course_tier: profile.courseTier || 'Intermediate',
    rounds_played: profile.roundsPlayed || 0,
    correct_answers: profile.correctAnswers || 0,
    total_answers: profile.totalAnswers || 0,
    experience: profile.experience || 'Beginner',
    fav_cats: profile.favCats || [],
    questionnaire: profile.questionnaire || null,
  };
}

function cloudToProfile(data: any) {
  return {
    name: data.name,
    pin: data.pin,
    owgtr: data.owgtr,
    triviaHandicap: data.trivia_handicap,
    sbr: data.sbr,
    courseTier: data.course_tier,
    roundsPlayed: data.rounds_played,
    correctAnswers: data.correct_answers,
    totalAnswers: data.total_answers,
    experience: data.experience,
    favCats: data.fav_cats || [],
    questionnaire: data.questionnaire || null,
  };
}