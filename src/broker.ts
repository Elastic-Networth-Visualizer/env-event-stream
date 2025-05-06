import {
  DeadLetterQueue,
  Event,
  EventHandler,
  EventStore,
  PublishResult,
  SubscriptionOptions,
  TopicOptions,
} from "./types.ts";
import { Topic } from "./topic.ts";
import { Subscription } from "./subscription.ts";
import { InMemoryEventStore } from "./persistence.ts";
import { SimpleDeadLetterQueue } from "./deadletter.ts";
import { generateId } from "./utils.ts";

/**
 * Core event broker that manages topics and event distribution
 */
export class EventBroker {
  private topics: Map<string, Topic> = new Map();
  private eventStore: EventStore;
  private deadLetterQueue: DeadLetterQueue;

  constructor(eventStore?: EventStore, deadLetterQueue?: DeadLetterQueue) {
    this.eventStore = eventStore || new InMemoryEventStore();
    this.deadLetterQueue = deadLetterQueue || new SimpleDeadLetterQueue();
  }

  /**
   * Create a new topic
   */
  createTopic(topicName: string, options: TopicOptions = {}): Topic {
    if (this.topics.has(topicName)) {
      return this.topics.get(topicName)!;
    }

    const topic = new Topic(
      topicName,
      this.eventStore,
      this.deadLetterQueue,
      options,
    );
    this.topics.set(topicName, topic);
    return topic;
  }

  /**
   * Get an existing topic
   */
  getTopic(topicName: string): Topic | undefined {
    return this.topics.get(topicName);
  }

  /**
   * Delete a topic
   */
  deleteTopic(topicName: string): boolean {
    return this.topics.delete(topicName);
  }

  /**
   * List all topic names
   */
  getTopicNames(): string[] {
    return Array.from(this.topics.keys());
  }

  /**
   * Subscribe to events on a topic
   */
  subscribe<T = unknown>(
    topicName: string,
    handler: EventHandler<T>,
    options: SubscriptionOptions = {},
  ): Subscription {
    let topic = this.topics.get(topicName);

    if (!topic) {
      topic = this.createTopic(topicName);
    }

    return topic.subscribe(handler, options);
  }

  /**
   * Publish an event to a topic
   */
  async publish<T = unknown>(
    topicName: string,
    eventType: string,
    payload: T,
    metadata: Record<string, unknown> = {},
  ): Promise<PublishResult> {
    let topic = this.topics.get(topicName);

    if (!topic) {
      topic = this.createTopic(topicName);
    }

    const event: Event<T> = {
      id: generateId(),
      type: eventType,
      topic: topicName,
      timestamp: Date.now(),
      schemaVersion: "1.0",
      payload,
      metadata,
    };

    try {
      const receiverCount = await topic.publish(event);
      return {
        success: true,
        eventId: event.id,
        receiverCount,
      };
    } catch (error) {
      return {
        success: false,
        eventId: event.id,
        receiverCount: 0,
        error,
      };
    }
  }

  /**
   * Get the dead letter queue instance
   */
  getDeadLetterQueue(): DeadLetterQueue {
    return this.deadLetterQueue;
  }

  /**
   * Get the event store instance
   */
  getEventStore(): EventStore {
    return this.eventStore;
  }

  /**
   * Replay historical events from a topic to a handler
   */
  async replayEvents<T = unknown>(
    topicName: string,
    handler: EventHandler<T>,
    options: {
      fromTimestamp?: number;
      toTimestamp?: number;
      eventTypes?: string[];
      limit?: number;
    } = {},
  ): Promise<number> {
    const events = await this.eventStore.getEvents(topicName, options);

    for (const event of events) {
      await handler(event as Event<T>);
    }

    return events.length;
  }

  /**
   * Retry processing a failed event from the dead letter queue
   */
  retryDeadLetterEvent(eventId: string): Promise<boolean> {
    const retryCallback = async (event: Event, subscriptionId: string) => {
      const topic = this.getTopic(event.topic);
      if (!topic) {
        throw new Error(`Topic ${event.topic} not found for retry of event ${eventId}`);
      }

      const subscription = topic.getSubscriptions().find((sub) => sub.getId() === subscriptionId);
      if (!subscription) {
        throw new Error(`Subscription ${subscriptionId} not found for retry of event ${eventId}`);
      }

      await subscription.deliver(event);
      return true;
    };

    return this.deadLetterQueue.retryEvent(eventId, retryCallback);
  }
}

// Create default singleton instance
export const defaultBroker: EventBroker = new EventBroker();
