import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import ShiprocketFulfillmentProviderService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [ShiprocketFulfillmentProviderService],
})
