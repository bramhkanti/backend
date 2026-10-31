import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PRODUCT_REVIEW_MODULE } from "../../modules/product-review"
import type ProductReviewModuleService from "../../modules/product-review/service"

export type CreateProductReviewStepInput = {
  product_id: string
  customer_id: string
  rating: number
  title: string | null
  body: string
  display_name: string
  verified_purchase: boolean
}

export const createProductReviewStep = createStep(
  "create-product-review",
  async (input: CreateProductReviewStepInput, { container }) => {
    const reviewService: ProductReviewModuleService =
      container.resolve(PRODUCT_REVIEW_MODULE)
    const review = await reviewService.createProductReviews({
      ...input,
      status: "pending",
    })
    return new StepResponse(review, review.id)
  },
  async (reviewId, { container }) => {
    if (!reviewId) {
      return
    }
    const reviewService: ProductReviewModuleService =
      container.resolve(PRODUCT_REVIEW_MODULE)
    await reviewService.deleteProductReviews(reviewId)
  }
)
