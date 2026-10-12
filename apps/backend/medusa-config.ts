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
