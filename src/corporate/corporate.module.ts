import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../mail/mail.module';
import { SmsModule } from '../sms/sms.module';
import { UsersModule } from '../users/users.module';
import { User } from '../users/user.entity';
import { CorporateAuthModule } from '../corporate-auth/corporate-auth.module';
import { CompanyAccess } from './company-access.entity';
import { CompanyEmployee } from './company-employee.entity';
import { CompanyInvite } from './company-invite.entity';
import { CompanyInvoice } from './company-invoice.entity';
import { Company } from './company.entity';
import { CorporateAccessService } from './corporate-access.service';
import { CorporateCompaniesService } from './corporate-companies.service';
import { CorporateController } from './corporate.controller';
import { CorporateEmployeesService } from './corporate-employees.service';
import { CorporateInvoicesService } from './corporate-invoices.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Company,
      CompanyAccess,
      CompanyEmployee,
      CompanyInvite,
      CompanyInvoice,
      User,
    ]),
    UsersModule,
    MailModule,
    SmsModule,
    forwardRef(() => CorporateAuthModule),
  ],
  controllers: [CorporateController],
  providers: [
    CorporateAccessService,
    CorporateCompaniesService,
    CorporateEmployeesService,
    CorporateInvoicesService,
  ],
  exports: [
    CorporateAccessService,
    CorporateCompaniesService,
    CorporateEmployeesService,
    CorporateInvoicesService,
  ],
})
export class CorporateModule {}
