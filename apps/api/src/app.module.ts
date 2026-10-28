import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { AuthGuard, RbacGuard } from './common/guards';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { CompaniesModule } from './companies/companies.module';
import { EmployeesModule } from './employees/employees.module';
import { ContractorsModule } from './contractors/contractors.module';
import { DepartmentsModule } from './departments/departments.module';
import { TaxEngineModule } from './tax-engine/tax-engine.module';
import { LedgerModule } from './ledger/ledger.module';
import { QueueModule } from './queue/queue.module';
import { AchModule } from './ach/ach.module';
import { PayrollModule } from './payroll/payroll.module';
import { InvoicesModule } from './invoices/invoices.module';
import { ExpensesModule } from './expenses/expenses.module';
import { ComplianceModule } from './compliance/compliance.module';
import { AuditLogModule } from './auditlog/auditlog.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AuditModule,
    CompaniesModule,
    EmployeesModule,
    ContractorsModule,
    DepartmentsModule,
    TaxEngineModule,
    LedgerModule,
    QueueModule,
    AchModule,
    PayrollModule,
    InvoicesModule,
    ExpensesModule,
    ComplianceModule,
    AuditLogModule,
    DashboardModule,
  ],
  providers: [
    // Order matters: authentication first, then permission checks.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
