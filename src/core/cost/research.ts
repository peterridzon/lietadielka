/**
 * Guards on cost research rows.
 *
 * A framework ceiling recorded as money spent would overstate public cost by an order of
 * magnitude, and it is an easy mistake to make when transcribing a contract register.
 * The guard runs at write time so the mistake cannot reach the database.
 */
import type { SourceTier } from './types.js'
import { SOURCE_TIER_RANK } from './types.js'

export const CONTRACT_VALUE_PRIORITY = [
  'actual_spend',
  'invoice_value',
  'executed_contract_value',
  'awarded_contract_value',
  'maximum_framework_value',
  'industry_benchmark',
] as const

export type ContractValueType = (typeof CONTRACT_VALUE_PRIORITY)[number] | 'annual_budget' | 'estimated_value'

/** Only these two say the money actually left the account. */
const SPENDING_TYPES = new Set<ContractValueType>(['actual_spend', 'invoice_value'])

export function assertSpendingClaim(item: {
  id: string
  actualSpend?: number | null
  contractValueType: ContractValueType
}): void {
  if (item.actualSpend == null) return
  if (SPENDING_TYPES.has(item.contractValueType)) return
  throw new Error(
    `Research item ${item.id} sets actualSpend but declares contractValueType ` +
      `"${item.contractValueType}". A framework ceiling, an award or a budget is not money spent.`,
  )
}

/** Which of two figures for the same thing should win. */
export function preferValue<T extends { contractValueType: ContractValueType; sourceTier: SourceTier }>(
  a: T,
  b: T,
): T {
  const rank = (v: T): number => {
    const index = (CONTRACT_VALUE_PRIORITY as readonly string[]).indexOf(v.contractValueType)
    return index === -1 ? CONTRACT_VALUE_PRIORITY.length : index
  }
  if (rank(a) !== rank(b)) return rank(a) < rank(b) ? a : b
  return SOURCE_TIER_RANK[a.sourceTier] >= SOURCE_TIER_RANK[b.sourceTier] ? a : b
}
