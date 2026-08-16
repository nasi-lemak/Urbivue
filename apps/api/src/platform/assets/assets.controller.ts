import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';
import { geoJsonFeatureCollectionSchema, updateAssetSchema } from '@urbivue/shared';
import { AssetsService } from './assets.service';
import { RequirePermission } from '../auth/decorators';
import { zodParse } from '../zod';

function parseBbox(bbox?: string): [number, number, number, number] | undefined {
  if (!bbox) return undefined;
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) {
    throw new BadRequestException('bbox must be "minLon,minLat,maxLon,maxLat"');
  }
  return parts as [number, number, number, number];
}

@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @RequirePermission('platform', 'read')
  @Get()
  list(
    @Query('type') typeId?: string,
    @Query('status') status?: string,
    @Query('bbox') bbox?: string,
    @Query('includeDecommissioned') includeDecommissioned?: string,
  ) {
    return this.assets.list({
      typeId,
      status,
      bbox: parseBbox(bbox),
      includeDecommissioned: includeDecommissioned === 'true',
    });
  }

  @RequirePermission('platform', 'read')
  @Get('export')
  export(@Query('type') typeId?: string) {
    return this.assets.list({ typeId, includeDecommissioned: true });
  }

  @RequirePermission('platform', 'read')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.get(id);
  }

  @RequirePermission('platform', 'write')
  @Post()
  create(@Body() body: unknown) {
    return this.assets.create(body);
  }

  @RequirePermission('platform', 'write')
  @Post('import')
  import(@Body() body: unknown, @Query('type') typeId?: string, @Query('dryRun') dryRun?: string) {
    if (!typeId) throw new BadRequestException('Query parameter "type" is required');
    const collection = zodParse(geoJsonFeatureCollectionSchema, body);
    return this.assets.importGeoJson(typeId, collection, dryRun === 'true');
  }

  @RequirePermission('platform', 'write')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.assets.update(id, zodParse(updateAssetSchema, body));
  }

  @RequirePermission('platform', 'write')
  @Delete(':id')
  decommission(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.decommission(id);
  }
}
