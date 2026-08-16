import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { AssetTypesController } from './asset-types.controller';
import { AssetTypesSyncService } from './asset-types.sync';

@Module({
  controllers: [AssetsController, AssetTypesController],
  providers: [AssetsService, AssetTypesSyncService],
  exports: [AssetsService],
})
export class AssetsModule {}
