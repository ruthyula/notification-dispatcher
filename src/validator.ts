
import type { Notification } from "./types";
import { ValidationError } from "./errors";

export function collectValidationErrors(
  notification: Notification
): Record<string, string> {

  const errors: Record<string, string> = {};

  if (!notification || typeof notification !== "object") {
    return { notification: "Invalid notification payload" };
  }

  if (typeof notification.userId !== "string" ||
      !notification.userId.trim()) {
    errors.userId = "User ID is required";
  }

  if (typeof notification.channel !== "string" ||
      !notification.channel.trim()) {
    errors.channel = "Please select a notification channel";
  }

  if (typeof notification.content !== "string" ||
      !notification.content.trim()) {
    errors.content = "Notification content is required";
  }

  if (typeof notification.idempotencyKey !== "string" ||
      !notification.idempotencyKey.trim()) {
    errors.idempotencyKey = "Idempotency key is required";
  }

  return errors;
}

export function validateNotification(
  notification: Notification
): void {

  const errors = collectValidationErrors(notification);

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(
      "Please correct the validation errors",
      errors
    );
  }
}
