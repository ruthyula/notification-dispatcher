
import { describe, it, expect, vi } from "vitest";
import { NotificationDispatcher } from "../src/NotificationDispatcher";
import { ValidationError } from "../src/errors";
import { sleep, isRetryable, getErrorMessage, retry } from "../src/retry";
import { Transport, Notification } from "../src/types";

describe("NotificationDispatcher", () => {
  it("should successfully dispatch a notification", async () => {
    const mockTransport: Transport = {
      send: vi.fn().mockResolvedValue({
        messageId: "mock-msg-101"
      })
    };

    const dispatcher = new NotificationDispatcher(
      mockTransport,
      3,
      60000
    );

    const notification: Notification = {
      userId: "user-101",
      channel: "email",
      content: "Your order has shipped",
      idempotencyKey: "order-101"
    };

    const result = await dispatcher.dispatch(notification);

    expect(result).toEqual({
      status: "SENT",
      messageId: "mock-msg-101"
    });

    expect(mockTransport.send).toHaveBeenCalledTimes(1);
    expect(mockTransport.send).toHaveBeenCalledWith(notification);
  });


it("should return DUPLICATE for an already sent notification", async () => {
  const mockTransport: Transport = {
    send: vi.fn().mockResolvedValue({
      messageId: "mock-msg-101"
    })
  };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    3,
    60000
  );

  const notification: Notification = {
    userId: "user-101",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-101"
  };

  // First submission.
  const firstResult = await dispatcher.dispatch(notification);

  // Second submission using the same idempotency key.
  const secondResult = await dispatcher.dispatch(notification);

  expect(firstResult).toEqual({
    status: "SENT",
    messageId: "mock-msg-101"
  });

  expect(secondResult).toEqual({
    status: "DUPLICATE",
    messageId: "mock-msg-101"
  });

  // The transport must only be called once.
  expect(mockTransport.send).toHaveBeenCalledTimes(1);
});


it("should not consume rate-limit capacity for duplicate notifications", async () => {
  const mockTransport: Transport = {
    send: vi.fn().mockResolvedValue({
      messageId: "mock-msg-101"
    })
  };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    1,
    60000
  );

  const notification: Notification = {
    userId: "user-101",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-101"
  };

  // First request consumes the only available slot.
  const firstResult = await dispatcher.dispatch(notification);

  // Duplicate should bypass the rate limiter.
  const duplicateResult = await dispatcher.dispatch(notification);

  // A different notification should still be rate-limited.
  const thirdResult = await dispatcher.dispatch({
    ...notification,
    idempotencyKey: "order-102",
    content: "Your payment was received"
  });

  expect(firstResult.status).toBe("SENT");
  expect(duplicateResult.status).toBe("DUPLICATE");

  expect(thirdResult).toEqual({
    status: "RATE_LIMITED",
    retryAfterMs: expect.any(Number)
  });

  expect(mockTransport.send).toHaveBeenCalledTimes(1);
});


it("should retry a notification after a temporary transport failure", async () => {
  const send = vi.fn()
    .mockRejectedValueOnce({
      retryable: true,
      message: "Temporary transport failure"
    })
    .mockResolvedValue({
      messageId: "mock-msg-102"
    });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    3,
    60000
  );

  const notification: Notification = {
    userId: "user-101",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-102"
  };

  const result = await dispatcher.dispatch(notification);

  expect(result).toEqual({
    status: "SENT",
    messageId: "mock-msg-102"
  });

  // First attempt fails; second attempt succeeds.
  expect(send).toHaveBeenCalledTimes(2);
});


it("should return FAILED when all retry attempts are exhausted", async () => {
  const send = vi.fn().mockRejectedValue({
    retryable: true,
    message: "Temporary transport failure"
  });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    3,
    60000
  );

  const notification: Notification = {
    userId: "user-101",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-103"
  };

  const result = await dispatcher.dispatch(notification);

  expect(result).toEqual({
    status: "FAILED",
    reason: "Temporary transport failure"
  });

  // Initial attempt + two retries = three attempts.
  expect(send).toHaveBeenCalledTimes(3);
});

it("should return FAILED immediately for non-retryable errors", async () => {
  const send = vi.fn().mockRejectedValue({
    retryable: false,
    message: "Invalid recipient"
  });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    3,
    60000
  );

  const notification: Notification = {
    userId: "user-101",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-104"
  };

  const result = await dispatcher.dispatch(notification);

  expect(result).toEqual({
    status: "FAILED",
    reason: "Invalid recipient"
  });

  // A permanent error should not trigger retries.
  expect(send).toHaveBeenCalledTimes(1);
});


