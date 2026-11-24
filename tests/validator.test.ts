import { describe, it, expect } from "vitest";
import { validateNotification } from "../src/validator";
import { collectValidationErrors } from "../src/validator";

describe("validateNotification", () => {

  it("should accept a valid notification", () => {
    const notification = {
      userId: "user-101",
      channel: "email",
      content: "Your order has shipped",
      idempotencyKey: "order-101"
    };

    expect(() => validateNotification(notification))
      .not.toThrow();
  });

  it("should reject a notification with a missing user ID", () => {
    const notification = {
      userId: "",
      channel: "email",
      content: "Your order has shipped",
      idempotencyKey: "order-101"
    };

    expect(() => validateNotification(notification))
      .toThrow("Please correct the validation errors");
  });

  it("should collect errors for all missing required fields", () => {
  const notification = {
    userId: "",
    channel: "",
    content: "",
    idempotencyKey: "order-101"
  };

  const errors = collectValidationErrors(notification);

  expect(Object.keys(errors)).toHaveLength(3);

  expect(errors).toHaveProperty("userId");
  expect(errors).toHaveProperty("channel");
  expect(errors).toHaveProperty("content");
});

});