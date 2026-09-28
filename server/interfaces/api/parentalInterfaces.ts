export interface ParentalProfileResponse {
  id: number;
  name: string;
  maxAge: number;
  allowUnrated: boolean;
}

export interface ParentalSettingsResponse {
  countries: string[];
  supportedCountries: string[];
}