it("should allow retrying a notification after a failed dispatch", async () => {
  const send = vi.fn()
    .mockRejectedValueOnce({
      retryable: false,
      message: "Provider unavailable"
    })
    .mockResolvedValue({
      messageId: "mock-msg-105"
    });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    3,
    60000
  );

  const notification: Notification = {
    userId: "user-101",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-105"
  };

  // First dispatch fails.
  const firstResult = await dispatcher.dispatch(notification);

  // Second dispatch uses the same idempotency key.
  const secondResult = await dispatcher.dispatch(notification);

  expect(firstResult).toEqual({
    status: "FAILED",
    reason: "Provider unavailable"
  });

  expect(secondResult).toEqual({
    status: "SENT",
    messageId: "mock-msg-105"
  });

  // The transport should be called once per dispatch.
  expect(send).toHaveBeenCalledTimes(2);
});

it("should prevent duplicate concurrent requests", async () => {
  let resolveTransport!: (value: { messageId: string }) => void;

  const send = vi.fn().mockImplementation(
    () => new Promise<{ messageId: string }>(resolve => {
      resolveTransport = resolve;
    })
  );

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    3,
    60000
  );

  const notification: Notification = {
    userId: "user-101",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-106"
  };

  // Start both requests without waiting for either.
  const firstRequest = dispatcher.dispatch(notification);
  const secondRequest = dispatcher.dispatch(notification);

  // Allow the transport to complete.
  resolveTransport({ messageId: "mock-msg-106" });

  const [firstResult, secondResult] = await Promise.all([
    firstRequest,
    secondRequest
  ]);

  expect(firstResult).toEqual({
    status: "SENT",
    messageId: "mock-msg-106"
  });

  expect(secondResult).toEqual({
    status: "DUPLICATE",
    messageId: "mock-msg-106"
  });

  // Only one transport request should be made.
  expect(send).toHaveBeenCalledTimes(1);
});


it("should share a failed result between concurrent requests", async () => {
  let rejectTransport!: (error: unknown) => void;

  const send = vi.fn().mockImplementation(
    () => new Promise<{ messageId: string }>((resolve, reject) => {
      rejectTransport = reject;
    })
  );

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    3,
    60000
  );

  const notification: Notification = {
    userId: "user-101",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-107"
  };

  const firstRequest = dispatcher.dispatch(notification);
  const secondRequest = dispatcher.dispatch(notification);

  // Fail the shared transport operation.
  rejectTransport({
    retryable: false,
    message: "Provider unavailable"
  });

  const [firstResult, secondResult] = await Promise.all([
    firstRequest,
    secondRequest
  ]);

  const expectedResult = {
    status: "FAILED",
    reason: "Provider unavailable"
  };

  expect(firstResult).toEqual(expectedResult);
  expect(secondResult).toEqual(expectedResult);

  // Both requests share one transport operation.
  expect(send).toHaveBeenCalledTimes(1);
});

it("should clean up inFlight after a failed request", async () => {
  const send = vi.fn()
    .mockRejectedValueOnce({
      retryable: false,
      message: "Provider unavailable"
    })
    .mockResolvedValue({
      messageId: "mock-msg-108"
    });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    3,
    60000
  );

  const notification: Notification = {
    userId: "user-101",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-108"
  };

  // First request fails.
  const firstResult = await dispatcher.dispatch(notification);

  // Submit again using the same key.
  const secondResult = await dispatcher.dispatch(notification);

  expect(firstResult).toEqual({
    status: "FAILED",
    reason: "Provider unavailable"
  });

  expect(secondResult).toEqual({
    status: "SENT",
    messageId: "mock-msg-108"
  });

  expect(send).toHaveBeenCalledTimes(2);
});


