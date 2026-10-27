import { loadEnv, defineConfig, MedusaError } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

const isProduction = process.env.NODE_ENV === "production"

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Missing required environment variable: ${name}`
    )
  }
  return value
}

const REDIS_URL = requireEnv("REDIS_URL")

if (isProduction) {
  for (const name of ["JWT_SECRET", "COOKIE_SECRET"]) {
    const value = requireEnv(name)
    if (value.length < 32 || value === "supersecret") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `${name} is too weak for production`
      )
    }
  }
}

// OTP test mode: no SMS is sent and OTP_TEST_CODE logs in any number.
// Defaults to ON only while no real SMS provider is configured.
const OTP_TEST_MODE =
  process.env.OTP_TEST_MODE !== undefined
    ? process.env.OTP_TEST_MODE === "true"
    : !process.env.SMS_PROVIDER || process.env.SMS_PROVIDER === "test"

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: requireEnv("DATABASE_URL"),
    // Used for session storage
    redisUrl: REDIS_URL,
    workerMode:
      (process.env.MEDUSA_WORKER_MODE as "shared" | "worker" | "server") ||
      "shared",
    http: {
      storeCors: requireEnv("STORE_CORS"),
      adminCors: requireEnv("ADMIN_CORS"),
      authCors: requireEnv("AUTH_CORS"),
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  admin: {
    disable: process.env.DISABLE_MEDUSA_ADMIN === "true",
    backendUrl: process.env.MEDUSA_BACKEND_URL,
  },
  modules: [
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: { redisUrl: REDIS_URL },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: { redis: { redisUrl: REDIS_URL } },
    },
    {
      resolve: "@medusajs/medusa/locking",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/locking-redis",
            id: "locking-redis",
            is_default: true,
            options: { redisUrl: REDIS_URL },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/auth",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/auth-emailpass",
            id: "emailpass",
          },
          // Mobile number + SMS OTP login for customers. See OTP_LOGIN.md.
          {
            resolve: "./src/modules/phone-auth",
            id: "phone-otp",
            options: {
              provider: process.env.SMS_PROVIDER || "test",
              test_mode: OTP_TEST_MODE,
              test_code: process.env.OTP_TEST_CODE || "123456",
              hash_secret:
                process.env.OTP_HASH_SECRET ||
                process.env.JWT_SECRET ||
                "supersecret",
              otp_expiry_minutes: Number(process.env.OTP_EXPIRY_MINUTES || 5),
              resend_cooldown_seconds: Number(
                process.env.OTP_RESEND_COOLDOWN_SECONDS || 30
              ),
              max_sends_per_hour: Number(process.env.OTP_MAX_SENDS_PER_HOUR || 5),
              max_verify_attempts: Number(process.env.OTP_MAX_VERIFY_ATTEMPTS || 5),
              msg91: {
                auth_key: process.env.MSG91_AUTH_KEY,
                template_id: process.env.MSG91_TEMPLATE_ID,
              },
              fast2sms: {
                api_key: process.env.FAST2SMS_API_KEY,
                sender_id: process.env.FAST2SMS_SENDER_ID,
                template_id: process.env.FAST2SMS_TEMPLATE_ID,
              },
              twilio: {
                account_sid: process.env.TWILIO_ACCOUNT_SID,
                auth_token: process.env.TWILIO_AUTH_TOKEN,
                from: process.env.TWILIO_FROM,
                messaging_service_sid: process.env.TWILIO_MESSAGING_SERVICE_SID,
              },
            },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          // Razorpay is registered only once test credentials exist.
          // See PAYMENTS_SETUP.md.
          ...(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
            ? [
                {
                  resolve: "./src/modules/razorpay",
                  id: "razorpay",
                  options: {
                    key_id: process.env.RAZORPAY_KEY_ID,
                    key_secret: process.env.RAZORPAY_KEY_SECRET,
                    webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET,
                  },
                },
              ]
            : []),
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/fulfillment-manual",
            id: "manual",
          },
          // Shiprocket is registered only once credentials exist.
          // See SHIPPING_SETUP.md.
          ...(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD
            ? [
                {
                  resolve: "./src/modules/shiprocket",
                  id: "shiprocket",
                  options: {
                    email: process.env.SHIPROCKET_EMAIL,
                    password: process.env.SHIPROCKET_PASSWORD,
                    pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION,
                  },
                },
              ]
            : []),
        ],
      },
    },
    // Product images: local disk in development, S3-compatible storage
    // (AWS S3, Cloudflare R2, DigitalOcean Spaces) when S3_* vars are set.
    ...(process.env.S3_BUCKET
      ? [
          {
            resolve: "@medusajs/medusa/file",
            options: {
              providers: [
                {
                  resolve: "@medusajs/medusa/file-s3",
                  id: "s3",
                  options: {
                    file_url: process.env.S3_FILE_URL,
                    access_key_id: process.env.S3_ACCESS_KEY_ID,
                    secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
                    region: process.env.S3_REGION,
                    bucket: process.env.S3_BUCKET,
                    endpoint: process.env.S3_ENDPOINT,
                  },
                },
              ],
            },
          },
        ]
      : []),
  ],
})
