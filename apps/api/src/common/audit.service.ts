import { Injectable } from '@nestjs/common';
import { auditLog } from '../db/schema';
import type { Tx } from '../db/db.service';

export interface AuditEntry {
  tenantId: string | null;
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Plan changes, price edits, refunds, role changes and staff actions are written here. */
@Injectable()
export class AuditService {
  async record(tx: Tx, e: AuditEntry) {
    await tx.insert(auditLog).values({
      tenantId: e.tenantId,
      actorId: e.actorId,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      before: (e.before ?? null) as never,
      after: (e.after ?? null) as never,
    });
  }
}
