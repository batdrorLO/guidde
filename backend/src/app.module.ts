import { Module } from '@nestjs/common';
import { AccountsController } from './accounts/accounts.controller';
import { HealthModule } from './health/health.module';
import { MetaController } from './meta/meta.controller';

@Module({
  imports: [HealthModule],
  controllers: [AccountsController, MetaController],
})
export class AppModule {}
