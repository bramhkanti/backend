import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PRODUCT_REVIEW_MODULE } from "../../../modules/product-review"
import type ProductReviewModuleService from "../../../modules/product-review/service"

const MAX_PRODUCTS = 100

/**
 * GET /store/review-summaries?product_ids=prod_1,prod_2
 * Average rating and review count per product, for product cards.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const raw = req.query.product_ids
  const productIds = [
    ...new Set(
      (Array.isArray(raw) ? raw : [raw])
        .flatMap((value) => String(value ?? "").split(","))
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ]
  if (productIds.length > MAX_PRODUCTS) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `At most ${MAX_PRODUCTS} product ids`
    )
  }

  const reviewService: ProductReviewModuleService =
    req.scope.resolve(PRODUCT_REVIEW_MODULE)
  const summaries = await reviewService.summarizeRatings(productIds)

  res.json({ summaries })
}
