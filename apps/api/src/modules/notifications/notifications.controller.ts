import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@dnd/contracts';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('attention')
  @ApiOperation({
    summary: 'What needs a human right now',
    description:
      'A live reading, not a stored stream — derived on request and gated per item on the caller\'s own permissions, so the bell only shows problems this person can go and fix.',
  })
  attention(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.attention(user);
  }
}
