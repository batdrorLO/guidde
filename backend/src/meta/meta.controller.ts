import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../auth/auth.guard';
import { DatasetService } from '../data/dataset.service';
import { HealthService } from '../health/health.service';
import { settingsFromQuery } from '../health/settings.query';

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

  /** Portfolio totals per status, CSM list, reference date and analysis window. Takes ?days=&minTenure=. */
  @Get('summary')
  summary(@Query() raw: Record<string, string | undefined>) {
    return this.health.summary(settingsFromQuery(raw));
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
