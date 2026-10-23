import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createSupplierRequest, paginationQuery, recordStatus, updateSupplierRequest,
  type AuthenticatedUser,
} from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { SuppliersService } from './suppliers.service';

const listQuery = paginationQuery.extend({ status: recordStatus.optional() });

@ApiTags('Suppliers')
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermissions('purchasing.read')
  @ApiOperation({ summary: 'List suppliers' })
  @ApiZodQuery(listQuery)
  list(@OrgId() orgId: string, @ZodQuery(listQuery) query: z.infer<typeof listQuery>) {
    return this.suppliers.list(orgId, query);
  }

  @Get(':id')
  @RequirePermissions('purchasing.read')
  @ApiOperation({ summary: 'One supplier with its materials and recent purchase orders' })
  get(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.get(orgId, id);
  }

  @Post()
  @RequirePermissions('purchasing.manage_suppliers')
  @ApiOperation({ summary: 'Create a supplier' })
  @ApiZodBody(createSupplierRequest)
  create(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createSupplierRequest) body: z.infer<typeof createSupplierRequest>,
  ) {
    return this.suppliers.create(orgId, user.id, body);
  }

  @Patch(':id')
  @RequirePermissions('purchasing.manage_suppliers')
  @ApiOperation({ summary: 'Update a supplier' })
  @ApiZodBody(updateSupplierRequest)
  update(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateSupplierRequest) body: z.infer<typeof updateSupplierRequest>,
  ) {
    return this.suppliers.update(orgId, user.id, id, body);
  }
}
