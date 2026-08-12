import { Component, output, signal } from '@angular/core';

export interface SearchResult {
  label: string;
  lat: number;
  lng: number;
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

// west,north,east,south — département bounds (see scripts/generate-visibility-heatmap.mjs)
const DEPT_VIEWBOX = '6.6354,44.36105,7.71881,43.48007';
const DEBOUNCE_MS = 400;

@Component({
  selector: 'app-search-bar',
  imports: [],
  templateUrl: './search-bar.html',
  styleUrl: './search-bar.scss',
})
export class SearchBarComponent {
  locationSelected = output<SearchResult>();

  protected readonly query = signal('');
  protected readonly results = signal<SearchResult[]>([]);
  protected readonly loading = signal(false);
  protected readonly open = signal(false);

  private debounceHandle?: ReturnType<typeof setTimeout>;
  private abortController?: AbortController;

  onInput(value: string): void {
    this.query.set(value);
    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
    }
    if (value.trim().length < 2) {
      this.results.set([]);
      this.open.set(false);
      return;
    }
    this.debounceHandle = setTimeout(() => this.search(value.trim()), DEBOUNCE_MS);
  }

  onFocus(): void {
    if (this.results().length > 0) {
      this.open.set(true);
    }
  }

  onBlur(): void {
    // Delay so a click on a result registers before the list closes.
    setTimeout(() => this.open.set(false), 150);
  }

  select(result: SearchResult): void {
    this.locationSelected.emit(result);
    this.query.set(result.label.split(',')[0]);
    this.results.set([]);
    this.open.set(false);
  }

  private async search(q: string): Promise<void> {
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    this.loading.set(true);
    try {
      const url =
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}` +
        `&countrycodes=fr&viewbox=${DEPT_VIEWBOX}&bounded=1&limit=6`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`Nominatim ${res.status}`);
      }
      const data: NominatimResult[] = await res.json();
      this.results.set(
        data.map((d) => ({ label: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) })),
      );
      this.open.set(true);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Recherche de ville impossible', err);
        this.results.set([]);
      }
    } finally {
      this.loading.set(false);
    }
  }
}
