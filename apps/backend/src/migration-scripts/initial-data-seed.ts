import { MedusaContainer } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  ModuleRegistrationName,
  Modules,
} from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createProductCategoriesWorkflow,
  createProductOptionsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows"

/**
 * Runs once, automatically, during `medusa db:migrate`.
 *
 * Creates Bramhkanti's store STRUCTURE only: INR store, India region,
 * India tax region, pickup stock location, India delivery zone, sales
 * channel, publishable API key, a "Pickles" category and a "Jar Size"
 * option.
 *
 * Deliberately NOT created here (business decisions, set in the admin):
 * - products, prices and stock quantities
 * - shipping options and shipping fees
 * - GST rate(s)
 * - the real pickup address (placeholder below, edit in admin)
 */
export default async function initial_data_seed({
  container,
}: {
  container: MedusaContainer
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const fulfillmentModuleService = container.resolve(
    ModuleRegistrationName.FULFILLMENT
  )

  logger.info("Setting up Bramhkanti store structure...")

  const {
    result: [salesChannel],
  } = await createSalesChannelsWorkflow(container).run({
    input: {
      salesChannelsData: [
        {
          name: "Bramhkanti Website",
          description: "bramhkanti.com storefront",
        },
      ],
    },
  })

  const {
    result: [publishableApiKey],
  } = await createApiKeysWorkflow(container).run({
    input: {
      api_keys: [
        {
          title: "Bramhkanti Storefront",
          type: "publishable",
          created_by: "",
        },
      ],
    },
  })

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: publishableApiKey.id,
      add: [salesChannel.id],
    },
  })

  await createStoresWorkflow(container).run({
    input: {
      stores: [
        {
          name: "Bramhkanti",
          supported_currencies: [
            {
              currency_code: "inr",
              is_default: true,
              // Indian retail prices (MRP) include GST
              is_tax_inclusive: true,
            },
          ],
          default_sales_channel_id: salesChannel.id,
        },
      ],
    },
  })

  const {
    result: [region],
  } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "India",
          currency_code: "inr",
          countries: ["in"],
          is_tax_inclusive: true,
          // Razorpay is added to this region from the admin once enabled.
          payment_providers: ["pp_system_default"],
        },
      ],
    },
  })
  logger.info(`Created region India (${region.id})`)

  // No default rate: GST rate must be confirmed by the business and set
  // in Admin > Settings > Tax Regions.
  await createTaxRegionsWorkflow(container).run({
    input: [{ country_code: "in", provider_id: "tp_system" }],
  })

  const {
    result: [stockLocation],
  } = await createStockLocationsWorkflow(container).run({
    input: {
      locations: [
        {
          name: "Bramhkanti Pickup Location",
          address: {
            // PLACEHOLDER: replace with the registered pickup address in
            // Admin > Settings > Locations & Shipping.
            address_1: "",
            city: "",
            country_code: "IN",
          },
        },
      ],
    },
  })

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
  })

  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
    name: "Bramhkanti India Delivery",
    type: "shipping",
    service_zones: [
      {
        name: "India",
        geo_zones: [{ country_code: "in", type: "country" }],
      },
    ],
  })

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
  })

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocation.id, add: [salesChannel.id] },
  })

  await createProductCategoriesWorkflow(container).run({
    input: {
      product_categories: [{ name: "Pickles", is_active: true }],
    },
  })

  await createProductOptionsWorkflow(container).run({
    input: {
      product_options: [{ title: "Jar Size", values: ["250 g", "500 g"] }],
    },
  })

  logger.info(
    "Bramhkanti structure ready. Next: set pickup address, GST rate, shipping options and products in the admin."
  )
}
