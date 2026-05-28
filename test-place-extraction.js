const mockResult = {
  address_components: [
    { long_name: "Lekki", types: ["locality", "political"] },
    { long_name: "Eti-Osa Local Government Area", types: ["administrative_area_level_2", "political"] },
    { long_name: "Lagos State", types: ["administrative_area_level_1", "political"] },
    { long_name: "Nigeria", types: ["country", "political"] }
  ]
};

let state = "";
let lga = "";
let ward = "";

if (mockResult.address_components) {
  mockResult.address_components.forEach((component) => {
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

console.log({ state, lga, ward });