it("should maintain independent rate limits for different users", async () => {
  const send = vi.fn().mockResolvedValue({
    messageId: "mock-msg-109"
  });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    1,
    60000
  );

  const firstNotification: Notification = {
    userId: "user-101",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-109"
  };

  const secondNotification: Notification = {
    userId: "user-202",
    channel: "email",
    content: "Your payment was received",
    idempotencyKey: "payment-109"
  };

  // User 101 uses their only available slot.
  const firstResult = await dispatcher.dispatch(firstNotification);

  // User 101 exceeds their rate limit.
  const secondResult = await dispatcher.dispatch({
    ...firstNotification,
    idempotencyKey: "order-110"
  });

  // User 202 should still be allowed.
  const thirdResult = await dispatcher.dispatch(secondNotification);

  expect(firstResult.status).toBe("SENT");

  expect(secondResult.status).toBe("RATE_LIMITED");

  expect(thirdResult).toEqual({
    status: "SENT",
    messageId: "mock-msg-109"
  });

  // Only the two permitted notifications reach the transport.
  expect(send).toHaveBeenCalledTimes(2);
});


it("should consume rate-limit capacity even when delivery fails", async () => {
  const send = vi.fn().mockRejectedValue({
    retryable: false,
    message: "Provider unavailable"
  });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    1,
    60000
  );

  const notification: Notification = {
    userId: "user-101",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-111"
  };

  // First attempt reaches the transport but fails.
  const firstResult = await dispatcher.dispatch(notification);

  // Second attempt uses a different key.
  const secondResult = await dispatcher.dispatch({
    ...notification,
    idempotencyKey: "order-112"
  });

  expect(firstResult).toEqual({
    status: "FAILED",
    reason: "Provider unavailable"
  });

  expect(secondResult.status).toBe("RATE_LIMITED");

  // The second request must not reach the transport.
  expect(send).toHaveBeenCalledTimes(1);
});


it("should not call the transport for an invalid notification", async () => {
  const send = vi.fn().mockResolvedValue({
    messageId: "mock-msg-113"
  });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    3,
    60000
  );

  const invalidNotification = {
    userId: "",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-113"
  };

  await expect(
    dispatcher.dispatch(invalidNotification)
  ).rejects.toThrow("Please correct the validation errors");

  // Invalid notifications must never reach the transport.
  expect(send).not.toHaveBeenCalled();
});

it("should not consume rate-limit capacity for an invalid notification", async () => {
  const send = vi.fn().mockResolvedValue({
    messageId: "mock-msg-114"
  });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    1,
    60000
  );

  const invalidNotification = {
    userId: "user-114",
    channel: "email",
    content: "",
    idempotencyKey: "order-114-invalid"
  };

  const validNotification = {
    userId: "user-114",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-114-valid"
  };

  // First, submit the invalid notification.
  await expect(
    dispatcher.dispatch(invalidNotification)
  ).rejects.toThrow("Please correct the validation errors");

  // Now submit a valid notification for the same user.
  const result = await dispatcher.dispatch(validNotification);

  expect(result).toEqual({
    status: "SENT",
    messageId: "mock-msg-114"
  });

  expect(send).toHaveBeenCalledTimes(1);
});

it("should provide field-specific validation errors", async () => {
  const send = vi.fn();

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    3,
    60000
  );

  const invalidNotification = {
    userId: "user-115",
    channel: "email",
    content: "",
    idempotencyKey: "order-115"
  };

  try {
    await dispatcher.dispatch(invalidNotification);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);

    if (error instanceof ValidationError) {
      expect(error.errors).toEqual({
        content: "Notification content is required"
      });
    }
  }

  expect(send).not.toHaveBeenCalled();
});


it("should return IDEMPOTENCY_CONFLICT when the same key is reused with different content", async () => {
  const send = vi.fn().mockResolvedValue({
    messageId: "mock-msg-116"
  });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    3,
    60000
  );

  const firstNotification: Notification = {
    userId: "user-116",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-116"
  };

  const secondNotification: Notification = {
    userId: "user-116",
    channel: "email",
    content: "Your password has changed",
    idempotencyKey: "order-116"
  };

  // First notification should be sent.
  const firstResult = await dispatcher.dispatch(firstNotification);

  expect(firstResult).toEqual({
    status: "SENT",
    messageId: "mock-msg-116"
  });

  // Second notification must be rejected.
  const secondResult = await dispatcher.dispatch(secondNotification);

  expect(secondResult).toEqual({
    status: "IDEMPOTENCY_CONFLICT",
    reason: "Idempotency key has already been used with a different notification payload"
  });

  // Only the first notification should reach the transport.
  expect(send).toHaveBeenCalledTimes(1);
});


