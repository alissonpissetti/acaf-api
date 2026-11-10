import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { EvolutionInboxMessageDto } from './evolution-inbox.service';

export type EvolutionInboxThreadActivityPayload = {
  instanceId: string;
  contactPhone: string;
  contactPhones?: string[];
  messageId: string | null;
  ingested: boolean;
  message?: EvolutionInboxMessageDto | null;
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

  notifyThreadsUpdated(instanceId: string) {
    const server = this.server;
    if (!server) return;
    server.to(EvolutionInboxRealtimeService.instanceRoom(instanceId)).emit('threads_updated', {
      instanceId,
    });
    server.to(EvolutionInboxRealtimeService.inboxRoom()).emit('threads_updated', {
      instanceId,
    });
  }

  notifyThreadActivity(payload: EvolutionInboxThreadActivityPayload) {
    const server = this.server;
    if (!server) return;

    const instanceRoom = EvolutionInboxRealtimeService.instanceRoom(payload.instanceId);
    const inboxRoom = EvolutionInboxRealtimeService.inboxRoom();

    const threadKeys = [
      ...new Set(
        [payload.contactPhone, ...(payload.contactPhones ?? [])]
          .map((key) => String(key ?? '').trim())
          .filter(Boolean),
      ),
    ];
    for (const contactPhone of threadKeys) {
      const threadRoom = EvolutionInboxRealtimeService.threadRoom(payload.instanceId, contactPhone);
      server.to(threadRoom).emit('thread_activity', payload);
    }
    server.to(instanceRoom).emit('thread_activity', payload);
    server.to(inboxRoom).emit('thread_activity', payload);
    if (!payload.message?.id) {
      server.to(instanceRoom).emit('threads_updated', {
        instanceId: payload.instanceId,
      });
      server.to(inboxRoom).emit('threads_updated', {
        instanceId: payload.instanceId,
      });
    }
  }
}
