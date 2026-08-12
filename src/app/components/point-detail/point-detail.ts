import { Component, input } from '@angular/core';
import { TAG_LABELS, ViewingPoint } from '../../models/viewing-point.model';

@Component({
  selector: 'app-point-detail',
  imports: [],
  templateUrl: './point-detail.html',
  styleUrl: './point-detail.scss',
})
export class PointDetailComponent {
  point = input.required<ViewingPoint>();

  protected readonly tagLabels = TAG_LABELS;
}
