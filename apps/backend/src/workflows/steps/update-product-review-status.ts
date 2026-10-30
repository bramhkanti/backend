import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PRODUCT_REVIEW_MODULE } from "../../modules/product-review"
import type { ReviewStatus } from "../../modules/product-review/models/product-review"
import type ProductReviewModuleService from "../../modules/product-review/service"

export type UpdateProductReviewStatusStepInput = {
  ids: string[]
  status: ReviewStatus
}

export const updateProductReviewStatusStep = createStep(
  "update-product-review-status",
  async (input: UpdateProductReviewStatusStepInput, { container }) => {
    const reviewService: ProductReviewModuleService =
      container.resolve(PRODUCT_REVIEW_MODULE)

    const previous = await reviewService.listProductReviews(
      { id: input.ids },
      { select: ["id", "status"] }
    )
    const updated = await reviewService.updateProductReviews(
      previous.map((review) => ({ id: review.id, status: input.status }))
    )

    return new StepResponse(
      updated,
      previous.map((review) => ({ id: review.id, status: review.status }))
    )
  },
  async (previous, { container }) => {
    if (!previous?.length) {
      return
    }
    const reviewService: ProductReviewModuleService =
      container.resolve(PRODUCT_REVIEW_MODULE)
    await reviewService.updateProductReviews(previous)
  }
)
