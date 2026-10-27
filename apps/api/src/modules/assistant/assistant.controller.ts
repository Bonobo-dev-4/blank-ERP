import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@dnd/contracts';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AssistantService } from './assistant.service';

@ApiTags('Assistant')
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Whether an AI provider is configured',
    description: 'Reports the provider and model. Never returns the key.',
  })
  status() {
    return this.assistant.status();
  }

  @Post('ask')
  @ApiOperation({
    summary: 'Ask a question about this ERP',
    description:
      'Read-only, and scoped to the asker: the model is only offered tools the caller has permission for, and each tool re-checks that permission when it runs. Nothing is persisted.',
  })
  ask(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { question: string; history?: { role: 'user' | 'assistant'; content: string }[] },
  ) {
    return this.assistant.ask(user, body);
  }
}
