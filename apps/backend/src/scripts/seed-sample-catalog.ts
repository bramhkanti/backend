import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createCollectionsWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createShippingOptionsWorkflow,
  updateCollectionsWorkflow,
  updateProductCategoriesWorkflow,
  updateProductsWorkflow,
  updateProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows"

/**
 * SAMPLE catalog for development and demos. Prices, stock and descriptions are
 * placeholders, not business data. Everything created here carries
 * `metadata.sample_data = true` so it can be found and replaced later.
 *
 *   npm run seed:sample            (from apps/backend)
 *
 * Safe to run again: existing categories, collections, products and shipping
 * options (matched by handle/name) are left alone; existing products without a
 * price get the sample price.
 *
 * Images are served by the storefront (`public/images/home/*`), so set
 * SAMPLE_IMAGE_BASE_URL to the storefront URL (default http://localhost:3000).
 */

const SAMPLE = { sample_data: true }
const STOCK = 50

type Size = { title: string; price: number }
type SampleProduct = {
  handle: string
  title: string
  subtitle: string
  description: string
  category: string
  collection?: string
  images: string[]
  sizes: Size[]
  featured?: boolean
}

const PICKLE_SIZES: Size[] = [
  { title: "250 g", price: 249 },
  { title: "500 g", price: 449 },
]
const MAKHANA_SIZES: Size[] = [
  { title: "100 g", price: 199 },
  { title: "200 g", price: 349 },
]
const SWEET_SIZES: Size[] = [
  { title: "500 g", price: 399 },
  { title: "1 kg", price: 749 },
]

const CATEGORIES: Array<{
  handle: string
  name: string
  description: string
  image: string
  children: Array<{ handle: string; name: string; description: string; image: string; badge?: string }>
}> = [
  {
    handle: "pickles",
    name: "Pickles",
    description: "Sun-cured achar made in small batches with cold-pressed mustard oil.",
    image: "category-pickle.jpg",
    children: [
      { handle: "aam-ka-achar", name: "Mango Pickles", description: "Raw mango, sun-cured", image: "category-pickle.jpg", badge: "Bestseller" },
      { handle: "nimbu-mirch", name: "Lemon & Chilli", description: "Tangy lemon and stuffed chilli", image: "hero-barnie.jpg" },
      { handle: "sabzi-achar", name: "Vegetable Pickles", description: "Suran, garlic and mixed vegetable", image: "story-spices.jpg", badge: "Heirloom" },
    ],
  },
  {
    handle: "makhana",
    name: "Makhana",
    description: "Slow-roasted foxnuts, savoury and sweet.",
    image: "category-makhana.jpg",
    children: [
      { handle: "roasted-savory", name: "Savoury Makhana", description: "Pink salt, peri peri", image: "category-makhana.jpg", badge: "Crunchy" },
      { handle: "roasted-sweet", name: "Sweet Makhana", description: "Caramelised in jaggery", image: "category-makhana.jpg" },
    ],
  },
  {
    handle: "sweets",
    name: "Sweets",
    description: "Traditional mithai made with desi ghee.",
    image: "category-sweets.jpg",
    children: [
      { handle: "ladoo", name: "Ladoo", description: "Besan and motichoor", image: "category-sweets.jpg", badge: "Pure ghee" },
      { handle: "regional-sweets", name: "Regional Sweets", description: "Thekua and more", image: "category-sweets.jpg" },
    ],
  },
]

const COLLECTIONS: Array<{
  handle: string
  title: string
  banner: string
  description: string
  subtitle: string
  badge: string
  highlights: string[]
}> = [
  {
    handle: "best-sellers",
    title: "Best Sellers",
    banner: "hero-barnie.jpg",
    description: "Our most-loved pickles, makhana and sweets.",
    subtitle: "Customer favourites",
    badge: "Most loved",
    highlights: ["Mango pickle", "Pink salt makhana", "Besan ladoo"],
  },
  {
    handle: "grandmas-specials",
    title: "Grandma's Specials",
    banner: "story-spices.jpg",
    description: "Old family recipes, made the slow way.",
    subtitle: "Heirloom recipes",
    badge: "Heirloom",
    highlights: ["Suran achar", "Stuffed red chilli", "Thekua"],
  },
  {
    handle: "diwali-gifting",
    title: "Diwali Gifting",
    banner: "category-gifting.jpg",
    description: "Festive favourites to share with family and friends.",
    subtitle: "Festive hampers",
    badge: "Festive",
    highlights: ["Gift-ready packs", "Ladoo", "Achar"],
  },
]

