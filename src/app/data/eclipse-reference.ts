import { EclipseCircumstances } from '../models/viewing-point.model';

/**
 * Circonstances de référence pour Nice (source : timeanddate.com, RCF Nice, Nice Premium).
 * Elles varient très peu à l'échelle des Alpes-Maritimes (quelques minutes, 95-97 %) ;
 * réutilisées comme valeur par défaut pour tout point du département (dataset curé
 * comme clic libre sur la carte).
 */
export const ECLIPSE_REFERENCE: Omit<EclipseCircumstances, 'approximatif'> = {
  heureDebut: '19h31',
  heureMaximum: '20h24',
  heureFin: '21h14',
  obscurationPct: 95.1,
  altitudeSoleilDeg: 6,
  azimutSoleilDeg: 292,
};
