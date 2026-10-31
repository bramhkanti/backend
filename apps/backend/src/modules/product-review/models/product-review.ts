import { model } from "@medusajs/framework/utils"

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/**
 * A customer's rating and written review of one product. New reviews start as
 * `pending` and appear on the storefront only after an admin approves them.
 */
const ProductReview = model
  .define("product_review", {
    id: model.id({ prefix: "prev" }).primaryKey(),
    product_id: model.text(),
    customer_id: model.text(),
    display_name: model.text(),
    rating: model.number(),
    title: model.text().nullable(),
    body: model.text(),
    status: model.enum([...REVIEW_STATUSES]).default("pending"),
    // The customer has an order that contains this product.
    verified_purchase: model.boolean().default(false),
  })
  .indexes([
    // One review per customer per product.
    { on: ["product_id", "customer_id"], unique: true },
    { on: ["product_id", "status"] },
    { on: ["status"] },
  ])

export default ProductReview
