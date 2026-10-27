import { Controller, Delete, Get, Put, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedUser } from '@dnd/contracts';
import { Public, RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ZodBody } from '../../common/zod/zod.decorators';
import { BrandingService, MAX_LOGO_BYTES } from './branding.service';

/** A base64 data URL; the character cap is the byte cap plus base64's overhead. */
const logoBody = z.object({
  dataUrl: z.string().min(32).max(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 64),
});

@ApiTags('Branding')
@Controller('branding')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get()
  @Public()
  @ApiQuery({ name: 'org', required: false, description: 'Organisation code; optional on a single-organisation install' })
  @ApiOperation({ summary: 'Whether a logo is set, and when it last changed', description: 'Public: the sign-in screen needs it before there is a session.' })
  info(@Query('org') org?: string) {
    return this.branding.info(org || undefined);
  }

  @Get('logo')
  @Public()
  @ApiQuery({ name: 'org', required: false })
  @ApiOperation({ summary: 'The logo image', description: 'Public. 404 when none is set. Raster only, served with nosniff.' })
  async logo(@Query('org') org: string | undefined, @Res() res: Response) {
    // Written directly rather than returned: the global serializer would
    // treat a file object as JSON.
    const logo = await this.branding.logo(org || undefined);
    if (!logo) {
      res.status(404).json({ code: 'NO_LOGO', message: 'No logo has been uploaded' });
      return;
    }
    res.setHeader('Content-Type', logo.mime);
    res.setHeader('Content-Length', String(logo.data.length));
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Last-Modified', logo.updatedAt.toUTCString());
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.end(logo.data);
  }

  @Put('logo')
  @RequirePermissions('admin.manage_settings')
  @ApiZodBody(logoBody)
  @ApiOperation({ summary: 'Upload or replace the logo', description: 'PNG, JPEG or WebP as a data URL, at most 64 KB. Audited.' })
  setLogo(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(logoBody) body: z.infer<typeof logoBody>,
  ) {
    return this.branding.setLogo(orgId, user.id, body.dataUrl);
  }

  @Delete('logo')
  @RequirePermissions('admin.manage_settings')
  @ApiOperation({ summary: 'Remove the logo and return to the D·D monogram' })
  clearLogo(@OrgId() orgId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.branding.clearLogo(orgId, user.id);
  }
}
