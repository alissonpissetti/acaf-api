import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PartnerJwtAuthGuard } from '../partner-auth/partner-jwt-auth.guard';
import type { GymUnit, ModalitySlotOverride, ModalitySlotTemplate, ConnectPlanId } from './types';
import type { CreateUnitInput } from './unitFactory';
import { AdminService } from './admin.service';
import { PartnerService } from './partner.service';
import { AddressesService } from '../addresses/addresses.service';

type PartnerRequest = Request & {
  user: { platformUserId: string; unitIds: string[] };
};

@ApiTags('App & Parceiro')
@ApiBearerAuth('partner-jwt')
@Controller()
export class PartnerController {
  constructor(
    private readonly partner: PartnerService,
    private readonly addresses: AddressesService,
    private readonly admin: AdminService,
  ) {}

  @Get('health')
  health() {
    return this.partner.getHealth();
  }

  @Get('domain')
  domain() {
    return this.partner.getDomain();
  }

  @Get('bootstrap')
  @UseGuards(PartnerJwtAuthGuard)
  bootstrap(@Req() req: PartnerRequest) {
    return this.partner.getBootstrap(req.user.unitIds);
  }

  @Get('portal')
  @UseGuards(PartnerJwtAuthGuard)
  portal(@Query('scope') scope: string | undefined, @Req() req: PartnerRequest) {
    return this.partner.getPortal(scope, req.user.unitIds);
  }

  @Patch('portal/active-unit')
  @UseGuards(PartnerJwtAuthGuard)
  patchActiveUnit(
    @Body() body: { unitId: string; scope?: string },
    @Req() req: PartnerRequest,
  ) {
    return this.partner.patchActiveUnit(body.unitId, body.scope, req.user.unitIds);
  }

  @Patch('units/:unitId')
  @UseGuards(PartnerJwtAuthGuard)
  patchUnit(
    @Param('unitId') unitId: string,
    @Body() patch: Partial<GymUnit>,
    @Query('scope') scope: string | undefined,
    @Req() req: PartnerRequest,
  ) {
    return this.partner.patchUnit(unitId, patch, scope, req.user.unitIds);
  }

