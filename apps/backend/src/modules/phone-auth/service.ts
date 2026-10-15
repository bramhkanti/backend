import { createHash, randomInt, timingSafeEqual } from "crypto"
import {
  AbstractAuthModuleProvider,
  MedusaError,
} from "@medusajs/framework/utils"
import type {
  AuthenticationInput,
  AuthenticationResponse,
  AuthIdentityDTO,
  AuthIdentityProviderService,
  Logger,
} from "@medusajs/framework/types"
import { createSmsSender, type SmsOptions, type SmsSender } from "./sms"

export type PhoneAuthOptions = SmsOptions & {
  /** When true no SMS is sent and `test_code` is the only valid OTP. */
  test_mode: boolean
  test_code: string
  /** Mixed into the stored OTP hash so a DB leak doesn't reveal codes. */
  hash_secret: string
  resend_cooldown_seconds: number
  max_sends_per_hour: number
  max_verify_attempts: number
}

type OtpState = {
  otp_hash?: string | null
  otp_expires_at?: number | null
  attempts?: number
  last_sent_at?: number
  window_started_at?: number
  sends_in_window?: number
}

const HOUR_MS = 60 * 60 * 1000

/**
 * Indian mobile numbers only: accepts 9876543210, 09876543210, 919876543210
 * or +91 98765-43210 and returns +919876543210.
 */
export function normalizeIndianPhone(input: unknown): string | null {
  if (typeof input !== "string") {
    return null
  }
  const digits = input.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "")
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null
}

/**
 * Passwordless login with a one-time code sent by SMS.
 *
 * 1. POST /auth/customer/phone-otp           { phone }       -> sends the OTP
 * 2. POST /auth/customer/phone-otp/callback  { phone, otp }  -> returns a JWT
 *
 * The auth identity's entity_id is the E.164 phone number. A first-time
 * phone gets a registration token; the storefront then calls
 * POST /store/phone-auth/customer to create the customer.
 */
class PhoneOtpAuthService extends AbstractAuthModuleProvider {
  static identifier = "phone-otp"
  static DISPLAY_NAME = "Phone OTP"

  protected readonly options_: PhoneAuthOptions
  protected readonly logger_: Logger
  protected readonly sms_: SmsSender

