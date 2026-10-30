import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { PRODUCT_REVIEW_MODULE } from "../../../modules/product-review"
import { REVIEW_STATUSES } from "../../../modules/product-review/models/product-review"
import type ProductReviewModuleService from "../../../modules/product-review/service"

const AdminListReviewsQuery = z.object({
  status: z.enum(REVIEW_STATUSES).optional(),
  product_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

/**
 * GET /admin/product-reviews?status=pending
 * Reviews for moderation, newest first, with the product title.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = AdminListReviewsQuery.safeParse(req.query)
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid filters")
  }
  const { status, product_id, limit, offset } = parsed.data

  const reviewService: ProductReviewModuleService =
    req.scope.resolve(PRODUCT_REVIEW_MODULE)
  const [reviews, count] = await reviewService.listAndCountProductReviews(
    {
      ...(status ? { status } : {}),
      ...(product_id ? { product_id } : {}),
    },
    { order: { created_at: "DESC" }, take: limit, skip: offset }
  )

  const productIds = [...new Set(reviews.map((review) => review.product_id))]
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = productIds.length
    ? await query.graph({
        entity: "product",
        fields: ["id", "title", "handle", "thumbnail"],
        filters: { id: productIds },
      })
    : { data: [] }
  const productById = new Map(products.map((product) => [product.id, product]))

  res.json({
    reviews: reviews.map((review) => ({
      ...review,
      product: productById.get(review.product_id) ?? null,
    })),
    count,
    limit,
    offset,
  })
}
