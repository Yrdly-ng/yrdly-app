import { useState, useEffect } from 'react';

interface LocationData {
  states: string[];
  lgas: Record<string, string[]>;
  wards: Array<{ State: string; LGA: string; Ward: string }>;
}

interface UseLocationDataReturn {
  states: string[];
  lgas: string[];
  wards: string[];
  isLoading: boolean;
  error: string | null;
  loadLgas: (state: string) => void;
  loadWards: (state: string, lga: string) => void;
}

export function useLocationData(): UseLocationDataReturn {
  const [data, setData] = useState<LocationData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedState, setSelectedState] = useState<string>('');
  const [selectedLga, setSelectedLga] = useState<string>('');

  // Load initial data (states)
  useEffect(() => {
    const loadStates = async () => {
      if (data?.states) return; // Already loaded
      
      setIsLoading(true);
      setError(null);
      
      try {
        const statesModule = await import('@/data/states.json');
        const lgasModule = await import('@/data/lgas.json');
        const wardsModule = await import('@/data/wards.json');
        
        setData({
          states: statesModule.default,
          lgas: lgasModule.default,
          wards: wardsModule.default
        });
      } catch (err) {
        console.error('Error loading location data:', err);
        setError('Failed to load location data');
      } finally {
        setIsLoading(false);
      }
    };

    loadStates();
  }, [data?.states]);

  const loadLgas = (state: string) => {
    setSelectedState(state);
    setSelectedLga(''); // Reset LGA when state changes
  };

  const loadWards = (state: string, lga: string) => {
    setSelectedLga(lga);
  };

  const lgas = selectedState && data?.lgas ? data.lgas[selectedState] || [] : [];
  const wards = selectedState && selectedLga && data?.wards 
    ? data.wards
        .filter(ward => ward.State === selectedState && ward.LGA === selectedLga)
        .map(ward => ward.Ward)
    : [];

  return {
    states: data?.states || [],
    lgas,
    wards,
    isLoading,
    error,
    loadLgas,
    loadWards
  };
}
