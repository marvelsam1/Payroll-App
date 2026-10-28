import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { DepartmentsService } from './departments.service';
import { CurrentUser, RequirePermissions, SessionUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

class DepartmentDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsInt() @Min(0) budgetCents?: number;
}

class UpdateDepartmentDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsInt() @Min(0) budgetCents?: number;
}

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.departmentsRead)
  list(@CurrentUser() s: SessionUser) {
    if (!s.companyId) return [];
    return this.departments.list(s.companyId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.departmentsWrite)
  @HttpCode(201)
  create(@CurrentUser() s: SessionUser, @Body() dto: DepartmentDto) {
    if (!s.companyId) throw new Error('No company scope');
    return this.departments.create(s.companyId, dto, s);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.departmentsWrite)
  update(@CurrentUser() s: SessionUser, @Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    if (!s.companyId) throw new Error('No company scope');
    return this.departments.update(s.companyId, id, dto, s);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.departmentsWrite)
  remove(@CurrentUser() s: SessionUser, @Param('id') id: string) {
    if (!s.companyId) throw new Error('No company scope');
    return this.departments.remove(s.companyId, id, s);
  }
}
