import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { PartnerAuthModule } from '../partner-auth/partner-auth.module';
import { UsersModule } from '../users/users.module';
import { PartnerLegalDocument } from './partner-legal-document.entity';
import { PartnerLegalTermsAdminController } from './partner-legal-terms-admin.controller';
import { PartnerLegalTermsController } from './partner-legal-terms.controller';
import { PartnerLegalTermsService } from './partner-legal-terms.service';
import { PartnerTermsAcceptance } from './partner-terms-acceptance.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([PartnerLegalDocument, PartnerTermsAcceptance]),
    AccessControlModule,
    PartnerAuthModule,
    UsersModule,
  ],
  controllers: [PartnerLegalTermsAdminController, PartnerLegalTermsController],
  providers: [PartnerLegalTermsService],
  exports: [PartnerLegalTermsService],
})
export class PartnerLegalModule {}
