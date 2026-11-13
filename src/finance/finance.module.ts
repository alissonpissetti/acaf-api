import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { CorporateModule } from '../corporate/corporate.module';
import { PartnerModule } from '../partner/partner.module';
import { AsaasModule } from '../asaas/asaas.module';
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
import { Transaction } from './transaction.entity';
import { TransactionGatewayAttempt } from './transaction-gateway-attempt.entity';
import { TransactionService } from './transaction.service';
import { TransactionController } from './transaction.controller';

@Module({
  imports: [
    AccessControlModule,
    StorageModule,
    forwardRef(() => UsersModule),
    forwardRef(() => CorporateModule),
    forwardRef(() => PartnerModule),
    forwardRef(() => AsaasModule),
    TypeOrmModule.forFeature([
      CostCenter,
      AccountPlan,
      AccountPayable,
      AccountReceivable,
      Transaction,
      TransactionGatewayAttempt,
      Supplier,
      SupplierPixKey,
      User,
      Company,
    ]),
  ],
  controllers: [FinanceController, TransactionController],
  providers: [FinanceService, TransactionService],
  exports: [FinanceService, TransactionService],
})
export class FinanceModule {}