  @Post('units/:unitId/photos/hero')
  @UseGuards(PartnerJwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadUnitHeroPhoto(
    @Param('unitId') unitId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: PartnerRequest,
  ) {
    if (!file) {
      throw new BadRequestException('Envie o arquivo da foto de capa.');
    }
    this.partner.assertPartnerUnitAccess(unitId, req.user.unitIds);
    return this.admin.uploadUnitHeroPhoto(unitId, file);
  }

  @Post('units/:unitId/photos/gallery')
  @UseGuards(PartnerJwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor('photos', 8, {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadUnitGalleryPhotos(
    @Param('unitId') unitId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: PartnerRequest,
  ) {
    if (!files?.length) {
      throw new BadRequestException('Envie ao menos uma foto para a galeria.');
    }
    this.partner.assertPartnerUnitAccess(unitId, req.user.unitIds);
    return this.admin.uploadUnitGalleryPhotos(unitId, files);
  }

  @Delete('units/:unitId/photos/hero')
  @UseGuards(PartnerJwtAuthGuard)
  removeUnitHeroPhoto(@Param('unitId') unitId: string, @Req() req: PartnerRequest) {
    this.partner.assertPartnerUnitAccess(unitId, req.user.unitIds);
    return this.admin.removeUnitHeroPhoto(unitId);
  }

  @Patch('units/:unitId/photos/hero')
  @UseGuards(PartnerJwtAuthGuard)
  setUnitHeroFromGallery(
    @Param('unitId') unitId: string,
    @Body() body: { galleryIndex: number },
    @Req() req: PartnerRequest,
  ) {
    if (body.galleryIndex == null || Number.isNaN(Number(body.galleryIndex))) {
      throw new BadRequestException('Informe o índice da foto na galeria.');
    }
    this.partner.assertPartnerUnitAccess(unitId, req.user.unitIds);
    return this.admin.setUnitHeroFromGallery(unitId, body.galleryIndex);
  }

  @Delete('units/:unitId/photos/gallery/:index')
  @UseGuards(PartnerJwtAuthGuard)
  removeUnitGalleryPhoto(
    @Param('unitId') unitId: string,
    @Param('index') index: string,
    @Req() req: PartnerRequest,
  ) {
    const parsed = Number.parseInt(index, 10);
    if (Number.isNaN(parsed)) {
      throw new BadRequestException('Índice da foto inválido.');
    }
    this.partner.assertPartnerUnitAccess(unitId, req.user.unitIds);
    return this.admin.removeUnitGalleryPhoto(unitId, parsed);
  }

  @Get('addresses/zip/:zip')
  @UseGuards(PartnerJwtAuthGuard)
  lookupZip(@Param('zip') zip: string) {
    return this.addresses.lookupZip(zip);
  }

  @Post('units')
  @UseGuards(PartnerJwtAuthGuard)
  createUnit(
    @Body() body: CreateUnitInput,
    @Query('scope') scope: string | undefined,
    @Req() req: PartnerRequest,
  ) {
    return this.partner.createUnit(body, scope, req.user.unitIds);
  }

  @Get('units/:unitId/public')
  unitPublic(@Param('unitId') unitId: string) {
    return this.partner.getUnitPublic(unitId);
  }

  @Get('units/:unitId/daily-pass-offers')
  dailyPassOffers(@Param('unitId') unitId: string, @Query('date') date: string) {
    return this.partner.getDailyPassOffers(unitId, date);
  }

  @Post('check-ins/validate')
  @UseGuards(PartnerJwtAuthGuard)
  validateCheckIn(
    @Body() body: { unitId: string; code: string; scope?: string; holderName?: string },
    @Req() req: PartnerRequest,
  ) {
    return this.partner.validateCheckIn(
      body.unitId,
      body.code,
      body.scope,
      req.user.unitIds,
      body.holderName,
    );
  }

  @Post('check-ins/issue')
  issueCheckIn(
    @Body()
    body: {
      code: string;
      unitId: string;
      holderName: string;
      validUntil: string;
      type?: 'daily_pass';
      offerId?: string;
      occurrenceDate?: string;
    },
  ) {
    return this.partner.issueCheckIn(body);
  }

  @Post('check-ins/request')
  requestGeoCheckIn(
    @Body()
    body: {
      unitId: string;
      code: string;
      holderName: string;
      latitude: number;
      longitude: number;
    },
  ) {
    return this.partner.requestGeoCheckIn(body);
  }

  @Get('check-ins/pending')
  @UseGuards(PartnerJwtAuthGuard)
  pendingCheckIns(
    @Query('unitId') unitId: string,
    @Query('scope') scope: string | undefined,
    @Req() req: PartnerRequest,
  ) {
    return this.partner.getPendingCheckIns(unitId, scope, req.user.unitIds);
  }

  @Post('check-ins/pending/:id/approve')
  @UseGuards(PartnerJwtAuthGuard)
  approvePending(
    @Param('id') id: string,
    @Body() body: { unitId: string; scope?: string },
    @Req() req: PartnerRequest,
  ) {
    return this.partner.approvePending(id, body.unitId, body.scope, req.user.unitIds);
  }

  @Post('check-ins/pending/:id/dismiss')
  @UseGuards(PartnerJwtAuthGuard)
  dismissPending(
    @Param('id') id: string,
    @Body() body: { unitId: string; scope?: string },
    @Req() req: PartnerRequest,
  ) {
    return this.partner.dismissPending(id, body.unitId, body.scope, req.user.unitIds);
  }

  @Get('units/:unitId/modality-slots')
  @UseGuards(PartnerJwtAuthGuard)
  getModalitySlots(@Param('unitId') unitId: string, @Req() req: PartnerRequest) {
    return this.partner.getModalitySlots(unitId, req.user.unitIds);
  }

  @Put('units/:unitId/modality-slots')
  @UseGuards(PartnerJwtAuthGuard)
  putModalitySlots(
    @Param('unitId') unitId: string,
    @Body() body: { templates: ModalitySlotTemplate[]; instructors?: string[] },
    @Req() req: PartnerRequest,
  ) {
    return this.partner.putModalitySlots(unitId, body, req.user.unitIds);
  }

  @Put('units/:unitId/modality-slot-overrides')
  @UseGuards(PartnerJwtAuthGuard)
  putModalitySlotOverrides(
    @Param('unitId') unitId: string,
    @Body() body: { overrides: ModalitySlotOverride[] },
    @Req() req: PartnerRequest,
  ) {
    return this.partner.putModalitySlotOverrides(unitId, body, req.user.unitIds);
  }

  @Get('units/:unitId/modality-reservations')
  @UseGuards(PartnerJwtAuthGuard)
  getModalityReservations(
    @Param('unitId') unitId: string,
    @Query('date') date: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() req: PartnerRequest,
  ) {
    return this.partner.getModalityReservations(unitId, { date, from, to }, req.user.unitIds);
  }

  @Get('units/:unitId/modality-availability')
  getModalityAvailability(
    @Param('unitId') unitId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('modality') modality?: string,
  ) {
    return this.partner.getModalityAvailability(unitId, from, to, modality?.trim());
  }

  @Post('modality-reservations')
  postModalityReservation(
    @Body()
    body: {
      unitId: string;
      occurrenceDate: string;
      slotTemplateId?: string;
      overrideId?: string;
      holderName: string;
      holderUserId?: string;
    },
  ) {
    return this.partner.postModalityReservation(body);
  }

  @Delete('modality-reservations/:id')
  deleteModalityReservation(@Param('id') id: string) {
    return this.partner.deleteModalityReservation(id);
  }

  @Get('modality-reservations')
  listModalityReservations(@Query('holderName') holderName?: string) {
    return this.partner.listModalityReservations(holderName);
  }

  @Get('connect/enrollment/validate')
  validateEnrollment(@Query('code') code?: string) {
    return this.partner.validateConnectEnrollmentCode(code ?? '');
  }

  @Get('connect/daily-passes')
  listActiveDailyPasses(@Query('holderName') holderName?: string) {
    if (!holderName?.trim()) {
      throw new BadRequestException('Informe holderName.');
    }
    return { passes: this.partner.listActiveDailyPasses(holderName) };
  }

  @Get('connect/member')
  getConnectMember(@Query('holderName') holderName?: string) {
    if (!holderName?.trim()) {
      throw new BadRequestException('Informe holderName.');
    }
    const profile = this.partner.getConnectMember(holderName);
    return { profile };
  }

  @Put('connect/subscription')
  registerConnectSubscription(
    @Body()
    body: {
      holderName: string;
      connectPlanId: ConnectPlanId;
      active?: boolean;
      companyName?: string;
    },
  ) {
    const profile = this.partner.registerConnectSubscription(body);
    return { ok: true, profile };
  }

  @Put('connect/primary-gym')
  setConnectPrimaryGym(@Body() body: { holderName: string; unitId: string }) {
    if (!body.holderName?.trim() || !body.unitId?.trim()) {
      throw new BadRequestException('Informe holderName e unitId.');
    }
    const profile = this.partner.setConnectPrimaryGym(body.holderName.trim(), body.unitId.trim());
    return { ok: true, profile };
  }

  @Get('clients')
  @UseGuards(PartnerJwtAuthGuard)
  listClients(@Query('scope') scope: string | undefined, @Req() req: PartnerRequest) {
    return { clients: this.partner.listClients(scope, req.user.unitIds) };
  }

  @Get('clients/:holderKey')
  @UseGuards(PartnerJwtAuthGuard)
  getClient(
    @Param('holderKey') holderKey: string,
    @Query('scope') scope: string | undefined,
    @Req() req: PartnerRequest,
  ) {
    const decoded = decodeURIComponent(holderKey);
    const client = this.partner.getClient(decoded, scope, req.user.unitIds);
    if (!client) {
      throw new BadRequestException('Cliente não encontrado.');
    }
    return { client };
  }

  @Get('catalog')
  catalog(@Query('city') city?: string, @Query('q') q?: string) {
    return this.partner.getCatalog({ city, q });
  }

  @Get('catalog/cities')
  catalogCities() {
    return this.partner.getCatalogCities();
  }

  @Get('catalog/units/:unitId')
  catalogUnit(@Param('unitId') unitId: string) {
    return this.partner.getCatalogUnit(unitId);
  }

  @Get('catalog/units/:unitId/hero')
  catalogUnitHero(@Param('unitId') unitId: string, @Res() res: Response) {
    return this.partner.streamUnitHeroPhoto(unitId, res);
  }

  @Get('catalog/units/:unitId/gallery/:index')
  catalogUnitGallery(
    @Param('unitId') unitId: string,
    @Param('index') index: string,
    @Res() res: Response,
  ) {
    return this.partner.streamUnitGalleryPhoto(unitId, Number(index), res);
  }
}

@ApiTags('Público')
@Controller()
export class SharedController {
  constructor(private readonly partner: PartnerService) {}

  /** Ping público — use GET /test (sem prefixo /api) para checar se o serviço responde. */
  @Get('test')
  @ApiOperation({ summary: 'Ping de disponibilidade (sem /api)' })
  test() {
    return this.partner.getTest();
  }

  @Get('shared/connect_domain.json')
  @Header('Content-Type', 'application/json')
  connectDomain(@Res() res: Response) {
    res.send(this.partner.getSharedDomainJson());
  }
}
