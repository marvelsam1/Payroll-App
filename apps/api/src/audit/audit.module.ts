import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionUser } from '../common/decorators';

export interface AuditRecordInput {
  actor?: SessionUser | null;
  actorId?: string | null;
  actorEmail?: string | null;
  /** Defaults to the actor's tenant; platform-admin actions are global (null). */
  companyId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Append-only audit trail.
 *
 * This service deliberately exposes ONLY a create path — there is no update or
 * delete method anywhere in the application, and the `AuditLog` table itself
 * refuses UPDATE/DELETE via database triggers (see the ledger_guardrails
 * migration). Every state-changing action in the platform calls `record()`.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput): Promise<void> {
    const actorId = input.actorId ?? input.actor?.id ?? null;
    const actorEmail = input.actorEmail ?? input.actor?.email ?? null;
    const companyId =
      input.companyId !== undefined ? input.companyId : (input.actor?.companyId ?? null);
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          actorEmail,
          companyId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          beforeState: (input.before ?? undefined) as any,
          afterState: (input.after ?? undefined) as any,
        },
      });
    } catch (err) {
      // Auditing must never break the business operation, but failures are loud.
      // eslint-disable-next-line no-console
      console.error('[audit] failed to record event:', input.action, err);
    }
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
