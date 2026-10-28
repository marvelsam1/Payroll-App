import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, resolve } from 'path';
import { randomUUID } from 'crypto';
import { IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { Response } from 'express';
import * as fs from 'fs';
import { ExpensesService } from './expenses.service';
import { CurrentUser, RequirePermissions, SessionUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import { env } from '../config/env';

class SubmitExpenseDto {
  @IsInt() @Min(1) amountCents!: number;
  @IsString() @MinLength(1) category!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() expenseDate?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsIn(['DEFER_TO_PAYROLL', 'STANDALONE']) reimbursementMode?: 'DEFER_TO_PAYROLL' | 'STANDALONE';
}

class RejectExpenseDto {
  @IsString() @MinLength(1) reason!: string;
}

class ExpenseQueryDto {
  @IsOptional() @IsString() status?: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REIMBURSED';
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}

const uploadDir = resolve(env.storageDir, 'uploads');

@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.expensesRead)
  list(@CurrentUser() s: SessionUser, @Query() q: ExpenseQueryDto) {
    if (!s.companyId) return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
    return this.expenses.list(s, {
      status: q.status as any,
      departmentId: q.departmentId,
      page: q.page ? parseInt(q.page, 10) : undefined,
      pageSize: q.pageSize ? parseInt(q.pageSize, 10) : undefined,
    });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.expensesSubmit)
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('receipt', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          fs.mkdirSync(uploadDir, { recursive: true });
          cb(null, uploadDir);
        },
        filename: (_req, file, cb) => {
          const ext = (extname(file.originalname) || '.bin').toLowerCase();
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = /^(image\/(png|jpeg|webp)|application\/pdf)$/.test(file.mimetype);
        cb(ok ? null : new BadRequestException('Only PNG/JPEG/WEBP/PDF receipts accepted'), ok);
      },
    }),
  )
  submit(
    @CurrentUser() s: SessionUser,
    @Body() dto: SubmitExpenseDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const amountCents = Number(dto.amountCents);
    if (!Number.isInteger(amountCents)) throw new BadRequestException('amountCents must be an integer');
    return this.expenses.submit(s, {
      amountCents,
      category: dto.category,
      description: dto.description,
      expenseDate: dto.expenseDate,
      departmentId: dto.departmentId,
      reimbursementMode: dto.reimbursementMode as any,
      receiptPath: file ? file.filename : null,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.expensesRead)
  getOne(@CurrentUser() s: SessionUser, @Param('id') id: string) {
    return this.expenses.getOne(s, id);
  }

  @Get(':id/receipt')
  @RequirePermissions(PERMISSIONS.expensesRead)
  async receipt(@CurrentUser() s: SessionUser, @Param('id') id: string, @Res() res: Response) {
    const filename = await this.expenses.getReceipt(s, id);
    const full = resolve(uploadDir, filename);
    if (!full.startsWith(uploadDir) || !fs.existsSync(full)) {
      throw new BadRequestException('Receipt file missing');
    }
    const ext = extname(full).toLowerCase();
    const mime =
      ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : ext === '.pdf' ? 'application/pdf'
      : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    fs.createReadStream(full).pipe(res);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.expensesApprove)
  approve(@CurrentUser() s: SessionUser, @Param('id') id: string) {
    return this.expenses.approve(s, id);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.expensesApprove)
  reject(@CurrentUser() s: SessionUser, @Param('id') id: string, @Body() dto: RejectExpenseDto) {
    return this.expenses.reject(s, id, dto.reason);
  }

  @Post(':id/reimburse')
  @RequirePermissions(PERMISSIONS.expensesReimburse)
  reimburse(@CurrentUser() s: SessionUser, @Param('id') id: string) {
    return this.expenses.reimburseStandalone(s, id);
  }
}
