
export interface Notification {
  userId: string;
  channel: string;
  content: string;
  idempotencyKey: string;
}

export interface TransportResponse {
  messageId: string;
}

export interface Transport {
  send(notification: Notification): Promise<TransportResponse>;
}


export type NotificationResult =
  | { status: "SENT"; messageId: string }
  | { status: "DUPLICATE"; messageId: string }
  | { status: "RATE_LIMITED"; retryAfterMs: number }
  | { status: "FAILED"; reason: string }
  | { status: "IDEMPOTENCY_CONFLICT"; reason: string };
  

export interface RateLimiterConfig {
  maxNotifications: number;
  windowMs: number;
}
