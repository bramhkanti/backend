import {
  authenticate,
  configureStoreSearch,
  defineMiddlewares,
  validateAndTransformBody,
} from '@medusajs/framework/http'
import { RegisterPhoneCustomerSchema } from './store/phone-auth/customer/route'

export default defineMiddlewares({
  routes: [
    // The product index declares filterable `status` and `sales_channel_ids`, so
    // the route narrows it to published products in the key's sales channels.
    {
      method: ['POST'],
      matcher: '/store/search',
      middlewares: [
        configureStoreSearch({
          allowed_indexes: {
            product: true,
          },
        }),
      ],
    },
    // Registration token from /auth/customer/phone-otp/callback (no customer yet).
    {
      method: ['POST'],
      matcher: '/store/phone-auth/customer',
      middlewares: [
        authenticate('customer', ['bearer'], { allowUnregistered: true }),
        validateAndTransformBody(RegisterPhoneCustomerSchema),
      ],
    },
  ],
})
