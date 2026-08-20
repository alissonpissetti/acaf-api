import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { CorporateModule } from '../corporate/corporate.module';
import { PartnerModule } from '../partner/partner.module';
import { StorageModule } from '../storage/storage.module';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { Company } from '../corporate/company.entity';
import { AccountPayable } from './account-payable.entity';
import { AccountPlan } from './account-plan.entity';
import { AccountReceivable } from './account-receivable.entity';
import { SupplierPixKey } from './supplier-pix-key.entity';
import { Supplier } from './supplier.entity';
import { CostCenter } from './cost-center.entity';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  imports: [
    AccessControlModule,
    StorageModule,
    UsersModule,
    CorporateModule,
    PartnerModule,
    TypeOrmModule.forFeature([
      CostCenter,
      AccountPlan,
      AccountPayable,
      AccountReceivable,
      Supplier,
      SupplierPixKey,
      User,
      Company,
    ]),
  ],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
