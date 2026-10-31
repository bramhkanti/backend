import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { PRODUCT_REVIEW_MODULE } from "../../../../../modules/product-review"
import type ProductReviewModuleService from "../../../../../modules/product-review/service"

const ListReviewsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).default(0),
})

// Only public fields: never the customer id.
const PUBLIC_FIELDS = [
  "id",
  "display_name",
  "rating",
  "title",
  "body",
  "verified_purchase",
  "created_at",
]

/**
 * GET /store/products/:id/reviews
 * Approved reviews of a product, newest first, with the rating summary.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const parsed = ListReviewsQuery.safeParse(req.query)
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid limit or offset")
  }
  const { limit, offset } = parsed.data
  const productId = req.params.id

  const reviewService: ProductReviewModuleService =
    req.scope.resolve(PRODUCT_REVIEW_MODULE)

  const [[reviews, count], summaries] = await Promise.all([
    reviewService.listAndCountProductReviews(
      { product_id: productId, status: "approved" },
      { select: PUBLIC_FIELDS, order: { created_at: "DESC" }, take: limit, skip: offset }
    ),
    reviewService.summarizeRatings([productId]),
  ])

  res.json({ reviews, count, limit, offset, summary: summaries[productId] })
}
