import { Global, Module } from '@nestjs/common';
import { PlatformEventsService } from './events.service';

@Global()
@Module({
  providers: [PlatformEventsService],
  exports: [PlatformEventsService],
})
export class EventsModule {}
