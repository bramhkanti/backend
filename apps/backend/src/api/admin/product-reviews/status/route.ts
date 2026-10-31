import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { REVIEW_STATUSES } from "../../../../modules/product-review/models/product-review"
import { updateProductReviewStatusWorkflow } from "../../../../workflows/update-product-review-status"

export const UpdateReviewStatusSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  status: z.enum(REVIEW_STATUSES),
})

type UpdateReviewStatusBody = z.infer<typeof UpdateReviewStatusSchema>

/**
 * POST /admin/product-reviews/status
 * Approve, reject or reset reviews to pending.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<UpdateReviewStatusBody>,
  res: MedusaResponse
) {
  const { result } = await updateProductReviewStatusWorkflow(req.scope).run({
    input: req.validatedBody,
  })
  res.json({ reviews: result })
}
