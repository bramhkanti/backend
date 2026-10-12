import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { updateFulfillmentWorkflow } from "@medusajs/medusa/core-flows"
import { getShiprocketClient } from "../../../../../../modules/shiprocket/client"
import type { ShiprocketFulfillmentData } from "../../../../../../modules/shiprocket/service"

/**
 * POST /admin/shiprocket/fulfillments/:id/pickup
 *
 * Books a REAL courier pickup for a Shiprocket fulfillment. Admin-only,
 * explicit action: call it after the parcel is packed and labelled.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const client = getShiprocketClient()
  if (!client) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Shiprocket is not configured"
    )
  }

  const fulfillmentService = req.scope.resolve(Modules.FULFILLMENT)
  const fulfillment = await fulfillmentService.retrieveFulfillment(
    req.params.id
  )
  const data = (fulfillment.data ?? {}) as ShiprocketFulfillmentData

  if (fulfillment.provider_id !== "shiprocket_shiprocket") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Fulfillment was not created with Shiprocket"
    )
  }
  if (fulfillment.canceled_at) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Fulfillment is canceled")
  }
  if (!data.shiprocket_shipment_id || !data.awb_code) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "AWB not assigned yet; assign it in the Shiprocket panel first"
    )
  }
  if (data.pickup_requested_at) {
    // Idempotent: never book a second pickup for the same shipment.
    res.json({ already_requested: true, pickup_requested_at: data.pickup_requested_at })
    return
  }

  const response = await client.generatePickup(data.shiprocket_shipment_id)

  const pickupRequestedAt = new Date().toISOString()
  await updateFulfillmentWorkflow(req.scope).run({
    input: {
      id: fulfillment.id,
      data: { ...data, pickup_requested_at: pickupRequestedAt },
    },
  })

  res.json({ pickup_requested_at: pickupRequestedAt, shiprocket: response })
}
