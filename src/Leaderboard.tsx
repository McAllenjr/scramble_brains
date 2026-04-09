import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';

// ─── DEMO DATA (falls off as real players fill spots) ─────────────
const DEMO_PLAYERS = [
  { name: 'T. Bradshaw',  rounds_played: 12, owgtr: 1820, best_round: 58, avg_score: 61.2, total_answers: 144, correct_answers: 122 },
  { name: 'R. Clemente', rounds_played: 9,  owgtr: 1755, best_round: 59, avg_score: 63.1, total_answers: 108, correct_answers: 89  },
  { name: 'M. Lemieux',  rounds_played: 7,  owgtr: 1690, best_round: 61, avg_score: 64.8, total_answers: 84,  correct_answers: 68  },
  { name: 'H. Stargell', rounds_played: 6,  owgtr: 1580, best_round: 62, avg_score: 65.4, total_answers: 72,  correct_answers: 57  },
  { name: 'A. Carnegie', rounds_played: 4,  owgtr: 1410, best_round: 64, avg_score: 67.0, total_answers: 48,  correct_answers: 36  },
  { name: 'J. Harris',   rounds_played: 11, owgtr: 1640, best_round: 60, avg_score: 62.5, total_answers: 132, correct_answers: 105 },
  { name: 'S. Crosby',   rounds_played: 8,  owgtr: 1720, best_round: 59, avg_score: 62.0, total_answers: 96,  correct_answers: 80  },
  { name: 'B. Mazeroski',rounds_played: 5,  owgtr: 1490, best_round: 63, avg_score: 66.2, total_answers: 60,  correct_answers: 44  },
];

interface PlayerRow {
  name: string;
  rounds_played: number;
  owgtr: number;
  best_round: number;
  avg_score: number;
  total_answers: number;
  correct_answers: number;
  isDemo?: boolean;
}

interface LeaderboardData {
  dailyLow: PlayerRow[];
  weeklyLow: PlayerRow[];
  mostRounds: PlayerRow[];
  bestAvg: PlayerRow[];
}

async function fetchLeaderboard(): Promise<LeaderboardData> {
  try {
    const { data, error } = await supabase
      .from('players')
      .select('name, rounds_played, owgtr, correct_answers, total_answers')
      .gt('rounds_played', 0);

    let players: PlayerRow[] = [];

    if (!error && data && data.length > 0) {
      players = data.map((p: any) => ({
        name: p.name,
        rounds_played: p.rounds_played || 0,
        owgtr: p.owgtr || 1000,
        best_round: p.best_round || 72,
        avg_score: p.avg_score || 75,
        total_answers: p.total_answers || 0,
        correct_answers: p.correct_answers || 0,
        isDemo: false,
      }));
    }

    const needed = Math.max(0, 5 - players.length);
    const demoFill = DEMO_PLAYERS.slice(0, needed).map(d => ({ ...d, isDemo: true }));
    const all = [...players, ...demoFill];

    return {
      dailyLow:   [...all].sort((a, b) => a.best_round - b.best_round).slice(0, 5),
      weeklyLow:  [...all].sort((a, b) => a.best_round - b.best_round).slice(0, 5),
      mostRounds: [...all].sort((a, b) => b.rounds_played - a.rounds_played).slice(0, 5),
      bestAvg:    [...all].sort((a, b) => a.avg_score - b.avg_score).slice(0, 5),
    };
  } catch {
    const demo = DEMO_PLAYERS.slice(0, 5).map(d => ({ ...d, isDemo: true }));
    return { dailyLow: demo, weeklyLow: demo, mostRounds: demo, bestAvg: demo };
  }
}

const SPONSOR_MESSAGES = [
  '⛳ TODAY\'S ROUND BROUGHT TO YOU BY YOUR BRAND',
  '🏌️ SCRAMBLE BRAINS — GOLF TRIVIA STRATEGY',
  '📍 YOUR BRAND — PROUD SPONSOR OF SCRAMBLE BRAINS',
  '🏆 THINK FAST. PLAY SMART. SCRAMBLE BRAINS.',
];

