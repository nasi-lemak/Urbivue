import { Module } from '@nestjs/common';
import { IncidentsController } from './incidents.controller';
import { RulesService } from './rules.service';

@Module({
  controllers: [IncidentsController],
  providers: [RulesService],
  exports: [RulesService],
})
export class RulesModule {}