it("should reject concurrent requests with the same key but different payloads", async () => {
  let resolveSend!: (value: { messageId: string }) => void;

  const send = vi.fn().mockImplementation(
    () =>
      new Promise<{ messageId: string }>(resolve => {
        resolveSend = resolve;
      })
  );

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    3,
    60000
  );

  const firstNotification: Notification = {
    userId: "user-117",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-117"
  };

  const secondNotification: Notification = {
    userId: "user-117",
    channel: "email",
    content: "Your password has changed",
    idempotencyKey: "order-117"
  };

  // Start the first request without waiting for delivery.
  const firstPromise = dispatcher.dispatch(firstNotification);

  // Start the second request while the first is still processing.
  const secondResult = await dispatcher.dispatch(secondNotification);

  expect(secondResult).toEqual({
    status: "IDEMPOTENCY_CONFLICT",
    reason: "Idempotency key is already being used with a different notification payload"
  });

  // Complete the first transport request.
  resolveSend({ messageId: "mock-msg-117" });

  const firstResult = await firstPromise;

  expect(firstResult).toEqual({
    status: "SENT",
    messageId: "mock-msg-117"
  });

  expect(send).toHaveBeenCalledTimes(1);
});


it("should return DUPLICATE for concurrent requests with the same key and payload", async () => {
  let resolveSend!: (value: { messageId: string }) => void;

  const send = vi.fn().mockImplementation(
    () =>
      new Promise<{ messageId: string }>(resolve => {
        resolveSend = resolve;
      })
  );

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    3,
    60000
  );

  const notification: Notification = {
    userId: "user-118",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-118"
  };

  // Start the first request.
  const firstPromise = dispatcher.dispatch(notification);

  // Start a second request with exactly the same payload.
  const secondPromise = dispatcher.dispatch(notification);

  // Complete the first transport request.
  resolveSend({ messageId: "mock-msg-118" });

  const [firstResult, secondResult] = await Promise.all([
    firstPromise,
    secondPromise
  ]);

  expect(firstResult).toEqual({
    status: "SENT",
    messageId: "mock-msg-118"
  });

  expect(secondResult).toEqual({
    status: "DUPLICATE",
    messageId: "mock-msg-118"
  });

  expect(send).toHaveBeenCalledTimes(1);
});


it("should not consume rate-limit capacity for an idempotency conflict", async () => {
  const send = vi.fn()
    .mockResolvedValueOnce({ messageId: "mock-msg-119" })
    .mockResolvedValueOnce({ messageId: "mock-msg-120" });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    2,
    60000
  );

  const firstNotification: Notification = {
    userId: "user-119",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-119"
  };

  const conflictingNotification: Notification = {
    userId: "user-119",
    channel: "email",
    content: "Your password has changed",
    idempotencyKey: "order-119"
  };

  const thirdNotification: Notification = {
    userId: "user-119",
    channel: "email",
    content: "Your payment was received",
    idempotencyKey: "payment-119"
  };

  const firstResult = await dispatcher.dispatch(firstNotification);

  expect(firstResult.status).toBe("SENT");

  const conflictResult = await dispatcher.dispatch(
    conflictingNotification
  );

  expect(conflictResult.status).toBe("IDEMPOTENCY_CONFLICT");

  const thirdResult = await dispatcher.dispatch(thirdNotification);

  expect(thirdResult).toEqual({
    status: "SENT",
    messageId: "mock-msg-120"
  });

  expect(send).toHaveBeenCalledTimes(2);
});

it("should allow different users to use the same idempotency key", async () => {
  const send = vi.fn()
    .mockResolvedValueOnce({ messageId: "mock-msg-130" })
    .mockResolvedValueOnce({ messageId: "mock-msg-131" });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    3,
    60000
  );

  const userANotification: Notification = {
    userId: "user-A",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-500"
  };

  const userBNotification: Notification = {
    userId: "user-B",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-500"
  };

  const resultA = await dispatcher.dispatch(userANotification);
  const resultB = await dispatcher.dispatch(userBNotification);

  expect(resultA).toEqual({
    status: "SENT",
    messageId: "mock-msg-130"
  });

  expect(resultB).toEqual({
    status: "SENT",
    messageId: "mock-msg-131"
  });

  expect(send).toHaveBeenCalledTimes(2);
});


