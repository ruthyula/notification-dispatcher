import { describe, it, expect } from "vitest";
import { RateLimiter } from "../src/rateLimiter";

describe("RateLimiter", () => {

  it("should allow requests within the limit", () => {

    let currentTime = 1000;

    const limiter = new RateLimiter(
      3,
      60000,
      () => currentTime
    );

    const firstRequest = limiter.check("user-101");
    const secondRequest = limiter.check("user-101");
    const thirdRequest = limiter.check("user-101");

    expect(firstRequest.allowed).toBe(true);
    expect(secondRequest.allowed).toBe(true);
    expect(thirdRequest.allowed).toBe(true);

  });

  it("should block requests exceeding the limit", () => {
  let currentTime = 1000;

  const limiter = new RateLimiter(
    3,
    60000,
    () => currentTime
  );

  limiter.check("user-101");
  limiter.check("user-101");
  limiter.check("user-101");

  const fourthRequest = limiter.check("user-101");

  expect(fourthRequest).toEqual({
    allowed: false,
    retryAfterMs: 60000
  });
});


it("should allow requests when old timestamps expire", () => {
  let currentTime = 1000;

  const limiter = new RateLimiter(
    2,
    60000,
    () => currentTime
  );

  // Use both available request slots.
  limiter.check("user-101");
  limiter.check("user-101");

  // Advance time by exactly 60 seconds.
  currentTime = 61000;

  // The old requests should have expired.
  const newRequest = limiter.check("user-101");

  expect(newRequest.allowed).toBe(true);
});


});