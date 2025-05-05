// Export types
export type {
  Event,
  EventHandler,
  PublishResult,
  SubscriptionOptions,
  TopicOptions,
  SchemaRegistry,
  EventStore,
  DeadLetterQueue,
  DeadLetterEntry,
  PostgresDeadLetterQueueOptions,
  PostgresEventStoreOptions
} from "./src/types.ts";

// Export broker implementation
export { EventBroker, defaultBroker } from "./src/broker.ts";
export { Topic } from "./src/topic.ts";
export { Subscription } from "./src/subscription.ts";

// Export persistence implementations
export { InMemoryEventStore, FileEventStore, PostgresEventStore } from "./src/persistence.ts";

// Export dead letter queue implementations
export {
  SimpleDeadLetterQueue,
  FileDeadLetterQueue,
  PostgresDeadLetterQueue
} from "./src/deadletter.ts";

// Export schema validation
export { JsonSchemaRegistry } from "./src/schema.ts";

// Export utility functions
export { generateId } from "./src/utils.ts";  // Added utility function export

// Export event sourcing
export {
  EventSourcedEntity,
  AggregateRoot,
  EventSourcedRepository,
  RepositoryFactory
} from "./src/sourcing.ts";
