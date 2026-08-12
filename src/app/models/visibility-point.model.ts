export interface VisibilityPoint {
  lat: number;
  lng: number;
  /** 0-100 clearance score toward the sun's azimuth at eclipse maximum (higher = clearer horizon). */
  score: number;
}
