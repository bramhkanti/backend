import { MedusaService } from "@medusajs/framework/utils"
import ProductReview from "./models/product-review"

export type RatingSummary = {
  average: number
  count: number
  // Number of approved reviews per star, keys "1" to "5".
  distribution: Record<string, number>
}

function emptySummary(): RatingSummary {
  return {
    average: 0,
    count: 0,
    distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
  }
}

class ProductReviewModuleService extends MedusaService({ ProductReview }) {
  /**
   * Rating summaries of approved reviews, keyed by product id. Products
   * without approved reviews get an empty summary.
   */
  async summarizeRatings(
    productIds: string[]
  ): Promise<Record<string, RatingSummary>> {
    const summaries: Record<string, RatingSummary> = {}
    for (const id of productIds) {
      summaries[id] = emptySummary()
    }
    if (!productIds.length) {
      return summaries
    }

    const reviews = await this.listProductReviews(
      { product_id: productIds, status: "approved" },
      { select: ["product_id", "rating"] }
    )

    const totals: Record<string, number> = {}
    for (const review of reviews) {
      const summary = summaries[review.product_id]
      if (!summary) {
        continue
      }
      summary.count += 1
      summary.distribution[String(review.rating)] =
        (summary.distribution[String(review.rating)] ?? 0) + 1
      totals[review.product_id] = (totals[review.product_id] ?? 0) + review.rating
    }

    for (const [id, summary] of Object.entries(summaries)) {
      if (summary.count) {
        summary.average = Math.round((totals[id] / summary.count) * 10) / 10
      }
    }
    return summaries
  }
}

export default ProductReviewModuleService
