import { Controller, ForbiddenException, Get, Param, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  IMPORT_SPECS, IMPORT_TYPES, importCommitRequest, importRowsRequest, importType,
  type AuthenticatedUser, type ImportType,
} from '@dnd/contracts';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ZodBody } from '../../common/zod/zod.decorators';
import { ImportsService } from './imports.service';

/** CSV text from rows; cells that could be read as formulas are neutralised. */
function toCsv(headers: string[], rows: Record<string, string>[]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return '﻿' + [headers.join(','), ...rows.map((r) => headers.map((h) => cell(r[h] ?? '')).join(','))].join('\r\n');
}

@ApiTags('Imports')
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /**
   * Each import type needs the permission its own screen needs to create or
   * edit, so an import can never do more than the person could by hand.
   */
  private allow(user: AuthenticatedUser, typeRaw: string): ImportType {
    const parsed = importType.safeParse(typeRaw);
    if (!parsed.success) throw new ForbiddenException({ code: 'UNKNOWN_IMPORT', message: `No import called ${typeRaw}` });
    const spec = IMPORT_SPECS[parsed.data];
    if (!user.permissions.includes(spec.permission)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_PERMISSIONS',
        message: `This import requires: ${spec.permission}`,
        details: { required: [spec.permission], missing: [spec.permission] },
      });
    }
    return parsed.data;
  }

  @Get('specs')
  @ApiOperation({ summary: 'The import types this person may use, with their columns' })
  specs(@CurrentUser() user: AuthenticatedUser) {
    return IMPORT_TYPES.map((t) => IMPORT_SPECS[t]).filter((s) => user.permissions.includes(s.permission));
  }

  @Get(':type/template')
  @ApiOperation({ summary: 'A blank CSV template: the column headers only' })
  template(@CurrentUser() user: AuthenticatedUser, @Param('type') type: string, @Res() res: Response) {
    const t = this.allow(user, type);
    const headers = IMPORT_SPECS[t].columns.map((c) => c.key);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${t}-template.csv"`);
    res.send(toCsv(headers, []));
  }

  @Get(':type/export')
  @ApiOperation({ summary: 'Current records in import columns, to edit and re-import' })
  async export(@OrgId() orgId: string, @CurrentUser() user: AuthenticatedUser, @Param('type') type: string, @Res() res: Response) {
    const t = this.allow(user, type);
    const rows = await this.imports.exportRows(orgId, t);
    const headers = IMPORT_SPECS[t].columns.map((c) => c.key);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${t}-${stamp}.csv"`);
    res.send(toCsv(headers, rows));
  }

  @Post(':type/preview')
  @ApiZodBody(importRowsRequest)
  @ApiOperation({ summary: 'Validate rows and say what each would do. Writes nothing.' })
  async preview(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('type') type: string,
    @ZodBody(importRowsRequest) body: z.infer<typeof importRowsRequest>,
  ) {
    const t = this.allow(user, type);
    const { prepared: _p, ...result } = await this.imports.preview(orgId, t, body.rows);
    return result;
  }

  @Post(':type/commit')
  @ApiZodBody(importCommitRequest)
  @ApiOperation({
    summary: 'Re-validate and apply. Nothing is written if any row has an error.',
    description: 'Each row goes through the same service as the screen. Audited as one import run.',
  })
  commit(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('type') type: string,
    @ZodBody(importCommitRequest) body: z.infer<typeof importCommitRequest>,
  ) {
    const t = this.allow(user, type);
    return this.imports.commit(orgId, user.id, t, body.rows, body.idempotencyKey);
  }
}
