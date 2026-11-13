import { Module, forwardRef } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { FinanceModule } from '../finance/finance.module';
import { UsersModule } from '../users/users.module';
import { AsaasClient } from './asaas.client';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountPlan } from '../finance/account-plan.entity';
import { AccountPayable } from '../finance/account-payable.entity';
import { AccountReceivable } from '../finance/account-receivable.entity';
import { CostCenter } from '../finance/cost-center.entity';
import { User } from '../users/user.entity';
import { Company } from '../corporate/company.entity';
import { ConnectCheckoutService } from './connect-checkout.service';
import { ConnectPlanChangeService } from './connect-plan-change.service';
import { ConnectFinanceReceivableService } from './connect-finance-receivable.service';
import { ConnectFinancePayableService } from './connect-finance-payable.service';
import { ConnectFinanceSyncService } from './connect-finance-sync.service';
import { AsaasInboundService } from './asaas-inbound.service';
import { AsaasWebhookController } from './asaas-webhook.controller';
import { ConnectFinanceAdminController } from './connect-finance-admin.controller';
import { ConnectTransactionBackfillService } from './connect-transaction-backfill.service';

@Module({
  imports: [
    AccessControlModule,
    TypeOrmModule.forFeature([AccountReceivable, AccountPayable, CostCenter, AccountPlan, User, Company]),
    forwardRef(() => UsersModule),
    forwardRef(() => FinanceModule),
  ],
  controllers: [AsaasWebhookController, ConnectFinanceAdminController],
  providers: [
    AsaasClient,
    ConnectFinanceReceivableService,
    ConnectFinancePayableService,
    ConnectFinanceSyncService,
    ConnectCheckoutService,
    ConnectPlanChangeService,
    AsaasInboundService,
    ConnectTransactionBackfillService,
  ],
  exports: [
    AsaasClient,
    AsaasInboundService,
    ConnectCheckoutService,
    ConnectPlanChangeService,
    ConnectFinanceReceivableService,
    ConnectFinancePayableService,
    ConnectFinanceSyncService,
    ConnectTransactionBackfillService,
  ],
})
export class AsaasModule {}
