import { Controller, Get } from '@nestjs/common';
import { DatasetService } from '../data/dataset.service';
import { HealthService } from '../health/health.service';

@Controller()
export class MetaController {
  constructor(
    private readonly health: HealthService,
    private readonly data: DatasetService,
  ) {}

  /**
   * Liveness + data readiness. Always 200 while the process is up, so the UI can
   * tell "API down" apart from "API up but the export is broken".
   */
  @Get('status')
  status() {
    const data = this.data.status();
    return { status: data.loaded ? 'ok' : 'degraded', data };
  }

  /** Portfolio totals per tier, CSM list, snapshot date. */
  @Get('summary')
  summary() {
    return this.health.summary();
  }

  /** Every data problem found in the export and how it was handled. */
  @Get('data-quality')
  dataQuality() {
    return this.health.dataQuality();
  }

  /** The live scoring config, so the UI's methodology page can't drift from the code. */
  @Get('methodology')
  methodology() {
    return this.health.methodology();
  }
}
