import { timingSafeEqual } from "node:crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createOrderShipmentWorkflow,
  updateFulfillmentWorkflow,
  markOrderFulfillmentAsDeliveredWorkflow,
} from "@medusajs/medusa/core-flows"
import type { ShiprocketFulfillmentData } from "../../../modules/shiprocket/service"

/**
 * POST /hooks/courier-tracking
 *
 * Shiprocket tracking webhook. (Shiprocket rejects webhook URLs containing
 * "shiprocket", "kartrocket", "sr" or "kr", hence the neutral path.)
 * Authenticated by the `x-api-key` security token configured in
 * Shiprocket > Settings > API > Webhooks.
 *
 * Idempotent: repeated or out-of-order events never ship/deliver twice.
 */

type TrackingEvent = {
  awb?: string
  order_id?: string
  current_status?: string
  shipment_status?: string
  current_timestamp?: string
}

const SHIPPED_STATUSES = new Set([
  "PICKED UP",
  "SHIPPED",
  "IN TRANSIT",
  "OUT FOR DELIVERY",
  "REACHED AT DESTINATION HUB",
])

function tokenMatches(received: unknown, expected: string): boolean {
  if (typeof received !== "string") {
    return false
  }
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const expected = process.env.SHIPROCKET_WEBHOOK_TOKEN

  if (!expected || !tokenMatches(req.headers["x-api-key"], expected)) {
    res.sendStatus(401)
    return
  }

  const event = (req.body ?? {}) as TrackingEvent
  const status = (event.current_status ?? event.shipment_status ?? "")
    .toUpperCase()
    .trim()

  // Always acknowledge with 200 so Shiprocket does not disable the hook;
  // processing errors are logged for follow-up.
  try {
    await processEvent(req, event, status)
  } catch (e) {
    logger.error(
      `courier-tracking: failed for AWB ${event.awb}: ${(e as Error).message}`
    )
  }
  res.sendStatus(200)
}

async function processEvent(
  req: MedusaRequest,
  event: TrackingEvent,
  status: string
) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  if (!event.awb || !status) {
    return
  }

  // Our Shiprocket order_id is "<display_id>-<fulfillment_id>".
  const fulfillmentId = event.order_id?.match(/ful_[A-Z0-9]+/)?.[0]
  const filters = fulfillmentId
    ? { id: fulfillmentId }
    : { labels: { tracking_number: event.awb } }

  const { data: fulfillments } = await query.graph({
    entity: "fulfillment",
    fields: [
      "id",
      "data",
      "shipped_at",
      "delivered_at",
      "canceled_at",
      "items.line_item_id",
      "items.quantity",
      "labels.tracking_number",
      "labels.tracking_url",
      "labels.label_url",
      "order.id",
    ],
    filters,
  })
  const fulfillment = fulfillments[0]
  if (!fulfillment) {
    logger.warn(`courier-tracking: no fulfillment for AWB ${event.awb}`)
    return
  }

  const data = (fulfillment.data ?? {}) as ShiprocketFulfillmentData
  if (data.last_status !== status) {
    await updateFulfillmentWorkflow(req.scope).run({
      input: {
        id: fulfillment.id,
        data: {
          ...data,
          last_status: status,
          last_status_at: event.current_timestamp,
        },
      },
    })
  }

  const orderId = fulfillment.order?.id
  if (!orderId || fulfillment.canceled_at || fulfillment.delivered_at) {
    return
  }

  const isDelivered = status === "DELIVERED"
  if ((isDelivered || SHIPPED_STATUSES.has(status)) && !fulfillment.shipped_at) {
    await createOrderShipmentWorkflow(req.scope).run({
      input: {
        order_id: orderId,
        fulfillment_id: fulfillment.id,
        items: (fulfillment.items ?? []).map((i) => ({
          id: i.line_item_id!,
          quantity: Number(i.quantity),
        })),
        labels: (fulfillment.labels ?? []).map((l) => ({
          tracking_number: l.tracking_number,
          tracking_url: l.tracking_url,
          label_url: l.label_url,
        })),
      },
    })
  }

  if (isDelivered) {
    await markOrderFulfillmentAsDeliveredWorkflow(req.scope).run({
      input: { orderId, fulfillmentId: fulfillment.id },
    })
    return
  }

  if (status.startsWith("RTO") || status.includes("UNDELIVERED") || status === "LOST") {
    // Needs a human decision (reattempt, refund, restock). See SHIPPING_SETUP.md.
    logger.warn(
      `courier-tracking: order ${orderId} AWB ${event.awb} needs attention: ${status}`
    )
  }
}
