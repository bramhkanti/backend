import {
  ContainerRegistrationKeys,
  MedusaError,
  ProductStatus,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PRODUCT_REVIEW_MODULE } from "../../modules/product-review"
import type ProductReviewModuleService from "../../modules/product-review/service"

export type PrepareProductReviewInput = {
  product_id: string
  customer_id: string
  rating: number
  title?: string
  body: string
  display_name?: string
}

// Orders in these states don't make a purchase "verified".
const NOT_PURCHASED_STATUSES = new Set(["canceled", "draft"])

function nameFromProfile(first?: string | null, last?: string | null): string {
  const firstName = first?.trim()
  const lastInitial = last?.trim().charAt(0)
  if (firstName) {
    return lastInitial ? `${firstName} ${lastInitial.toUpperCase()}.` : firstName
  }
  return "Bramhkanti customer"
}

/**
 * Checks that the product is published and not yet reviewed by this customer,
 * then works out the public display name and whether the customer bought it.
 */
export const prepareProductReviewStep = createStep(
  "prepare-product-review",
  async (input: PrepareProductReviewInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const reviewService: ProductReviewModuleService =
      container.resolve(PRODUCT_REVIEW_MODULE)

    const {
      data: [product],
    } = await query.graph({
      entity: "product",
      fields: ["id", "status"],
      filters: { id: input.product_id },
    })
    if (!product || product.status !== ProductStatus.PUBLISHED) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Product not found")
    }

    const [existing] = await reviewService.listProductReviews(
      { product_id: input.product_id, customer_id: input.customer_id },
      { take: 1, select: ["id"] }
    )
    if (existing) {
      throw new MedusaError(
        MedusaError.Types.DUPLICATE_ERROR,
        "You have already reviewed this product"
      )
    }

    const {
      data: [customer],
    } = await query.graph({
      entity: "customer",
      fields: ["id", "first_name", "last_name"],
      filters: { id: input.customer_id },
    })

    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "status", "items.product_id"],
      filters: { customer_id: input.customer_id },
    })
    const verifiedPurchase = orders.some(
      (order) =>
        !NOT_PURCHASED_STATUSES.has(String(order.status)) &&
        (order.items ?? []).some((item) => item?.product_id === input.product_id)
    )

    return new StepResponse({
      product_id: input.product_id,
      customer_id: input.customer_id,
      rating: input.rating,
      title: input.title?.trim() || null,
      body: input.body.trim(),
      display_name:
        input.display_name?.trim() ||
        nameFromProfile(customer?.first_name, customer?.last_name),
      verified_purchase: verifiedPurchase,
    })
  }
)
