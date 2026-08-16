import { Controller, Get, Module } from '@nestjs/common';
import { RulesModule } from '../../platform/rules/rules.module';
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
}

@Module({
  imports: [RulesModule],
  controllers: [PumpsController],
  providers: [PumpsService],
})
export class PumpsModule {}
