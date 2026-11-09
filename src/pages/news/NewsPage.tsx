import { useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'
import { canSendMarketing } from '../../lib/permissions'
import { Card } from '../../components/ui/Card'
import { CampaignEditor } from './CampaignEditor'
import { CampaignList } from './CampaignList'
import { SendersPanel } from './SendersPanel'
import { TemplatesPanel } from './TemplatesPanel'
import { WorkflowsPanel } from './WorkflowsPanel'
import { SenderSetup, useSenderConfig } from './shared'

/**
 * NEWS & CAMPAIGNS -- a client newsletter and lead re-engagement, sent through Resend (S10, 21 Oct).
 *
 * The firm: "if we send out a blog or a new blog or a newsletter, we should be able to send it out
 * from the system to all of their email addresses", and for leads, "to try to reactivate them,
 * leads that are dormant". Lists are rules over Raptor's own records, never typed; the count and a
 * sample are shown before anything goes; and an address that has said stop is never sent to.
 *
 * FOUR PLACES (S13): the campaigns and their history, the templates they start from, the workflows that
 * send follow-ups on their own, and who campaigns come from and who hears the results. One address each (?tab=) so a link to a
 * workflow from a campaign lands on the workflows.
 *
 * NOTHING HERE IS A DEBTOR. This page reads companies, contacts and leads; it never touches an
 * account and raises no Annexure B fee.
 */
type Tab = 'campaigns' | 'templates' | 'workflows' | 'senders'
const TABS: { key: Tab; label: string }[] = [
  { key: 'campaigns', label: 'Campaigns' }, { key: 'templates', label: 'Templates' }, { key: 'workflows', label: 'Workflows' }, { key: 'senders', label: 'Senders & results' },
]

export function NewsPage() {
  const { id } = useParams()
  const { currentUser } = useAuth()
  if (!canSendMarketing(currentUser)) {
    return (
      <Card>
        <p className="text-sm text-slate-600">Sending news and campaigns is not one of your permissions. An administrator can give it to you in Settings → Users.</p>
      </Card>
    )
  }
  return id ? <CampaignEditor id={id} /> : <NewsHome />
}

function NewsHome() {
  const [params, setParams] = useSearchParams()
  const { config, error } = useSenderConfig()
  const raw = params.get('tab')
  const tab: Tab = raw === 'workflows' || raw === 'senders' || raw === 'templates' ? raw : 'campaigns'
  return (
    <div className="space-y-4">
      <SenderSetup config={config} error={error} />
      <nav className="flex gap-1 border-b border-slate-200 overflow-x-auto" aria-label="News & campaigns">
        {TABS.map((t) => (
          <button key={t.key} type="button" data-testid={`news-tab-${t.key}`} aria-current={tab === t.key ? 'page' : undefined}
            onClick={() => setParams(t.key === 'campaigns' ? {} : { tab: t.key })}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${tab === t.key
              ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'campaigns' && <CampaignList />}
      {tab === 'templates' && <TemplatesPanel schemaReady={!!config?.schemaReady} />}
      {tab === 'workflows' && <WorkflowsPanel />}
      {tab === 'senders' && <SendersPanel />}
    </div>
  )
}
