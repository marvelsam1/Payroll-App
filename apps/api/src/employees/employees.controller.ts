import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { EmployeesService } from './employees.service';
import { CurrentUser, RequirePermissions, SessionUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

class CreateEmployeeDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() email?: string;
  @IsString() @MinLength(9) ssn!: string;
  @IsString() workState!: string;
  @IsString() residenceState!: string;
  @IsOptional() @IsString() residenceCity?: string;
  @IsOptional() @IsIn(['SINGLE', 'MARRIED_JOINTLY', 'HEAD_OF_HOUSEHOLD', 'MARRIED_FILING_SEPARATELY'])
  filingStatus?: 'SINGLE' | 'MARRIED_JOINTLY' | 'HEAD_OF_HOUSEHOLD' | 'MARRIED_FILING_SEPARATELY';
  @IsOptional() @IsIn(['FULL_TIME', 'PART_TIME', 'TEMPORARY']) employmentType?: 'FULL_TIME' | 'PART_TIME' | 'TEMPORARY';
  @IsOptional() @IsIn(['SALARIED', 'HOURLY']) payType?: 'SALARIED' | 'HOURLY';
  @IsInt() @Min(0) payRateCents!: number;
  @IsOptional() @IsInt() @Min(0) weeklyHours?: number;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsISO8601() hireDate?: string;
  @IsOptional() @IsIn(['ACTIVE', 'ON_LEAVE', 'TERMINATED']) status?: 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';
  @IsOptional() @IsInt() @Min(0) preTax401kBps?: number;
  @IsOptional() @IsInt() @Min(0) healthInsuranceCents?: number;
  @IsOptional() @IsInt() @Min(0) postTaxRothBps?: number;
  @IsOptional() @IsInt() @Min(0) garnishmentCents?: number;
  @IsOptional() @IsInt() @Min(0) additionalFederalWithholdingCents?: number;
  @IsOptional() @IsInt() @Min(0) ptoBalanceDays?: number;
  @IsOptional() @IsBoolean() createUser?: boolean;
  @IsOptional() @IsString() password?: string;
}

class UpdateEmployeeDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() ssn?: string;
  @IsOptional() @IsString() workState?: string;
  @IsOptional() @IsString() residenceState?: string;
  @IsOptional() @IsString() residenceCity?: string;
  @IsOptional() @IsIn(['SINGLE', 'MARRIED_JOINTLY', 'HEAD_OF_HOUSEHOLD', 'MARRIED_FILING_SEPARATELY'])
  filingStatus?: 'SINGLE' | 'MARRIED_JOINTLY' | 'HEAD_OF_HOUSEHOLD' | 'MARRIED_FILING_SEPARATELY';
  @IsOptional() @IsIn(['FULL_TIME', 'PART_TIME', 'TEMPORARY']) employmentType?: 'FULL_TIME' | 'PART_TIME' | 'TEMPORARY';
  @IsOptional() @IsIn(['SALARIED', 'HOURLY']) payType?: 'SALARIED' | 'HOURLY';
  @IsOptional() @IsInt() @Min(0) payRateCents?: number;
  @IsOptional() @IsInt() @Min(0) weeklyHours?: number;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsISO8601() hireDate?: string;
  @IsOptional() @IsIn(['ACTIVE', 'ON_LEAVE', 'TERMINATED']) status?: 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';
  @IsOptional() @IsInt() @Min(0) preTax401kBps?: number;
  @IsOptional() @IsInt() @Min(0) healthInsuranceCents?: number;
  @IsOptional() @IsInt() @Min(0) postTaxRothBps?: number;
  @IsOptional() @IsInt() @Min(0) garnishmentCents?: number;
  @IsOptional() @IsInt() @Min(0) additionalFederalWithholdingCents?: number;
  @IsOptional() @IsInt() @Min(0) ptoBalanceDays?: number;
}

class EmployeeQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() status?: 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}

/** Employee directory — tenant-scoped CRUD with encrypted SSNs at rest. */
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.employeesRead)
  list(@CurrentUser() s: SessionUser, @Query() q: EmployeeQueryDto) {
    if (!s.companyId) return { items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 };
    return this.employees.list(s.companyId, {
      search: q.search,
      status: q.status as any,
      departmentId: q.departmentId,
      page: q.page ? parseInt(q.page, 10) : undefined,
      pageSize: q.pageSize ? parseInt(q.pageSize, 10) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.employeesRead)
  getOne(@CurrentUser() s: SessionUser, @Param('id') id: string) {
    if (!s.companyId) throw new Error('No company scope');
    return this.employees.getOne(s.companyId, id, s);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.employeesWrite)
  @HttpCode(201)
  create(@CurrentUser() s: SessionUser, @Body() dto: CreateEmployeeDto) {
    if (!s.companyId) throw new Error('No company scope');
    return this.employees.create(s.companyId, dto, s);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.employeesWrite)
  update(@CurrentUser() s: SessionUser, @Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    if (!s.companyId) throw new Error('No company scope');
    return this.employees.update(s.companyId, id, dto as any, s);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.employeesWrite)
  terminate(@CurrentUser() s: SessionUser, @Param('id') id: string) {
    if (!s.companyId) throw new Error('No company scope');
    return this.employees.terminate(s.companyId, id, s);
  }
}
