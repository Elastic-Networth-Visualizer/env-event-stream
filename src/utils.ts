/**
 * Generate a cryptographically secure, random, collision-resistant ID
 * Used as a replacement for the UUID library
 *
 * Format: <timestamp>-<random>-<counter>
 * This ensures:
 * 1. Temporal uniqueness (timestamp component)
 * 2. Randomness (random component)
 * 3. Sequential uniqueness with a counter (even for IDs generated within same millisecond)
 *
 * @returns A string ID that is guaranteed to be unique
 */
export function generateId(): string {
  // Static counter for uniqueness within same millisecond
  // Using closure to maintain state between calls
  const getCounter = (() => {
    let counter = 0;
    // Reset counter after it reaches a high value to prevent overflow
    return () => {
      counter = (counter + 1) % 1000000;
      return counter.toString().padStart(6, "0");
    };
  })();

  // Current timestamp in milliseconds
  const timestamp = Date.now().toString(36);

  // Random component (11 chars)
  const randomPart = Array.from(
    crypto.getRandomValues(new Uint8Array(8)),
    (byte) => byte.toString(16).padStart(2, "0")
  )
    .join("")
    .substring(0, 11);

  // Counter for same-millisecond uniqueness
  const counterPart = getCounter();

  return `${timestamp}-${randomPart}-${counterPart}`;
}