export function LeaderboardTicker({ data }: { data: any }) {
  const items = [
    ...SPONSOR_MESSAGES,
    data ? `🏆 LOW ROUND: ${data.dailyLow[0]?.name || '---'} · ${data.dailyLow[0]?.best_round || '--'}` : '',
    data ? `🔥 MOST ROUNDS: ${data.mostRounds[0]?.name || '---'} · ${data.mostRounds[0]?.rounds_played || '--'} PLAYED` : '',
    data ? `📊 BEST AVG: ${data.bestAvg[0]?.name || '---'} · ${data.bestAvg[0]?.avg_score?.toFixed(1) || '--'}` : '',
    data ? `🌍 TOP RANKED: ${data.dailyLow[0]?.name || '---'} · OWGTR ${data.dailyLow[0]?.owgtr || '--'}` : '',
  ].filter(Boolean);

  const [offset, setOffset] = useState(0);
  const itemWidth = 340;
  const total = items.length * itemWidth;

  useEffect(() => {
    let frame: number;
    let pos = 0;
    const animate = () => {
      pos += 0.6;
      if (pos >= total) pos = 0;
      setOffset(pos);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [total]);

  return (
    <div style={{
      width: '100%', height: 28, background: '#0a1a08',
      borderTop: '1px solid #c8a84b', overflow: 'hidden', position: 'relative', flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, height: '100%',
        display: 'flex', alignItems: 'center',
        transform: `translateX(-${offset}px)`, willChange: 'transform',
      }}>
        {[...items, ...items].map((item, i) => (
          <span key={i} style={{
            display: 'inline-block', width: itemWidth, flexShrink: 0,
            fontFamily: 'Georgia, serif', fontSize: '0.68rem',
            color: i % 2 === 0 ? '#c8a84b' : 'rgba(255,255,255,0.6)',
            letterSpacing: '1.5px', paddingRight: 40, whiteSpace: 'nowrap',
          }}>
            {item}
            <span style={{ color: 'rgba(200,168,75,0.3)', marginLeft: 20 }}>◆</span>
          </span>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 40, height: '100%', background: 'linear-gradient(to right, #0a1a08, transparent)', pointerEvents: 'none' }}/>
      <div style={{ position: 'absolute', right: 0, top: 0, width: 40, height: '100%', background: 'linear-gradient(to left, #0a1a08, transparent)', pointerEvents: 'none' }}/>
    </div>
  );
}

const MEDALS = ['#c8a84b', '#9aa8b0', '#b87333', 'rgba(255,255,255,0.4)', 'rgba(255,255,255,0.3)'];
const RANK_LABELS = ['1ST', '2ND', '3RD', '4TH', '5TH'];

function BoardRow({ rank, name, value, isDemo }: { rank: number; name: string; value: string; isDemo?: boolean }) {
  const medal = MEDALS[rank];
  const isTop3 = rank < 3;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 0,
      borderBottom: '1px solid rgba(200,168,75,0.08)',
      padding: '5px 0', opacity: isDemo ? 0.45 : 1,
    }}>
      <div style={{ width: 36, flexShrink: 0, textAlign: 'center', fontFamily: 'Georgia, serif', fontSize: isTop3 ? '0.72rem' : '0.62rem', color: medal, fontWeight: isTop3 ? 'bold' : 'normal', letterSpacing: '1px' }}>
        {RANK_LABELS[rank]}
      </div>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: medal, flexShrink: 0, opacity: 0.7 }}/>
      <div style={{ flex: 1, paddingLeft: 8, fontFamily: 'Georgia, serif', fontSize: '0.82rem', color: isTop3 ? '#fff' : 'rgba(255,255,255,0.65)', letterSpacing: '0.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {name}{isDemo ? ' *' : ''}
      </div>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: isTop3 ? '0.85rem' : '0.75rem', color: medal, fontWeight: isTop3 ? 'bold' : 'normal', letterSpacing: '1px', paddingRight: 4 }}>
        {value}
      </div>
    </div>
  );
}