it("should apply the same rate limit across different channels for one user", async () => {
  const send = vi.fn().mockResolvedValue({
    messageId: "mock-msg-132"
  });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    1,
    60000
  );

  const emailNotification: Notification = {
    userId: "user-132",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-132-email"
  };

  const smsNotification: Notification = {
    userId: "user-132",
    channel: "sms",
    content: "Your order has shipped",
    idempotencyKey: "order-132-sms"
  };

  const emailResult = await dispatcher.dispatch(emailNotification);
  const smsResult = await dispatcher.dispatch(smsNotification);

  expect(emailResult.status).toBe("SENT");

  expect(smsResult.status).toBe("RATE_LIMITED");

  expect(send).toHaveBeenCalledTimes(1);
});


it("should maintain independent rate limits across users and channels", async () => {
  const send = vi.fn()
    .mockResolvedValueOnce({ messageId: "mock-msg-133" })
    .mockResolvedValueOnce({ messageId: "mock-msg-134" });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    1,
    60000
  );

  const userAEmail: Notification = {
    userId: "user-A",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-133"
  };

  const userASms: Notification = {
    userId: "user-A",
    channel: "sms",
    content: "Your order has shipped",
    idempotencyKey: "order-134"
  };

  const userBSms: Notification = {
    userId: "user-B",
    channel: "sms",
    content: "Your order has shipped",
    idempotencyKey: "order-135"
  };

  const resultAEmail = await dispatcher.dispatch(userAEmail);
  const resultASms = await dispatcher.dispatch(userASms);
  const resultBSms = await dispatcher.dispatch(userBSms);

  expect(resultAEmail.status).toBe("SENT");
  expect(resultASms.status).toBe("RATE_LIMITED");
  expect(resultBSms.status).toBe("SENT");

  expect(send).toHaveBeenCalledTimes(2);
});



it("should return the correct retryAfterMs when rate limited", async () => {
  let currentTime = 1000;

  const send = vi.fn().mockResolvedValue({
    messageId: "mock-msg-135"
  });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    1,
    60000,
    () => currentTime
  );

  const notification1: Notification = {
    userId: "user-A",
    channel: "email",
    content: "First notification",
    idempotencyKey: "order-136"
  };

  const notification2: Notification = {
    userId: "user-A",
    channel: "sms",
    content: "Second notification",
    idempotencyKey: "order-137"
  };

  const result1 = await dispatcher.dispatch(notification1);

  // Advance time by 10 seconds.
  currentTime += 10000;

  const result2 = await dispatcher.dispatch(notification2);

  expect(result1.status).toBe("SENT");
  expect(result2.status).toBe("RATE_LIMITED");

  if (result2.status === "RATE_LIMITED") {
    expect(result2.retryAfterMs).toBe(50000);
  }

  expect(send).toHaveBeenCalledTimes(1);
});


it("should allow a notification after the rate limit window expires", async () => {
  let currentTime = 1000;

  const send = vi.fn()
    .mockResolvedValueOnce({ messageId: "mock-msg-136" })
    .mockResolvedValueOnce({ messageId: "mock-msg-137" });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    1,
    60000,
    () => currentTime
  );

  const notification1: Notification = {
    userId: "user-A",
    channel: "email",
    content: "First notification",
    idempotencyKey: "order-138"
  };

  const notification2: Notification = {
    userId: "user-A",
    channel: "sms",
    content: "Second notification",
    idempotencyKey: "order-139"
  };

  const result1 = await dispatcher.dispatch(notification1);

  // Advance time beyond the 60-second window.
  currentTime += 60001;

  const result2 = await dispatcher.dispatch(notification2);

  expect(result1.status).toBe("SENT");
  expect(result2.status).toBe("SENT");
  expect(send).toHaveBeenCalledTimes(2);
});


it("should allow different users to use the same idempotency key concurrently", async () => {
  const send = vi.fn()
    .mockResolvedValueOnce({ messageId: "mock-msg-138" })
    .mockResolvedValueOnce({ messageId: "mock-msg-139" });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    5,
    60000
  );

  const notificationA: Notification = {
    userId: "user-A",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "shared-key"
  };

  const notificationB: Notification = {
    userId: "user-B",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "shared-key"
  };

  const [resultA, resultB] = await Promise.all([
    dispatcher.dispatch(notificationA),
    dispatcher.dispatch(notificationB)
  ]);

  expect(resultA.status).toBe("SENT");
  expect(resultB.status).toBe("SENT");

  expect(send).toHaveBeenCalledTimes(2);
});


