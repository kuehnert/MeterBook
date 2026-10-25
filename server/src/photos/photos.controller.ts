import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { PhotosService } from './photos.service';

@Controller()
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  /**
   * multipart/form-data: file, takenAt (ISO, optional), recognize ("false" zum Abschalten).
   * Der Aufnahmezeitpunkt kommt bevorzugt aus EXIF, dann aus dem Dateinamen, dann aus takenAt.
   * Mit ?async=true kommt die Antwort sofort; die Erkennung läuft im Hintergrund (Foto im Eingang).
   */
  @Post('meters/:meterId/photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  upload(
    @CurrentUser() u: AuthUser,
    @Param('meterId') meterId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('takenAt') takenAt?: string,
    @Body('recognize') recognize?: string,
    @Query('async') async?: string,
  ) {
    if (!file) throw new BadRequestException('Kein Foto übertragen');
    return this.photos.upload(u.id, meterId, file.buffer, {
      fileName: file.originalname,
      takenAt,
      recognize: recognize !== 'false',
      async: async === 'true',
    });
  }

  /** Wie oben, aber ohne Zähler: die Erkennung bestimmt, welcher Zähler auf dem Foto ist. */
  @Post('photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  uploadAuto(
    @CurrentUser() u: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('takenAt') takenAt?: string,
    @Query('async') async?: string,
  ) {
    if (!file) throw new BadRequestException('Kein Foto übertragen');
    return this.photos.upload(u.id, null, file.buffer, { fileName: file.originalname, takenAt, async: async === 'true' });
  }

  /** Eingang: Fotos ohne gespeicherte Ablesung, älteste zuerst (mit Stand der Erkennung). */
  @Get('photos/inbox')
  inbox(@CurrentUser() u: AuthUser) {
    return this.photos.inbox(u.id);
  }

  /** Stand der Erkennung eines Fotos */
  @Get('photos/:id/info')
  info(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.photos.info(u.id, id);
  }

  /** Foto einem anderen Zähler zuordnen; die Erkennung läuft für diesen Zähler neu. */
  @Post('photos/:id/assign')
  @HttpCode(200)
  assign(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body('meterId') meterId: string) {
    if (!meterId) throw new BadRequestException('Zähler fehlt');
    return this.photos.assign(u.id, id, meterId);
  }

  @Get('meters/:meterId/photos')
  list(@CurrentUser() u: AuthUser, @Param('meterId') meterId: string) {
    return this.photos.list(u.id, meterId);
  }

  @Get('photos/:id')
  async get(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Query('size') size: string | undefined,
    @Res() res: Response,
  ) {
    const data = await this.photos.read(u.id, id, size === 'thumb' ? 'thumb' : 'full');
    res.setHeader('Content-Type', 'image/jpeg');
    // Nachfragen statt cachen: nach dem Zuschneiden ändert sich das Bild (ETag sorgt für 304)
    res.setHeader('Cache-Control', 'private, no-cache');
    res.send(data);
  }

  @Delete('photos/:id')
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.photos.remove(u.id, id);
  }
}
