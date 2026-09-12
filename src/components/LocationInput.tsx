
"use client";

import { useEffect, useState, useRef } from 'react';
import { useFormContext, Controller } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { usePlaces } from '@/hooks/use-places-autocomplete';
import { Skeleton } from './ui/skeleton';
// Removed Firebase import - using custom location types

import { reverseGeocode } from '@/lib/geocoding-service';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface LocationValue {
  address: string;
  geopoint?: GeoPoint;
  state?: string;
  lga?: string;
  ward?: string;
}

export interface StructuredLocation {
  address: string;
  lat?: number;
  lng?: number;
  ward?: string;
  lga?: string;
  state?: string;
}

interface LocationInputProps {
  name?: string;
  control?: any;
  defaultValue?: LocationValue;
  value?: string;
  onChange?: (value: string) => void;
  onLocationSelect?: (location: StructuredLocation) => void;
  placeholder?: string;
}

export function LocationInput({
  name = "location",
  control,
  defaultValue,
  value: externalValue,
  onChange: externalOnChange,
  onLocationSelect,
  placeholder = "Enter a location",
}: LocationInputProps) {
  const formContext = useFormContext();
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
    
    // Resolve lat/lng to canonical Nigerian State/LGA/Ward if available
    let resolvedState = details.state;
    let resolvedLga = details.lga;
    let resolvedWard = details.ward;

    if (details.geopoint?.latitude && details.geopoint?.longitude) {
      try {
        const matched = await reverseGeocode(details.geopoint.latitude, details.geopoint.longitude);
        if (matched && !('status' in matched)) {
          resolvedState = matched.state || resolvedState;
          resolvedLga = matched.lga || resolvedLga;
          resolvedWard = matched.ward || resolvedWard;
        }
      } catch {
        // Fallback to Google details if geocoding fails
      }
    }

    const fullDetails = {
      ...details,
      state: resolvedState,
      lga: resolvedLga,
      ward: resolvedWard,
    };

    if (externalOnChange) {
      externalOnChange(details.address);
    }

    if (formContext?.setValue && name) {
      formContext.setValue(name, fullDetails, { shouldValidate: true, shouldDirty: true });
    }

    if (onLocationSelect) {
      onLocationSelect({
        address: details.address,
        lat: details.geopoint?.latitude,
        lng: details.geopoint?.longitude,
        state: resolvedState,
        lga: resolvedLga,
        ward: resolvedWard,
      });
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newAddress = e.target.value;
    getPlacePredictions(newAddress);
    if (externalOnChange) {
      externalOnChange(newAddress);
    }
    if (formContext?.setValue && name) {
      formContext.setValue(name, { address: newAddress }, { shouldValidate: true, shouldDirty: true });
    }
    setShowSuggestions(true);
  };
  
  if (!ready) {
    return <Skeleton className="h-10 w-full" />;
  }

  const displayValue = externalValue !== undefined ? externalValue : value;

  return (
    <div className="relative" ref={containerRef}>
      {control ? (
        <Controller
          name={name}
          control={control}
          defaultValue={defaultValue}
          render={({ field }) => (
            <Input
              {...field}
              placeholder={placeholder}
              value={displayValue}
              onChange={handleInputChange}
              onFocus={() => setShowSuggestions(placePredictions.length > 0)}
              disabled={!ready}
              autoComplete="off"
            />
          )}
        />
      ) : (
        <Input
          placeholder={placeholder}
          value={displayValue}
          onChange={handleInputChange}
          onFocus={() => setShowSuggestions(placePredictions.length > 0)}
          disabled={!ready}
          autoComplete="off"
        />
      )}
      {showSuggestions && (
        <div className="absolute z-50 w-full mt-1 bg-background border border-border rounded-md shadow-lg">
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
