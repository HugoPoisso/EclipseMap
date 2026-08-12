import {
  AfterViewInit,
  Component,
  ElementRef,
  input,
  OnChanges,
  OnDestroy,
  output,
  SimpleChanges,
  viewChild,
} from '@angular/core';
import * as L from 'leaflet';
import { ECLIPSE_REFERENCE } from '../../data/eclipse-reference';
import { ViewingPoint } from '../../models/viewing-point.model';
import { VisibilityPoint } from '../../models/visibility-point.model';

// Département bounding box the visibility-heatmap.png raster covers
// (printed by scripts/generate-visibility-heatmap.mjs when it's regenerated).
const VISIBILITY_BOUNDS: L.LatLngBoundsLiteral = [
  [43.48007, 6.6354],
  [44.36105, 7.71881],
];
const VISIBILITY_IMAGE_URL = 'data/visibility-heatmap.png';
const VISIBILITY_LOOKUP_URL = 'data/visibility-lookup.json';
const LOOKUP_MAX_DISTANCE_KM = 3; // beyond this, treat a click as outside the covered area

const SCORE_COLOR_STOPS: Array<{ t: number; rgb: [number, number, number] }> = [
  { t: 0, rgb: [214, 69, 69] },
  { t: 0.5, rgb: [232, 197, 71] },
  { t: 1, rgb: [63, 145, 66] },
];

function scoreToColor(score: number): string {
  const t = Math.max(0, Math.min(1, score / 100));
  for (let i = 0; i < SCORE_COLOR_STOPS.length - 1; i++) {
    const a = SCORE_COLOR_STOPS[i];
    const b = SCORE_COLOR_STOPS[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t);
      const rgb = a.rgb.map((c, idx) => Math.round(c + (b.rgb[idx] - c) * f));
      return `rgb(${rgb.join(',')})`;
    }
  }
  const last = SCORE_COLOR_STOPS[SCORE_COLOR_STOPS.length - 1].rgb;
  return `rgb(${last.join(',')})`;
}

function scoreLabel(score: number): string {
  if (score >= 66) return 'Horizon dégagé';
  if (score >= 33) return 'Partiellement obstrué';
  return 'Vue bloquée';
}

function distanceKm(a: L.LatLng, b: VisibilityPoint): number {
  const dLat = a.lat - b.lat;
  const dLng = (a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng) * 111;
}

// Deliberately L.icon(...), not L.Icon.Default: IconDefault._getIconUrl()
// always prepends an auto-detected `imagePath` folder guess on top of
// iconUrl/shadowUrl (even when they're set explicitly via mergeOptions),
// and that auto-detection breaks under Angular's content-hashed CSS assets
// — producing a garbled, 404ing URL. Plain L.icon() has no such prepending.
const DEFAULT_ICON = L.icon({
  iconUrl: 'leaflet/marker-icon.png',
  iconRetinaUrl: 'leaflet/marker-icon-2x.png',
  shadowUrl: 'leaflet/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const SELECTED_ICON = L.icon({
  iconUrl: 'leaflet/marker-icon-2x.png',
  shadowUrl: 'leaflet/marker-shadow.png',
  iconSize: [30, 49],
  iconAnchor: [15, 49],
  popupAnchor: [1, -40],
  shadowSize: [41, 41],
  className: 'marker-selected',
});

@Component({
  selector: 'app-map',
  imports: [],
  templateUrl: './map.html',
  styleUrl: './map.scss',
})
export class MapComponent implements AfterViewInit, OnChanges, OnDestroy {
  points = input.required<ViewingPoint[]>();
  selectedId = input<string | null>(null);
  showVisibilityLayer = input(false);
  flyTo = input<{ lat: number; lng: number } | null>(null);
  pointSelected = output<ViewingPoint>();

  private mapContainer = viewChild.required<ElementRef<HTMLDivElement>>('mapContainer');

  private map?: L.Map;
  private markers = new Map<string, L.Marker>();
  private visibilityLayer?: L.ImageOverlay;
  private lookupPromise?: Promise<VisibilityPoint[]>;

