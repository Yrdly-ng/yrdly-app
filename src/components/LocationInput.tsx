
"use client";

import { useEffect, useState, useRef } from 'react';
import { useFormContext, Controller } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { usePlaces } from '@/hooks/use-places-autocomplete';
import { Skeleton } from './ui/skeleton';
// Removed Firebase import - using custom location types

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface LocationValue {
  address: string;
  geopoint?: GeoPoint;
}

interface LocationInputProps {
  name: string;
  control: any;
  defaultValue?: LocationValue;
}

export function LocationInput({ name, control, defaultValue }: LocationInputProps) {
  const { setValue: setFormValue } = useFormContext();
  const {
    ready,
    value,
    placePredictions,
    isPlacePredictionsLoading,
    getPlacePredictions,
    getPlaceDetails,
    clearSuggestions,
  } = usePlaces();
  
  const [showSuggestions, setShowSuggestions] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Set initial value from form default
    if (defaultValue?.address) {
      getPlacePredictions(defaultValue.address);
    }
  }, [defaultValue, getPlacePredictions]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
        clearSuggestions();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [containerRef, clearSuggestions]);

  const handleSelect = async (prediction: { description: string; place_id: string }) => {
    getPlacePredictions(prediction.description);
    setShowSuggestions(false);
    clearSuggestions();

    const details = await getPlaceDetails(prediction.place_id);
    setFormValue(name, details, { shouldValidate: true, shouldDirty: true });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newAddress = e.target.value;
    getPlacePredictions(newAddress);
    setFormValue(name, { address: newAddress }, { shouldValidate: true, shouldDirty: true });
    setShowSuggestions(true);
  };
  
  if (!ready) {
    return <Skeleton className="h-10 w-full" />;
  }

  return (
    <div className="relative" ref={containerRef}>
      <Controller
        name={name}
        control={control}
        defaultValue={defaultValue}
        render={({ field }) => (
          <Input
            {...field}
            placeholder="Enter a location"
            value={value}
            onChange={handleInputChange}
            onFocus={() => setShowSuggestions(placePredictions.length > 0)}
            disabled={!ready}
            autoComplete="off"
          />
        )}
      />
      {showSuggestions && (
        <div className="absolute z-10 w-full mt-1 bg-background border border-border rounded-md shadow-lg">
          {isPlacePredictionsLoading ? (
            <div className="p-2 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <ul className="py-1">
              {placePredictions.map((prediction) => (
                <li
                  key={prediction.place_id}
                  onClick={() => handleSelect(prediction)}
                  className="px-3 py-2 cursor-pointer hover:bg-accent"
                >
                  {prediction.description}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
