import { Controller, Get, Module, Post } from '@nestjs/common';
import { RulesModule } from '../../platform/rules/rules.module';
import { ZonesModule } from '../../platform/zones/zones.module';
import { RequirePermission } from '../../platform/auth/decorators';
import { PumpsService } from './pumps.service';

@Controller('pumps')
class PumpsController {
  constructor(private readonly pumps: PumpsService) {}

  @RequirePermission('pumps', 'read')
  @Get('readiness')
  readiness() {
    return this.pumps.readiness();
  }

  /** On-demand run of the hourly run-hours service sweep. */
  @RequirePermission('pumps', 'manage')
  @Post('service-check')
  serviceCheck() {
    return this.pumps.checkServiceDue();
  }
}

@Module({
  imports: [RulesModule, ZonesModule],
  controllers: [PumpsController],
  providers: [PumpsService],
})
export class PumpsModule {}
