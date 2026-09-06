import { Card, CardHeader } from '../ui/Card'
import { SCORE_LABELS, type RepScorecard as RepScorecardType, type ScoreKey } from '../../lib/repScore'

const SCORE_KEYS: ScoreKey[] = ['activity', 'leadCoverage', 'followUp', 'conversion', 'win', 'revenue']

function scoreColor(value: number) {
  if (value >= 75) return 'var(--c-green)'
  if (value >= 50) return 'var(--c-gold)'
  return 'var(--c-rust-deep)'
}

export function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 text-xs text-slate-500 shrink-0">{label}</span>
      <div className="flex-1 bg-slate-50 rounded-full h-2">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, backgroundColor: scoreColor(value) }} />
      </div>
      <span className="w-8 text-xs font-semibold text-slate-700 text-right">{value}</span>
    </div>
  )
}

export function RepScorecardCard({ scorecard, repName }: { scorecard: RepScorecardType; repName: string }) {
  return (
    <Card>
      <CardHeader
        title={`${repName} — Scorecard`}
        action={
          <span className="text-xl font-bold text-slate-800">
            {scorecard.overall}
            <span className="text-xs font-normal text-slate-400">/100</span>
          </span>
        }
      />
      <div className="space-y-2.5">
        {SCORE_KEYS.map((key) => (
          <ScoreBar key={key} label={SCORE_LABELS[key]} value={scorecard.scores[key].value} />
        ))}
      </div>
    </Card>
  )
}
