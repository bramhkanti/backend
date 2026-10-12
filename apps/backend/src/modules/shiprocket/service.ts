import {
  AbstractFulfillmentProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import type {
  CreateFulfillmentResult,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
  Logger,
} from "@medusajs/framework/types"
import { ShiprocketClient } from "./client"

type Options = {
  email: string
  password: string
  /** Pickup location NAME exactly as configured in Shiprocket. */
  pickup_location: string
}

type InjectedDependencies = {
  logger: Logger
}

export type ShiprocketFulfillmentData = {
  shiprocket_order_id?: number
  shiprocket_shipment_id?: number
  awb_code?: string
  courier_name?: string
  label_url?: string
  pickup_requested_at?: string
  last_status?: string
}

/**
 * Package dimensions are required by Shiprocket and drive courier charges.
 * They come from env so the business sets real box sizes; nothing is guessed.
 */
function packageFromEnv() {
  const values = {
    length: Number(process.env.SHIPROCKET_PACKAGE_LENGTH_CM),
    breadth: Number(process.env.SHIPROCKET_PACKAGE_BREADTH_CM),
    height: Number(process.env.SHIPROCKET_PACKAGE_HEIGHT_CM),
    weight: Number(process.env.SHIPROCKET_PACKAGE_WEIGHT_KG),
  }
  if (Object.values(values).some((v) => !v || Number.isNaN(v))) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Set SHIPROCKET_PACKAGE_LENGTH_CM / BREADTH_CM / HEIGHT_CM / WEIGHT_KG before creating Shiprocket shipments"
    )
  }
  return values
}

class ShiprocketFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = "shiprocket"

  protected logger_: Logger
  protected options_: Options
  protected client_: ShiprocketClient

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.email || !options.password || !options.pickup_location) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Shiprocket provider requires email, password and pickup_location"
      )
    }
  }

  constructor(container: InjectedDependencies, options: Options) {
    super()
    this.logger_ = container.logger
    this.options_ = options
    this.client_ = new ShiprocketClient({
      email: options.email,
      password: options.password,
    })
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [{ id: "shiprocket-standard", name: "Shiprocket Standard" }]
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return { ...optionData, ...data }
  }

  async validateOption(): Promise<boolean> {
    return true
  }

  // Shipping fees are flat prices set by the business in the admin.
  async canCalculate(): Promise<boolean> {
    return false
  }

  async createFulfillment(
    _data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    const address = order?.shipping_address
    if (!order || !address?.postal_code || !address.phone) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Order needs a shipping address with postal code and phone for Shiprocket"
      )
    }

    const pkg = packageFromEnv()
    const lineItems = new Map(
      (order.items ?? []).map((li) => [li.id, li] as const)
    )
    const orderItems = items.map((item) => {
      const li = item.line_item_id ? lineItems.get(item.line_item_id) : undefined
      return {
        name: item.title,
        sku: item.sku || item.line_item_id || item.title,
        units: item.quantity,
        selling_price: Number(li?.unit_price ?? 0),
      }
    })
    const subTotal = orderItems.reduce(
      (sum, i) => sum + i.selling_price * Number(i.units),
      0
    )

    const fullName = [address.first_name, address.last_name]
      .filter(Boolean)
      .join(" ")

    // Unique per fulfillment so partial/re-fulfillments don't collide.
    const srOrderRef = `${order.display_id}-${fulfillment.id ?? Date.now()}`

    const created = await this.client_.createAdhocOrder({
      order_id: srOrderRef,
      order_date: new Date().toISOString().slice(0, 16).replace("T", " "),
      pickup_location: this.options_.pickup_location,
      billing_customer_name: address.first_name ?? fullName,
      billing_last_name: address.last_name ?? "",
      billing_address: address.address_1,
      billing_address_2: address.address_2 ?? "",
      billing_city: address.city,
      billing_pincode: address.postal_code,
      billing_state: address.province,
      billing_country: "India",
      billing_email: order.email,
      billing_phone: address.phone,
      shipping_is_billing: true,
      order_items: orderItems,
      // All Bramhkanti orders are prepaid via Razorpay (no COD).
      payment_method: "Prepaid",
      sub_total: subTotal,
      ...pkg,
    })

    const data: ShiprocketFulfillmentData = {
      shiprocket_order_id: created.order_id,
      shiprocket_shipment_id: created.shipment_id,
    }

    // AWB and label: if either fails the Shiprocket order still exists and
    // can be completed from the Shiprocket panel; we log and keep the ids.
    try {
      const awb = await this.client_.assignAwb(created.shipment_id)
      data.awb_code = awb.response?.data?.awb_code
      data.courier_name = awb.response?.data?.courier_name
      if (data.awb_code) {
        const label = await this.client_.generateLabel(created.shipment_id)
        data.label_url = label.label_url
      }
    } catch (e) {
      this.logger_.warn(
        `Shiprocket: order ${created.order_id} created but AWB/label failed: ${
          (e as Error).message
        }`
      )
    }

    return {
      data: data as Record<string, unknown>,
      labels: data.awb_code
        ? [
            {
              tracking_number: data.awb_code,
              tracking_url: `https://shiprocket.co/tracking/${data.awb_code}`,
              label_url: data.label_url ?? "",
            },
          ]
        : [],
    }
  }

  async cancelFulfillment(data: Record<string, unknown>): Promise<unknown> {
    const { shiprocket_order_id } = data as ShiprocketFulfillmentData
    if (shiprocket_order_id) {
      await this.client_.cancelOrders([shiprocket_order_id])
    }
    return {}
  }

  async createReturnFulfillment(): Promise<CreateFulfillmentResult> {
    // Returns are handled manually in the Shiprocket panel for now.
    // See SHIPPING_SETUP.md.
    return { data: {}, labels: [] }
  }
}

export default ShiprocketFulfillmentProviderService
