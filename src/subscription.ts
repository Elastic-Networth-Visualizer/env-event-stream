import { Event, EventHandler, SubscriptionOptions } from "./types.ts";
import { SimpleDeadLetterQueue } from "./deadletter.ts";

/**
 * @description Represents a subscription to a topic.
 * Handles event delivery, retries, and error handling
 */
export class Subscription {
  private id: string;
  private topicName: string;
  private handler: EventHandler;
  private options: SubscriptionOptions;
  private deadLetterQueue: SimpleDeadLetterQueue;
  private active: boolean = true;
  
  constructor(
    id: string, 
    topicName: string, 
    handler: EventHandler,
    deadLetterQueue: SimpleDeadLetterQueue,
    options: SubscriptionOptions = {}
  ) {
    this.id = id;
    this.topicName = topicName;
    this.handler = handler;
    this.deadLetterQueue = deadLetterQueue;
    this.options = {
      maxRetries: 3,
      retryDelay: 1000,
      ...options
    };
  }
  
  /**
   * Get the subscription ID
   */
  getId(): string {
    return this.id;
  }
  
  /**
   * Get event types this subscription is interested in
   */
  getEventTypes(): string[] | undefined {
    return this.options.eventTypes;
  }
  
  /**
   * Get topic this subscription belongs to
   */
  getTopicName(): string {
    return this.topicName;
  }
  
  /**
   * Check if subscription is active
   */
  isActive(): boolean {
    return this.active;
  }
  
  /**
   * Pause this subscription (temporarily stop receiving events)
   */
  pause(): void {
    this.active = false;
  }
  
  /**
   * Resume this subscription
   */
  resume(): void {
    this.active = true;
  }
  
  /**
   * Deliver an event to this subscription's handler
   */
  async deliver(event: Event, attempt: number = 1): Promise<void> {
    if (!this.active) {
      return;
    }
    
    // Skip if subscription only wants specific event types
    if (
      this.options.eventTypes?.length && 
      !this.options.eventTypes.includes(event.type)
    ) {
      return;
    }
    
    try {
      await Promise.resolve(this.handler(event));
    } catch (error) {
      // If we have retries left, try again after delay
      if (attempt < (this.options.maxRetries || 3)) {
        await new Promise(resolve => setTimeout(resolve, this.options.retryDelay));
        return this.deliver(event, attempt + 1);
      } else {
        // No more retries, send to dead letter queue
        await this.deadLetterQueue.addEvent(
          event, 
          error instanceof Error ? error : new Error(String(error)),
          this.id
        );
      }
    }
  }
}