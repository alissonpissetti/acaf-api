import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { GymUnit, NetworkSocialContacts } from './types';
import type { CompanyStatus } from '../corporate/company.entity';
import type { UnitWeeklySchedule } from './weeklySchedule';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview() {
    return this.admin.getOverview();
  }

  @Get('networks')
  networks() {
    return this.admin.listNetworks();
  }

  @Post('networks')
  createNetwork(@Body() body: { name: string; social?: Partial<NetworkSocialContacts> }) {
    return this.admin.createNetwork(body.name, body.social);
  }

  @Patch('networks/:id')
  updateNetwork(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      logoUrl?: string | null;
      social?: Partial<NetworkSocialContacts>;
    },
  ) {
    return this.admin.updateNetwork(id, body);
  }

  @Post('networks/:id/logo')
  @UseInterceptors(
    FileInterceptor('logo', {
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadNetworkLogo(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Envie o arquivo da logo.');
    }
    return this.admin.uploadNetworkLogo(id, file);
  }

  @Get('units')
  units(@Query('networkId') networkId?: string) {
    return this.admin.listUnits(networkId);
  }

  @Post('units')
  createUnit(
    @Body()
    body: {
      networkId: string;
      unitName: string;
      zip?: string;
      address?: string;
      number?: string;
      complement?: string;
      neighborhood: string;
      city: string;
      state?: string;
      openHours?: string;
      weeklySchedule?: UnitWeeklySchedule;
      description?: string;
    },
  ) {
    return this.admin.createUnit(body);
  }

  @Patch('units/:id')
  updateUnit(@Param('id') id: string, @Body() patch: Partial<GymUnit>) {
    return this.admin.updateUnit(id, patch);
  }

  @Get('units/:id/check-ins')
  listUnitCheckIns(@Param('id') id: string, @Query('today') today?: string) {
    const todayOnly = today !== '0' && today !== 'false';
    return this.admin.listUnitCheckIns(id, todayOnly);
  }

  @Delete('units/:unitId/check-ins/:entryId')
  cancelUnitCheckIn(@Param('unitId') unitId: string, @Param('entryId') entryId: string) {
    return this.admin.cancelUnitCheckIn(unitId, entryId);
  }

  @Delete('units/:id')
  deleteUnit(@Param('id') id: string) {
    return this.admin.deleteUnit(id);
  }

  @Post('units/:id/photos/hero')
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadUnitHeroPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Envie o arquivo da foto de capa.');
    }
    return this.admin.uploadUnitHeroPhoto(id, file);
  }

  @Post('units/:id/photos/gallery')
  @UseInterceptors(
    FilesInterceptor('photos', 8, {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadUnitGalleryPhotos(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) {
      throw new BadRequestException('Envie ao menos uma foto para a galeria.');
    }
    return this.admin.uploadUnitGalleryPhotos(id, files);
  }

  @Delete('units/:id/photos/hero')
  removeUnitHeroPhoto(@Param('id') id: string) {
    return this.admin.removeUnitHeroPhoto(id);
  }

  @Patch('units/:id/photos/hero')
  setUnitHeroFromGallery(
    @Param('id') id: string,
    @Body() body: { galleryIndex: number },
  ) {
    if (body.galleryIndex == null || Number.isNaN(Number(body.galleryIndex))) {
      throw new BadRequestException('Informe o índice da foto na galeria.');
    }
    return this.admin.setUnitHeroFromGallery(id, body.galleryIndex);
  }

  @Delete('units/:id/photos/gallery/:index')
  removeUnitGalleryPhoto(@Param('id') id: string, @Param('index') index: string) {
    const parsed = Number.parseInt(index, 10);
    if (Number.isNaN(parsed)) {
      throw new BadRequestException('Índice da foto inválido.');
    }
    return this.admin.removeUnitGalleryPhoto(id, parsed);
  }

  @Get('users/search')
  searchUsers(@Query('q') q: string) {
    return this.admin.searchUsers(q ?? '');
  }

  @Get('platform-users/search')
  searchPlatformUsers(@Query('q') q: string) {
    return this.admin.searchUsers(q ?? '');
  }

  @Post('platform-users')
  createPlatformUser(
    @Body()
    body: {
      name: string;
      email: string;
      cpf: string;
      password: string;
    },
  ) {
    return this.admin.createPlatformUser(body);
  }

  @Get('units/:id/partner-users')
  listUnitPartnerUsers(@Param('id') id: string) {
    return this.admin.listUnitPartnerUsers(id);
  }

  @Post('units/:id/partner-users')
  addUnitPartnerUser(
    @Param('id') id: string,
    @Body()
    body: {
      userId?: string;
      name?: string;
      email?: string;
      cpf?: string;
      password?: string;
    },
  ) {
    return this.admin.addUnitPartnerUser(id, body);
  }

  @Delete('units/:id/partner-users/:userId')
  removeUnitPartnerUser(@Param('id') id: string, @Param('userId') userId: string) {
    return this.admin.removeUnitPartnerUser(id, userId);
  }

  @Get('companies')
  listCompanies(@Query('status') status?: CompanyStatus) {
    return this.admin.listCompanies(status);
  }

  @Get('companies/:id')
  getCompany(@Param('id') id: string) {
    return this.admin.getCompany(id);
  }

  @Patch('companies/:id')
  updateCompany(
    @Param('id') id: string,
    @Body() body: { status?: CompanyStatus },
  ) {
    if (!body.status) {
      throw new BadRequestException('Informe o status.');
    }
    return this.admin.updateCompanyStatus(id, body.status);
  }

  @Post('companies/:id/access')
  addCompanyManager(
    @Param('id') id: string,
    @Body() body: { userId: string },
  ) {
    if (!body.userId) throw new BadRequestException('Informe userId.');
    return this.admin.addCompanyManager(id, body.userId);
  }

  @Delete('companies/:id/access/:userId')
  removeCompanyManager(@Param('id') id: string, @Param('userId') userId: string) {
    return this.admin.removeCompanyManager(id, userId);
  }

  @Get('connect-domain')
  connectDomain() {
    return this.admin.getConnectDomain();
  }

  @Patch('connect-domain')
  updateConnectDomain(
    @Body()
    body: {
      acafConnectFeePercent?: number;
      acafDailyFeePercent?: number;
      connectPlans?: Array<{
        id: string;
        name: string;
        pricePerMonth: number;
        tierIndex: number;
        description: string;
      }>;
    },
  ) {
    return this.admin.updateConnectDomain(body);
  }

  @Get('modalities')
  listModalities() {
    return this.admin.listModalities();
  }

  @Post('modalities')
  createModality(@Body() body: { name: string }) {
    return this.admin.createModality(body.name);
  }

  @Put('modalities/reorder')
  reorderModalities(@Body() body: { ids: string[] }) {
    return this.admin.reorderModalities(body.ids ?? []);
  }

  @Patch('modalities/:id')
  updateModality(
    @Param('id') id: string,
    @Body() body: { name?: string; sortOrder?: number; active?: boolean },
  ) {
    return this.admin.updateModality(id, body);
  }

  @Delete('modalities/:id')
  deleteModality(@Param('id') id: string) {
    return this.admin.deleteModality(id);
  }
}
