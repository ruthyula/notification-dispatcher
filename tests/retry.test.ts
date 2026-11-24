
import { describe, it, expect, vi } from "vitest";
import { retry } from "../src/retry";

describe("retry", () => {
  it("should return the result without retrying when successful", async () => {
    const operation = vi.fn().mockResolvedValue("Success");

    const delay = vi.fn().mockResolvedValue(undefined);

    const result = await retry(operation, 2, delay);

    expect(result).toBe("Success");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });


it("should retry after a retryable failure", async () => {
  const operation = vi.fn()
    .mockRejectedValueOnce({ retryable: true, message: "Temporary failure" })
    .mockResolvedValue("Success");

  const delay = vi.fn().mockResolvedValue(undefined);

  const result = await retry(operation, 2, delay);

  expect(result).toBe("Success");

  // First attempt fails; second attempt succeeds.
  expect(operation).toHaveBeenCalledTimes(2);

  // The first retry should wait 100 milliseconds.
  expect(delay).toHaveBeenCalledTimes(1);
  expect(delay).toHaveBeenCalledWith(100);
});

it("should not retry a non-retryable failure", async () => {
  const operation = vi.fn()
    .mockRejectedValue({
      retryable: false,
      message: "Invalid notification"
    });

  const delay = vi.fn().mockResolvedValue(undefined);

  await expect(
    retry(operation, 2, delay)
  ).rejects.toMatchObject({
    retryable: false,
    message: "Invalid notification"
  });

  // The operation should execute only once.
  expect(operation).toHaveBeenCalledTimes(1);

  // No retry delay should occur.
  expect(delay).not.toHaveBeenCalled();
});

it("should use exponential backoff delays of 100ms and 200ms", async () => {
  const operation = vi.fn()
    .mockRejectedValueOnce({
      message: "Temporary failure",
      retryable: true
    })
    .mockRejectedValueOnce({
      message: "Temporary failure",
      retryable: true
    })
    .mockRejectedValueOnce({
      message: "Temporary failure",
      retryable: true
    });

  const delay = vi.fn().mockResolvedValue(undefined);

  await expect(
    retry(operation, 2, delay)
  ).rejects.toMatchObject({
    message: "Temporary failure"
  });

  expect(operation).toHaveBeenCalledTimes(3);

  expect(delay).toHaveBeenNthCalledWith(1, 100);
  expect(delay).toHaveBeenNthCalledWith(2, 200);
  expect(delay).toHaveBeenCalledTimes(2);
});


it("should stop after two retries using exponential backoff", async () => {
  const operation = vi.fn()
    .mockRejectedValue({
      retryable: true,
      message: "Temporary transport failure"
    });

  const delay = vi.fn().mockResolvedValue(undefined);

  await expect(
    retry(operation, 2, delay)
  ).rejects.toMatchObject({
    retryable: true,
    message: "Temporary transport failure"
  });

  // Initial attempt + two retries = three attempts.
  expect(operation).toHaveBeenCalledTimes(3);

  // Verify the exponential backoff delays.
  expect(delay).toHaveBeenCalledTimes(2);
  expect(delay).toHaveBeenNthCalledWith(1, 100);
  expect(delay).toHaveBeenNthCalledWith(2, 200);
});

it("should not retry a non-retryable error", async () => {
  const operation = vi.fn().mockRejectedValue({
    message: "Invalid notification",
    retryable: false
  });

  const delay = vi.fn().mockResolvedValue(undefined);

  await expect(
    retry(operation, 2, delay)
  ).rejects.toMatchObject({
    message: "Invalid notification"
  });

  expect(operation).toHaveBeenCalledTimes(1);
  expect(delay).not.toHaveBeenCalled();
});


it("should return the result when a retry succeeds", async () => {
  const operation = vi.fn()
    .mockRejectedValueOnce({
      message: "Temporary transport failure",
      retryable: true
    })
    .mockResolvedValueOnce("Notification delivered");

  const delay = vi.fn().mockResolvedValue(undefined);

  const result = await retry(operation, 2, delay);

  expect(result).toBe("Notification delivered");
  expect(operation).toHaveBeenCalledTimes(2);
  expect(delay).toHaveBeenCalledTimes(1);
  expect(delay).toHaveBeenCalledWith(100);
});



});
