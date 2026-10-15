import { Controller, Get, HttpStatus, Param, Query } from '@nestjs/common';
import { AppException } from '../common/errors';
import { HEALTH_TIERS, PLAN_TIERS, type AccountDetail, type AccountHealth } from '../common/types';
import { HealthService, SORT_KEYS, type AccountQuery } from '../health/health.service';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly health: HealthService) {}

  /** GET /api/accounts?tier=&plan=&csm=&q=&sort=&order= */
  @Get()
  list(@Query() raw: Record<string, string | undefined>): AccountHealth[] {
    const query: AccountQuery = {
      tier: oneOf('tier', raw.tier, HEALTH_TIERS),
      plan: oneOf('plan', raw.plan, PLAN_TIERS),
      sort: oneOf('sort', raw.sort, SORT_KEYS),
      order: oneOf('order', raw.order, ['asc', 'desc'] as const),
      csm: raw.csm || undefined,
      q: raw.q || undefined,
    };
    return this.health.list(query);
  }

  @Get(':slug')
  detail(@Param('slug') slug: string): AccountDetail {
    const detail = this.health.detail(slug);
    if (!detail) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'account_not_found',
        `There's no account called "${slug}".`,
        'It may have been renamed or removed from the export. Go back to the account list.',
      );
    }
    return detail;
  }
}

function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (!value) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      'invalid_query',
      `"${value}" isn't a valid ${name}.`,
      `Use one of: ${allowed.join(', ')}.`,
    );
  }
  return value as T;
}
