import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Mail, MessageSquare, StickyNote, Building2, Pencil } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { Card, CardHeader } from '../../components/ui/Card'
import { StageBadge } from '../../components/ui/Badge'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { ComposeEmailModal } from '../../components/ComposeEmailModal'
import { EditContactModal } from '../../components/contacts/EditContactModal'
import { DashboardHero } from '../../components/dashboard/DashboardHero'
import { HeroOwner } from '../../components/RecordOwner'
import {
  ACTION_BASE, ACTION_ENABLED, RecordAction, RecordActions, RecordActionsMore, RecordFigure,
  RecordFigures, RecordLayout, RecordLayoutSwitcher, RecordMoreAction, RecordTabs, useRecordLayout,
} from '../../components/record/RecordShell'
import { CrmCallButton } from '../../components/record/CrmCallButton'
import {
  RecordComment, RecordCommentFact, RecordCommentSummary,
} from '../../components/record/RecordComment'
import { companyById, formatCurrency, formatDate, formatDateTime, userById } from '../../data/mockData'

type ContactTab = 'Overview' | 'Activity' | 'Tasks'

export function ContactDetail() {
  const { id } = useParams()
  const { contacts, deals, activities, tasks, addActivity, updateContact } = useAppStore()
  const { currentUser } = useAuth()
  const contact = contacts.find((c) => c.id === id)
  const [tab, setTab] = useState<ContactTab>('Overview')
  const [layout, chooseLayout] = useRecordLayout('raptor.contact.layout')
  const [noteOpen, setNoteOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const contactDeals = useMemo(() => deals.filter((d) => d.contactId === id), [deals, id])
  const contactActivities = useMemo(
    () => activities.filter((a) => a.contactId === id || (a.companyId === contact?.companyId && contactDeals.some((d) => d.id === a.dealId))).sort((a, b) => new Date(b.activityDate).getTime() - new Date(a.activityDate).getTime()),
    [activities, id, contact, contactDeals],
  )
  const contactTasks = useMemo(() => tasks.filter((t) => t.contactId === id || contactDeals.some((d) => d.id === t.dealId)), [tasks, id, contactDeals])
  const notes = contactActivities.filter((a) => a.type === 'Note')
  const dealValue = useMemo(() => contactDeals.reduce((sum, d) => sum + d.value, 0), [contactDeals])
  /** Work still outstanding, which is what "open tasks" means to somebody reading a record. */
  const openTasks = useMemo(
    () => contactTasks.filter((t) => t.status !== 'Completed' && t.status !== 'Cancelled').length,
    [contactTasks],
  )
  /*
   * Their numbers, mobile first. A mobile is answered by the person; a switchboard is answered
   * by somebody else.
   */
  const contactNumbers = useMemo(() => [
    ...(contact?.mobile ? [{ label: 'Mobile', value: contact.mobile }] : []),
    ...(contact?.phone ? [{ label: 'Office', value: contact.phone }] : []),
  ], [contact?.mobile, contact?.phone])

  if (!contact) {
    return (
      <div className="text-center py-16 text-slate-400">
        Contact not found. <Link to="/contacts" className="text-brand-600 hover:underline">Back to contacts</Link>
      </div>
    )
  }

  const company = companyById(contact.companyId)

  /*
   * The panels, built once and placed by whichever layout is chosen — the same shape every other
   * record page uses.
   */
  /** The business this person is attached to. */
  const dealsPanel = (
    <Card>
      <CardHeader title="Deals" />
      {contactDeals.length === 0 ? (
        <p className="text-sm text-slate-400">No deals linked to this contact yet.</p>
      ) : (
        <div className="divide-y divide-slate-50">
          {contactDeals.map((d) => (
            <Link key={d.id} to={`/deals/${d.id}`} className="flex items-center justify-between py-2.5 hover:bg-slate-50/60 -mx-1 px-1 rounded-lg">
              <span className="text-sm font-medium text-slate-700">{d.name}</span>
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-500">{formatCurrency(d.value)}</span>
                <StageBadge stage={d.stage} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  )

  /** Its own tab: a list that grows without limit is not context. */
  const activityPanel = (
    <Card>
      <CardHeader title="Activities" />
      {contactActivities.length === 0 ? (
        <p className="text-sm text-slate-400">No activity recorded yet.</p>
      ) : (
        <div className="space-y-3">
          {contactActivities.slice(0, 8).map((a) => (
            <div key={a.id} className="flex justify-between text-sm border-b border-slate-50 pb-2.5 last:border-0">
              <span className="text-slate-700">{a.subject}</span>
              <span className="text-xs text-slate-400">{formatDateTime(a.activityDate)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )

  /** Everything somebody wrote down. */
  const notesPanel = (
    <Card>
      <CardHeader title="Notes" />
      {notes.length === 0 ? (
        <p className="text-sm text-slate-400">No notes yet.</p>
      ) : (
        <div className="space-y-2.5">
          {notes.map((n) => (
            <div key={n.id} className="bg-[var(--tint-gold)] border border-[var(--tint-gold-pale)] rounded-lg p-3">
              <p className="text-sm text-slate-700">{n.notes || n.subject}</p>
              <p className="text-[11px] text-slate-400 mt-1">{formatDateTime(n.activityDate)}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )

  /** Who they are and how to reach them. */
  const detailsPanel = (
    <Card>
      <CardHeader title="Personal Details" />
      <dl className="space-y-3 text-sm">
        <Field label="First Name" value={contact.firstName} />
        <Field label="Last Name" value={contact.lastName} />
        <Field label="Job Title" value={contact.jobTitle} />
        <Field label="Email" value={contact.email} />
        <Field label="Phone" value={contact.phone} />
        <Field label="Mobile" value={contact.mobile} />
        <Field label="Owner" value={userById(contact.ownerId)?.name} />
        <Field label="Created" value={formatDate(contact.createdAt)} />
        <Field label="Last Contact" value={formatDate(contact.lastContactAt)} />
      </dl>
    </Card>
  )

  /** Where they work. */
  const companyPanel = company && (
    <Card>
      <CardHeader title="Company" />
      <Link to={`/companies/${company.id}`} className="flex items-center gap-2.5 hover:bg-slate-50 -mx-1 px-1 py-1 rounded-lg">
        <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
          <Building2 size={16} />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-700">{company.name}</p>
          <p className="text-xs text-slate-400">{company.industry}</p>
        </div>
      </Link>
    </Card>
  )

  /** Its own tab as well: a task list is work, not context. */
  const tasksPanel = (
    <Card>
      <CardHeader title="Tasks" />
      {contactTasks.length === 0 ? (
        <p className="text-sm text-slate-400">No tasks yet.</p>
      ) : (
        <div className="space-y-2">
          {contactTasks.map((t) => (
            <div key={t.id} className="text-sm">
              <p className="text-slate-700">{t.title}</p>
              <p className="text-xs text-slate-400">Due {formatDate(t.dueDate)}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )

  return (
    <div className="space-y-5">
      <Link to="/contacts" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={15} /> Back to Contacts
      </Link>

      {/*
        The same band, figures and action row every other record page wears. This page had a
        white card with an avatar in it and two small buttons in a size nothing else used.
      */}
      <DashboardHero
        eyebrow="Contact"
        title={`${contact.firstName} ${contact.lastName}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {contact.jobTitle && <span>{contact.jobTitle}</span>}
            {contact.jobTitle && company && <span className="text-white/30">at</span>}
            {company && (
              <Link to={`/companies/${company.id}`} className="text-gold-400 hover:underline">
                {company.name}
              </Link>
            )}
          </span>
        }
      >
        <HeroOwner ownerId={contact.ownerId} label="Owner" />
      </DashboardHero>

      <RecordFigures count={4}>
        <RecordFigure label="Deals" value={String(contactDeals.length)}
          note={contactDeals.length === 0 ? 'none yet' : formatCurrency(dealValue)} />
        <RecordFigure label="Open tasks" value={String(openTasks)}
          note={openTasks === 0 ? 'nothing outstanding' : 'still to do'} />
        <RecordFigure label="Last contact" small
          value={contact.lastContactAt ? formatDate(contact.lastContactAt) : '\u2014'}
          note={contact.lastContactAt ? undefined : 'never recorded'} />
        <RecordFigure label="On file since" value={formatDate(contact.createdAt)} small />
      </RecordFigures>

      {/*
        The two lines the next person needs, above the actions, exactly as on every other record
        page. On a person rather than a relationship: "prefers to be called after four", "goes
        through his PA". What is going on with the CLIENT belongs on the client.
      */}
      <RecordComment
        text={contact.mainComment}
        at={contact.mainCommentAt}
        placeholder="Anything the next person should know before they ring? Two lines is plenty."
        onSave={(text) => updateContact(contact.id, {
          mainComment: text || undefined,
          mainCommentAt: new Date().toISOString(),
          mainCommentBy: currentUser?.id,
        })}
        summary={(
          <RecordCommentSummary>
            <RecordCommentFact label="Deals">
              {contactDeals.length === 0
                ? <span className="text-slate-400">None yet</span>
                : (
                  <>
                    <span className="font-medium tabular-nums">{formatCurrency(dealValue)}</span>
                    <span className="text-slate-400">across {contactDeals.length}</span>
                  </>
                )}
            </RecordCommentFact>
            <RecordCommentFact label="Reach them on">
              {contactNumbers.length === 0 && !contact.email
                ? <span className="text-slate-400">Nothing on file</span>
                : (
                  <>
                    {contactNumbers.map((n) => (
                      <span key={n.value} className="text-xs px-2 py-0.5 rounded-md bg-white border border-slate-200">
                        {n.label} {n.value}
                      </span>
                    ))}
                    {contact.email && (
                      <span className="text-xs px-2 py-0.5 rounded-md bg-white border border-slate-200 truncate max-w-[16rem]">
                        {contact.email}
                      </span>
                    )}
                  </>
                )}
            </RecordCommentFact>
          </RecordCommentSummary>
        )}
      />

      <Card>
        <RecordActions>
          {/* Their own numbers, so a contact can be rung from their page. Nothing is charged:
              a contact is not a debtor. See CrmCallButton. */}
          <CrmCallButton
            numbers={contactNumbers}
            to={{ contactId: contact.id, companyId: contact.companyId }}
            subject={`${contact.firstName} ${contact.lastName}`}
            className={`${ACTION_BASE} ${ACTION_ENABLED}`}
          />
          <RecordAction icon={MessageSquare} label="SMS"
            title="Not built for contacts yet \u2014 the SMS route is tied to a debtor's account, where it raises a fee." />
          <RecordAction icon={Mail} label="Email"
            onClick={contact.email ? () => setEmailOpen(true) : undefined}
            title={contact.email ? 'Send from your connected mailbox' : 'No email address on this contact yet'} />
          <RecordAction icon={StickyNote} label="Add Note" onClick={() => setNoteOpen(true)}
            title="Write on the timeline" />
          <RecordActionsMore>
            <RecordMoreAction icon={Pencil} label="Edit contact" onClick={() => setEditOpen(true)} />
          </RecordActionsMore>
        </RecordActions>
      </Card>

      <RecordTabs<ContactTab>
        tabs={[
          { id: 'Overview', label: 'Overview' },
          { id: 'Activity', label: 'Activity', count: contactActivities.length },
          { id: 'Tasks', label: 'Tasks', count: contactTasks.length },
        ]}
        active={tab}
        onChange={setTab}
        trailing={tab === 'Overview'
          ? <RecordLayoutSwitcher layout={layout} onChange={chooseLayout} />
          : undefined}
      />

      {tab === 'Overview' && (
        <RecordLayout
          layout={layout}
          /* Notes under the details, not behind a tab — the same move as every other record. */
          details={<div className="space-y-5">{detailsPanel}{notesPanel}</div>}
          main={dealsPanel}
          side={companyPanel ? [companyPanel] : []}
        />
      )}

      {tab === 'Activity' && activityPanel}
      {tab === 'Tasks' && tasksPanel}

      {noteOpen && (
        <NoteModal
          onClose={() => setNoteOpen(false)}
          onSave={(text) => addActivity({ type: 'Note', subject: 'Note added', notes: text, contactId: contact.id, companyId: contact.companyId })}
        />
      )}
      {emailOpen && contact.email && (
        <ComposeEmailModal
          to={contact.email}
          onClose={() => setEmailOpen(false)}
          onSent={(subject, bodyText) => addActivity({ type: 'Email', subject, notes: bodyText, contactId: contact.id, companyId: contact.companyId })}
        />
      )}
      {editOpen && (
        <EditContactModal contact={contact} onClose={() => setEditOpen(false)} onSave={(patch) => updateContact(contact.id, patch)} />
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-slate-700 font-medium text-right">{value || '—'}</dd>
    </div>
  )
}

function NoteModal({ onClose, onSave }: { onClose: () => void; onSave: (text: string) => void }) {
  const [text, setText] = useState('')
  return (
    <Modal title="Add Note" onClose={onClose} width={400}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          onSave(text)
          onClose()
        }}
      >
        <FormField label="Note" required>
          <textarea className={inputClass} rows={4} value={text} onChange={(e) => setText(e.target.value)} required autoFocus />
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Add Note
          </button>
        </div>
      </form>
    </Modal>
  )
}
