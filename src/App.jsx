import { useEffect, useRef, useState } from 'react';
import DiscoveryOverlay from './components/DiscoveryOverlay';
import IntroView from './components/IntroView';
import MumbaiGlobe from './components/MumbaiGlobe';
import gemsData, { MUMBAI_GEMS } from './data/gemsData';
import { useDiscovery } from './hooks/useDiscovery';
import neighborhoods from "./data/neighborhoods";

export default function App() {
  const globeRef = useRef(null);
  const [phase, setPhase] = useState('intro'); // intro -> leaving -> map
  const discovery = useDiscovery(gemsData, globeRef);

  useEffect(() => {
    if (phase !== 'leaving') return undefined;
    const t = setTimeout(() => setPhase('map'), 850);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#e8f4f8]">
      {/* Mounted from the start so the map is ready when the intro fades. */}
      <MumbaiGlobe
        ref={globeRef}
        landmarks={MUMBAI_GEMS}
        active={phase !== 'intro'}
        blind={discovery.blind}
        visitedIds={discovery.visited}
        onLandmarkClick={discovery.handlePick}
      />
      {phase === 'map' && (
        <DiscoveryOverlay
          discovery={discovery}
          landmarks={MUMBAI_GEMS}
          visitedIds={discovery.visited}
        />
      )}
      {phase !== 'map' && <IntroView leaving={phase === 'leaving'} onEnter={() => setPhase('leaving')} />}
    </div>
  );
}