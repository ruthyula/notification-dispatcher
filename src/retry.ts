
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isRetryable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  return (
    "retryable" in error &&
    error.retryable === true
  );
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return String(error);
}

export async function retry<T>(
  operation: () => Promise<T>,
  maxRetries = 2,
  delay: (ms: number) => Promise<void> = sleep
): Promise<T> {
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
  throw new Error("maxRetries must be a non-negative integer");
}

  let attempt = 0;

  while (true) {
    try {
      return await operation();

    } catch (error) {
      if (!isRetryable(error) || attempt >= maxRetries) {
        throw error;
      }

      const backoffMs = 100 * Math.pow(2, attempt);

      await delay(backoffMs);

      attempt++;
    }
  }
}
