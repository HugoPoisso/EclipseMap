export type ViewpointTag =
  | 'vue-mer'
  | 'altitude'
  | 'crete'
  | 'evenement-officiel'
  | 'facile-acces'
  | 'urbain';

export const TAG_LABELS: Record<ViewpointTag, string> = {
  'vue-mer': 'Vue mer',
  altitude: 'Point haut',
  crete: 'Horizon dégagé',
  'evenement-officiel': 'Événement organisé',
  'facile-acces': 'Accès facile',
  urbain: 'En ville',
};

export interface EclipseCircumstances {
  /** Heure de début (premier contact), ex. "19h31" */
  heureDebut: string;
  /** Heure du maximum, ex. "20h24" */
  heureMaximum: string;
  /** Heure de fin (coucher de soleil avant la fin réelle de l'éclipse) */
  heureFin: string;
  /** Pourcentage du disque solaire masqué au maximum */
  obscurationPct: number;
  /** Hauteur du soleil au-dessus de l'horizon au maximum, en degrés */
  altitudeSoleilDeg: number;
  /** Azimut du soleil au maximum, en degrés (0=N, 90=E, 180=S, 270=O) */
  azimutSoleilDeg: number;
  /** true si les valeurs sont extrapolées depuis Nice plutôt que calculées pour ce point précis */
  approximatif: boolean;
}

export interface ViewingPoint {
  id: string;
  nom: string;
  commune: string;
  lat: number;
  lng: number;
  altitudeM?: number;
  description: string;
  tags: ViewpointTag[];
  accessibilite?: string;
  eclipse: EclipseCircumstances;
}
