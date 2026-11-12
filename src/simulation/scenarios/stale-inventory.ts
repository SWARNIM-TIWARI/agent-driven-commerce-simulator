// src/simulation/scenarios/stale-inventory.ts

import { usd } from '../../domain/money'
import type { WorldConfig, ScenarioConfig, Experiment } from '../../domain/experiment'

export const STALE_INVENTORY_WORLD: WorldConfig = {
  merchants: [
    {
      id:               'merchant_a',
      name:             'AlphaShop',
      reliability:      0.92,        // high — agents naturally prefer this
      priceLevel:       'mid',
      fulfillmentSpeed: 'standard',
      returnPolicy:     'flexible',
    },
    {
      id:               'merchant_b',
      name:             'BetaMart',
      reliability:      0.74,        // lower — the price-for-reliability tradeoff
      priceLevel:       'budget',
      fulfillmentSpeed: 'slow',
      returnPolicy:     'restrictive',
    },
    {
      id:               'merchant_c',
      name:             'GammaStore',
      reliability:      0.95,        // premium tier — shallow inventory
      priceLevel:       'premium',
      fulfillmentSpeed: 'fast',
      returnPolicy:     'flexible',
    },
  ],

  products: [
    // AlphaShop — mid-price, broad selection, deep inventory
    { id: 'prod_a1', merchantId: 'merchant_a', name: 'Wireless Headphones', category: 'electronics', price: usd(89),  initialInventoryCount: 30 },
    { id: 'prod_a2', merchantId: 'merchant_a', name: 'USB-C Hub',           category: 'electronics', price: usd(45),  initialInventoryCount: 25 },
    { id: 'prod_a3', merchantId: 'merchant_a', name: 'Desk Lamp',           category: 'home',        price: usd(38),  initialInventoryCount: 20 },
    { id: 'prod_a4', merchantId: 'merchant_a', name: 'Phone Case',          category: 'accessories', price: usd(22),  initialInventoryCount: 40 },

    // BetaMart — cheap, limited selection
    { id: 'prod_b1', merchantId: 'merchant_b', name: 'Wireless Headphones', category: 'electronics', price: usd(62),  initialInventoryCount: 15 },
    { id: 'prod_b2', merchantId: 'merchant_b', name: 'Desk Lamp',           category: 'home',        price: usd(28),  initialInventoryCount: 12 },
    { id: 'prod_b3', merchantId: 'merchant_b', name: 'Phone Case',          category: 'accessories', price: usd(14),  initialInventoryCount: 18 },

    // GammaStore — premium, SHALLOW inventory (the secondary failure trigger)
    { id: 'prod_c1', merchantId: 'merchant_c', name: 'Wireless Headphones', category: 'electronics', price: usd(129), initialInventoryCount: 6  },
    { id: 'prod_c2', merchantId: 'merchant_c', name: 'USB-C Hub',           category: 'electronics', price: usd(72),  initialInventoryCount: 5  },
    { id: 'prod_c3', merchantId: 'merchant_c', name: 'Desk Lamp',           category: 'home',        price: usd(65),  initialInventoryCount: 4  },
  ],

  agents: [
    {
      id:        'agent_budget',
      name:      'BudgetBot',
      phenotype: 'budget_hunter',
      policy: {
        priceSensitivity:    0.90,
        reliabilityWeight:   0.20,
        shippingSpeedWeight: 0.10,
        merchantLoyalty:     0.15,
        retryTolerance:      3,      // retries 3× before switching
        patience:            10,
        riskTolerance:       0.60,
        maxBudget:           usd(75),
        preferredCategories: ['electronics'],
      },
      objective: {
        description:             'Buy 3 electronics items under $75',
        targetCategory:          'electronics',
        maxPrice:                usd(75),
        minReliabilityThreshold: 0.50,
        quantity:                12,
      },
    },
    {
      id:        'agent_reliable',
      name:      'ReliableRoger',
      phenotype: 'reliability_first',
      policy: {
        priceSensitivity:    0.15,
        reliabilityWeight:   0.90,
        shippingSpeedWeight: 0.30,
        merchantLoyalty:     0.40,
        retryTolerance:      1,      // switches after first failure
        patience:            6,
        riskTolerance:       0.20,   // abandons fast if merchant seems bad
        maxBudget:           usd(200),
        preferredCategories: [],
      },
      objective: {
        description:             'Buy 3 items from reliable merchants',
        targetCategory:          '',
        maxPrice:                usd(200),
        minReliabilityThreshold: 0.85,
        quantity:                12,
      },
    },
    {
      id:        'agent_impatient',
      name:      'ImpatientIvan',
      phenotype: 'impatient',
      policy: {
        priceSensitivity:    0.40,
        reliabilityWeight:   0.40,
        shippingSpeedWeight: 0.80,
        merchantLoyalty:     0.10,
        retryTolerance:      0,      // switches immediately on ANY failure
        patience:            4,
        riskTolerance:       0.50,
        maxBudget:           usd(150),
        preferredCategories: [],
      },
      objective: {
        description:             'Buy 3 items quickly',
        targetCategory:          '',
        maxPrice:                usd(150),
        minReliabilityThreshold: 0.60,
        quantity:                12,
      },
    },
    {
      id:        'agent_loyal',
      name:      'LoyalLisa',
      phenotype: 'loyal',
      policy: {
        priceSensitivity:    0.35,
        reliabilityWeight:   0.45,
        shippingSpeedWeight: 0.20,
        merchantLoyalty:     0.92,   // enormous loyalty bonus
        retryTolerance:      5,      // will suffer 5 failures before switching
        patience:            15,
        riskTolerance:       0.70,
        maxBudget:           usd(120),
        preferredCategories: ['home', 'accessories'],
      },
      objective: {
        description:             'Buy 3 home/accessories items from preferred merchants',
        targetCategory:          '',
        maxPrice:                usd(120),
        minReliabilityThreshold: 0.65,
        quantity:                12,
      },
    },
    {
      id:        'agent_balanced',
      name:      'BalancedBea',
      phenotype: 'balanced',
      policy: {
        priceSensitivity:    0.50,
        reliabilityWeight:   0.50,
        shippingSpeedWeight: 0.40,
        merchantLoyalty:     0.40,
        retryTolerance:      2,
        patience:            8,
        riskTolerance:       0.45,
        maxBudget:           usd(100),
        preferredCategories: [],
      },
      objective: {
        description:             'Buy 3 items with good price/reliability balance',
        targetCategory:          '',
        maxPrice:                usd(100),
        minReliabilityThreshold: 0.70,
        quantity:                12,
      },
    },
  ],
}

export const STALE_INVENTORY_SCENARIO: ScenarioConfig = {
  name:        'stale_inventory_001',
  description: 'AlphaShop inventory sync fails at tick 20. Listings remain unchanged but all fulfillment attempts fail.',
  totalTicks:  60,
  injections: [
    {
      id:               'inj_stale_alpha',
      atTick:           20,
      type:             'STALE_INVENTORY',
      targetMerchantId: 'merchant_a',
      targetProductId:  null,          // affects ALL merchant_a products
      parameters: {
        setActualInventoryTo:  0,
        setVisibleInventoryTo: null,    // null = leave visible unchanged (stale!)
        failureCategory:       'fulfillment_failed',
        failureMessage:        'FULFILLMENT_ERROR: inventory sync failure — item unavailable',
      },
      applied: false,
    },
  ],
}

export const EXPERIMENT_001: Experiment = {
  id:          'exp_001',
  name:        'Stale Inventory',
  description: 'What collective adaptation occurs when autonomous buyers encounter hidden inventory failure?',
  worldConfig:    STALE_INVENTORY_WORLD,
  scenarioConfig: STALE_INVENTORY_SCENARIO,
  createdAt:   new Date('2026-10-08'),
}
