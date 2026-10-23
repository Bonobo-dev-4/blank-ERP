import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  bundleComponentRequest, createProductRequest, createVariantRequest,
  generateVariantMatrixRequest, productListQuery, updateProductRequest,
  updateVariantRequest, upsertExternalMappingRequest, variantListQuery,
  type AuthenticatedUser,
} from '@dnd/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/guards';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod/zod.decorators';
import { ProductsService } from './products.service';

@ApiTags('Product Master')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions('products.read')
  @ApiOperation({ summary: 'List product styles' })
  @ApiZodQuery(productListQuery)
  list(@OrgId() orgId: string, @ZodQuery(productListQuery) query: z.infer<typeof productListQuery>) {
    return this.products.listProducts(orgId, query);
  }

  @Get('variants')
  @RequirePermissions('products.read')
  @ApiOperation({ summary: 'List SKUs, optionally only those unmapped for a provider' })
  @ApiZodQuery(variantListQuery)
  listVariants(@OrgId() orgId: string, @ZodQuery(variantListQuery) query: z.infer<typeof variantListQuery>) {
    return this.products.listVariants(orgId, query);
  }

  @Get('mapping-issues')
  @RequirePermissions('products.read')
  @ApiOperation({ summary: 'SKU mapping gaps that would block an import or a push' })
  mappingIssues(@OrgId() orgId: string) {
    return this.products.mappingIssues(orgId);
  }

  @Get(':id')
  @RequirePermissions('products.read')
  @ApiOperation({ summary: 'One style with its full variant matrix' })
  get(@OrgId() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.products.getProduct(orgId, id);
  }

  @Post()
  @RequirePermissions('products.write')
  @ApiOperation({ summary: 'Create a product style' })
  @ApiZodBody(createProductRequest)
  create(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createProductRequest) body: z.infer<typeof createProductRequest>,
  ) {
    return this.products.createProduct(orgId, user.id, body);
  }

  @Patch(':id')
  @RequirePermissions('products.write')
  @ApiOperation({ summary: 'Update a product style' })
  @ApiZodBody(updateProductRequest)
  update(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateProductRequest) body: z.infer<typeof updateProductRequest>,
  ) {
    return this.products.updateProduct(orgId, user.id, id, body);
  }

  @Post('variants')
  @RequirePermissions('products.write')
  @ApiOperation({ summary: 'Create a single SKU' })
  @ApiZodBody(createVariantRequest)
  createVariant(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createVariantRequest) body: z.infer<typeof createVariantRequest>,
  ) {
    return this.products.createVariant(orgId, user.id, body);
  }

  @Patch('variants/:id')
  @RequirePermissions('products.write')
  @ApiOperation({ summary: 'Update a SKU' })
  @ApiZodBody(updateVariantRequest)
  updateVariant(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateVariantRequest) body: z.infer<typeof updateVariantRequest>,
  ) {
    return this.products.updateVariant(orgId, user.id, id, body);
  }

  @Post('variants/matrix')
  @RequirePermissions('products.write')
  @ApiOperation({ summary: 'Generate the colour x size SKU matrix for a style' })
  @ApiZodBody(generateVariantMatrixRequest)
  generateMatrix(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(generateVariantMatrixRequest) body: z.infer<typeof generateVariantMatrixRequest>,
  ) {
    return this.products.generateMatrix(orgId, user.id, body);
  }

  @Post('mappings')
  @RequirePermissions('products.manage_mappings')
  @ApiOperation({ summary: 'Map a SKU to a Shopify or Unicommerce identifier' })
  @ApiZodBody(upsertExternalMappingRequest)
  upsertMapping(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(upsertExternalMappingRequest) body: z.infer<typeof upsertExternalMappingRequest>,
  ) {
    return this.products.upsertMapping(orgId, user.id, body);
  }

  @Post('bundles')
  @RequirePermissions('products.write')
  @ApiOperation({ summary: 'Define the component SKUs of a bundle' })
  @ApiZodBody(bundleComponentRequest)
  setBundle(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(bundleComponentRequest) body: z.infer<typeof bundleComponentRequest>,
  ) {
    return this.products.setBundleComponents(orgId, user.id, body);
  }
}
