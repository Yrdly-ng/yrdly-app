"use client";

import usePlacesAutocomplete, {
  getGeocode,
  getLatLng,
} from "use-places-autocomplete";

export interface Suggestion {
  description: string;
  place_id: string;
}

export const usePlaces = () => {
  const {
    ready,
    value,
    suggestions: { loading, status, data },
    setValue,
    clearSuggestions,
  } = usePlacesAutocomplete({
    requestOptions: {
      componentRestrictions: { country: "ng" },
    },
    debounce: 300,
  });

  const getPlacePredictions = (val: string) => {
    setValue(val, true);
  };

  const getPlaceDetails = async (placeId: string) => {
    try {
      const results = await getGeocode({ placeId });
      if (!results || results.length === 0) {
        return { address: "", geopoint: undefined, state: "", lga: "", ward: "" };
      }
      const { lat, lng } = await getLatLng(results[0]);

      let state = "";
      let lga = "";
      let ward = "";

      if (results[0].address_components) {
        results[0].address_components.forEach((component: any) => {
          if (component.types.includes("administrative_area_level_1")) {
            state = component.long_name.replace(" State", "");
          }
          if (component.types.includes("administrative_area_level_2")) {
            lga = component.long_name.replace(" Local Government Area", "").replace(" LGA", "");
          } else if (!lga && component.types.includes("locality")) {
            lga = component.long_name;
          }
          if (component.types.includes("sublocality") || component.types.includes("neighborhood")) {
            ward = component.long_name;
          }
        });
      }

      return {
        address: results[0].formatted_address,
        geopoint: { latitude: lat, longitude: lng },
        state,
        lga,
        ward,
      };
    } catch {
      return { address: "", geopoint: undefined, state: "", lga: "", ward: "" };
    }
  };

  return {
    ready,
    value,
    placePredictions: data || [],
    isPlacePredictionsLoading: loading,
    status,
    getPlacePredictions,
    getPlaceDetails,
    clearSuggestions,
  };
};