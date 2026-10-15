import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PhoneOtpAuthService from "./service"

export default ModuleProvider(Modules.AUTH, {
  services: [PhoneOtpAuthService],
})
