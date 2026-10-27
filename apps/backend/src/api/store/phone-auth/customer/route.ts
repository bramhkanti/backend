import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { registerPhoneCustomerWorkflow } from "../../../../workflows/register-phone-customer"

export const RegisterPhoneCustomerSchema = z.object({
  first_name: z.string().trim().max(100).optional(),
  last_name: z.string().trim().max(100).optional(),
  email: z.string().trim().email().optional(),
})

type RegisterPhoneCustomerBody = z.infer<typeof RegisterPhoneCustomerSchema>

/**
 * POST /store/phone-auth/customer
 * Called once with the registration token returned by
 * /auth/customer/phone-otp/callback for a new phone number. The phone comes
 * from the verified auth identity, never from the request body.
 * Afterwards call POST /auth/token/refresh to get a customer token.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<RegisterPhoneCustomerBody>,
  res: MedusaResponse
) {
  if (req.auth_context.actor_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This login is already linked to a customer"
    )
  }

  const authModule = req.scope.resolve(Modules.AUTH)
  const identity = await authModule.retrieveAuthIdentity(
    req.auth_context.auth_identity_id,
    { relations: ["provider_identities"] }
  )
  const phone = identity.provider_identities?.find(
    (pi) => pi.provider === "phone-otp"
  )?.entity_id
  if (!phone) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Only phone-OTP logins can register here"
    )
  }
  // An older registration token can outlive the registration itself.
  if (identity.app_metadata?.customer_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Already registered. Call POST /auth/token/refresh for a customer token"
    )
  }

  const { result } = await registerPhoneCustomerWorkflow(req.scope).run({
    input: {
      auth_identity_id: identity.id,
      phone,
      ...req.validatedBody,
    },
  })

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [customer],
  } = await query.graph({
    entity: "customer",
    fields: ["id", "email", "phone", "first_name", "last_name"],
    filters: { id: result.id },
  })

  res.status(201).json({ customer })
}