const PRODUCTS: SampleProduct[] = [
  {
    handle: "bharwa-lal-mirch-achar",
    title: "Stuffed Red Chilli Pickle (Bharwa Lal Mirch)",
    subtitle: "भरवा लाल मिर्च",
    description: "Fat red chillies stuffed with roasted spices and matured in mustard oil.",
    category: "nimbu-mirch",
    collection: "grandmas-specials",
    images: ["hero-barnie.jpg", "category-pickle.jpg"],
    sizes: PICKLE_SIZES,
    featured: true,
  },
  {
    handle: "lahsun-achar",
    title: "Garlic Pickle (Lahsun ka Achar)",
    subtitle: "लहसुन का अचार",
    description: "Whole garlic cloves in a spiced mustard-oil masala.",
    category: "sabzi-achar",
    collection: "best-sellers",
    images: ["story-spices.jpg", "category-pickle.jpg"],
    sizes: PICKLE_SIZES,
  },
  {
    handle: "mixed-vegetable-achar",
    title: "Mixed Vegetable Pickle (Pachranga)",
    subtitle: "पचरंगा अचार",
    description: "Mango, lemon, carrot, chilli and lotus stem in one jar.",
    category: "sabzi-achar",
    collection: "diwali-gifting",
    images: ["category-pickle.jpg", "story-spices.jpg"],
    sizes: PICKLE_SIZES,
  },
  {
    handle: "pink-salt-makhana",
    title: "Himalayan Pink Salt Makhana",
    subtitle: "Slow-roasted foxnuts",
    description: "Lightly roasted makhana with pink salt and black pepper.",
    category: "roasted-savory",
    collection: "best-sellers",
    images: ["category-makhana.jpg"],
    sizes: MAKHANA_SIZES,
    featured: true,
  },
  {
    handle: "peri-peri-makhana",
    title: "Peri Peri Makhana",
    subtitle: "Slow-roasted foxnuts",
    description: "Crunchy makhana with a smoky peri peri seasoning.",
    category: "roasted-savory",
    images: ["category-makhana.jpg"],
    sizes: MAKHANA_SIZES,
  },
  {
    handle: "gur-makhana",
    title: "Jaggery Makhana (Gur Makhana)",
    subtitle: "Caramelised in organic gur",
    description: "Makhana coated in jaggery and a touch of ghee.",
    category: "roasted-sweet",
    collection: "diwali-gifting",
    images: ["category-makhana.jpg"],
    sizes: MAKHANA_SIZES,
  },
  {
    handle: "besan-ladoo",
    title: "Desi Ghee Besan Ladoo",
    subtitle: "बेसन लड्डू",
    description: "Slow-roasted gram flour ladoo made with desi ghee.",
    category: "ladoo",
    collection: "best-sellers",
    images: ["category-sweets.jpg"],
    sizes: SWEET_SIZES,
    featured: true,
  },
  {
    handle: "thekua",
    title: "Thekua",
    subtitle: "ठेकुआ",
    description: "Crisp wheat and jaggery biscuits, a Chhath favourite.",
    category: "regional-sweets",
    collection: "grandmas-specials",
    images: ["category-sweets.jpg"],
    sizes: SWEET_SIZES,
  },
]

/** Existing products: category / collection / sample price to assign. */
const EXISTING: Record<string, { category: string; collection: string; sizes: Size[] }> = {
  "jimikand-pickle": { category: "sabzi-achar", collection: "grandmas-specials", sizes: PICKLE_SIZES },
  "mango-pickle": { category: "aam-ka-achar", collection: "best-sellers", sizes: PICKLE_SIZES },
  "lemon-pickle": { category: "nimbu-mirch", collection: "diwali-gifting", sizes: PICKLE_SIZES },
}

