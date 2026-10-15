# Mobile OTP Login

Customers log in with their mobile number and a 6-digit code sent by SMS.
There are no passwords. The first login creates the account.

Code: `apps/backend/src/modules/phone-auth/` (Medusa auth provider `phone-otp`),
`src/api/store/phone-auth/customer/route.ts`, `src/workflows/register-phone-customer.ts`.

## Flow

```
1. POST /auth/customer/phone-otp            { "phone": "9876543210" }
   → 200 { "location": "otp_sent" }           (SMS sent; nothing else returned)

2. POST /auth/customer/phone-otp/callback   { "phone": "9876543210", "otp": "123456" }
   → 200 { "token": "<jwt>" }

   Existing customer: the token is a normal customer token. Done.
   New number: the token is a *registration* token (no customer yet), go to step 3.

3. POST /store/phone-auth/customer          Authorization: Bearer <registration token>
   { "first_name": "Asha", "last_name": "Verma" }    (all optional; email optional too)
   → 201 { "customer": { ... } }

4. POST /auth/token/refresh                 Authorization: Bearer <registration token>
   → 200 { "token": "<customer token>" }
```

Then use `Authorization: Bearer <customer token>` with `/store/customers/me`, addresses,
orders and `/store/carts/:id/customer` (attach the guest cart), like any Medusa login.

How to tell a registration token from a customer token: decode the JWT payload. If
`actor_id` is empty, the number isn't registered yet. The storefront does this in
`MedusaAdapter.verifyOtp`.

Phone formats accepted: `9876543210`, `09876543210`, `919876543210`, `+91 98765-43210`.
Only Indian mobile numbers (starting 6–9). They are stored as `+919876543210`.

## Security rules built in

| Rule | Default | Env |
|---|---|---|
| OTP valid for | 5 minutes | `OTP_EXPIRY_MINUTES` |
| Wait before resend | 30 s | `OTP_RESEND_COOLDOWN_SECONDS` |
| Max OTPs per number per hour | 5 | `OTP_MAX_SENDS_PER_HOUR` |
| Wrong attempts before the code is burnt | 5 | `OTP_MAX_VERIFY_ATTEMPTS` |

- Codes are stored only as a SHA-256 hash (salted with `OTP_HASH_SECRET`, falling back to
  `JWT_SECRET`), compared in constant time, and deleted after one successful use.
- The phone for a new account comes from the verified identity, never from the request body.
- Not included: per-IP rate limiting. Put the API behind Cloudflare/Nginx rate limits for
  `/auth/customer/phone-otp` before a public launch.

## SMS providers: switch with one env variable

`apps/backend/.env`:

```bash
SMS_PROVIDER=test        # test | msg91 | fast2sms | twilio
OTP_TEST_MODE=true       # see below
OTP_TEST_CODE=123456
```

| Provider | Env | Notes |
|---|---|---|
| `msg91` | `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` | Uses the OTP API with our own code. Template must be DLT-approved and contain the OTP variable. |
| `fast2sms` | `FAST2SMS_API_KEY`, optional `FAST2SMS_SENDER_ID` + `FAST2SMS_TEMPLATE_ID` | With sender id + template it uses the DLT route; otherwise the OTP route. |
| `twilio` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID` | International pricing; Indian delivery still needs DLT registration. |

Adding another provider is one class in `src/modules/phone-auth/sms.ts` plus one `case`
in `createSmsSender`.

> **Not verified:** none of the three real providers were called. There were no
> accounts or keys. The request formats follow each provider's public docs. Send one
> real OTP to your own phone after configuring a provider.

India requires DLT registration (sender id + approved template) for SMS. Your SMS
provider helps with this. It can take a few days.

## Test mode

`OTP_TEST_MODE=true`:
- no SMS is sent (the log shows `OTP TEST MODE: no SMS sent to +9198*****`),
- **`OTP_TEST_CODE` logs in to any number.**

It defaults to **on** while `SMS_PROVIDER` is empty or `test`, so the site can be deployed and
tested before an SMS account exists. The server logs a warning at startup while it is on.

**Before real customers use the site:** set a real `SMS_PROVIDER` and `OTP_TEST_MODE=false`,
then restart. Anyone who knows the test code can log in as any customer while test mode is on.

## What was verified locally (2026-10-15, test mode)

- Send OTP → `200 {location: "otp_sent"}`; resend within 30 s → 401 "Please wait 30s…";
  invalid number → 401.
- Wrong code → 401; right code → token; same code again → 401 (one-time).
- New number: registration token → `/store/phone-auth/customer` 201 → refresh → `/store/customers/me` 200.
- Second registration with the old token → 400 "Already registered".
- Logging in again with the same number returns the same customer.
- Through the storefront: login modal, account page, saved address, order history.
