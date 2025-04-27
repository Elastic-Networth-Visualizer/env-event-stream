import {
  Event,
  EventHandler,
  TopicOptions,
  SubscriptionOptions,
} from "./types.ts";
import { Subscription } from "./subscription.ts";
import { InMemoryEventStore } from "./persistence.ts";
import { SimpleDeadLetterQueue } from "./deadletter.ts";
import { generateId } from "./utils.ts";

/**
 * Represents a topic in the event system
 * A topic is a channel to which events are published and from which subscribers receive events
 */
export class Topic {
  private name: string;
  private subscriptions: Map<string, Subscription> = new Map();
  private options: TopicOptions;
  private eventStore: InMemoryEventStore;
  private deadLetterQueue: SimpleDeadLetterQueue;

  constructor(
    name: string,
    eventStore: InMemoryEventStore,
    deadLetterQueue: SimpleDeadLetterQueue,
    options: TopicOptions = {}
  ) {
    this.name = name;
    this.options = {
      persistent: true,
      retentionPeriod: 0, // 0 means keep forever
      maxEvents: 10000,
      ...options,
    };
    this.eventStore = eventStore;
    this.deadLetterQueue = deadLetterQueue;

    // Apply retention policy periodically if set
    if (this.options.retentionPeriod && this.options.retentionPeriod > 0) {
      setInterval(() => this.applyRetentionPolicy(), 60000);
    }
  }

  /**
   * Get the name of this topic
   */
  getName(): string {
    return this.name;
  }

  /**
   * Subscribe to events on this topic
   */
  subscribe<T = unknown>(
    handler: EventHandler<T>,
    options: SubscriptionOptions = {}
  ): Subscription {
    const subscriptionId = options.name || generateId();
    const subscription = new Subscription(
      subscriptionId,
      this.name,
      handler as EventHandler<unknown>,
      this.deadLetterQueue,
      options
    );

    this.subscriptions.set(subscriptionId, subscription);

    // Handle historical events if requested
    if (options.receiveHistoricalEvents) {
      this.eventStore
        .getEvents(this.name, {
          eventTypes: options.eventTypes,
        })
        .then((events) => {
          for (const event of events) {
            subscription.deliver(event).catch((error) => {
              console.error(
                `Error delivering historical event ${event.id}:`,
                error
              );
            });
          }
        });
    }

    return subscription;
  }

  /**
   * Unsubscribe from this topic
   */
  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  /**
   * Publish an event to this topic
   */
  async publish<T = unknown>(event: Event<T>): Promise<number> {
    // Validate event schema if a registry is available
    if (this.options.schemaRegistry) {
      const isValid = await this.options.schemaRegistry.validate(
        event as Event
      );
      if (!isValid) {
        throw new Error(`Event validation failed for type ${event.type}`);
      }
    }

    // Store event if topic is persistent
    if (this.options.persistent) {
      await this.eventStore.saveEvent(event as Event);
    }

    // Deliver to all subscribers
    const deliveryPromises: Promise<void>[] = [];
    let subscriberCount = 0;

    for (const subscription of this.subscriptions.values()) {
      // Skip if subscription is filtering for specific event types
      // and this event doesn't match
      if (
        subscription.getEventTypes()?.length &&
        !subscription.getEventTypes()?.includes(event.type)
      ) {
        continue;
      }

      subscriberCount++;
      deliveryPromises.push(
        subscription.deliver(event as Event).catch((error) => {
          console.error(
            `Error delivering event ${
              event.id
            } to subscription ${subscription.getId()}:`,
            error
          );
        })
      );
    }

    await Promise.all(deliveryPromises);
    return subscriberCount;
  }

  /**
   * Get all subscriptions for this topic
   */
  getSubscriptions(): Subscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Apply retention policy to remove old events
   */
  private async applyRetentionPolicy(): Promise<void> {
    if (!this.options.persistent) return;

    if (this.options.retentionPeriod && this.options.retentionPeriod > 0) {
      const cutoffTime = Date.now() - this.options.retentionPeriod;
      await this.eventStore.deleteEvents(this.name, cutoffTime);
    }
  }
}
