
import { collectValidationErrors } from "./validator";
import { NotificationDispatcher } from "./NotificationDispatcher";
import  type{ Notification, Transport } from "./types";

let messageCounter = 1;
let attemptCounter = 0;

const mockTransport: Transport = {
  async send(notification) {
    attemptCounter++;

    console.log(
      `Transport attempt ${attemptCounter}:`,
      notification.content
    );

    if (
  notification.content === "TEST_RETRY" &&
  attemptCounter === 1
) {
  throw {
    message: "Temporary transport failure",
    retryable: true
  };
}

    return {
      messageId: `mock-msg-${messageCounter++}`
    };
  }
};


const dispatcher = new NotificationDispatcher(
  mockTransport,
  3,
  60_000
);


function getElement<T extends HTMLElement>(
  selector: string
): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  return element;
}

const form = getElement<HTMLFormElement>(
  "#notificationForm"
);

const userIdInput = getElement<HTMLInputElement>(
  "#userId"
);

const channelInput = getElement<HTMLSelectElement>(
  "#channel"
);

const contentInput = getElement<HTMLTextAreaElement>(
  "#content"
);

const idempotencyKeyInput = getElement<HTMLInputElement>(
  "#idempotencyKey"
);

const formMessage = getElement<HTMLParagraphElement>(
  "#formMessage"
);

const submitButton = getElement<HTMLButtonElement>(
  'button[type="submit"]'
);

// Clear previous errors.
function clearErrors(): void {
  const fields = [
    userIdInput,
    channelInput,
    contentInput,
    idempotencyKeyInput
  ];

  fields.forEach(field => {
    field.classList.remove("invalid");
    field.setAttribute("aria-invalid", "false");
  });

  document.querySelectorAll(".error").forEach(error => {
    error.textContent = "";
  });

  formMessage.textContent = "";
  formMessage.className = "";
}

// Display validation errors.
function displayError(
  field: HTMLElement,
  errorId: string,
  message: string

): void {
  field.classList.add("invalid");
   // Tell assistive technologies this field is invalid.
  field.setAttribute("aria-invalid", "true");
  

  const errorElement = document.getElementById(errorId);

  if (errorElement) {
    errorElement.textContent = message;
    
  }
}

// Handle form submission.
form.addEventListener("submit", async (event: SubmitEvent) => {
  event.preventDefault();

  clearErrors();

  const notification: Notification = {
    userId: userIdInput.value,
    channel: channelInput.value,
    content: contentInput.value,
    idempotencyKey: idempotencyKeyInput.value
  };

  // Validate notification.
  const errors = collectValidationErrors(notification);

  if (Object.keys(errors).length > 0) {

    const fieldMap = {
      userId: userIdInput,
      channel: channelInput,
      content: contentInput,
      idempotencyKey: idempotencyKeyInput
    };

    const errorIdMap = {
      userId: "userIdError",
      channel: "channelError",
      content: "contentError",
      idempotencyKey: "idempotencyKeyError"
    };

    // Display every validation error.
    for (const key of Object.keys(errors) as Array<keyof typeof fieldMap>) {
      displayError(
        fieldMap[key],
        errorIdMap[key],
        errors[key]
      );
    }

    formMessage.textContent = "Please correct the errors above.";
    formMessage.className = "failure";

    return;
  }

  // Send notification through the dispatcher.
  formMessage.textContent = "Processing notification...";
  formMessage.className = "";

  submitButton.disabled = true;
submitButton.textContent = "Sending...";

  try {
    const result = await dispatcher.dispatch(notification);

    // Display the appropriate result.
    switch (result.status) {

      case "SENT":
        formMessage.textContent =
          `Notification sent successfully! Message ID: ${result.messageId}`;
        formMessage.className = "success";
        break;

      case "DUPLICATE":
        formMessage.textContent =
          `This notification was already sent. Message ID: ${result.messageId}`;
        formMessage.className = "success";
        break;

      case "RATE_LIMITED":
        formMessage.textContent =
          `Rate limit reached. Please try again in ${Math.ceil(result.retryAfterMs / 1000)} seconds.`;
        formMessage.className = "failure";
        break;

      case "FAILED":
        formMessage.textContent =
          `Notification delivery failed: ${result.reason}`;
        formMessage.className = "failure";
        break;
      case "IDEMPOTENCY_CONFLICT":
         formMessage.textContent =
        `Idempotency conflict: ${result.reason}`;
         formMessage.className = "failure";
         break;
         
    }

    console.log("Dispatcher result:", result);

  } catch (error) {
    formMessage.textContent =
      error instanceof Error
        ? error.message
        : "An unexpected error occurred.";

    formMessage.className = "failure";

    console.error("Dispatcher error:", error);
  }finally {
  submitButton.disabled = false;
  submitButton.textContent = "Send Notification";
}
});