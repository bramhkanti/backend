import Razorpay from "razorpay"
import { validateWebhookSignature } from "razorpay/dist/utils/razorpay-utils"
import {
  AbstractPaymentProvider,
  BigNumber,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  Logger,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"

type Options = {
  key_id: string
  key_secret: string
  webhook_secret?: string
}

type InjectedDependencies = {
  logger: Logger
}

type RazorpayPaymentEntity = {
  id: string
  order_id: string
  amount: number | string
  currency: string
  status: "created" | "authorized" | "captured" | "refunded" | "failed"
  notes?: Record<string, string> | unknown[]
}

/**
 * Data stored on the Medusa payment session. Only non-secret values:
 * the storefront reads `razorpay_order_id` and `key_id` from it to open
 * Razorpay Checkout.
 */
type SessionData = {
  razorpay_order_id?: string
  razorpay_payment_id?: string
  amount?: number
  currency?: string
  key_id?: string
  session_id?: string
}

/** Razorpay amounts are integers in the smallest unit (paise for INR). */
function toSubunits(amount: unknown): number {
  return Math.round(new BigNumber(amount as number).numeric * 100)
}

function fromSubunits(amount: number | string): number {
  return Number(amount) / 100
}

/**
 * Razorpay payment provider (custom, built on the official `razorpay` SDK).
 *
 * Flow:
 * 1. initiatePayment creates a Razorpay Order; the storefront opens Razorpay
 *    Checkout with `razorpay_order_id`.
 * 2. On cart completion, authorizePayment asks the Razorpay API (server to
 *    server) whether that order has an authorized/captured payment for the
 *    exact amount. A frontend "success" callback alone never marks a payment
 *    as paid.
 * 3. Webhooks (payment.authorized / payment.captured / payment.failed /
 *    order.paid) are signature-verified and handed to Medusa's
 *    processPaymentWorkflow, which is idempotent and completes the cart if the
 *    customer closed the browser after paying.
 */
class RazorpayProviderService extends AbstractPaymentProvider<Options> {
  static identifier = "razorpay"

  protected logger_: Logger
  protected options_: Options
  protected client_: Razorpay

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.key_id || !options.key_secret) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Razorpay provider requires key_id and key_secret"
      )
    }
  }

  constructor(container: InjectedDependencies, options: Options) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = options
    this.client_ = new Razorpay({
      key_id: options.key_id,
      key_secret: options.key_secret,
    })

    if (!options.webhook_secret) {
      this.logger_.warn(
        "Razorpay: RAZORPAY_WEBHOOK_SECRET is not set, webhooks will be rejected"
      )
    }
  }

  private async createOrder(
    amount: unknown,
    currencyCode: string,
    sessionId?: string
  ): Promise<SessionData> {
    const order = await this.client_.orders.create({
      amount: toSubunits(amount),
      currency: currencyCode.toUpperCase(),
      // Razorpay limits receipt to 40 chars
      receipt: (sessionId ?? `medusa_${Date.now()}`).slice(0, 40),
      notes: sessionId ? { session_id: sessionId } : undefined,
    })

    return {
      razorpay_order_id: order.id,
      amount: Number(order.amount),
      currency: order.currency,
      key_id: this.options_.key_id,
      session_id: sessionId,
    }
  }

  /**
   * Returns the most relevant payment for a Razorpay order, verified against
   * the expected amount. Captured wins over authorized.
   */
  private async findPaidPayment(
    orderId: string,
    expectedSubunits?: number
  ): Promise<RazorpayPaymentEntity | undefined> {
    const { items } = await this.client_.orders.fetchPayments(orderId)
    const payments = (items as RazorpayPaymentEntity[]).filter(
      (p) =>
        expectedSubunits === undefined ||
        Number(p.amount) === expectedSubunits
    )
    return (
      payments.find((p) => p.status === "captured") ??
      payments.find((p) => p.status === "authorized")
    )
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const sessionId = input.data?.session_id as string | undefined
    const data = await this.createOrder(
      input.amount,
      input.currency_code,
      sessionId
    )
    return { id: data.razorpay_order_id!, data }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    // Razorpay orders are immutable; a changed amount needs a new order.
    if (data.amount === toSubunits(input.amount) && data.razorpay_order_id) {
      return { data }
    }
    return {
      data: await this.createOrder(
        input.amount,
        input.currency_code,
        data.session_id
      ),
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    if (!data.razorpay_order_id) {
      return { status: PaymentSessionStatus.ERROR, data }
    }

    const payment = await this.findPaidPayment(
      data.razorpay_order_id,
      data.amount
    )

    if (!payment) {
      // Customer has not paid (or payment failed); keep the cart open.
      return { status: PaymentSessionStatus.PENDING, data }
    }

    return {
      status:
        payment.status === "captured"
          ? PaymentSessionStatus.CAPTURED
          : PaymentSessionStatus.AUTHORIZED,
      data: { ...data, razorpay_payment_id: payment.id },
    }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    if (!data.razorpay_payment_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Razorpay payment id missing on payment data"
      )
    }

    const payment = (await this.client_.payments.fetch(
      data.razorpay_payment_id
    )) as RazorpayPaymentEntity

    if (payment.status === "captured") {
      return { data }
    }

    await this.client_.payments.capture(
      payment.id,
      Number(payment.amount),
      payment.currency
    )
    return { data }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    if (!data.razorpay_payment_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Razorpay payment id missing on payment data"
      )
    }

    const refund = await this.client_.payments.refund(
      data.razorpay_payment_id,
      { amount: toSubunits(input.amount) }
    )
    return { data: { ...data, last_refund_id: refund.id } }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    // Razorpay has no API to void an authorized payment. Uncaptured
    // payments are auto-refunded by Razorpay after the capture window.
    return { data: input.data ?? {} }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const data = (input.data ?? {}) as SessionData
    if (!data.razorpay_order_id) {
      return { status: PaymentSessionStatus.PENDING, data }
    }
    const payment = await this.findPaidPayment(
      data.razorpay_order_id,
      data.amount
    )
    if (!payment) {
      return { status: PaymentSessionStatus.PENDING, data }
    }
    return {
      status:
        payment.status === "captured"
          ? PaymentSessionStatus.CAPTURED
          : PaymentSessionStatus.AUTHORIZED,
      data,
    }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    if (!data.razorpay_order_id) {
      return { data }
    }
    const order = await this.client_.orders.fetch(data.razorpay_order_id)
    return { data: { ...data, razorpay_order_status: order.status } }
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const notSupported = { action: PaymentActions.NOT_SUPPORTED }
    const signature = payload.headers["x-razorpay-signature"] as
      | string
      | undefined

    if (!this.options_.webhook_secret || !signature || !payload.rawData) {
      this.logger_.warn("Razorpay webhook rejected: missing signature/secret")
      return notSupported
    }

    let valid = false
    try {
      valid = validateWebhookSignature(
        payload.rawData.toString(),
        signature,
        this.options_.webhook_secret
      )
    } catch {
      valid = false
    }
    if (!valid) {
      this.logger_.warn("Razorpay webhook rejected: invalid signature")
      return notSupported
    }

    const event = payload.data as {
      event: string
      payload?: {
        payment?: { entity: RazorpayPaymentEntity }
        order?: { entity: { id: string; notes?: Record<string, string> } }
      }
    }

    const payment = event.payload?.payment?.entity
    if (!payment) {
      return notSupported
    }

    // session_id is stored in the Razorpay order notes at creation time.
    let sessionId =
      event.payload?.order?.entity.notes?.session_id ??
      (payment.notes as Record<string, string> | undefined)?.session_id
    if (!sessionId && payment.order_id) {
      const order = await this.client_.orders.fetch(payment.order_id)
      sessionId = (order.notes as Record<string, string> | undefined)
        ?.session_id
    }
    if (!sessionId) {
      this.logger_.warn(
        `Razorpay webhook ${event.event}: no session_id for order ${payment.order_id}`
      )
      return notSupported
    }

    const result = {
      session_id: sessionId,
      amount: new BigNumber(fromSubunits(payment.amount)),
    }

    switch (event.event) {
      case "payment.authorized":
        return { action: PaymentActions.AUTHORIZED, data: result }
      case "payment.captured":
      case "order.paid":
        return { action: PaymentActions.SUCCESSFUL, data: result }
      case "payment.failed":
        return { action: PaymentActions.FAILED, data: result }
      default:
        return notSupported
    }
  }
}

export default RazorpayProviderService
