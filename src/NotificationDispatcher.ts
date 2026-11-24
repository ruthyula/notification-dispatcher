import type{
  Notification,
  NotificationResult,
  Transport
} from "./types";

import { RateLimiter } from "./rateLimiter";
import { validateNotification } from "./validator";
import { retry, getErrorMessage } from "./retry";

export class NotificationDispatcher {
  private rateLimiter: RateLimiter;

  // Stores successfully sent notifications.
  private sentNotifications = new Map<
  string,
  {
    messageId: string;
    fingerprint: string;
  }
>();

  // Prevents simultaneous requests with the same key
  // from sending the same notification twice.
  private inFlight = new Map<
  string,
  {
    fingerprint: string;
    promise: Promise<NotificationResult>;
  }
>();

  private createFingerprint(notification: Notification): string {
  return JSON.stringify({
    userId: notification.userId,
    channel: notification.channel,
    content: notification.content
  });
}

  constructor(
    
  private transport: Transport,
  maxNotifications: number,
  windowMs: number,
  now: () => number = Date.now
) {
  this.rateLimiter = new RateLimiter(maxNotifications, windowMs, now);
}

  async dispatch(
    notification: Notification
  ): Promise<NotificationResult> {

    // 1. Validate input.
    validateNotification(notification);

   const scopedKey = JSON.stringify([
  notification.userId,
  notification.idempotencyKey
]);

    // 2. Check whether this notification was already sent.
   const existingNotification = this.sentNotifications.get(scopedKey);

if (existingNotification) {
  const fingerprint = this.createFingerprint(notification);

  if (existingNotification.fingerprint !== fingerprint) {
    return {
      status: "IDEMPOTENCY_CONFLICT",
      reason: "Idempotency key has already been used with a different notification payload"
    };
  }

  return {
    status: "DUPLICATE",
    messageId: existingNotification.messageId
  };
}

    // 3. Check whether the same key is currently being processed.
   const fingerprint = this.createFingerprint(notification);

const existingRequest = this.inFlight.get(scopedKey);

if (existingRequest) {
  if (existingRequest.fingerprint !== fingerprint) {
    return {
      status: "IDEMPOTENCY_CONFLICT",
      reason: "Idempotency key is already being used with a different notification payload"
    };
  }

  const result = await existingRequest.promise;

  if (result.status === "SENT") {
    return {
      status: "DUPLICATE",
      messageId: result.messageId
    };
  }

  return result;
}

    // 4. Start processing this notification.
    const request = this.processNotification(notification, scopedKey);

this.inFlight.set(scopedKey, {
  fingerprint,
  promise: request
});

    try {
      return await request;
    } finally {
      this.inFlight.delete(scopedKey);
    }
  }

 private async processNotification(
  notification: Notification,
  scopedKey: string
): Promise<NotificationResult> {

    // 5. Enforce the user's rate limit.
   const rateLimitResult = this.rateLimiter.check(
  notification.userId
);

    if (!rateLimitResult.allowed) {
      return {
        status: "RATE_LIMITED",
        retryAfterMs: rateLimitResult.retryAfterMs
      };
    }

    try {
      // 6. Deliver with automatic retries.
      const response = await retry(
        () => this.transport.send(notification),
        2
      );
      if (
  typeof response?.messageId !== "string" ||
  response.messageId.trim() === ""
) {
  throw new Error(
    "Invalid transport response: messageId must be a non-empty string"
  );
}

      // 7. Save successful delivery for idempotency.
     this.sentNotifications.set(scopedKey, {
  messageId: response.messageId,
  fingerprint: this.createFingerprint(notification)
});

      return {
        status: "SENT",
        messageId: response.messageId
      };

    } catch (error) {
      // 8. Return a structured failure instead of
      // allowing transport errors to escape.
      return {
        status: "FAILED",
        reason: getErrorMessage(error)
      };
    }
  }
}