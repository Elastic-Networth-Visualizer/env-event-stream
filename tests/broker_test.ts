import { assertEquals, assertExists } from "https://deno.land/std@0.182.0/testing/asserts.ts";
import { EventBroker } from "../src/broker.ts";
import { Event } from "../src/types.ts";

Deno.test("EventBroker - Create Topic", () => {
  const broker = new EventBroker();
  const topic = broker.createTopic("test-topic");

  assertExists(topic);
  assertEquals(topic.getName(), "test-topic");
});

Deno.test("EventBroker - Subscribe and Publish", async () => {
  const broker = new EventBroker();
  let receivedEvent: Event<unknown> | null = null;

  const subscription = broker.subscribe("test-topic", (event) => {
    receivedEvent = event;
  });

  assertExists(subscription);

  const result = await broker.publish("test-topic", "test-event", { message: "Hello, World!" });

  assertEquals(result.success, true);
  assertEquals(result.receiverCount, 1);
  assertExists(receivedEvent);
  assertEquals(receivedEvent.type, "test-event");
  assertEquals(receivedEvent.payload.message, "Hello, World!");
});

Deno.test("EventBroker - Event Filtering", async () => {
  const broker = new EventBroker();
  let receivedEvents: string[] = [];

  broker.subscribe("test-topic", (event) => {
    receivedEvents.push(event.type);
  }, {
    eventTypes: ["wanted-event"],
  });

  await broker.publish("test-topic", "wanted-event", { value: 1 });
  await broker.publish("test-topic", "unwanted-event", { value: 2 });
  await broker.publish("test-topic", "wanted-event", { value: 3 });

  assertEquals(receivedEvents.length, 2);
  assertEquals(receivedEvents, ["wanted-event", "wanted-event"]);
});

Deno.test("EventBroker - Dead Letter Queue", async () => {
  const broker = new EventBroker();

  // Create a subscription that will fail
  broker.subscribe("test-topic", () => {
    throw new Error("Intentional failure");
  }, {
    name: "failing-handler",
    maxRetries: 1,
  });

  // Publish an event that will fail processing
  await broker.publish("test-topic", "test-event", { value: 1 });

  // Wait for retries and dead letter queue processing
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Check the dead letter queue
  const deadLetterQueue = broker.getDeadLetterQueue();
  const failedEvents = await deadLetterQueue.getEvents();

  assertEquals(failedEvents.length, 1);
  assertEquals(failedEvents[0].event.type, "test-event");
  assertEquals(failedEvents[0].error, "Intentional failure");
  assertEquals(failedEvents[0].subscription, "failing-handler");
});
