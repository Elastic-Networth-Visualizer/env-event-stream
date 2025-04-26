// Example usage of env-event-stream

import { defaultBroker } from "../mod.ts";

// Define a user created event type
interface UserCreatedEvent {
  userId: string;
  username: string;
  email: string;
  createdAt: string;
}

// Define a connection event type
interface ConnectionEvent {
  sourceUserId: string;
  targetUserId: string;
  strength: number;
}

// Create topics for different domains
const userTopic = defaultBroker.createTopic("users");
const connectionTopic = defaultBroker.createTopic("connections");

// Subscribe to user events
const userSubscription = defaultBroker.subscribe<UserCreatedEvent>("users", async (event) => {
  console.log(`User created: ${event.payload.username} (${event.payload.userId})`);
  
  // In a real app, you might update a database, send notifications, etc.
});

// Subscribe to connection events
const connectionSubscription = defaultBroker.subscribe<ConnectionEvent>("connections", async (event) => {
  console.log(`New connection between ${event.payload.sourceUserId} and ${event.payload.targetUserId} with strength ${event.payload.strength}`);
  
  // In a real app, you might update a graph database, recalculate network metrics, etc.
});

// Publish a user created event
await defaultBroker.publish<UserCreatedEvent>("users", "user.created", {
  userId: "user-123",
  username: "johndoe",
  email: "john@example.com",
  createdAt: new Date().toISOString()
});

// Publish a connection event
await defaultBroker.publish<ConnectionEvent>("connections", "connection.created", {
  sourceUserId: "user-123",
  targetUserId: "user-456",
  strength: 0.75
});

// Wait for events to be processed
setTimeout(() => {
  console.log("Events processed!");
  
  // Unsubscribe when done
  userSubscription.pause();
  connectionSubscription.pause();
}, 1000);
