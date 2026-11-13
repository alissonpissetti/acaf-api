import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { parseDatabaseUrl } from '../database/parse-database-url';
import { Department } from '../access-control/department.entity';
import { Company } from '../corporate/company.entity';
import { AccountPlan } from '../finance/account-plan.entity';
import { AccountReceivable } from '../finance/account-receivable.entity';
import { CostCenter } from '../finance/cost-center.entity';
import { Transaction } from '../finance/transaction.entity';
import { TransactionGatewayAttempt } from '../finance/transaction-gateway-attempt.entity';
import { TransactionService } from '../finance/transaction.service';
import { User } from '../users/user.entity';
import { AsaasClient } from './asaas.client';
import { ConnectFinanceReceivableService } from './connect-finance-receivable.service';
import { ConnectTransactionBackfillService } from './connect-transaction-backfill.service';

/**
 * Módulo enxuto para `npm run backfill:connect-transactions` (evita bootstrap do AppModule).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.getOrThrow<string>('DATABASE_URL');
        const db = parseDatabaseUrl(databaseUrl);
        return {
          type: db.type,
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          entities: [
            User,
            Department,
            Company,
            CostCenter,
            AccountPlan,
            AccountReceivable,
            Transaction,
            TransactionGatewayAttempt,
          ],
          synchronize: config.get('DB_SYNC', 'true') === 'true',
        };
      },
    }),
    TypeOrmModule.forFeature([
      User,
      Company,
      CostCenter,
      AccountPlan,
      AccountReceivable,
      Transaction,
      TransactionGatewayAttempt,
    ]),
  ],
  providers: [
    AsaasClient,
    ConnectFinanceReceivableService,
    TransactionService,
    ConnectTransactionBackfillService,
  ],
})
export class ConnectBackfillScriptModule {}
