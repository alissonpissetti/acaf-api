import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AddressesService } from './addresses.service';

@ApiTags('Admin · API')
@ApiBearerAuth('admin-jwt')
@Controller('admin/addresses')
@UseGuards(JwtAuthGuard)
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get('zip/:zip')
  lookupZip(@Param('zip') zip: string) {
    return this.addresses.lookupZip(zip);
  }
}
