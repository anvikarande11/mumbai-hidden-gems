import { useState } from 'react';
import { ROUNDS, ROUND_SECONDS, rankFor } from '../hooks/useDiscovery';
import JournalModal from './JournalModal';

const glass =
  'pointer-events-auto rounded-2xl border border-slate-300/50 bg-white/75 shadow-[0_8px_28px_rgba(51,65,85,0.14)] backdrop-blur-xl';
const primary =
  'rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500';
const ghost =
  'rounded-full border border-slate-300/70 bg-white/80 px-4 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-500 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400';

const CSS = `
@keyframes mg-miss{0%{opacity:0;transform:translateY(4px)}15%,70%{opacity:1;transform:none}100%{opacity:0}}
.mg-miss{animation:mg-miss 1.4s ease forwards}
@keyframes mg-toast{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
.mg-toast{animation:mg-toast .3s ease both}
@media (prefers-reduced-motion:reduce){.mg-miss,.mg-toast{animation:none}}
`;

export default function DiscoveryOverlay({ discovery, landmarks = [], visitedIds }) {
  const { game, target, clue, hubs, unlockedCount, visitedCount, tier, toast, startGame, quitGame, nextRound } = discovery;
  const [open, setOpen] = useState(false);
  const [isJournalOpen, setIsJournalOpen] = useState(false);
  

  const playing = game.phase === 'playing';
  const result = game.phase === 'result';
  const done = game.phase === 'done';
  const rounds = game.order?.length ?? ROUNDS;
  const low = playing && game.timeLeft <= 10;

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <style>{CSS}</style>

      {/* Top Left Controls & Journal Button */}
      <div className="pointer-events-auto absolute left-4 top-4 flex items-center gap-2">
        {game.phase === 'off' && (
          <button type="button" onClick={startGame} className={`${primary} px-5 py-2.5 text-sm shadow-md`}>
            🎲 Spin &amp; Find
          </button>
        )}
        <button
  type="button"
  onClick={() => setIsJournalOpen(true)}
  className="pointer-events-auto rounded-full bg-white/90 px-4 py-2 text-xs font-semibold text-slate-800 shadow-md backdrop-blur hover:bg-white transition flex items-center gap-1.5"
>
  <span>📖</span> Travel Journal
</button>
      </div>

      {/* Passport */}
      <div className="absolute right-4 top-4 flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`${glass} px-4 py-2 text-xs font-medium text-slate-700 transition hover:text-slate-900`}
        >
          Passport · {unlockedCount}/{hubs.length} hubs
        </button>
        {open && (
          <div className={`${glass} w-64 p-4`}>
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">Explorer Badge</div>
            <div className="mt-0.5 text-sm font-semibold text-slate-900">{tier}</div>
            <div className="text-xs text-slate-500">
              {unlockedCount}/{hubs.length} hubs unlocked
            </div>
            <ul className="mt-3 space-y-2.5">
              {hubs.map((h) => (
                <li key={h.id}>
                  <div className="flex items-center justify-between text-xs">
                    <span className={h.unlocked ? 'font-medium text-slate-900' : 'text-slate-500'}>
                      {h.unlocked ? '✓ ' : ''}
                      {h.name}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">
                      {h.count}/{h.total}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200/80">
                    <div
                      className="h-full rounded-full bg-slate-700 transition-[width] duration-500"
                      style={{ width: `${h.total ? (h.count / h.total) * 100 : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-slate-300/50 pt-2 text-[11px] text-slate-500">
              {visitedCount} {visitedCount === 1 ? 'gem' : 'gems'} discovered
            </div>
          </div>
        )}
      </div>

      {/* Game HUD */}
      {playing && (
        <div className={`${glass} absolute left-1/2 top-16 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 p-4`}>
          <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
            <span>
              Round {game.round + 1}/{rounds}
            </span>
            <span className="flex items-center gap-3">
              <span>{game.score} pts</span>
              <button type="button" onClick={quitGame} aria-label="Quit game" className="text-base leading-none text-slate-400 hover:text-slate-700">
                ×
              </button>
            </span>
          </div>
          <p className="mt-2 text-[15px] font-semibold leading-snug text-slate-900">{clue}</p>
          <div className="mt-1.5 min-h-[1rem] space-x-3 text-[11px] text-slate-500">
            {game.timeLeft <= 20 && <span>Vibe: {target?.vibeTag}</span>}
            {game.timeLeft <= 10 && <span>Budget: {target?.priceRange}</span>}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/80">
              <div
                className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${low ? 'bg-rose-500' : 'bg-slate-700'}`}
                style={{ width: `${(game.timeLeft / ROUND_SECONDS) * 100}%` }}
              />
            </div>
            <span className={`w-8 text-right font-mono text-xs ${low ? 'text-rose-600' : 'text-slate-600'}`}>{game.timeLeft}s</span>
          </div>
          {game.wrong > 0 && (
            <div key={game.wrong} className="mg-miss mt-2 text-[11px] font-medium text-rose-600">
              Not that one. −5s
            </div>
          )}
        </div>
      )}

      {result && (
        <div className={`${glass} absolute left-1/2 top-16 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 p-4`}>
          <div className={`text-[11px] font-medium uppercase tracking-[0.12em] ${game.outcome === 'found' ? 'text-emerald-700' : 'text-slate-500'}`}>
            {game.outcome === 'found' ? `Found it · +${game.gained} pts` : "Time's up"}
          </div>
          <div className="mt-1 text-[15px] font-semibold text-slate-900">{target?.name}</div>
          <div className="text-xs text-slate-500">{target?.area}</div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-500">{game.score} pts total</span>
            <button type="button" onClick={nextRound} className={primary}>
              {game.round + 1 >= rounds ? 'See results' : 'Next spot'}
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className={`${glass} absolute left-1/2 top-16 w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 p-5 text-center`}>
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">Your rank</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{rankFor(game.found, rounds)}</div>
          <div className="mt-1 text-xs text-slate-500">
            {game.found}/{rounds} gems found · {game.score} pts
          </div>
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" onClick={startGame} className={primary}>
              Play again
            </button>
            <button type="button" onClick={quitGame} className={ghost}>
              Back to map
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div
          key={toast.key}
          className="mg-toast absolute bottom-20 left-1/2 rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white shadow-lg"
        >
          {toast.text}
        </div>
      )}

      {/* Travel Journal Modal */}
      <JournalModal
        isOpen={isJournalOpen}
        onClose={() => setIsJournalOpen(false)}
        landmarks={landmarks}
        visitedIds={visitedIds}
      />
    </div>
  );
}