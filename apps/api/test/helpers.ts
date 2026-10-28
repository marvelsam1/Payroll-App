import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/api-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../src/generated/client';

/** Build the full API app (real modules, real database, random port). */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  return app;
}

/**
 * Wipe all application data. TRUNCATE intentionally bypasses the row-level
 * immutability triggers (admin/environment-reset path); there is no
 * application-level DELETE for ledger or audit tables.
 * Refuses to run against anything but the test database.
 */
export async function resetDb(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (!/test/i.test(url)) {
    throw new Error(`refusing to truncate a non-test database: ${url}`);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
        LOOP
          EXECUTE format('TRUNCATE TABLE %I CASCADE', r.tablename);
        END LOOP;
      END $$;
    `);
  } finally {
    await client.end();
  }
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: Role;
  companyId: string | null;
  /** filled in after an explicit login() call */
  token?: string;
}

export async function createCompany(
  prisma: PrismaService,
  data: { name: string; ein?: string; defaultState?: string },
) {
  return prisma.company.create({
    data: {
      name: data.name,
      ein: data.ein ?? '12-3456789',
      defaultState: data.defaultState ?? 'CA',
      paySchedule: 'BIWEEKLY',
    },
  });
}

export async function createUser(
  prisma: PrismaService,
  data: {
    email: string;
    role: Role;
    companyId?: string | null;
    name?: string;
    password?: string;
  },
): Promise<{ id: string; email: string; password: string; role: Role; companyId: string | null }> {
  const password = data.password ?? 'Password123!';
  const user = await prisma.user.create({
    data: {
      email: data.email.toLowerCase(),
      role: data.role,
      companyId: data.companyId ?? null,
      name: data.name ?? data.email.split('@')[0],
      passwordHash: await bcrypt.hash(password, 4),
    },
  });
  return { id: user.id, email: user.email, password, role: user.role, companyId: user.companyId };
}

export async function login(
  app: INestApplication,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`login failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}
