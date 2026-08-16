import { Controller, Get } from '@nestjs/common';
import { listAssetTypes } from '@urbivue/shared';
import { RequirePermission } from '../auth/decorators';

@Controller('asset-types')
export class AssetTypesController {
  @RequirePermission('platform', 'read')
  @Get()
  list() {
    // The code registry is the source of truth; the DB copy exists for FK
    // integrity and is synced at startup (see AssetTypesSyncService).
    return listAssetTypes().map((def) => ({
      id: def.id,
      module: def.module,
      name: def.name,
      geometryKind: def.geometryKind,
      style: def.style,
    }));
  }
}
