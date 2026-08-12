import { Component, signal } from '@angular/core';
import { MapComponent } from './components/map/map';
import { PointDetailComponent } from './components/point-detail/point-detail';
import { PointListComponent } from './components/point-list/point-list';
import { SearchBarComponent, SearchResult } from './components/search-bar/search-bar';
import { VisibilityLegendComponent } from './components/visibility-legend/visibility-legend';
import { VIEWING_POINTS } from './data/viewing-points';
import { ViewingPoint } from './models/viewing-point.model';

@Component({
  selector: 'app-root',
  imports: [
    MapComponent,
    PointDetailComponent,
    PointListComponent,
    VisibilityLegendComponent,
    SearchBarComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly points = VIEWING_POINTS;
  protected readonly selected = signal<ViewingPoint | null>(null);
  protected readonly panelOpen = signal(false);
  protected readonly showVisibilityLayer = signal(false);
  protected readonly flyToTarget = signal<{ lat: number; lng: number } | null>(null);

  protected onPointSelected(point: ViewingPoint): void {
    this.selected.set(point);
    this.panelOpen.set(true);
  }

  protected closePanel(): void {
    this.panelOpen.set(false);
  }

  protected onLocationSelected(result: SearchResult): void {
    this.flyToTarget.set({ lat: result.lat, lng: result.lng });
  }
}
