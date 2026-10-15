import { setAuthAppMetadataStep } from "@medusajs/medusa/core-flows"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  findOrCreatePhoneCustomerStep,
  type FindOrCreatePhoneCustomerInput,
} from "./steps/find-or-create-phone-customer"

export type RegisterPhoneCustomerInput = FindOrCreatePhoneCustomerInput & {
  auth_identity_id: string
}

/**
 * Links a phone-OTP auth identity to a customer. Medusa's own
 * createCustomerAccountWorkflow requires an email, which OTP users may not have.
 */
export const registerPhoneCustomerWorkflow = createWorkflow(
  "register-phone-customer",
  (input: RegisterPhoneCustomerInput) => {
    const customer = findOrCreatePhoneCustomerStep(
      transform({ input }, ({ input }) => ({
        phone: input.phone,
        first_name: input.first_name,
        last_name: input.last_name,
        email: input.email,
      }))
    )

    setAuthAppMetadataStep(
      transform({ input, customer }, ({ input, customer }) => ({
        authIdentityId: input.auth_identity_id,
        actorType: "customer",
        value: customer.id,
      }))
    )

    return new WorkflowResponse(customer)
  }
)
