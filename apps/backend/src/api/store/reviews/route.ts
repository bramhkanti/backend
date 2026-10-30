import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  ProductStatus,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { PRODUCT_REVIEW_MODULE } from "../../../modules/product-review"
import type ProductReviewModuleService from "../../../modules/product-review/service"
import { createProductReviewWorkflow } from "../../../workflows/create-product-review"

const LatestReviewsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(6),
  min_rating: z.coerce.number().int().min(1).max(5).default(1),
})

/**
 * GET /store/reviews?limit=6&min_rating=4
 * Latest approved reviews across published products, for the home page.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const parsed = LatestReviewsQuery.safeParse(req.query)
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid limit or min_rating")
  }
  const { limit, min_rating } = parsed.data

  const reviewService: ProductReviewModuleService =
    req.scope.resolve(PRODUCT_REVIEW_MODULE)
  // Over-fetch a little: reviews of unpublished products are dropped below.
  const reviews = await reviewService.listProductReviews(
    { status: "approved", rating: { $gte: min_rating } },
    {
      select: [
        "id",
        "product_id",
        "display_name",
        "rating",
        "title",
        "body",
        "verified_purchase",
        "created_at",
      ],
      order: { created_at: "DESC" },
      take: limit * 2,
    }
  )

  const productIds = [...new Set(reviews.map((review) => review.product_id))]
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = productIds.length
    ? await query.graph({
        entity: "product",
        fields: ["id", "title", "handle", "thumbnail"],
        filters: { id: productIds, status: ProductStatus.PUBLISHED },
      })
    : { data: [] }
  const productById = new Map(products.map((product) => [product.id, product]))

  res.json({
    reviews: reviews
      .filter((review) => productById.has(review.product_id))
      .slice(0, limit)
      .map(({ product_id, ...review }) => ({
        ...review,
        product: productById.get(product_id),
      })),
  })
}

export const CreateProductReviewSchema = z.object({
  product_id: z.string().trim().min(1),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(10).max(2000),
  display_name: z.string().trim().min(2).max(60).optional(),
})

type CreateProductReviewBody = z.infer<typeof CreateProductReviewSchema>

/**
 * POST /store/reviews
 * A logged-in customer reviews a product. The review waits for admin approval.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<CreateProductReviewBody>,
  res: MedusaResponse
) {
  const { result } = await createProductReviewWorkflow(req.scope).run({
    input: {
      ...req.validatedBody,
      customer_id: req.auth_context.actor_id,
    },
  })

  res.status(201).json({
    review: {
      id: result.id,
      status: result.status,
      verified_purchase: result.verified_purchase,
    },
  })
}
