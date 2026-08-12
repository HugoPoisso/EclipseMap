import { Component, input, output } from '@angular/core';
import { ViewingPoint } from '../../models/viewing-point.model';

@Component({
  selector: 'app-point-list',
  imports: [],
  templateUrl: './point-list.html',
  styleUrl: './point-list.scss',
})
export class PointListComponent {
  points = input.required<ViewingPoint[]>();
  selectedId = input<string | null>(null);
  pointSelected = output<ViewingPoint>();
}
