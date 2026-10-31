import { emitEventStep } from "@medusajs/medusa/core-flows"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  updateProductReviewStatusStep,
  type UpdateProductReviewStatusStepInput,
} from "./steps/update-product-review-status"

export const PRODUCT_REVIEW_STATUS_CHANGED = "product_review.status_changed"

/**
 * Approves or rejects reviews. Approved reviews count towards the product's
 * rating and are listed on the storefront.
 */
export const updateProductReviewStatusWorkflow = createWorkflow(
  "update-product-review-status",
  (input: UpdateProductReviewStatusStepInput) => {
    const reviews = updateProductReviewStatusStep(input)

    emitEventStep({
      eventName: PRODUCT_REVIEW_STATUS_CHANGED,
      data: transform({ reviews }, ({ reviews }) => ({
        ids: reviews.map((review) => review.id),
        product_ids: [...new Set(reviews.map((review) => review.product_id))],
      })),
    })

    return new WorkflowResponse(reviews)
  }
)
