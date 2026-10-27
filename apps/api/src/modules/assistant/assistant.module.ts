import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantProvider } from './assistant.provider';
import { AssistantService } from './assistant.service';
import { AssistantTools } from './assistant.tools';

@Module({
  controllers: [AssistantController],
  providers: [AssistantService, AssistantProvider, AssistantTools],
  exports: [AssistantService],
})
export class AssistantModule {}
