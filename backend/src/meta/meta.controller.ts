import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/auth.guard';
import { DatasetService } from '../data/dataset.service';
import { HealthService } from '../health/health.service';

@Controller()
export class MetaController {
  constructor(
    private readonly health: HealthService,
    private readonly data: DatasetService,
  ) {}

  /**
   * Liveness + data readiness, for uptime checks. Public, so it says only whether
   * data is loaded; the reason (file paths etc.) goes to signed-in users and the logs.
   */
  @Public()
  @Get('status')
  status() {
    const { loaded } = this.data.status();
    return { status: loaded ? 'ok' : 'degraded', data: { loaded } };
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
