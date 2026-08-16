import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { listAssetTypes } from '@urbivue/shared';
import { DbService } from '../db/db.service';

/** Upserts the code-defined asset type registry into the DB at startup. */
@Injectable()
export class AssetTypesSyncService implements OnModuleInit {
  private readonly logger = new Logger(AssetTypesSyncService.name);

  constructor(private readonly db: DbService) {}

  async onModuleInit() {
    try {
      for (const def of listAssetTypes()) {
        await this.db.query(
          `INSERT INTO asset_types (id, module, name, geometry_kind, style)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             module = EXCLUDED.module, name = EXCLUDED.name,
             geometry_kind = EXCLUDED.geometry_kind, style = EXCLUDED.style`,
          [def.id, def.module, def.name, def.geometryKind, JSON.stringify(def.style)],
        );
      }
      this.logger.log(`Synced ${listAssetTypes().length} asset types`);
    } catch (err) {
      this.logger.error(`Asset type sync failed (has the DB been migrated?): ${err}`);
    }
  }
}