  ngAfterViewInit(): void {
    this.map = L.map(this.mapContainer().nativeElement, {
      zoomControl: false,
    });
    // Default top-left position clashes with the search bar overlay.
    L.control.zoom({ position: 'topright' }).addTo(this.map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(this.map);

    this.map.on('click', (e: L.LeafletMouseEvent) => this.onMapClick(e.latlng));

    this.renderMarkers();
    this.fitToPoints();
    this.applySelection();
    this.applyVisibilityLayer();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.map) {
      return;
    }
    if (changes['points']) {
      this.renderMarkers();
      this.fitToPoints();
    }
    if (changes['selectedId']) {
      this.applySelection();
    }
    if (changes['showVisibilityLayer']) {
      this.applyVisibilityLayer();
    }
    if (changes['flyTo'] && this.flyTo()) {
      const target = this.flyTo()!;
      this.map.flyTo([target.lat, target.lng], 13);
    }
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  private renderMarkers(): void {
    if (!this.map) {
      return;
    }
    this.markers.forEach((marker) => marker.remove());
    this.markers.clear();

    for (const point of this.points()) {
      const marker = L.marker([point.lat, point.lng], { icon: DEFAULT_ICON }).addTo(this.map);
      marker.bindPopup(
        `<strong>${point.nom}</strong><br>${point.commune}<br>Max. ${point.eclipse.obscurationPct.toFixed(1)} % à ${point.eclipse.heureMaximum}`,
      );
      marker.on('click', () => this.pointSelected.emit(point));
      this.markers.set(point.id, marker);
    }
  }

  private fitToPoints(): void {
    const pts = this.points();
    if (!this.map || pts.length === 0) {
      return;
    }
    const bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number]));
    this.map.fitBounds(bounds, { padding: [32, 32] });
  }

  private applyVisibilityLayer(): void {
    if (!this.map) {
      return;
    }
    if (!this.showVisibilityLayer()) {
      if (this.visibilityLayer) {
        this.map.removeLayer(this.visibilityLayer);
      }
      return;
    }
    if (!this.visibilityLayer) {
      // Renders in Leaflet's overlayPane (z-index 400), below markerPane
      // (600), so markers stay on top without any extra z-index handling.
      this.visibilityLayer = L.imageOverlay(VISIBILITY_IMAGE_URL, VISIBILITY_BOUNDS, {
        opacity: 0.75,
        interactive: false,
      });
    }
    this.visibilityLayer.addTo(this.map);
  }

  private async onMapClick(latlng: L.LatLng): Promise<void> {
    if (!this.map) {
      return;
    }
    const popup = L.popup({ className: 'visibility-popup' })
      .setLatLng(latlng)
      .setContent('<p class="popup-loading">Chargement…</p>')
      .openOn(this.map);

    try {
      const lookup = await this.loadLookupData();
      let nearest: VisibilityPoint | null = null;
      let nearestDist = Infinity;
      for (const p of lookup) {
        const d = distanceKm(latlng, p);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = p;
        }
      }

      if (!nearest || nearestDist > LOOKUP_MAX_DISTANCE_KM) {
        popup.setContent(
          '<p class="popup-note">Hors zone d\'estimation (en dehors des Alpes-Maritimes).</p>',
        );
        return;
      }

      const color = scoreToColor(nearest.score);
      const label = scoreLabel(nearest.score);
      popup.setContent(`
        <div class="score-row">
          <span class="dot" style="background:${color}"></span>
          <strong>${label}</strong> — ${nearest.score}/100
        </div>
        <dl class="popup-eclipse">
          <dt>Maximum</dt><dd>${ECLIPSE_REFERENCE.heureMaximum} — ${ECLIPSE_REFERENCE.obscurationPct}&nbsp;% masqué</dd>
          <dt>Début → Fin</dt><dd>${ECLIPSE_REFERENCE.heureDebut} → ${ECLIPSE_REFERENCE.heureFin}</dd>
        </dl>
        <p class="popup-note">Estimation de dégagement de l'horizon vers l'ouest-nord-ouest
          (résolution ~200&nbsp;m, azimut unique) — à confirmer sur place.</p>
      `);
    } catch (err) {
      console.error('Impossible de charger la carte de visibilité', err);
      popup.setContent('<p class="popup-note">Estimation indisponible pour le moment.</p>');
    }
  }

  private loadLookupData(): Promise<VisibilityPoint[]> {
    if (!this.lookupPromise) {
      this.lookupPromise = fetch(VISIBILITY_LOOKUP_URL).then((res) => {
        if (!res.ok) {
          throw new Error(`Lookup fetch failed: ${res.status}`);
        }
        return res.json() as Promise<VisibilityPoint[]>;
      });
    }
    return this.lookupPromise;
  }

  private applySelection(): void {
    const id = this.selectedId();
    for (const [pointId, marker] of this.markers) {
      marker.setIcon(pointId === id ? SELECTED_ICON : DEFAULT_ICON);
      if (pointId === id) {
        marker.openPopup();
        this.map?.panTo(marker.getLatLng());
      }
    }
  }
}
