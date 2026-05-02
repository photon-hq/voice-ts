/**
 * Shared types used across multiple resource namespaces.
 */

/** Options for automatic retry with exponential back-off. */
export interface RetryOptions {
  /** Initial delay in milliseconds before the first retry. */
  readonly initialDelay?: number;
  /** Maximum number of attempts (including the initial call). */
  readonly maxAttempts?: number;
  /** Maximum delay in milliseconds between retries. */
  readonly maxDelay?: number;
}