function BoardPanel({ title, icon, rows, valueKey, valueFormat }: {
  title: string; icon: string; rows: PlayerRow[];
  valueKey: keyof PlayerRow; valueFormat: (v: any) => string;
}) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(200,168,75,0.2)', borderTop: '2px solid #c8a84b', borderRadius: 4, padding: '10px 12px', flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid rgba(200,168,75,0.2)' }}>
        <span style={{ fontSize: '0.9rem' }}>{icon}</span>
        <span style={{ fontFamily: 'Georgia, serif', fontSize: '0.62rem', letterSpacing: '2.5px', textTransform: 'uppercase', color: '#c8a84b' }}>{title}</span>
      </div>
      {rows.map((row, i) => (
        <BoardRow key={row.name + i} rank={i} name={row.name} value={valueFormat(row[valueKey])} isDemo={row.isDemo} />
      ))}
    </div>
  );
}

export function LeaderboardScreen({ onBack }: { onBack?: () => void }) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');

  useEffect(() => {
    fetchLeaderboard().then(d => {
      setData(d);
      setLoading(false);
      setLastUpdated(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
    });
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#061008', display: 'flex', flexDirection: 'column', fontFamily: 'Georgia, serif' }}>
      <div style={{ background: '#0a1a08', borderBottom: '2px solid #c8a84b', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 44, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 3, height: 20, background: '#c8a84b' }}/>
          <span style={{ fontSize: '0.6rem', letterSpacing: '4px', textTransform: 'uppercase', color: '#c8a84b' }}>Scramble Brains</span>
          <span style={{ fontSize: '0.6rem', letterSpacing: '2px', color: 'rgba(255,255,255,0.25)' }}>Official Rankings</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastUpdated && <span style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.25)', letterSpacing: '1px' }}>UPDATED {lastUpdated}</span>}
          {onBack && <button onClick={onBack} style={{ background: 'transparent', border: '1px solid rgba(200,168,75,0.3)', color: 'rgba(200,168,75,0.7)', padding: '4px 10px', borderRadius: 3, fontFamily: 'Georgia, serif', fontSize: '0.65rem', cursor: 'pointer', letterSpacing: '1px' }}>← BACK</button>}
        </div>
      </div>

      <div style={{ background: 'linear-gradient(180deg, #0d2010 0%, #061008 100%)', padding: '16px 16px 12px', textAlign: 'center', borderBottom: '1px solid rgba(200,168,75,0.15)', flexShrink: 0 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, background: '#0a1a08', border: '1px solid rgba(200,168,75,0.3)', padding: '8px 20px', borderRadius: 2 }}>
          <span style={{ fontSize: '1.2rem' }}>⛳</span>
          <div>
            <div style={{ fontSize: '1.1rem', color: '#c8a84b', letterSpacing: '4px', lineHeight: 1 }}>LEADERBOARD</div>
            <div style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '3px', marginTop: 3 }}>
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}
            </div>
          </div>
          <span style={{ fontSize: '1.2rem' }}>⛳</span>
        </div>
      </div>

      <div style={{ flex: 1, padding: '12px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>⛳</div>
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem', letterSpacing: '2px' }}>LOADING SCORES...</p>
            </div>
          </div>
        ) : data ? (
          <>
            <div style={{ display: 'flex', gap: 10 }}>
              <BoardPanel title="Daily Low Round" icon="🌅" rows={data.dailyLow} valueKey="best_round" valueFormat={v => `${v}`} />
              <BoardPanel title="Weekly Low Round" icon="📅" rows={data.weeklyLow} valueKey="best_round" valueFormat={v => `${v}`} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <BoardPanel title="Most Rounds" icon="🔁" rows={data.mostRounds} valueKey="rounds_played" valueFormat={v => `${v} RDS`} />
              <BoardPanel title="Best Avg Score" icon="📊" rows={data.bestAvg} valueKey="avg_score" valueFormat={v => typeof v === 'number' ? v.toFixed(1) : `${v}`} />
            </div>
            <p style={{ textAlign: 'center', fontSize: '0.58rem', color: 'rgba(255,255,255,0.18)', letterSpacing: '1px', marginTop: 4 }}>
              * PLACEHOLDER · PLAY A ROUND TO CLAIM YOUR SPOT
            </p>
          </>
        ) : null}
      </div>

      <LeaderboardTicker data={data} />
    </div>
  );
}

export { fetchLeaderboard };
