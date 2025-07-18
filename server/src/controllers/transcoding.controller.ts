import { Controller, Get, Header, Next, Param, Res, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NextFunction, Response } from 'express';
import { JsonWebTokenError, JwtPayload, verify } from 'jsonwebtoken';
import fs from 'node:fs';
import sanitize from 'sanitize-filename';
import { AudioPlaylistParamDto, MasterPlaylistParamDto, PartParamDto, VideoPlaylistParamDto } from 'src/dtos/video.dto';
import { CacheControl, RouteKey } from 'src/enum';
import { FileResponse } from 'src/middleware/auth.guard';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { TranscodingService } from 'src/services/transcoding.service';
import { sendFile } from 'src/utils/file';

@ApiTags('Transcoder')
@Controller(RouteKey.PLAYBACK)
export class TranscodingController {
  constructor(
    private service: TranscodingService,
    private logger: LoggingRepository,
    private systemMetadataRepository: SystemMetadataRepository,
  ) {}

  @Get(':secret/master.m3u8')
  @Header('Content-Type', 'application/vnd.apple.mpegurl')
  async getMasterPlaylist(@Param() { secret }: MasterPlaylistParamDto) {
    let data;
    try {
      data = verify(secret, await this.systemMetadataRepository.getSecretKey()) as
        | JwtPayload
        | { id: string; sessionId: string };
    } catch (error: any) {
      throw error instanceof JsonWebTokenError ? new UnauthorizedException() : error;
    }
    return await this.service.getMasterPlaylist(data.id, data.sessionId);
  }

  @Get(':secret/:codec/:quality/playlist.m3u8')
  @Header('Content-Type', 'application/vnd.apple.mpegurl')
  @FileResponse()
  async getVideoPlaylist(@Param() { secret, codec, quality }: VideoPlaylistParamDto) {
    let data;
    try {
      data = verify(secret, await this.systemMetadataRepository.getSecretKey()) as
        | JwtPayload
        | { id: string; sessionId: string };
    } catch (error: any) {
      throw error instanceof JsonWebTokenError ? new UnauthorizedException() : error;
    }
    return await this.service.getVideoPlaylist(data.id, data.sessionId, codec, quality);
  }

  @Get(':secret/a/:codec/:quality/playlist.m3u8')
  @Header('Content-Type', 'application/vnd.apple.mpegurl')
  @FileResponse()
  async getAudioPlaylist(@Param() { secret, codec, quality }: AudioPlaylistParamDto) {
    let data;
    try {
      data = verify(secret, await this.systemMetadataRepository.getSecretKey()) as
        | JwtPayload
        | { id: string; sessionId: string };
    } catch (error: any) {
      throw error instanceof JsonWebTokenError ? new UnauthorizedException() : error;
    }
    return await this.service.getAudioPlaylist(data.id, data.sessionId, codec, quality);
  }

  @Get(':secret/:codec/:quality/:name.mp4')
  @FileResponse()
  async getVideoPart(
    @Param() { secret, codec, quality, name }: PartParamDto,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    let data;
    try {
      data = verify(secret, await this.systemMetadataRepository.getSecretKey()) as
        | JwtPayload
        | { id: string; sessionId: string };
    } catch (error: any) {
      throw error instanceof JsonWebTokenError ? new UnauthorizedException() : error;
    }

    const arr = name.split('.');

    if (arr.length == 1) {
      // It's necessary to provide promisified result into sendFile
      await sendFile(
        res,
        next,
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => {
          return {
            path: `/tmp/video/${sanitize(data['sessionId'])}/${sanitize(codec.toString())}/${sanitize(quality)}/${sanitize(arr[0])}.mp4`,
            cacheControl: CacheControl.PRIVATE_WITH_CACHE,
            contentType: 'video/mp4',
          };
        },
        this.logger,
      );
      return;
    }

    // Make full segment by joining parts
    for (const name of arr) {
      await new Promise<void>((resolve) => {
        const buf = fs.createReadStream(
          `/tmp/video/${sanitize(data['sessionId'])}/${sanitize(codec.toString())}/${sanitize(quality)}/${sanitize(name)}.mp4`,
        );
        buf.pipe(res, { end: false });
        buf.on('end', () => {
          resolve();
        });
      });
    }
    res.end();
  }
}
