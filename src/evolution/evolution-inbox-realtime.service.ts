import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

export type EvolutionInboxThreadActivityPayload = {
  instanceId: string;
  contactPhone: string;
  messageId: string | null;
  ingested: boolean;
};

@Injectable()
export class EvolutionInboxRealtimeService {
  private server: Server | null = null;

  static threadRoom(instanceId: string, contactPhone: string): string {
    return `thread:${instanceId}:${contactPhone}`;
  }

  static instanceRoom(instanceId: string): string {
    return `instance:${instanceId}`;
  }

  static inboxRoom(): string {
    return 'inbox:all';
  }

  setServer(server: Server) {
    this.server = server;
  }

  notifyThreadActivity(payload: EvolutionInboxThreadActivityPayload) {
    const server = this.server;
    if (!server) return;

    const threadRoom = EvolutionInboxRealtimeService.threadRoom(
      payload.instanceId,
      payload.contactPhone,
    );
    const instanceRoom = EvolutionInboxRealtimeService.instanceRoom(payload.instanceId);
    const inboxRoom = EvolutionInboxRealtimeService.inboxRoom();

    server.to(threadRoom).emit('thread_activity', payload);
    server.to(instanceRoom).emit('threads_updated', {
      instanceId: payload.instanceId,
    });
    server.to(inboxRoom).emit('threads_updated', {
      instanceId: payload.instanceId,
    });
  }
}
