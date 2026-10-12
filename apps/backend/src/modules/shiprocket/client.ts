import { MedusaError } from "@medusajs/framework/utils"

/**
 * Minimal Shiprocket REST client.
 * Endpoints verified against the official collection at
 * https://apidocs.shiprocket.in (checked 2026-10-12).
 */
const BASE_URL = "https://apiv2.shiprocket.in/v1/external"

// Tokens are valid for 10 days; refresh well before that.
const TOKEN_TTL_MS = 9 * 24 * 60 * 60 * 1000

export type ShiprocketCredentials = {
  email: string
  password: string
}

export class ShiprocketClient {
  private token_?: string
  private tokenExpiresAt_ = 0

  constructor(private readonly credentials_: ShiprocketCredentials) {}

  private async getToken(): Promise<string> {
    if (this.token_ && Date.now() < this.tokenExpiresAt_) {
      return this.token_
    }
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.credentials_),
    })
    const body = (await res.json()) as { token?: string; message?: string }
    if (!res.ok || !body.token) {
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        `Shiprocket login failed: ${body.message ?? res.status}`
      )
    }
    this.token_ = body.token
    this.tokenExpiresAt_ = Date.now() + TOKEN_TTL_MS
    return body.token
  }

  async request<T = Record<string, unknown>>(
    method: "GET" | "POST",
    path: string,
    payload?: Record<string, unknown>
  ): Promise<T> {
    const token = await this.getToken()
    let url = `${BASE_URL}${path}`
    if (method === "GET" && payload) {
      url += `?${new URLSearchParams(
        Object.entries(payload).map(([k, v]) => [k, String(v)])
      )}`
    }
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: method === "POST" ? JSON.stringify(payload ?? {}) : undefined,
    })
    if (res.status === 401) {
      this.token_ = undefined
    }
    const body = (await res.json().catch(() => ({}))) as T & {
      message?: string
    }
    if (!res.ok) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Shiprocket ${method} ${path} failed (${res.status}): ${
          body.message ?? JSON.stringify(body)
        }`
      )
    }
    return body
  }

  createAdhocOrder(payload: Record<string, unknown>) {
    return this.request<{
      order_id: number
      shipment_id: number
      status: string
    }>("POST", "/orders/create/adhoc", payload)
  }

  assignAwb(shipmentId: number, courierId?: number) {
    return this.request<{
      awb_assign_status: number
      response?: { data?: { awb_code?: string; courier_name?: string } }
    }>("POST", "/courier/assign/awb", {
      shipment_id: shipmentId,
      ...(courierId ? { courier_id: courierId } : {}),
    })
  }

  generateLabel(shipmentId: number) {
    return this.request<{ label_created: number; label_url?: string }>(
      "POST",
      "/courier/generate/label",
      { shipment_id: [shipmentId] }
    )
  }

  generatePickup(shipmentId: number) {
    return this.request<Record<string, unknown>>(
      "POST",
      "/courier/generate/pickup",
      { shipment_id: [shipmentId] }
    )
  }

  cancelOrders(orderIds: number[]) {
    return this.request("POST", "/orders/cancel", { ids: orderIds })
  }

  serviceability(params: {
    pickup_postcode: string
    delivery_postcode: string
    weight: number
    cod: 0 | 1
  }) {
    return this.request<{
      data?: {
        available_courier_companies?: {
          courier_company_id: number
          courier_name: string
          etd: string
          estimated_delivery_days: string
          rate: number
        }[]
      }
    }>("GET", "/courier/serviceability/", params)
  }

  trackAwb(awb: string) {
    return this.request("GET", `/courier/track/awb/${encodeURIComponent(awb)}`)
  }
}

let sharedClient: ShiprocketClient | undefined

/**
 * Client for API routes (serviceability, pickup). Returns undefined when
 * Shiprocket credentials are not configured.
 */
export function getShiprocketClient(): ShiprocketClient | undefined {
  const email = process.env.SHIPROCKET_EMAIL
  const password = process.env.SHIPROCKET_PASSWORD
  if (!email || !password) {
    return undefined
  }
  sharedClient ??= new ShiprocketClient({ email, password })
  return sharedClient
}
