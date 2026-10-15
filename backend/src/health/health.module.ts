import { Module } from '@nestjs/common';
import { DataModule } from '../data/data.module';
import { HealthService } from './health.service';

@Module({
  imports: [DataModule],
  providers: [HealthService],
  exports: [HealthService, DataModule],
})
export class HealthModule {}
