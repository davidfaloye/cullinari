import { Logger } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { SocketEvent } from '@cullinari/shared';
import { AuthGuard } from '../auth/auth.guard';

const tenantRoom = (tenantId: string) => `t:${tenantId}:all`;
const branchRoom = (tenantId: string, branchId: string) => `t:${tenantId}:b:${branchId}`;

/**
 * Live events for the admin (new orders, status changes, usage). Clients connect to the
 * /admin namespace with their session token. Staff tied to one branch only join that
 * branch's room; everyone else joins the tenant-wide room.
 *
 * Single instance today. With more than one API instance, add @socket.io/redis-adapter.
 */
@WebSocketGateway({ namespace: '/admin', cors: { origin: true } })
export class EventsGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger('Realtime');

  constructor(private readonly guard: AuthGuard) {}

  async handleConnection(client: Socket) {
    const token = (client.handshake.auth?.token as string | undefined) ?? '';
    const auth = token ? await this.guard.resolve(token).catch(() => null) : null;
    if (!auth || auth.tenantStatus === 'suspended') {
      client.emit('error', { code: 'UNAUTHENTICATED' });
      client.disconnect(true);
      return;
    }
    await client.join(auth.branchId ? branchRoom(auth.tenantId, auth.branchId) : tenantRoom(auth.tenantId));
    client.data.auth = auth;
  }

  orderCreated(tenantId: string, branchId: string, order: unknown) {
    this.toBranch(tenantId, branchId, SocketEvent.ORDER_CREATED, order);
  }

  orderUpdated(tenantId: string, branchId: string, order: unknown) {
    this.toBranch(tenantId, branchId, SocketEvent.ORDER_UPDATED, order);
  }

  usageUpdated(tenantId: string, usage: unknown) {
    this.server?.to(tenantRoom(tenantId)).emit(SocketEvent.USAGE_UPDATED, usage);
  }

  private toBranch(tenantId: string, branchId: string, event: string, payload: unknown) {
    if (!this.server) return;
    try {
      this.server.to([tenantRoom(tenantId), branchRoom(tenantId, branchId)]).emit(event, payload);
    } catch (err) {
      this.logger.warn(`emit ${event} failed: ${String(err)}`);
    }
  }
}
