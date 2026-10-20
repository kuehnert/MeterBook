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
   */
  @Post('meters/:meterId/photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  upload(
    @CurrentUser() u: AuthUser,
    @Param('meterId') meterId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('takenAt') takenAt?: string,
    @Body('recognize') recognize?: string,
  ) {
    if (!file) throw new BadRequestException('Kein Foto übertragen');
    return this.photos.upload(u.id, meterId, file.buffer, { fileName: file.originalname, takenAt, recognize: recognize !== 'false' });
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
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(data);
  }

  @Delete('photos/:id')
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.photos.remove(u.id, id);
  }
}
