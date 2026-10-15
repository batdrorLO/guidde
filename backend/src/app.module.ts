import { Module } from '@nestjs/common';
import { AccountsController } from './accounts/accounts.controller';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { MetaController } from './meta/meta.controller';

@Module({
  imports: [AuthModule, HealthModule],
  controllers: [AccountsController, MetaController],
})
export class AppModule {}
