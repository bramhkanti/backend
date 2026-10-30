import { emitEventStep } from "@medusajs/medusa/core-flows"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { createProductReviewStep } from "./steps/create-product-review"
import {
  prepareProductReviewStep,
  type PrepareProductReviewInput,
} from "./steps/prepare-product-review"

export const PRODUCT_REVIEW_CREATED = "product_review.created"

/**
 * Stores a customer's review as `pending`. It is shown on the storefront only
 * after an admin approves it (updateProductReviewStatusWorkflow).
 */
export const createProductReviewWorkflow = createWorkflow(
  "create-product-review",
  (input: PrepareProductReviewInput) => {
    const prepared = prepareProductReviewStep(input)
    const review = createProductReviewStep(prepared)

    emitEventStep({
      eventName: PRODUCT_REVIEW_CREATED,
      data: transform({ review }, ({ review }) => ({
        id: review.id,
        product_id: review.product_id,
      })),
    })

    return new WorkflowResponse(review)
  }
)
