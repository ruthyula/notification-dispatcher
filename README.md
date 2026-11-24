# Notification Dispatcher

A modular notification dispatching system built with **TypeScript**. It demonstrates reliable notification delivery through validation, rate limiting, retry handling, idempotency, and an injectable transport layer.

## Features

- **Input validation:** Checks required notification fields and returns meaningful validation errors.
- **Rate limiting:** Implements a sliding-window rate limiter to control notification requests per user.
- **Retry mechanism:** Retries transient transport failures using exponential backoff (100ms, 200ms).
- **Idempotency:** Prevents duplicate notifications when the same user submits the same idempotency key and payload.
- **Idempotency conflict detection:** Identifies attempts to reuse an idempotency key with a different payload.
- **Concurrent request handling:** Shares an in-flight operation for matching requests to avoid duplicate transport calls.
- **Injectable transport:** Separates notification processing from the delivery provider, making the system easier to test and extend.
- **Automated testing:** Includes unit and integration tests using Vitest.

## Technologies Used

- TypeScript
- JavaScript
- Vite
- Vitest
- HTML
- CSS

## Project Structure

```text
notification-ts-app/
├── src/
│   ├── errors.ts
│   ├── main.ts
│   ├── NotificationDispatcher.ts
│   ├── rateLimiter.ts
│   ├── retry.ts
│   ├── types.ts
│   └── validator.ts
├── tests/
│   ├── NotificationDispatcher.test.ts
│   ├── rateLimiter.test.ts
│   ├── retry.test.ts
│   └── validator.test.ts
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── .gitignore
└── README.md
```

## Installation

Clone the repository:

```bash
git clone <https://github.com/ruthyula>
```

Navigate into the project directory:

```bash
cd notification-ts-app
```

Install dependencies:

```bash
npm install
```

## Running the Application

Start the development server:

```bash
npm run dev
```

Open the local URL displayed in your terminal to access the application.

## Running Tests

Run the test suite:

```bash
npm test
```

To run tests once without watch mode:

```bash
npx vitest run
```

## Production Build

Run TypeScript compilation and create a production build:

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```

## Example Notification Results

The dispatcher returns structured results depending on the outcome:

| Status | Description |
|---|---|
| `SENT` | Notification was successfully sent. |
| `DUPLICATE` | A matching notification was already processed. |
| `RATE_LIMITED` | The user has exceeded the allowed request limit. |
| `FAILED` | Notification delivery failed. |
| `IDEMPOTENCY_CONFLICT` | An idempotency key was reused with a different payload. |

## Learning Objectives

This project demonstrates practical application of:

- TypeScript interfaces, types, and generics.
- Asynchronous programming with Promises and `async/await`.
- Error handling and retry strategies.
- Sliding-window rate-limiting algorithms.
- JavaScript Maps and in-flight request tracking.
- Dependency injection and modular architecture.
- Unit and integration testing.

## Future Improvements

- Integrate real email, SMS, or push notification providers.
- Add persistent storage for idempotency records.
- Add configurable retry and rate-limit settings.
- Introduce structured logging and monitoring.

## License

This project is available for learning and portfolio demonstration purposes.