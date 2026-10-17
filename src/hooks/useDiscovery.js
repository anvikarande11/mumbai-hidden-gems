import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

export const ROUNDS = 5;
export const ROUND_SECONDS = 30;
const WRONG_PENALTY = 5;
const BASE_POINTS = 50;

/* Passport hubs. A gem belongs to the first hub whose pattern matches its area. */
export const HUBS = [
  { id: 'south', name: 'South Mumbai', match: /colaba|fort|kala ghoda|churchgate|marine lines|dhobi|tardeo|grant road|gamdevi|byculla|mahalaxmi|walkeshwar|babulnath|bhendi/i },
  { id: 'central', name: 'Dadar & Matunga', match: /dadar|matunga|mahim|sion/i },
  { id: 'bandra', name: 'Bandra & Khar', match: /bandra|khar|pali|ranwar/i },
  { id: 'west', name: 'Western Suburbs', match: /juhu|versova|vile parle|andheri|malad|madh|borivali/i },
  { id: 'east', name: 'Eastern Suburbs', match: /powai|chembur|ghatkopar|kurla/i },
];

const hubIdFor = (gem) => HUBS.find((h) => h.match.test(gem.area ?? ''))?.id ?? (gem.lat < 18.99 ? 'south' : 'west');

/* Hand-written clues for some gems; everything else gets one generated from its data. */
const CLUES = {
  'gem-1': 'Find the 1904 Irani café in Marine Lines.',
  'gem-7': 'Find the pavement book stalls under the old Fort buildings.',
  'gem-13': 'Find the working fish dock in Colaba that wakes up before sunrise.',
  'gem-17': 'Find the antiques bazaar on Mutton Street.',
  'gem-24': 'Find the cricket-mad park at the heart of Dadar.',
  'gem-29': 'Find the legendary South Indian café near King\u2019s Circle.',
  'gem-36': 'Find the small Portuguese fort that looks out at the Sea Link.',
  'gem-39': 'Find the theatre-courtyard café in Juhu.',
  'gem-46': 'Find the lakeside promenade next to IIT Bombay.',
};

const NOUN = {
  cafe: 'café',
  pub: 'pub',
  bar: 'pub',
  study: 'quiet study spot',
  budget: 'budget eatery',
  streetfood: 'street-food stop',
  viewpoint: 'viewpoint',
  culture: 'cultural landmark',
};

export const clueFor = (gem) => CLUES[gem.id] ?? `Find a ${NOUN[gem.category] ?? 'hidden gem'} in ${gem.area}.`;

export const rankFor = (found, total) => {
  const r = total ? found / total : 0;
  if (r >= 1) return 'Gem Keeper';
  if (r >= 0.8) return 'Local';
  if (r >= 0.4) return 'Regular';
  return 'Tourist';
};

export const tierFor = (unlocked, total) => {
  if (unlocked >= total && total > 0) return 'City Insider';
  if (unlocked >= 3) return 'Neighbourhood Regular';
  if (unlocked >= 1) return 'Local Explorer';
  return 'Wanderer';
};

/* ---- Game state machine -------------------------------------------------- */

const IDLE = { phase: 'off' };

function reducer(state, action) {
  switch (action.type) {
    case 'start':
      return {
        phase: 'playing',
        order: action.order,
        round: 0,
        timeLeft: ROUND_SECONDS,
        score: 0,
        streak: 0,
        found: 0,
        wrong: 0,
        gained: 0,
        outcome: null,
      };
    case 'tick':
      if (state.phase !== 'playing') return state;
      return state.timeLeft <= 1
        ? { ...state, phase: 'result', timeLeft: 0, outcome: 'timeout', streak: 0 }
        : { ...state, timeLeft: state.timeLeft - 1 };
    case 'guess': {
      if (state.phase !== 'playing') return state;
      if (action.correct) {
        const gained = BASE_POINTS + state.timeLeft * 5 + state.streak * 25;
        return {
          ...state,
          phase: 'result',
          outcome: 'found',
          gained,
          score: state.score + gained,
          streak: state.streak + 1,
          found: state.found + 1,
        };
      }
      const timeLeft = state.timeLeft - WRONG_PENALTY;
      return timeLeft <= 0
        ? { ...state, phase: 'result', timeLeft: 0, outcome: 'timeout', streak: 0, wrong: state.wrong + 1 }
        : { ...state, timeLeft, wrong: state.wrong + 1 };
    }
    case 'next':
      return state.round + 1 >= state.order.length
        ? { ...state, phase: 'done' }
        : { ...state, phase: 'playing', round: state.round + 1, timeLeft: ROUND_SECONDS, wrong: 0, gained: 0, outcome: null };
    case 'quit':
      return IDLE;
    default:
      return state;
  }
}

