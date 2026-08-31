import { Injectable } from '@nestjs/common';
import {
  NOTIFICATION_TRIGGER_CATALOG,
  type NotificationTriggerDefinition,
  type NotificationTriggerEvent,
} from './notification.types';

export type NotificationTriggerHandler = {
  key: string;
  handle: (event: NotificationTriggerEvent) => Promise<void>;
};

@Injectable()
export class NotificationTriggersRegistry {
  private readonly handlers = new Map<string, NotificationTriggerHandler>();

  listCatalog(): NotificationTriggerDefinition[] {
    return NOTIFICATION_TRIGGER_CATALOG;
  }

  getTriggerDefinition(key: string): NotificationTriggerDefinition | undefined {
    return NOTIFICATION_TRIGGER_CATALOG.find((item) => item.key === key);
  }

  registerHandler(handler: NotificationTriggerHandler): void {
    this.handlers.set(handler.key, handler);
  }

  getHandler(key: string): NotificationTriggerHandler | undefined {
    return this.handlers.get(key);
  }

  async dispatch(event: NotificationTriggerEvent): Promise<void> {
    const handler = this.handlers.get(event.triggerKey);
    if (!handler) return;
    await handler.handle(event);
  }
}