it("should not call the transport when a notification is rate limited", async () => {
  const send = vi.fn().mockResolvedValue({
    messageId: "mock-msg-140"
  });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    1,
    60000
  );

  const notification1: Notification = {
    userId: "user-A",
    channel: "email",
    content: "First notification",
    idempotencyKey: "order-140"
  };

  const notification2: Notification = {
    userId: "user-A",
    channel: "sms",
    content: "Second notification",
    idempotencyKey: "order-141"
  };

  const result1 = await dispatcher.dispatch(notification1);
  const result2 = await dispatcher.dispatch(notification2);

  expect(result1.status).toBe("SENT");
  expect(result2.status).toBe("RATE_LIMITED");

  expect(send).toHaveBeenCalledTimes(1);
});


it("should handle an invalid transport response", async () => {
  const send = vi.fn().mockResolvedValue({});

  const mockTransport = {
    send
  } as unknown as Transport;

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    5,
    60000
  );

  const notification: Notification = {
    userId: "user-A",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-142"
  };

  const result = await dispatcher.dispatch(notification);

 expect(result.status).toBe("FAILED");

if (result.status === "FAILED") {
  expect(result.reason).toBe(
    "Invalid transport response: messageId must be a non-empty string"
  );
}

expect(send).toHaveBeenCalledTimes(1);
});


it("should reject an empty messageId from the transport", async () => {
  const send = vi.fn().mockResolvedValue({
    messageId: ""
  });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    5,
    60000
  );

  const notification: Notification = {
    userId: "user-A",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-143"
  };

  const result = await dispatcher.dispatch(notification);

  expect(result.status).toBe("FAILED");

  if (result.status === "FAILED") {
    expect(result.reason).toBe(
      "Invalid transport response: messageId must be a non-empty string"
    );
  }

  expect(send).toHaveBeenCalledTimes(1);
});


it("should allow retrying the same idempotency key after an invalid transport response", async () => {
  const send = vi.fn()
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ messageId: "mock-msg-144" });

  const mockTransport = {
    send
  } as unknown as Transport;

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    5,
    60000
  );

  const notification: Notification = {
    userId: "user-A",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-144"
  };

  const firstResult = await dispatcher.dispatch(notification);
  const secondResult = await dispatcher.dispatch(notification);

  expect(firstResult.status).toBe("FAILED");
  expect(secondResult.status).toBe("SENT");

  if (secondResult.status === "SENT") {
    expect(secondResult.messageId).toBe("mock-msg-144");
  }

  expect(send).toHaveBeenCalledTimes(2);
});


it("should reject a whitespace-only messageId", async () => {
  const send = vi.fn().mockResolvedValue({
    messageId: "   "
  });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    5,
    60000
  );

  const notification: Notification = {
    userId: "user-A",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-145"
  };

  const result = await dispatcher.dispatch(notification);

  expect(result.status).toBe("FAILED");

  if (result.status === "FAILED") {
    expect(result.reason).toBe(
      "Invalid transport response: messageId must be a non-empty string"
    );
  }

  expect(send).toHaveBeenCalledTimes(1);
});


it("should return FAILED to concurrent requests when transport response is invalid", async () => {
  let resolveTransport!: (value: { messageId: string }) => void;

  const send = vi.fn().mockImplementation(
    () =>
      new Promise<{ messageId: string }>((resolve) => {
        resolveTransport = resolve;
      })
  );

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    5,
    60000
  );

  const notification: Notification = {
    userId: "user-A",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-146"
  };

  const requestA = dispatcher.dispatch(notification);
  const requestB = dispatcher.dispatch(notification);

  resolveTransport({ messageId: "" });

  const [resultA, resultB] = await Promise.all([
    requestA,
    requestB
  ]);

  expect(resultA.status).toBe("FAILED");
  expect(resultB.status).toBe("FAILED");
  expect(send).toHaveBeenCalledTimes(1);
});


it("should clean up in-flight requests after an invalid transport response", async () => {
  const send = vi.fn()
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ messageId: "mock-msg-147" });

  const mockTransport = {
    send
  } as unknown as Transport;

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    5,
    60000
  );

  const notification: Notification = {
    userId: "user-A",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-147"
  };

  const firstResult = await dispatcher.dispatch(notification);
  const secondResult = await dispatcher.dispatch(notification);

  expect(firstResult.status).toBe("FAILED");
  expect(secondResult.status).toBe("SENT");

  expect(send).toHaveBeenCalledTimes(2);
});


