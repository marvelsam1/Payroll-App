import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ContractorsService } from './contractors.service';
import { CurrentUser, RequirePermissions, SessionUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

class CreateContractorDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() businessName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsInt() @Min(0) rateCents?: number;
  @IsOptional() @IsString() rateUnit?: string;
  @IsOptional() @IsBoolean() createUser?: boolean;
  @IsOptional() @IsString() password?: string;
}

class UpdateContractorDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() businessName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsInt() @Min(0) rateCents?: number;
  @IsOptional() @IsString() rateUnit?: string;
}

class ContractorQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}

@Controller('contractors')
export class ContractorsController {
  constructor(private readonly contractors: ContractorsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.contractorsRead)
  list(@CurrentUser() s: SessionUser, @Query() q: ContractorQueryDto) {
    if (!s.companyId) return { items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 };
    return this.contractors.list(s.companyId, {
      search: q.search,
      page: q.page ? parseInt(q.page, 10) : undefined,
      pageSize: q.pageSize ? parseInt(q.pageSize, 10) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.contractorsRead)
  getOne(@CurrentUser() s: SessionUser, @Param('id') id: string) {
    if (!s.companyId) throw new Error('No company scope');
    return this.contractors.getOne(s.companyId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.contractorsWrite)
  @HttpCode(201)
  create(@CurrentUser() s: SessionUser, @Body() dto: CreateContractorDto) {
    if (!s.companyId) throw new Error('No company scope');
    return this.contractors.create(s.companyId, dto, s);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.contractorsWrite)
  update(@CurrentUser() s: SessionUser, @Param('id') id: string, @Body() dto: UpdateContractorDto) {
    if (!s.companyId) throw new Error('No company scope');
    return this.contractors.update(s.companyId, id, dto, s);
  }
}