const shuffled = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* ---- Hook ---------------------------------------------------------------- */

export function useDiscovery(gems, globeRef) {
  const [game, dispatch] = useReducer(reducer, IDLE);
  const [visited, setVisited] = useState(() => new Set());
  const [toast, setToast] = useState(null);
  const visitedRef = useRef(visited);
  const toastTimer = useRef(0);

  const byId = useMemo(() => new Map(gems.map((g) => [g.id, g])), [gems]);
  const hubOf = useMemo(() => new Map(gems.map((g) => [g.id, hubIdFor(g)])), [gems]);

  const hubs = useMemo(
    () =>
      HUBS.map((h) => {
        const members = gems.filter((g) => hubOf.get(g.id) === h.id);
        const count = members.filter((g) => visited.has(g.id)).length;
        return { id: h.id, name: h.name, total: members.length, count, unlocked: count > 0 };
      }),
    [gems, hubOf, visited],
  );
  const unlockedCount = hubs.filter((h) => h.unlocked).length;

  const target = game.phase === 'off' ? null : byId.get(game.order[game.round]) ?? null;
  const targetId = target?.id;

  const showToast = useCallback((text) => {
    setToast({ text, key: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const markVisited = useCallback(
    (gem) => {
      if (visitedRef.current.has(gem.id)) return;
      const hubId = hubOf.get(gem.id);
      const hubWasLocked = !gems.some((g) => hubOf.get(g.id) === hubId && visitedRef.current.has(g.id));
      visitedRef.current = new Set(visitedRef.current).add(gem.id);
      setVisited(visitedRef.current);
      if (hubWasLocked) showToast(`Hub unlocked: ${HUBS.find((h) => h.id === hubId).name}`);
    },
    [gems, hubOf, showToast],
  );

  // Round clock.
  useEffect(() => {
    if (game.phase !== 'playing') return undefined;
    const t = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => clearInterval(t);
  }, [game.phase, game.round]);

  // Round over: reveal the answer on the globe.
  useEffect(() => {
    if (game.phase === 'result' && targetId) globeRef.current?.focus(targetId);
  }, [game.phase, targetId, globeRef]);

  const startGame = useCallback(() => {
    if (!gems.length) return;
    globeRef.current?.recenter();
    dispatch({ type: 'start', order: shuffled(gems).slice(0, ROUNDS).map((g) => g.id) });
  }, [gems, globeRef]);

  const quitGame = useCallback(() => {
    dispatch({ type: 'quit' });
    globeRef.current?.recenter();
  }, [globeRef]);

  const nextRound = useCallback(() => dispatch({ type: 'next' }), []);

  // Every globe click lands here: a guess while playing, a passport stamp otherwise.
  const handlePick = useCallback(
    (d) => {
      const gem = byId.get(d.id);
      if (!gem) return;
      if (game.phase === 'playing') {
        const correct = gem.id === targetId;
        dispatch({ type: 'guess', correct });
        if (correct) markVisited(gem);
        return;
      }
      markVisited(gem);
    },
    [byId, game.phase, targetId, markVisited],
  );

  return {
    game,
    target,
    clue: target ? clueFor(target) : '',
    blind: game.phase === 'playing',
    visited,
    visitedCount: visited.size,
    hubs,
    unlockedCount,
    tier: tierFor(unlockedCount, HUBS.length),
    toast,
    startGame,
    quitGame,
    nextRound,
    handlePick,
  };
}