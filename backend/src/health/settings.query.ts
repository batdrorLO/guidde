import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors';
import { SCORING, parseScoringSettings, type ScoringSettings } from './scoring.config';

/** Read `?days=&minTenure=` from a request; 400 with a readable message if invalid. */
export function settingsFromQuery(raw: Record<string, string | undefined>): ScoringSettings {
  const result = parseScoringSettings({ days: raw.days, minTenure: raw.minTenure });
  if (!result.ok) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      'invalid_setting',
      result.message,
      result.field === 'days'
        ? `Pick one of ${SCORING.lookback.presets.join(', ')} days, or a custom whole number in that range.`
        : 'Use a whole number of days, e.g. 30.',
    );
  }
  return result.settings;
}
