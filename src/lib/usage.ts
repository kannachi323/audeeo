// Model pricing rates per minute of audio streamed (in USD)
// Pricing based on streaming transcription:
// nova-3: $0.0059 / min
// nova-2 & variants: $0.0043 / min
// enhanced: $0.0145 / min
// base: $0.0125 / min
export const MODEL_RATES_PER_MINUTE: Record<string, number> = {
  'nova-3': 0.0059,
  'nova-2': 0.0043,
  'nova-2-general': 0.0043,
  'nova-2-meeting': 0.0043,
  'enhanced': 0.0145,
  'base': 0.0125,
}

export const DEFAULT_MODEL_RATE = 0.0059

export type UsageStats = {
  totalSeconds: number
  totalCost: number
  budgetLimit: number
  autoStopOnBudget: boolean
}

const STORAGE_KEY = 'audeeo_usage_stats_v1'
const DEFAULT_BUDGET = 5.0 // $5.00 default budget

export function loadUsageStats(): UsageStats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        totalSeconds: Number(parsed.totalSeconds) || 0,
        totalCost: Number(parsed.totalCost) || 0,
        budgetLimit: Number(parsed.budgetLimit) > 0 ? Number(parsed.budgetLimit) : DEFAULT_BUDGET,
        autoStopOnBudget: Boolean(parsed.autoStopOnBudget),
      }
    }
  } catch {
    // ignore
  }
  return {
    totalSeconds: 0,
    totalCost: 0,
    budgetLimit: DEFAULT_BUDGET,
    autoStopOnBudget: false,
  }
}

export function saveUsageStats(stats: UsageStats): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats))
  } catch {
    // ignore
  }
}

export function calculateCost(seconds: number, model = 'nova-3'): number {
  const ratePerMinute = MODEL_RATES_PER_MINUTE[model] ?? DEFAULT_MODEL_RATE
  return (seconds / 60) * ratePerMinute
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const hrs = Math.floor(mins / 60)

  if (hrs > 0) {
    const remMins = mins % 60
    return `${hrs}h ${remMins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

export function formatCurrency(amount: number): string {
  if (amount === 0) return '$0.00'
  if (amount < 0.01) {
    return `$${amount.toFixed(4)}`
  }
  return `$${amount.toFixed(2)}`
}

export type BudgetAlertLevel = 'normal' | 'warning' | 'exceeded'

export function getBudgetAlertLevel(currentSpend: number, budgetLimit: number): BudgetAlertLevel {
  if (budgetLimit <= 0) return 'normal'
  const ratio = currentSpend / budgetLimit
  if (ratio >= 1.0) return 'exceeded'
  if (ratio >= 0.8) return 'warning'
  return 'normal'
}
