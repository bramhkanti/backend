import { MedusaError } from "@medusajs/framework/utils"

/**
 * SMS senders for login OTPs. The active one is chosen by `SMS_PROVIDER`
 * (see medusa-config.ts). Adding a provider = one class + one `case` below.
 *
 * Phone numbers arrive normalized as E.164 (`+919876543210`).
 */
export interface SmsSender {
  readonly name: string
  sendOtp(phone: string, otp: string): Promise<void>
}

export type SmsProviderName = "test" | "msg91" | "fast2sms" | "twilio"

export type SmsOptions = {
  provider: SmsProviderName
  otp_expiry_minutes: number
  msg91?: { auth_key?: string; template_id?: string }
  fast2sms?: { api_key?: string; sender_id?: string; template_id?: string }
  twilio?: {
    account_sid?: string
    auth_token?: string
    from?: string
    messaging_service_sid?: string
  }
}

type Logger = { info(msg: string): void; warn(msg: string): void }

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `SMS provider is misconfigured: ${name} is not set`
    )
  }
  return value
}

async function assertOk(res: Response, provider: string): Promise<void> {
  if (res.ok) {
    return
  }
  const text = await res.text().catch(() => "")
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    `${provider} rejected the OTP SMS (${res.status}): ${text.slice(0, 300)}`
  )
}

/** Sends nothing. The OTP is the fixed test code; only the fact it was requested is logged. */
class TestSmsSender implements SmsSender {
  readonly name = "test"
  constructor(private readonly logger_: Logger) {}

  async sendOtp(phone: string): Promise<void> {
    this.logger_.warn(
      `[phone-auth] OTP TEST MODE: no SMS sent to ${phone.slice(0, 5)}*****. Use the configured test code.`
    )
  }
}

/** MSG91 OTP API: https://docs.msg91.com/otp/sendotp (DLT-approved template required). */
class Msg91SmsSender implements SmsSender {
  readonly name = "msg91"
  constructor(
    private readonly config_: NonNullable<SmsOptions["msg91"]>,
    private readonly expiryMinutes_: number
  ) {}

  async sendOtp(phone: string, otp: string): Promise<void> {
    const params = new URLSearchParams({
      template_id: required(this.config_.template_id, "MSG91_TEMPLATE_ID"),
      mobile: phone.replace(/^\+/, ""),
      otp,
      otp_expiry: String(this.expiryMinutes_),
    })
    const res = await fetch(`https://control.msg91.com/api/v5/otp?${params}`, {
      method: "POST",
      headers: {
        authkey: required(this.config_.auth_key, "MSG91_AUTH_KEY"),
        "Content-Type": "application/json",
      },
    })
    await assertOk(res, "MSG91")
    const body = (await res.json().catch(() => ({}))) as { type?: string; message?: string }
    if (body.type === "error") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `MSG91 rejected the OTP SMS: ${body.message ?? "unknown error"}`
      )
    }
  }
}

/**
 * Fast2SMS: https://docs.fast2sms.com. Uses the DLT route when a sender id and
 * DLT template id are configured, otherwise the built-in OTP route.
 */
class Fast2SmsSender implements SmsSender {
  readonly name = "fast2sms"
  constructor(private readonly config_: NonNullable<SmsOptions["fast2sms"]>) {}

  async sendOtp(phone: string, otp: string): Promise<void> {
    const useDlt = Boolean(this.config_.sender_id && this.config_.template_id)
    const payload: Record<string, string> = {
      route: useDlt ? "dlt" : "otp",
      variables_values: otp,
      numbers: phone.replace(/^\+91/, ""),
      flash: "0",
    }
    if (useDlt) {
      payload.sender_id = this.config_.sender_id!
      payload.message = this.config_.template_id!
    }
    const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: {
        authorization: required(this.config_.api_key, "FAST2SMS_API_KEY"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
    await assertOk(res, "Fast2SMS")
    const body = (await res.json().catch(() => ({}))) as { return?: boolean; message?: unknown }
    if (body.return === false) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Fast2SMS rejected the OTP SMS: ${JSON.stringify(body.message)}`
      )
    }
  }
}

/** Twilio Messages API: https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource */
class TwilioSmsSender implements SmsSender {
  readonly name = "twilio"
  constructor(
    private readonly config_: NonNullable<SmsOptions["twilio"]>,
    private readonly expiryMinutes_: number
  ) {}

  async sendOtp(phone: string, otp: string): Promise<void> {
    const sid = required(this.config_.account_sid, "TWILIO_ACCOUNT_SID")
    const token = required(this.config_.auth_token, "TWILIO_AUTH_TOKEN")
    const form = new URLSearchParams({
      To: phone,
      Body: `${otp} is your Bramhkanti login code. It expires in ${this.expiryMinutes_} minutes. Do not share it with anyone.`,
    })
    if (this.config_.messaging_service_sid) {
      form.set("MessagingServiceSid", this.config_.messaging_service_sid)
    } else {
      form.set("From", required(this.config_.from, "TWILIO_FROM"))
    }
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      }
    )
    await assertOk(res, "Twilio")
  }
}

export function createSmsSender(options: SmsOptions, logger: Logger): SmsSender {
  switch (options.provider) {
    case "test":
      return new TestSmsSender(logger)
    case "msg91":
      return new Msg91SmsSender(options.msg91 ?? {}, options.otp_expiry_minutes)
    case "fast2sms":
      return new Fast2SmsSender(options.fast2sms ?? {})
    case "twilio":
      return new TwilioSmsSender(options.twilio ?? {}, options.otp_expiry_minutes)
    default:
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unknown SMS_PROVIDER "${String(options.provider)}". Use test, msg91, fast2sms or twilio.`
      )
  }
}
