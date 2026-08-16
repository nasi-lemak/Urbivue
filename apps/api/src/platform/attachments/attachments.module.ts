import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DbService } from '../db/db.service';
import { Public, RequirePermission } from '../auth/decorators';
import { PublicRateLimitGuard } from '../auth/rate-limit.guard';
import type { AuthUser } from '../auth/auth.service';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const ENTITY_TABLES: Record<string, string> = {
  inspection: 'inspections',
  work_order: 'work_orders',
  citizen_report: 'citizen_reports',
};

/** Shape provided by multer's memory storage (avoids the Express.Multer type). */
interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export function attachmentsDir(): string {
  return process.env.ATTACHMENTS_DIR ?? path.join(process.cwd(), 'data', 'uploads');
}

/**
 * File attachments for inspections, work orders, and citizen reports.
 * Local-disk storage (single instance / mounted volume); an S3-style
 * adapter can replace the fs calls when the API scales out.
 */
@Injectable()
export class AttachmentsService {
  constructor(private readonly db: DbService) {}

  async store(
    entityKind: string,
    entityId: string,
    file: UploadedFileLike,
    uploadedBy: string | null,
  ) {
    const table = ENTITY_TABLES[entityKind];
    if (!table) throw new BadRequestException(`Unknown entity kind '${entityKind}'`);
    const ext = ALLOWED_MIME[file.mimetype];
    if (!ext) throw new BadRequestException('Only JPEG, PNG, or WebP images are accepted');
    if (file.size > MAX_BYTES) throw new BadRequestException('File exceeds the 5 MB limit');

    const entity = await this.db.query(`SELECT 1 FROM ${table} WHERE id = $1`, [entityId]);
    if (!entity.rowCount) throw new NotFoundException(`${entityKind} ${entityId} not found`);

    const dir = attachmentsDir();
    fs.mkdirSync(dir, { recursive: true });
    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO attachments
         (entity_kind, entity_id, original_name, mime, size_bytes, storage_path, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, '', $6)
       RETURNING id`,
      [entityKind, entityId, file.originalname.slice(0, 200), file.mimetype, file.size, uploadedBy],
    );
    const id = inserted.rows[0].id;
    const storagePath = path.join(dir, `${id}${ext}`);
    fs.writeFileSync(storagePath, file.buffer);
    await this.db.query('UPDATE attachments SET storage_path = $2 WHERE id = $1', [
      id,
      storagePath,
    ]);
    return { id, entityKind, entityId, mime: file.mimetype, sizeBytes: file.size };
  }

  list(entityKind: string, entityId: string) {
    return this.db
      .query(
        `SELECT id, original_name AS "originalName", mime, size_bytes AS "sizeBytes",
                created_at AS "createdAt"
         FROM attachments WHERE entity_kind = $1 AND entity_id = $2
         ORDER BY created_at`,
        [entityKind, entityId],
      )
      .then((r) => r.rows);
  }

  async file(id: string) {
    const result = await this.db.query<{ storage_path: string; mime: string }>(
      'SELECT storage_path, mime FROM attachments WHERE id = $1',
      [id],
    );
    const row = result.rows[0];
    if (!row || !fs.existsSync(row.storage_path)) {
      throw new NotFoundException(`Attachment ${id} not found`);
    }
    return row;
  }
}

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @RequirePermission('platform', 'write')
  @Post(':entityKind/:entityId')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Param('entityKind') entityKind: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Req() req: { user: AuthUser },
  ) {
    if (!file) throw new BadRequestException('Multipart field "file" is required');
    return this.attachments.store(entityKind, entityId, file, req.user.sub);
  }

  @RequirePermission('platform', 'read')
  @Get(':entityKind/:entityId')
  list(
    @Param('entityKind') entityKind: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
  ) {
    return this.attachments.list(entityKind, entityId);
  }

  @RequirePermission('platform', 'read')
  @Get('file/:id')
  async serve(@Param('id', ParseUUIDPipe) id: string, @Res() res: any) {
    const row = await this.attachments.file(id);
    res.setHeader('Content-Type', row.mime);
    fs.createReadStream(row.storage_path).pipe(res);
  }
}

/** Citizens attach a photo to their own fresh report (rate-limited). */
@Controller('public/reports')
export class PublicReportPhotoController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly db: DbService,
  ) {}

  @Public()
  @UseGuards(PublicRateLimitGuard)
  @Post(':id/photo')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    if (!file) throw new BadRequestException('Multipart field "file" is required');
    // Only fresh, untriaged reports accept public uploads — closes the door
    // on old report IDs being used as a public file drop.
    const report = await this.db.query(
      `SELECT 1 FROM citizen_reports
       WHERE id = $1 AND status = 'new' AND created_at > now() - interval '24 hours'`,
      [id],
    );
    if (!report.rowCount) {
      throw new BadRequestException('Photos can only be added to a just-submitted report');
    }
    const existing = await this.attachments.list('citizen_report', id);
    if (existing.length >= 3) throw new BadRequestException('Photo limit reached');
    return this.attachments.store('citizen_report', id, file, null);
  }
}

@Module({
  controllers: [AttachmentsController, PublicReportPhotoController],
  providers: [AttachmentsService, PublicRateLimitGuard],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