  static validateOptions(options: Record<string, unknown>) {
    if (!options.hash_secret) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "phone-otp: hash_secret is required"
      )
    }
    if (options.test_mode && !/^\d{6}$/.test(String(options.test_code ?? ""))) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "phone-otp: OTP_TEST_CODE must be 6 digits"
      )
    }
  }

  constructor({ logger }: { logger: Logger }, options: PhoneAuthOptions) {
    // @ts-ignore - AbstractAuthModuleProvider's constructor signature
    super(...arguments)
    this.options_ = options
    this.logger_ = logger
    this.sms_ = options.test_mode
      ? createSmsSender({ ...options, provider: "test" }, logger)
      : createSmsSender(options, logger)
    if (options.test_mode) {
      this.logger_.warn(
        "[phone-auth] OTP_TEST_MODE is ON: SMS is not sent and anyone can log in to any number with the test code. Turn it off before real customers use the site."
      )
    }
  }

  private hash_(phone: string, otp: string): string {
    return createHash("sha256")
      .update(`${phone}:${otp}:${this.options_.hash_secret}`)
      .digest("hex")
  }

  private state_(identity: AuthIdentityDTO): OtpState {
    const providerIdentity = identity.provider_identities?.find(
      (pi) => pi.provider === this.provider
    )
    return (providerIdentity?.provider_metadata ?? {}) as OtpState
  }

  private async findIdentity_(
    phone: string,
    service: AuthIdentityProviderService
  ): Promise<AuthIdentityDTO | null> {
    try {
      return await service.retrieve({ entity_id: phone })
    } catch (error) {
      if ((error as MedusaError).type === MedusaError.Types.NOT_FOUND) {
        return null
      }
      throw error
    }
  }

  /** Step 1: generate and send an OTP. */
  async authenticate(
    data: AuthenticationInput,
    service: AuthIdentityProviderService
  ): Promise<AuthenticationResponse> {
    const phone = normalizeIndianPhone(data.body?.phone)
    if (!phone) {
      return { success: false, error: "Enter a valid 10-digit Indian mobile number" }
    }

    const now = Date.now()
    const existing = await this.findIdentity_(phone, service)
    const state = existing ? this.state_(existing) : {}

    const cooldownMs = this.options_.resend_cooldown_seconds * 1000
    if (state.last_sent_at && now - state.last_sent_at < cooldownMs) {
      const wait = Math.ceil((cooldownMs - (now - state.last_sent_at)) / 1000)
      return { success: false, error: `Please wait ${wait}s before requesting another OTP` }
    }

    const windowFresh =
      state.window_started_at && now - state.window_started_at < HOUR_MS
    const sendsInWindow = windowFresh ? state.sends_in_window ?? 0 : 0
    if (sendsInWindow >= this.options_.max_sends_per_hour) {
      return { success: false, error: "Too many OTP requests. Try again in an hour." }
    }

    const otp = this.options_.test_mode
      ? this.options_.test_code
      : String(randomInt(0, 1_000_000)).padStart(6, "0")

    const next: OtpState = {
      ...state,
      otp_hash: this.hash_(phone, otp),
      otp_expires_at: now + this.options_.otp_expiry_minutes * 60 * 1000,
      attempts: 0,
      last_sent_at: now,
      window_started_at: windowFresh ? state.window_started_at : now,
      sends_in_window: sendsInWindow + 1,
    }

    // Send first so a failed SMS doesn't start the cooldown.
    try {
      await this.sms_.sendOtp(phone, otp)
    } catch (error) {
      this.logger_.error(
        `[phone-auth] ${this.sms_.name} failed to send OTP: ${(error as Error).message}`
      )
      return { success: false, error: "Could not send the OTP right now. Please try again." }
    }

    if (existing) {
      await service.update(phone, { provider_metadata: next })
    } else {
      await service.create({ entity_id: phone, provider_metadata: next })
    }

    // `location` makes Medusa's auth route answer 200 { location } without a token.
    return { success: true, location: "otp_sent" }
  }

  /** Step 2: verify the OTP and hand the identity to Medusa for a JWT. */
  async validateCallback(
    data: AuthenticationInput,
    service: AuthIdentityProviderService
  ): Promise<AuthenticationResponse> {
    const invalid = { success: false, error: "Incorrect or expired OTP" }
    const phone = normalizeIndianPhone(data.body?.phone ?? data.query?.phone)
    const otp = String(data.body?.otp ?? data.query?.otp ?? "")
    if (!phone || !/^\d{6}$/.test(otp)) {
      return invalid
    }

    const identity = await this.findIdentity_(phone, service)
    if (!identity) {
      return invalid
    }
    const state = this.state_(identity)
    if (!state.otp_hash || !state.otp_expires_at || Date.now() > state.otp_expires_at) {
      return { success: false, error: "OTP expired. Please request a new one." }
    }

    const attempts = (state.attempts ?? 0) + 1
    if (attempts > this.options_.max_verify_attempts) {
      await service.update(phone, {
        provider_metadata: { ...state, otp_hash: null, otp_expires_at: null },
      })
      return { success: false, error: "Too many wrong attempts. Please request a new OTP." }
    }

    const expected = Buffer.from(state.otp_hash, "hex")
    const actual = Buffer.from(this.hash_(phone, otp), "hex")
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await service.update(phone, { provider_metadata: { ...state, attempts } })
      return invalid
    }

    // One-time: clear the code so it can't be replayed.
    const updated = await service.update(phone, {
      provider_metadata: { ...state, otp_hash: null, otp_expires_at: null, attempts: 0 },
    })
    return { success: true, authIdentity: updated }
  }

  async register(): Promise<AuthenticationResponse> {
    return {
      success: false,
      error: "Use POST /auth/customer/phone-otp to request an OTP; new numbers are registered automatically",
    }
  }
}

export default PhoneOtpAuthService