export default async function seedSampleCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productModule = container.resolve(Modules.PRODUCT)
  const imageBase = (process.env.SAMPLE_IMAGE_BASE_URL || "http://localhost:3000").replace(/\/$/, "")
  const img = (file: string) => `${imageBase}/images/home/${file}`

  const { data: [salesChannel] } = await query.graph({
    entity: "sales_channel",
    fields: ["id"],
    filters: { name: "Bramhkanti Website" },
  })
  const { data: [location] } = await query.graph({
    entity: "stock_location",
    fields: ["id", "fulfillment_sets.service_zones.id"],
  })
  const { data: [profile] } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
    filters: { type: "default" },
  })
  if (!salesChannel || !location || !profile) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Run migrations first: sales channel, stock location or shipping profile missing"
    )
  }

  // --- Categories (top level + subcategories) ---
  const categoryId: Record<string, string> = {}
  const categoryMeta: Record<string, Record<string, unknown>> = {}
  const loadCategories = async () => {
    const cats = await productModule.listProductCategories({}, { take: 500 })
    for (const c of cats) {
      categoryId[c.handle] = c.id
      categoryMeta[c.handle] = (c.metadata ?? {}) as Record<string, unknown>
    }
  }
  await loadCategories()
  // Categories that already exist (e.g. "Pickles" from the first migration)
  // only get an image if they have none.
  for (const parent of CATEGORIES) {
    if (categoryId[parent.handle] && !categoryMeta[parent.handle]?.image_url) {
      await updateProductCategoriesWorkflow(container).run({
        input: {
          selector: { id: categoryId[parent.handle] },
          update: { metadata: { ...categoryMeta[parent.handle], image_url: img(parent.image) } },
        },
      })
    }
  }
  for (const parent of CATEGORIES) {
    if (!categoryId[parent.handle]) {
      await createProductCategoriesWorkflow(container).run({
        input: {
          product_categories: [{
            name: parent.name, handle: parent.handle, description: parent.description,
            is_active: true, metadata: { ...SAMPLE, image_url: img(parent.image) },
          }],
        },
      })
      await loadCategories()
    }
    const missing = parent.children.filter((c) => !categoryId[c.handle])
    if (missing.length) {
      await createProductCategoriesWorkflow(container).run({
        input: {
          product_categories: missing.map((c) => ({
            name: c.name, handle: c.handle, description: c.description, is_active: true,
            parent_category_id: categoryId[parent.handle],
            metadata: { ...SAMPLE, image_url: img(c.image), ...(c.badge ? { badge: c.badge } : {}) },
          })),
        },
      })
      await loadCategories()
    }
  }
  logger.info(`Categories ready (${Object.keys(categoryId).length})`)

  // --- Collections with banners ---
  const collectionId: Record<string, string> = {}
  const existingCollections = await productModule.listProductCollections({}, { take: 100 })
  for (const c of existingCollections) collectionId[c.handle] = c.id
  for (const col of COLLECTIONS) {
    const metadata = {
      ...SAMPLE,
      banner_url: img(col.banner),
      banner_alt: col.title,
      description: col.description,
      subtitle: col.subtitle,
      badge: col.badge,
      highlights: col.highlights,
    }
    if (collectionId[col.handle]) {
      // Keep any banner/metadata the admin already set.
      const current = existingCollections.find((c) => c.handle === col.handle)
      await updateCollectionsWorkflow(container).run({
        input: { selector: { id: collectionId[col.handle] }, update: { metadata: { ...metadata, ...(current?.metadata ?? {}) } } },
      })
    } else {
      const { result } = await createCollectionsWorkflow(container).run({
        input: { collections: [{ title: col.title, handle: col.handle, metadata }] },
      })
      collectionId[col.handle] = result[0].id
    }
  }
  logger.info(`Collections ready: ${COLLECTIONS.map((c) => c.handle).join(", ")}`)

  // --- New sample products ---
  const existingProducts = await productModule.listProducts(
    { handle: [...PRODUCTS.map((p) => p.handle), ...Object.keys(EXISTING)] },
    { relations: ["variants"], take: 100 }
  )
  const existingHandles = new Set(existingProducts.map((p) => p.handle))
  const toCreate = PRODUCTS.filter((p) => !existingHandles.has(p.handle))
  if (toCreate.length) {
    const { result: created } = await createProductsWorkflow(container).run({
      input: {
        products: toCreate.map((p) => ({
          title: p.title,
          subtitle: p.subtitle,
          handle: p.handle,
          description: p.description,
          status: ProductStatus.PUBLISHED,
          thumbnail: img(p.images[0]),
          images: p.images.map((file) => ({ url: img(file) })),
          category_ids: [categoryId[p.category]],
          collection_id: p.collection ? collectionId[p.collection] : undefined,
          shipping_profile_id: profile.id,
          sales_channels: [{ id: salesChannel.id }],
          metadata: { ...SAMPLE, ...(p.featured ? { featured: true } : {}) },
          options: [{ title: "Size", values: p.sizes.map((s) => s.title) }],
          variants: p.sizes.map((s) => ({
            title: s.title,
            sku: `SAMPLE-${p.handle.toUpperCase()}-${s.title.replace(/\s/g, "").toUpperCase()}`,
            manage_inventory: true,
            options: { Size: s.title },
            prices: [{ amount: s.price, currency_code: "inr" }],
          })),
        })),
      },
    })

    // Stock for the new variants at the pickup location.
    const variantIds = created.flatMap((p) => (p.variants ?? []).map((v) => v.id))
    const { data: links } = await query.graph({
      entity: "product_variant",
      fields: ["id", "inventory_items.inventory_item_id"],
      filters: { id: variantIds },
    })
    const inventoryItemIds = links.flatMap((v) =>
      (v.inventory_items ?? []).map((i) => i?.inventory_item_id).filter((id): id is string => Boolean(id))
    )
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: inventoryItemIds.map((id) => ({
          inventory_item_id: id, location_id: location.id, stocked_quantity: STOCK,
        })),
      },
    })
    logger.info(`Created ${created.length} sample products`)
  }

  // --- Existing products: category, collection and a sample price if unpriced ---
  for (const product of existingProducts.filter((p) => EXISTING[p.handle])) {
    const plan = EXISTING[product.handle]
    await updateProductsWorkflow(container).run({
      input: {
        selector: { id: product.id },
        update: {
          category_ids: [categoryId[plan.category]],
          collection_id: collectionId[plan.collection],
        },
      },
    })
    const { data: [withPrices] } = await query.graph({
      entity: "product",
      fields: ["variants.id", "variants.title", "variants.prices.amount"],
      filters: { id: product.id },
    })
    // `prices` comes from the variant ↔ price set link, absent from the generated types.
    const unpriced = (withPrices?.variants ?? []).filter(
      (v) => !(v as { prices?: unknown[] } | null)?.prices?.length
    )
    if (unpriced.length) {
      await updateProductVariantsWorkflow(container).run({
        input: {
          product_variants: unpriced.map((v) => ({
            id: v!.id,
            prices: [{
              amount: plan.sizes.find((s) => s.title === v!.title)?.price ?? plan.sizes[0].price,
              currency_code: "inr",
            }],
          })),
        },
      })
      logger.info(`Sample prices set on ${product.handle}`)
    }
  }

  // --- Delivery options ---
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)
  const zoneId = location.fulfillment_sets?.[0]?.service_zones?.[0]?.id
  const existingOptions = await fulfillmentModule.listShippingOptions({}, { take: 50 })
  const wanted = [
    { name: "Standard Delivery", code: "standard", amount: 49, description: "4–6 working days" },
    { name: "Express Delivery", code: "express", amount: 99, description: "2–3 working days" },
  ].filter((o) => !existingOptions.some((e) => e.name === o.name))
  if (zoneId && wanted.length) {
    await createShippingOptionsWorkflow(container).run({
      input: wanted.map((o) => ({
        name: o.name,
        price_type: "flat" as const,
        provider_id: "manual_manual",
        service_zone_id: zoneId,
        shipping_profile_id: profile.id,
        type: { label: o.name, description: o.description, code: o.code },
        prices: [{ currency_code: "inr", amount: o.amount }],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" as const },
          { attribute: "is_return", value: "false", operator: "eq" as const },
        ],
        data: SAMPLE,
      })),
    })
    logger.info(`Delivery options created: ${wanted.map((o) => o.name).join(", ")}`)
  }

  logger.info("Sample catalog ready. Prices and stock are SAMPLE values.")
}