it("should return DUPLICATE after a successful retry", async () => {
  const send = vi.fn()
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ messageId: "mock-msg-148" });

  const mockTransport = {
    send
  } as unknown as Transport;

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    5,
    60000
  );

  const notification: Notification = {
    userId: "user-A",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-148"
  };

  const firstResult = await dispatcher.dispatch(notification);
  const secondResult = await dispatcher.dispatch(notification);
  const thirdResult = await dispatcher.dispatch(notification);

  expect(firstResult.status).toBe("FAILED");
  expect(secondResult.status).toBe("SENT");
  expect(thirdResult.status).toBe("DUPLICATE");

  expect(send).toHaveBeenCalledTimes(2);
});


it("should not consume rate-limit capacity for duplicate notifications", async () => {
  const send = vi.fn().mockResolvedValue({
    messageId: "mock-msg-149"
  });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    1,
    60000
  );

  const notification: Notification = {
    userId: "user-A",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-149"
  };

  const differentNotification: Notification = {
    userId: "user-A",
    channel: "sms",
    content: "Your payment was received",
    idempotencyKey: "order-150"
  };

  const firstResult = await dispatcher.dispatch(notification);
  const duplicateResult = await dispatcher.dispatch(notification);
  const differentResult = await dispatcher.dispatch(differentNotification);

  expect(firstResult.status).toBe("SENT");
  expect(duplicateResult.status).toBe("DUPLICATE");
  expect(differentResult.status).toBe("RATE_LIMITED");

  expect(send).toHaveBeenCalledTimes(1);
});


it("should not consume rate-limit capacity for idempotency conflicts", async () => {
  const send = vi.fn().mockResolvedValue({
    messageId: "mock-msg-150"
  });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    1,
    60000
  );

  const originalNotification: Notification = {
    userId: "user-A",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-150"
  };

  const conflictingNotification: Notification = {
    userId: "user-A",
    channel: "email",
    content: "Your payment has been received",
    idempotencyKey: "order-150"
  };

  const newNotification: Notification = {
    userId: "user-A",
    channel: "sms",
    content: "Your delivery is scheduled",
    idempotencyKey: "order-151"
  };

  const firstResult = await dispatcher.dispatch(originalNotification);
  const conflictResult = await dispatcher.dispatch(conflictingNotification);
  const thirdResult = await dispatcher.dispatch(newNotification);

  expect(firstResult.status).toBe("SENT");
  expect(conflictResult.status).toBe("IDEMPOTENCY_CONFLICT");
  expect(thirdResult.status).toBe("RATE_LIMITED");

  expect(send).toHaveBeenCalledTimes(1);
});

it("should not create an in-flight request for invalid notifications", async () => {
  const send = vi.fn().mockResolvedValue({
    messageId: "mock-msg-151"
  });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    5,
    60000
  );

  const invalidNotification = {
    userId: "",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-152"
  } as Notification;

  await expect(
    dispatcher.dispatch(invalidNotification)
  ).rejects.toThrow("Please correct the validation errors");

  const validNotification: Notification = {
    userId: "user-A",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "order-152"
  };

  const result = await dispatcher.dispatch(validNotification);

  expect(result.status).toBe("SENT");
  expect(send).toHaveBeenCalledTimes(1);
});


it("should detect an idempotency conflict when the same user reuses a key across channels", async () => {
  const send = vi.fn().mockResolvedValue({
    messageId: "mock-msg-152"
  });

  const mockTransport: Transport = { send };

  const dispatcher = new NotificationDispatcher(
    mockTransport,
    5,
    60000
  );

  const emailNotification: Notification = {
    userId: "user-A",
    channel: "email",
    content: "Your order has shipped",
    idempotencyKey: "shared-order-key"
  };

  const smsNotification: Notification = {
    userId: "user-A",
    channel: "sms",
    content: "Your order has shipped",
    idempotencyKey: "shared-order-key"
  };

  const emailResult = await dispatcher.dispatch(emailNotification);
  const smsResult = await dispatcher.dispatch(smsNotification);

  expect(emailResult.status).toBe("SENT");
  expect(smsResult.status).toBe("IDEMPOTENCY_CONFLICT");

  expect(send).toHaveBeenCalledTimes(1);
});

});
