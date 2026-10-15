import type { FilterableCustomerProps } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export type FindOrCreatePhoneCustomerInput = {
  phone: string
  first_name?: string
  last_name?: string
  email?: string
}

/**
 * Reuses a registered customer that already owns this phone number,
 * otherwise creates one. Compensation deletes only a customer it created.
 */
export const findOrCreatePhoneCustomerStep = createStep(
  "find-or-create-phone-customer",
  async (input: FindOrCreatePhoneCustomerInput, { container }) => {
    const customerModule = container.resolve(Modules.CUSTOMER)

    // `phone` is a plain column; the typed filter just doesn't list it.
    const filters = { phone: input.phone, has_account: true } as FilterableCustomerProps
    const [existing] = await customerModule.listCustomers(filters, { take: 1 })
    if (existing) {
      return new StepResponse({ id: existing.id }, null)
    }

    const created = await customerModule.createCustomers({
      phone: input.phone,
      first_name: input.first_name || null,
      last_name: input.last_name || null,
      email: input.email || null,
      has_account: true,
    })
    return new StepResponse({ id: created.id }, created.id)
  },
  async (createdId, { container }) => {
    if (!createdId) {
      return
    }
    await container.resolve(Modules.CUSTOMER).deleteCustomers(createdId)
  }
)
