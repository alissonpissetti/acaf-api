import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import type { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { PermissionsService } from '../access-control/access-control.service';
import { EvolutionInboxRealtimeService } from './evolution-inbox-realtime.service';
import { EvolutionInboxService } from './evolution-inbox.service';

type JwtPayload = {
  sub: string;
  email?: string;
  roles?: UserRole[];
  role?: UserRole;
};

type SubscribeThreadBody = {
  instanceId?: string;
  contactPhone?: string;
};

type SubscribeInboxBody = {
  instanceId?: string | null;
};

@WebSocketGateway({
  namespace: 'evolution-inbox',
  cors: { origin: true, credentials: true },
})
export class EvolutionInboxGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(EvolutionInboxGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly permissions: PermissionsService,
    private readonly realtime: EvolutionInboxRealtimeService,
    private readonly inbox: EvolutionInboxService,
  ) {}

  afterInit(server: Server) {
    this.realtime.setServer(server);
  }

  async handleConnection(client: Socket) {
    const userId = await this.resolveUserId(client);
    if (!userId) {
      client.disconnect(true);
      return;
    }

    const allowed = await this.userCanAccessInbox(userId);
    if (!allowed) {
      client.disconnect(true);
      return;
    }

    client.data.userId = userId;
    client.join(EvolutionInboxRealtimeService.inboxRoom());
  }

  handleDisconnect(_client: Socket) {
    // rooms are cleared automatically
  }

  @SubscribeMessage('subscribe_thread')
  async handleSubscribeThread(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SubscribeThreadBody,
  ) {
    if (!client.data.userId) return { ok: false };
    const instanceId = String(body?.instanceId ?? '').trim();
    const contactPhone = String(body?.contactPhone ?? '').trim();
    if (!instanceId || !contactPhone) return { ok: false, error: 'dados inválidos' };

    const keys = await this.inbox.resolveThreadContactKeys(instanceId, contactPhone);
    const rooms = keys.map((key) => EvolutionInboxRealtimeService.threadRoom(instanceId, key));
    for (const room of rooms) {
      client.join(room);
    }
    client.data.subscribedThreadRooms = rooms;
    return { ok: true, rooms: keys };
  }

  @SubscribeMessage('unsubscribe_thread')
  async handleUnsubscribeThread(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SubscribeThreadBody,
  ) {
    const instanceId = String(body?.instanceId ?? '').trim();
    const contactPhone = String(body?.contactPhone ?? '').trim();
    if (!instanceId || !contactPhone) return { ok: false };

    const prevRooms = (client.data.subscribedThreadRooms as string[] | undefined) ?? [];
    for (const room of prevRooms) {
      client.leave(room);
    }
    client.data.subscribedThreadRooms = [];

    const keys = await this.inbox.resolveThreadContactKeys(instanceId, contactPhone);
    const rooms = keys.map((key) => EvolutionInboxRealtimeService.threadRoom(instanceId, key));
    for (const room of rooms) {
      client.leave(room);
    }
    return { ok: true };
  }

  @SubscribeMessage('subscribe_inbox')
  handleSubscribeInbox(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SubscribeInboxBody,
  ) {
    if (!client.data.userId) return { ok: false };
    const instanceId = body?.instanceId ? String(body.instanceId).trim() : '';
    if (instanceId) {
      client.join(EvolutionInboxRealtimeService.instanceRoom(instanceId));
    }
    return { ok: true };
  }

  private async resolveUserId(client: Socket): Promise<string | null> {
    const raw =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.query?.token as string | undefined);
    const token = String(raw ?? '').trim().replace(/^Bearer\s+/i, '');
    if (!token) return null;

    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      const user = await this.users.findById(payload.sub);
      if (!user?.active) return null;
      return user.id;
    } catch (err) {
      this.logger.debug(`WebSocket auth failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return null;
    }
  }

  private async userCanAccessInbox(userId: string): Promise<boolean> {
    const keys = await this.permissions.getUserPermissionKeys(userId);
    return keys.includes('sistema.evolution') || keys.includes('comercial.leads');
  }
}
