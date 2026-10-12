import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getShiprocketClient } from "../../../../modules/shiprocket/client"

/**
 * GET /store/shipping/serviceability?postcode=302001&weight_kg=0.5
 *
 * Checks whether couriers deliver from the pickup pincode to the customer's
 * pincode. Informational only: shipping fees charged at checkout are the
 * flat shipping option prices set in the admin.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const postcode = String(req.query.postcode ?? "")
  const weightKg = Number(req.query.weight_kg ?? 0.5)

  if (!/^[1-9]\d{5}$/.test(postcode)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "postcode must be a 6-digit Indian pincode"
    )
  }
  if (!(weightKg > 0 && weightKg <= 50)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "weight_kg must be between 0 and 50"
    )
  }

  const client = getShiprocketClient()
  const pickupPostcode = process.env.SHIPROCKET_PICKUP_POSTCODE
  if (!client || !pickupPostcode) {
    res.status(503).json({
      type: "not_configured",
      message: "Delivery check is not available yet",
    })
    return
  }

  const result = await client.serviceability({
    pickup_postcode: pickupPostcode,
    delivery_postcode: postcode,
    weight: weightKg,
    cod: 0,
  })
  const couriers = result.data?.available_courier_companies ?? []

  res.json({
    postcode,
    serviceable: couriers.length > 0,
    // Fastest estimate only; courier rates are internal and not exposed.
    estimated_delivery_days: couriers.length
      ? Math.min(...couriers.map((c) => Number(c.estimated_delivery_days) || Infinity))
      : null,
  })
}
