import { Controller, Get, Header, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { paginationQuery, type AuthenticatedUser } from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { BarcodesService } from './barcodes.service';

const BARCODE_KINDS = ['MATERIAL_LOT', 'FABRIC_ROLL', 'PRODUCTION_BATCH', 'PRODUCTION_UNIT', 'GOODS_RECEIPT', 'FG_CARTON'] as const;

const listQuery = paginationQuery.extend({ kind: z.enum(BARCODE_KINDS).optional() });
const resolveQuery = z.object({ code: z.string().trim().min(3).max(120) });
const printBody = z.object({
  codes: z.array(z.string().trim().min(3).max(120)).min(1).max(200),
  symbology: z.enum(['code128', 'qrcode']).default('code128'),
  copies: z.coerce.number().int().min(1).max(20).default(1),
});
const reissueBody = z.object({
  code: z.string().trim().min(3).max(120),
  reason: z.string().trim().min(3).max(300),
});

@ApiTags('Barcodes')
@Controller('barcodes')
export class BarcodesController {
  constructor(private readonly barcodes: BarcodesService) {}

  @Get()
  @RequirePermissions('production.print_labels')
  @ApiOperation({ summary: 'List issued barcodes' })
  @ApiZodQuery(listQuery)
  list(@OrgId() orgId: string, @ZodQuery(listQuery) query: z.infer<typeof listQuery>) {
    return this.barcodes.list(orgId, query);
  }

  @Get('resolve')
  @RequirePermissions('production.scan')
  @ApiOperation({
    summary: 'Resolve a scanned barcode',
    description: 'All context comes from the database; the symbol itself carries only an identifier.',
  })
  @ApiZodQuery(resolveQuery)
  resolve(@OrgId() orgId: string, @ZodQuery(resolveQuery) query: z.infer<typeof resolveQuery>) {
    return this.barcodes.resolve(orgId, query.code);
  }

  @Get('image')
  @RequirePermissions('production.print_labels')
  @ApiOperation({ summary: 'Render one barcode as a PNG' })
  @ApiProduces('image/png')
  @ApiQuery({ name: 'code', required: true })
  @ApiQuery({ name: 'symbology', required: false, enum: ['code128', 'qrcode'] })
  async image(
    @OrgId() orgId: string,
    @Query('code') code: string,
    @Res() res: Response,
    @Query('symbology') symbology?: 'code128' | 'qrcode',
  ): Promise<void> {
    const png = await this.barcodes.renderImage(orgId, code, { symbology: symbology ?? 'code128' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(png);
  }

  @Post('labels')
  @RequirePermissions('production.print_labels')
  @ApiOperation({ summary: 'Print a sheet of labels as a PDF (70 x 37 mm, three across)' })
  @ApiProduces('application/pdf')
  @ApiZodBody(printBody)
  async labels(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(printBody) body: z.infer<typeof printBody>,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.barcodes.renderLabelSheet(orgId, user.id, body.codes, {
      symbology: body.symbology,
      copies: body.copies,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="dnd-labels.pdf"');
    res.send(pdf);
  }

  @Post('reissue')
  @RequirePermissions('production.print_labels')
  @ApiOperation({ summary: 'Revoke a damaged barcode and issue a replacement' })
  @ApiZodBody(reissueBody)
  reissue(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(reissueBody) body: z.infer<typeof reissueBody>,
  ) {
    return this.barcodes.reissue(orgId, user.id, body.code, body.reason);
  }
}
