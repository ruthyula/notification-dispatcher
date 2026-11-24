
export class RateLimiter {
  private userRequests = new Map<string, number[]>();

  constructor(
    private maxNotifications: number,
    private windowMs: number,
    private now: () => number = Date.now
    
  ) {
   if (!Number.isInteger(maxNotifications) || maxNotifications <= 0) {
  throw new Error("maxNotifications must be a positive integer");
}

if (!Number.isFinite(windowMs) || windowMs <= 0) {
  throw new Error("windowMs must be a positive number");
}
  }

  check(userId: string):
    | { allowed: true }
    | { allowed: false; retryAfterMs: number } {

    const currentTime = this.now();

    const timestamps = this.userRequests.get(userId) ?? [];

    // Remove timestamps outside the rolling window.
    const validTimestamps = timestamps.filter(
      timestamp => timestamp > currentTime - this.windowMs
    );

    if (validTimestamps.length >= this.maxNotifications) {
      this.userRequests.set(userId, validTimestamps);

      const oldestTimestamp = validTimestamps[0];

      return {
        allowed: false,
        retryAfterMs: Math.max(
          0,
          oldestTimestamp + this.windowMs - currentTime
        )
      };
    }

    // Record this notification request.
    validTimestamps.push(currentTime);

    this.userRequests.set(userId, validTimestamps);

    return { allowed: true };
  }
}
