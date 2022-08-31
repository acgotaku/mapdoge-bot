interface Location {
  lat: number;
  lng: number;
}

export interface PlusCode {
  plus_code: {
    global_code: string;
    geometry: {
      bounds: {
        northeast: Location;
        southwest: Location;
      };
      location: Location;
    };
    local_code: string;
    locality: {
      local_address: string;
    };
  };
  status: string;
}

export interface MapCodeResponse {
  success: boolean;
  mapcode: string;
}
