import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PRODUCT_REVIEW_STATUS_CHANGED } from "../workflows/update-product-review-status"

type ReviewStatusChangedData = {
  ids: string[]
  product_ids: string[]
}

/**
 * Refreshes the storefront's cached reviews and ratings after an admin
 * approves or rejects reviews. Needs STOREFRONT_URL and REVALIDATE_SECRET;
 * without them the storefront updates on its own within a few minutes.
 */
export default async function productReviewStatusChangedHandler({
  event: { data },
  container,
}: SubscriberArgs<ReviewStatusChangedData>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const storefrontUrl = process.env.STOREFRONT_URL?.replace(/\/+$/, "")
  const secret = process.env.REVALIDATE_SECRET
  if (!storefrontUrl || !secret) {
    return
  }

  const tags = ["reviews", ...data.product_ids.map((id) => `reviews:${id}`)]
  try {
    const response = await fetch(`${storefrontUrl}/api/revalidate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-revalidate-secret": secret,
      },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      logger.warn(`Storefront revalidate failed with HTTP ${response.status}`)
    }
  } catch (error) {
    logger.warn(`Storefront revalidate failed: ${(error as Error).message}`)
  }
}

export const config: SubscriberConfig = {
  event: PRODUCT_REVIEW_STATUS_CHANGED,
}
