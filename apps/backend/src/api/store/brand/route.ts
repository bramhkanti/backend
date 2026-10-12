import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/brand
 *
 * Public brand info for the storefront (name, logo, tagline). Values are
 * edited in Admin > Settings > Store > Metadata (logo_url, tagline).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [store],
  } = await query.graph({
    entity: "store",
    fields: ["name", "metadata"],
  })

  const metadata = (store?.metadata ?? {}) as Record<string, unknown>
  res.json({
    brand: {
      name: store?.name ?? null,
      logo_url: (metadata.logo_url as string) ?? null,
      tagline: (metadata.tagline as string) ?? null,
    },
  })
}
