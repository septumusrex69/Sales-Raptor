import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2, Pencil, Check, X, Mail, Link2, Unlink, RefreshCw, Image as ImageIcon, Volume2, VolumeX, PhoneCall } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { UserAvatar, Avatar } from '../../components/ui/Avatar'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { SignatureEditor } from '../../components/settings/SignatureEditor'
import { DataImportTab } from '../../components/settings/DataImportTab'
import { customFields as initialCustomFields, industries, leadSources as initialLeadSources } from '../../data/mockData'
import { REJECTION_REASONS } from '../../lib/rejection'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { useTheme } from '../../store/ThemeContext'
import { useBuzzBox } from '../../store/BuzzBoxContext'
import { THEMES } from '../../lib/themes'
import { DEAL_MILESTONE_EVERY, MANDATE_MILESTONE_EVERY } from '../../lib/celebration'
import { celebrationSoundEnabled, setCelebrationSoundEnabled } from '../../lib/chime'
import { supabase, PRODUCTION_APP_URL } from '../../lib/supabase'
import type { CustomField, CustomFieldType, Team, TeamKind, User, UserRole } from '../../types'
import { DEAL_STAGES } from '../../types'
import type { Target, TargetMetric } from '../../types'
import { TARGET_METRICS, resolveTarget } from '../../lib/targets'
import { getCurrentSalesMonth } from '../../lib/salesMonth'
import { formatCurrency, TODAY } from '../../data/mockData'

const TABS = ['Profile', 'Appearance', 'Users', 'Teams', 'Targets', 'Pipelines', 'Custom Fields', 'Lead Sources', 'Rejection Reasons', 'Notifications', 'Integrations', 'Data Import'] as const
type Tab = (typeof TABS)[number]

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('Profile')

  return (
    <div className="flex gap-6">
      <nav className="w-52 shrink-0 space-y-0.5">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium ${tab === t ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100'}`}
          >
            {t}
          </button>
        ))}
      </nav>
      <div className="flex-1 min-w-0">
        {tab === 'Profile' && <ProfileTab />}
        {tab === 'Appearance' && <AppearanceTab />}
        {tab === 'Users' && <UsersTab />}
        {tab === 'Teams' && <TeamsTab />}
        {tab === 'Targets' && <TargetsTab />}
        {tab === 'Pipelines' && <PipelinesTab />}
        {tab === 'Custom Fields' && <CustomFieldsTab />}
        {tab === 'Lead Sources' && <StringListTab title="Lead Sources" initial={initialLeadSources} />}
        {tab === 'Rejection Reasons' && <StringListTab title="Rejection Reasons" initial={REJECTION_REASONS} />}
        {tab === 'Notifications' && <NotificationsTab />}
        {tab === 'Integrations' && <IntegrationsTab />}
        {tab === 'Data Import' && <DataImportTab />}
      </div>
    </div>
  )
}

function ProfileTab() {
  const { currentUser, updateCurrentUserLocal } = useAuth()
  const { updateUser } = useAppStore()
  const [form, setForm] = useState({
    fullName: currentUser?.name ?? '',
    email: currentUser?.email ?? '',
    phone: currentUser?.phone ?? '',
    emailSignature: currentUser?.emailSignature ?? '',
    emailSignatureImageUrl: currentUser?.emailSignatureImageUrl,
    emailSignatureImageWidth: currentUser?.emailSignatureImageWidth,
    emailSignatureImageAlign: currentUser?.emailSignatureImageAlign,
    language: 'English',
    timezone: '(GMT+02:00) Johannesburg',
    dateFormat: 'DD MMM YYYY',
    currency: 'ZAR - Rand',
  })
  const [saved, setSaved] = useState(false)

  return (
    <Card>
      <CardHeader title="Profile" subtitle="Your personal account settings" />
      <div className="flex items-center gap-4 mb-6">
        <Avatar name={form.fullName} color={currentUser?.avatarColor ?? 'var(--c-navy)'} size={64} />
        <div>
          <p className="font-semibold text-slate-800">{form.fullName}</p>
          <p className="text-sm text-slate-400">{currentUser?.role}</p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (currentUser) {
            const patch = {
              name: form.fullName,
              phone: form.phone || undefined,
              emailSignature: form.emailSignature || undefined,
              emailSignatureImageUrl: form.emailSignatureImageUrl,
              emailSignatureImageWidth: form.emailSignatureImageWidth,
              emailSignatureImageAlign: form.emailSignatureImageAlign,
            }
            updateUser(currentUser.id, patch)
            updateCurrentUserLocal(patch)
          }
          setSaved(true)
          setTimeout(() => setSaved(false), 2000)
        }}
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Personal Information</h4>
            <FormField label="Full Name">
              <input className={inputClass} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </FormField>
            <FormField label="Email">
              <input type="email" className={inputClass} value={form.email} disabled />
            </FormField>
            <FormField label="Phone">
              <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </FormField>
            <FormField label="Role">
              <input className={inputClass} value={currentUser?.role ?? ''} disabled />
            </FormField>
            {currentUser && (
              <SignatureEditor
                userId={currentUser.id}
                value={{
                  text: form.emailSignature,
                  imageUrl: form.emailSignatureImageUrl,
                  imageWidth: form.emailSignatureImageWidth,
                  imageAlign: form.emailSignatureImageAlign,
                }}
                onChange={(patch) =>
                  setForm((prev) => ({
                    ...prev,
                    ...(patch.text !== undefined ? { emailSignature: patch.text } : {}),
                    ...('imageUrl' in patch ? { emailSignatureImageUrl: patch.imageUrl } : {}),
                    ...('imageWidth' in patch ? { emailSignatureImageWidth: patch.imageWidth } : {}),
                    ...('imageAlign' in patch ? { emailSignatureImageAlign: patch.imageAlign } : {}),
                  }))
                }
              />
            )}
          </div>
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Preferences</h4>
            <FormField label="Language">
              <select className={inputClass} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                <option>English</option>
                <option>Afrikaans</option>
                <option>Zulu</option>
              </select>
            </FormField>
            <FormField label="Timezone">
              <input className={inputClass} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
            </FormField>
            <FormField label="Date Format">
              <select className={inputClass} value={form.dateFormat} onChange={(e) => setForm({ ...form, dateFormat: e.target.value })}>
                <option>DD MMM YYYY</option>
                <option>MM/DD/YYYY</option>
                <option>YYYY-MM-DD</option>
              </select>
            </FormField>
            <FormField label="Currency">
              <select className={inputClass} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option>ZAR - Rand</option>
                <option>USD - Dollar</option>
                <option>EUR - Euro</option>
              </select>
            </FormField>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-slate-100">
          <button type="submit" className="text-sm font-medium px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Save Changes
          </button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--c-green)]">
              <Check size={13} /> Saved
            </span>
          )}
        </div>
      </form>
    </Card>
  )
}

function UsersTab() {
  const { users, teams, updateUser, removeUserLocal } = useAppStore()
  const { currentUser, session } = useAuth()
  const isAdmin = currentUser?.role === 'Administrator'
  const [addOpen, setAddOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [removingUser, setRemovingUser] = useState<User | null>(null)
  const [emailUser, setEmailUser] = useState<User | null>(null)
  const [signatureUser, setSignatureUser] = useState<User | null>(null)

  return (
    <Card padded={false}>
      <div className="p-5 flex items-center justify-between">
        <CardHeader title="Users" subtitle={`${users.length} team members`} />
        {isAdmin && (
          <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 h-fit">
            <Plus size={15} /> Add User
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-t border-slate-100">
              <th className="font-medium px-5 py-2.5">User</th>
              <th className="font-medium px-3 py-2.5">Role</th>
              <th className="font-medium px-3 py-2.5">Team</th>
              <th className="font-medium px-3 py-2.5">Email</th>
              <th className="font-medium px-3 py-2.5">Status</th>
              {isAdmin && <th className="font-medium px-3 py-2.5">Login</th>}
              {isAdmin && <th className="font-medium px-3 py-2.5"></th>}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-50">
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <UserAvatar userId={u.id} size={26} />
                    <span className="font-medium text-slate-700">{u.name}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {isAdmin ? (
                    <select
                      className="text-sm text-slate-600 border border-slate-200 rounded-lg px-2 py-1 bg-white outline-none"
                      value={u.role}
                      onChange={(e) => updateUser(u.id, { role: e.target.value as UserRole })}
                    >
                      {(['Administrator', 'Sales Manager', 'Sales Representative', 'Liaison Manager', 'Liaison', 'Pre-legal Agent', 'Read Only'] as UserRole[]).map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-slate-500">{u.role}</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {isAdmin ? (
                    <select
                      className="text-sm text-slate-600 border border-slate-200 rounded-lg px-2 py-1 bg-white outline-none"
                      value={u.teamId ?? ''}
                      onChange={(e) => updateUser(u.id, { teamId: e.target.value || undefined })}
                    >
                      <option value="">No team</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-slate-500">{teams.find((t) => t.id === u.teamId)?.name ?? '—'}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-slate-500">{u.email}</td>
                <td className="px-3 py-2.5">
                  {isAdmin ? (
                    <button
                      onClick={() => updateUser(u.id, { status: u.status === 'Active' ? 'Inactive' : 'Active' })}
                      className={`badge ${u.status === 'Active' ? 'bg-[var(--tint-green)] text-[var(--c-green)]' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {u.status}
                    </button>
                  ) : (
                    <span className={`badge ${u.status === 'Active' ? 'bg-[var(--tint-green)] text-[var(--c-green)]' : 'bg-slate-100 text-slate-500'}`}>{u.status}</span>
                  )}
                </td>
                {isAdmin && (
                  <td className="px-3 py-2.5">
                    <ResetLoginButton email={u.email} />
                  </td>
                )}
                {isAdmin && (
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <button onClick={() => setEmailUser(u)} className="text-slate-400 hover:text-brand-600" title="Manage email connection">
                        <Mail size={14} />
                      </button>
                      <button onClick={() => setSignatureUser(u)} className="text-slate-400 hover:text-brand-600" title="Manage email signature">
                        <ImageIcon size={14} />
                      </button>
                      <button onClick={() => setEditingUser(u)} className="text-slate-400 hover:text-brand-600" title="Edit user">
                        <Pencil size={14} />
                      </button>
                      {u.id !== currentUser?.id && (
                        <button onClick={() => setRemovingUser(u)} className="text-slate-400 hover:text-[var(--c-rust-deep)]" title="Remove user">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {addOpen && session && <InviteUserModal accessToken={session.access_token} teams={teams} onClose={() => setAddOpen(false)} />}
      {editingUser && session && (
        <EditUserModal
          user={editingUser}
          accessToken={session.access_token}
          onClose={() => setEditingUser(null)}
          onSaveName={(name) => updateUser(editingUser.id, { name })}
        />
      )}
      {removingUser && session && (
        <RemoveUserModal
          user={removingUser}
          accessToken={session.access_token}
          onClose={() => setRemovingUser(null)}
          onRemoved={() => removeUserLocal(removingUser.id)}
        />
      )}
      {emailUser && session && (
        <AdminEmailConnectModal user={emailUser} accessToken={session.access_token} onClose={() => setEmailUser(null)} />
      )}
      {signatureUser && (
        <AdminSignatureModal user={signatureUser} onClose={() => setSignatureUser(null)} onSave={(patch) => updateUser(signatureUser.id, patch)} />
      )}
    </Card>
  )
}

function AdminSignatureModal({ user, onClose, onSave }: { user: User; onClose: () => void; onSave: (patch: Partial<User>) => void }) {
  const [value, setValue] = useState({
    text: user.emailSignature ?? '',
    imageUrl: user.emailSignatureImageUrl,
    imageWidth: user.emailSignatureImageWidth,
    imageAlign: user.emailSignatureImageAlign,
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onSave({
      emailSignature: value.text || undefined,
      emailSignatureImageUrl: value.imageUrl,
      emailSignatureImageWidth: value.imageWidth,
      emailSignatureImageAlign: value.imageAlign,
    })
    onClose()
  }

  return (
    <Modal title={`Email Signature — ${user.name}`} onClose={onClose} width={460}>
      <form onSubmit={handleSubmit}>
        <SignatureEditor userId={user.id} value={value} onChange={(patch) => setValue((prev) => ({ ...prev, ...patch }))} />
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Save Changes
          </button>
        </div>
      </form>
    </Modal>
  )
}

function AdminEmailConnectModal({ user, accessToken, onClose }: { user: User; accessToken: string; onClose: () => void }) {
  const [status, setStatus] = useState<EmailStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ email: user.email, password: '', smtpHost: '', smtpPort: '587', imapHost: '', imapPort: '993' })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch(`/api/email/status?targetUserId=${encodeURIComponent(user.id)}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((res) => res.json())
      .then((body) => setStatus(body))
      .catch(() => setStatus({ connected: false }))
      .finally(() => setLoading(false))
  }, [accessToken, user.id])

  async function handleConnect(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/email/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          targetUserId: user.id,
          email: form.email.trim(),
          password: form.password,
          smtpHost: form.smtpHost.trim(),
          smtpPort: Number(form.smtpPort),
          imapHost: form.imapHost.trim(),
          imapPort: Number(form.imapPort),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Could not connect that mailbox.')
        setSubmitting(false)
        return
      }
      setStatus({ connected: true, email: form.email.trim(), lastSyncedAt: null })
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm(`Disconnect ${user.name}'s mailbox?`)) return
    await fetch('/api/email/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ targetUserId: user.id }),
    })
    setStatus({ connected: false })
  }

  return (
    <Modal title={`Email — ${user.name}`} onClose={onClose} width={480}>
      {loading ? (
        <p className="text-sm text-slate-400">Checking connection…</p>
      ) : status?.connected ? (
        <div>
          <p className="text-sm text-slate-700">
            Connected as <span className="font-medium">{status.email}</span>
          </p>
          {status.lastSyncedAt && <p className="text-xs text-slate-400 mt-1">Last synced {new Date(status.lastSyncedAt).toLocaleString()}</p>}
          <div className="flex justify-end mt-4">
            <button onClick={handleDisconnect} className="text-sm font-medium px-4 py-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100">
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleConnect}>
          <p className="text-xs text-slate-400 mb-4">
            Enter {user.name}'s mailbox credentials to connect it on their behalf. Find the SMTP/IMAP host and port under Email Accounts →
            Connect Devices (or Configure Mail Client) in ConsoleH / webmail.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormField label="Email Address" required>
              <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </FormField>
            <FormField label="Password" required>
              <input className={inputClass} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </FormField>
            <FormField label="SMTP Host" required>
              <input className={inputClass} placeholder="mail.yourdomain.co.za" value={form.smtpHost} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} required />
            </FormField>
            <FormField label="SMTP Port" required>
              <input className={inputClass} type="number" value={form.smtpPort} onChange={(e) => setForm({ ...form, smtpPort: e.target.value })} required />
            </FormField>
            <FormField label="IMAP Host" required>
              <input className={inputClass} placeholder="mail.yourdomain.co.za" value={form.imapHost} onChange={(e) => setForm({ ...form, imapHost: e.target.value })} required />
            </FormField>
            <FormField label="IMAP Port" required>
              <input className={inputClass} type="number" value={form.imapPort} onChange={(e) => setForm({ ...form, imapPort: e.target.value })} required />
            </FormField>
          </div>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={onClose} className="text-sm font-medium px-4 py-2 rounded-lg text-slate-500 hover:bg-slate-100">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="text-sm font-medium px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
              {submitting ? 'Connecting…' : 'Connect Mailbox'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

/**
 * Covers the "invited but never actually able to log in" case (an invite
 * link signs someone in once but doesn't let them set a password — see
 * SetPasswordPage) — this sends the same kind of email a "Forgot password"
 * click would, which works for any existing user regardless of whether
 * they ever completed setup.
 */
function ResetLoginButton({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setState('sending')
    setError(null)
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${PRODUCTION_APP_URL}/login` })
    if (sendError) {
      setState('idle')
      setError(sendError.message)
      return
    }
    setState('sent')
  }

  if (state === 'sent') {
    return <span className="text-xs text-[var(--c-green)]">Reset link sent</span>
  }
  return (
    <div>
      <button onClick={handleClick} disabled={state === 'sending'} className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50">
        {state === 'sending' ? 'Sending…' : 'Send login link'}
      </button>
      {error && <p className="text-[11px] text-[var(--c-rust-deep)] mt-0.5 max-w-[160px]">{error}</p>}
    </div>
  )
}

function EditUserModal({
  user,
  accessToken,
  onClose,
  onSaveName,
}: {
  user: User
  accessToken: string
  onClose: () => void
  onSaveName: (name: string) => void
}) {
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return
    setSubmitting(true)
    setError(null)
    if (name.trim() !== user.name) onSaveName(name.trim())
    if (email.trim() !== user.email) {
      try {
        const res = await fetch('/api/update-user-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ userId: user.id, email: email.trim() }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(body.error ?? 'Something went wrong updating the email.')
          setSubmitting(false)
          return
        }
      } catch {
        setError('Could not reach the server. Please try again.')
        setSubmitting(false)
        return
      }
    }
    setSubmitting(false)
    onClose()
  }

  return (
    <Modal title="Edit User" onClose={onClose} width={400}>
      <form onSubmit={handleSubmit}>
        <FormField label="Name" required>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </FormField>
        <FormField label="Email" required>
          <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} required />
        </FormField>
        {email.trim() !== user.email && (
          <p className="text-xs text-slate-400 mb-3.5 -mt-2">Changing the email changes their login — they'll need to sign in with the new address.</p>
        )}
        {error && <p className="text-sm text-[var(--c-rust-deep)] mb-3.5">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function RemoveUserModal({
  user,
  accessToken,
  onClose,
  onRemoved,
}: {
  user: User
  accessToken: string
  onClose: () => void
  onRemoved: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ userId: user.id }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Something went wrong removing this user.')
        setSubmitting(false)
        return
      }
      onRemoved()
      onClose()
    } catch {
      setError('Could not reach the server. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Modal title="Remove User" onClose={onClose} width={380}>
      <p className="text-sm text-slate-600 leading-relaxed mb-1">
        Remove <b>{user.name}</b> ({user.email})? They'll no longer be able to log in. Records they own (leads, deals, etc.) are kept, not deleted.
      </p>
      <p className="text-sm text-[var(--c-rust-deep)] mb-3.5">This can't be undone.</p>
      {error && <p className="text-sm text-[var(--c-rust-deep)] mb-3.5">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={submitting}
          className="text-sm font-medium px-3.5 py-2 rounded-lg bg-[var(--c-rust-deep)] text-white hover:bg-[var(--c-rust-deep-hover)] disabled:opacity-50"
        >
          {submitting ? 'Removing…' : 'Remove User'}
        </button>
      </div>
    </Modal>
  )
}

const INVITE_ROLES: UserRole[] = ['Administrator', 'Sales Manager', 'Sales Representative', 'Liaison Manager', 'Liaison', 'Pre-legal Agent', 'Read Only']

function InviteUserModal({ accessToken, teams, onClose }: { accessToken: string; teams: Team[]; onClose: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('Sales Representative')
  const [teamId, setTeamId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ email, name: name || undefined, role, teamId: teamId || undefined }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Something went wrong sending the invite.')
        return
      }
      setSent(true)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <Modal title="Add User" onClose={onClose} width={420}>
        <p className="text-sm text-slate-600 leading-relaxed">
          Invite sent to <span className="font-medium text-slate-800">{email}</span>. They'll get an email to set their password, and will appear in this
          list with the role{teamId ? ' and team' : ''} you just set once they accept.
        </p>
        <div className="flex justify-end mt-4 pt-3 border-t border-slate-100">
          <button onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Done
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Add User" onClose={onClose} width={420}>
      <form onSubmit={handleSubmit}>
        <FormField label="Full Name (optional)">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </FormField>
        <FormField label="Email" required>
          <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} required />
        </FormField>
        <FormField label="Role" required>
          <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {INVITE_ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Team (optional)">
          <select className={inputClass} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">No team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </FormField>
        {error && <p className="text-sm text-[var(--c-rust-deep)] mb-3.5">{error}</p>}
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {submitting ? 'Sending…' : 'Send Invite'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Where the numbers get set.
 *
 * Two scopes on purpose. A target on the team is the team's total; a target on a person is
 * theirs alone. Neither implies the other and the business genuinely uses both — "we want 75
 * mandates a month" is a team number, while "nobody signs fewer than 15" is a personal one —
 * so this offers both rather than picking one and forcing the other to be derived from it.
 *
 * Each metric takes a goal and, optionally, a floor. That is how the targets were actually
 * described ("fifty is the minimum, we want seventy-five"), and a single figure would throw
 * away the half people are held to.
 *
 * A blank or zero goal clears the target rather than storing a goal of nothing.
 */
function TargetsTab() {
  const { teams, users, targets, setTarget } = useAppStore()
  const { currentUser } = useAuth()
  const canEdit = currentUser?.role === 'Administrator' || currentUser?.role === 'Sales Manager'

  const [scopeType, setScopeType] = useState<'team' | 'user'>('team')
  const [scopeId, setScopeId] = useState<string>('')

  const assignable = useMemo(() => users.filter((u) => u.status === 'Active'), [users])
  const options: { id: string; name: string }[] = scopeType === 'team' ? teams : assignable
  const effectiveScopeId = scopeId && options.some((o) => o.id === scopeId) ? scopeId : (options[0]?.id ?? '')
  const periodKey = getCurrentSalesMonth(TODAY).key

  return (
    <Card>
      <CardHeader
        title="Targets"
        subtitle="What a team or a person is expected to produce in a sales month. Set once and it applies every month until you change it."
      />

      <div className="flex flex-wrap gap-3 mb-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Set targets for</span>
          <select
            value={scopeType}
            onChange={(e) => {
              setScopeType(e.target.value as 'team' | 'user')
              setScopeId('')
            }}
            className={inputClass}
          >
            <option value="team">A team</option>
            <option value="user">One person</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 min-w-[220px]">
          <span className="text-xs font-medium text-slate-500">{scopeType === 'team' ? 'Team' : 'Person'}</span>
          <select value={effectiveScopeId} onChange={(e) => setScopeId(e.target.value)} className={inputClass}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
            {options.length === 0 && <option value="">None yet</option>}
          </select>
        </label>
      </div>

      {!canEdit && (
        <p className="text-sm text-slate-400 mb-4">
          You can see the targets but not change them &mdash; that is an Administrator or Sales Manager job.
        </p>
      )}

      {effectiveScopeId ? (
        <div className="space-y-3 max-w-3xl">
          <div className="hidden sm:grid grid-cols-[1fr_130px_130px] gap-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400 px-1">
            <span>Metric</span>
            <span>Target</span>
            <span>Minimum</span>
          </div>
          {TARGET_METRICS.map((def) => (
            <TargetRow
              key={def.id}
              metricId={def.id}
              label={def.label}
              description={def.description}
              unit={def.unit}
              existing={resolveTarget(targets, scopeType, effectiveScopeId, def.id, periodKey)}
              disabled={!canEdit}
              onSave={(targetValue, thresholdValue) =>
                setTarget({ scopeType, scopeId: effectiveScopeId, metric: def.id, targetValue, thresholdValue })
              }
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400">Create a {scopeType === 'team' ? 'team' : 'user'} first, then set its targets here.</p>
      )}
    </Card>
  )
}

function TargetRow({
  metricId,
  label,
  description,
  unit,
  existing,
  disabled,
  onSave,
}: {
  metricId: TargetMetric
  label: string
  description: string
  unit: 'count' | 'currency'
  existing?: Target
  disabled: boolean
  onSave: (targetValue: number, thresholdValue?: number) => void
}) {
  const [target, setTargetValue] = useState(existing ? String(existing.targetValue) : '')
  const [floor, setFloor] = useState(existing?.thresholdValue != null ? String(existing.thresholdValue) : '')

  // The stored value is the source of truth; re-sync when it changes underneath (another
  // admin saving, or the scope selector switching to a different team).
  useEffect(() => {
    setTargetValue(existing ? String(existing.targetValue) : '')
    setFloor(existing?.thresholdValue != null ? String(existing.thresholdValue) : '')
  }, [existing?.id, existing?.targetValue, existing?.thresholdValue])

  function commit() {
    const t = Number(target)
    const f = floor.trim() === '' ? undefined : Number(floor)
    if (Number.isNaN(t) || (f !== undefined && Number.isNaN(f))) return
    const nextTarget = target.trim() === '' ? 0 : t
    if (nextTarget === (existing?.targetValue ?? 0) && f === existing?.thresholdValue) return
    onSave(nextTarget, f)
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_130px_130px] gap-3 items-center py-2 border-t border-slate-50">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-700">
          {label}
          {unit === 'currency' && <span className="ml-1.5 text-[11px] font-normal text-slate-400">in rand</span>}
        </p>
        <p className="text-[11.5px] text-slate-400 leading-snug">{description}</p>
      </div>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={target}
        disabled={disabled}
        onChange={(e) => setTargetValue(e.target.value)}
        onBlur={commit}
        placeholder="—"
        aria-label={`${label} target`}
        className={inputClass}
      />
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={floor}
        disabled={disabled}
        onChange={(e) => setFloor(e.target.value)}
        onBlur={commit}
        placeholder="optional"
        aria-label={`${label} minimum`}
        className={inputClass}
      />
      {existing && unit === 'currency' && (
        <p className="sm:col-span-3 text-[11px] text-slate-400 -mt-1">
          {formatCurrency(existing.targetValue)} a month
          {existing.thresholdValue != null && `, minimum ${formatCurrency(existing.thresholdValue)}`}
        </p>
      )}
      <input type="hidden" value={metricId} readOnly />
    </div>
  )
}

function TeamsTab() {
  const { teams, users, addTeam, updateTeam, deleteTeam, updateUser } = useAppStore()
  const { currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'Administrator'
  const [name, setName] = useState('')
  const [kind, setKind] = useState<TeamKind>('Sales')
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [removingTeam, setRemovingTeam] = useState<{ id: string; name: string } | null>(null)

  return (
    <Card>
      <CardHeader title="Teams" subtitle="Group salespeople into teams" />
      <div className="space-y-3">
        {teams.map((t) => {
          const unassigned = users.filter((u) => u.teamId !== t.id)
          return (
            <div key={t.id} className="border border-slate-100 rounded-xl p-3.5">
              <div className="flex items-center justify-between">
                {editingTeamId === t.id ? (
                  <form
                    className="flex items-center gap-2 flex-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!editingName.trim()) return
                      updateTeam(t.id, { name: editingName.trim() })
                      setEditingTeamId(null)
                    }}
                  >
                    <input
                      autoFocus
                      className={`${inputClass} text-sm py-1`}
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                    />
                    <button type="submit" className="text-brand-600 hover:text-brand-700" title="Save">
                      <Check size={16} />
                    </button>
                    <button type="button" onClick={() => setEditingTeamId(null)} className="text-slate-400 hover:text-slate-600" title="Cancel">
                      <X size={16} />
                    </button>
                  </form>
                ) : (
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-slate-700">{t.name}</p>
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md ${t.kind === 'Communications' ? 'bg-[var(--tint-steel)] text-[var(--c-navy)]' : 'bg-[var(--tint-gold)] text-[var(--c-gold-deep)]'}`}
                      >
                        {t.kind}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">{t.memberIds.length} members</p>
                  </div>
                )}
                {isAdmin && editingTeamId !== t.id && (
                  <div className="flex items-center gap-2.5 shrink-0">
                    <select
                      value={t.kind}
                      onChange={(e) => updateTeam(t.id, { kind: e.target.value as TeamKind })}
                      className="text-xs text-slate-500 border border-slate-200 rounded-lg px-2 py-1 bg-white outline-none"
                      title="Which dashboard this team's members land on"
                    >
                      <option value="Sales">Sales</option>
                      <option value="Communications">Communications</option>
                    </select>
                    <button
                      onClick={() => {
                        setEditingTeamId(t.id)
                        setEditingName(t.name)
                      }}
                      className="text-slate-400 hover:text-brand-600"
                      title="Rename team"
                    >
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => setRemovingTeam({ id: t.id, name: t.name })} className="text-slate-400 hover:text-[var(--c-rust-deep)]" title="Delete team">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {t.memberIds.map((id) => {
                  const member = users.find((u) => u.id === id)
                  return (
                    <div key={id} className="flex items-center gap-1.5 bg-slate-50 rounded-full pl-1 pr-2 py-1">
                      <UserAvatar userId={id} size={20} />
                      <span className="text-xs text-slate-600">{member?.name ?? 'Unknown'}</span>
                      {isAdmin && (
                        <button onClick={() => updateUser(id, { teamId: undefined })} className="text-slate-400 hover:text-[var(--c-rust-deep)]" title="Remove from team">
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
              {isAdmin && unassigned.length > 0 && (
                <select
                  className="text-sm text-slate-500 border border-slate-200 rounded-lg px-2 py-1 bg-white outline-none mt-2.5"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) updateUser(e.target.value, { teamId: t.id })
                  }}
                >
                  <option value="">+ Add member…</option>
                  {unassigned.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )
        })}
      </div>
      {isAdmin && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            addTeam({ name, kind })
            setName('')
            setKind('Sales')
          }}
          className="flex gap-2 mt-4 pt-4 border-t border-slate-100"
        >
          <input className={inputClass} placeholder="New team name" value={name} onChange={(e) => setName(e.target.value)} />
          <select value={kind} onChange={(e) => setKind(e.target.value as TeamKind)} className={`${inputClass} w-40 shrink-0`}>
            <option value="Sales">Sales</option>
            <option value="Communications">Communications</option>
          </select>
          <button type="submit" className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 shrink-0">
            <Plus size={15} /> Add Team
          </button>
        </form>
      )}
      {removingTeam && (
        <Modal title="Remove team" onClose={() => setRemovingTeam(null)}>
          <p className="text-sm text-slate-600">
            Remove <span className="font-medium text-slate-800">{removingTeam.name}</span>? Its members won't be deleted, they'll just no longer belong to a team. This can't be undone.
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setRemovingTeam(null)} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button
              onClick={() => {
                deleteTeam(removingTeam.id)
                setRemovingTeam(null)
              }}
              className="text-sm font-medium px-3.5 py-2 rounded-lg bg-[var(--c-rust-deep)] text-white hover:bg-[var(--c-rust-hover)]"
            >
              Remove
            </button>
          </div>
        </Modal>
      )}
    </Card>
  )
}

function PipelinesTab() {
  const [stages, setStages] = useState<string[]>([...DEAL_STAGES]);
  const [name, setName] = useState('')
  return (
    <Card>
      <CardHeader title="Pipelines" subtitle="Customise your sales pipeline stages" />
      <div className="space-y-2">
        {stages.map((s, i) => (
          <div key={s} className="flex items-center gap-3 border border-slate-100 rounded-lg px-3.5 py-2.5">
            <span className="text-xs text-slate-400 w-5">{i + 1}</span>
            <span className="text-sm font-medium text-slate-700 flex-1">{s}</span>
            {!(['Won', 'Rejected'] as string[]).includes(s) && (
              <button onClick={() => setStages((prev) => prev.filter((x) => x !== s))} className="p-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50">
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          setStages((prev) => [...prev.slice(0, -2), name, ...prev.slice(-2)])
          setName('')
        }}
        className="flex gap-2 mt-4 pt-4 border-t border-slate-100"
      >
        <input className={inputClass} placeholder="New stage name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 shrink-0">
          <Plus size={15} /> Add Stage
        </button>
      </form>
    </Card>
  )
}

const FIELD_TYPES: CustomFieldType[] = ['Text', 'Number', 'Currency', 'Date', 'Dropdown', 'Multi-select', 'Checkbox', 'URL', 'Email', 'Phone']

function CustomFieldsTab() {
  const [fields, setFields] = useState<CustomField[]>(initialCustomFields)
  const [addOpen, setAddOpen] = useState(false)

  return (
    <Card padded={false}>
      <div className="p-5 flex items-center justify-between">
        <CardHeader title="Custom Fields" subtitle="Add fields without developer changes" />
        <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 h-fit">
          <Plus size={15} /> Add Custom Field
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-t border-slate-100">
              <th className="font-medium px-5 py-2.5">Field</th>
              <th className="font-medium px-3 py-2.5">Related To</th>
              <th className="font-medium px-3 py-2.5">Type</th>
              <th className="font-medium px-3 py-2.5">Status</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.id} className="border-t border-slate-50">
                <td className="px-5 py-2.5 font-medium text-slate-700">{f.name}</td>
                <td className="px-3 py-2.5 text-slate-500">{f.relatedTo}</td>
                <td className="px-3 py-2.5 text-slate-500">{f.type}</td>
                <td className="px-3 py-2.5">
                  <span className={`badge ${f.status === 'Active' ? 'bg-[var(--tint-green)] text-[var(--c-green)]' : 'bg-slate-100 text-slate-500'}`}>{f.status}</span>
                </td>
                <td className="px-3 py-2.5">
                  <button onClick={() => setFields((prev) => prev.filter((x) => x.id !== f.id))} className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {addOpen && (
        <AddCustomFieldModal
          onClose={() => setAddOpen(false)}
          onSave={(f) => setFields((prev) => [...prev, { ...f, id: `cf${prev.length + 1}`, status: 'Active' }])}
        />
      )}
    </Card>
  )
}

function AddCustomFieldModal({ onClose, onSave }: { onClose: () => void; onSave: (f: { name: string; relatedTo: CustomField['relatedTo']; type: CustomFieldType }) => void }) {
  const [form, setForm] = useState<{ name: string; relatedTo: CustomField['relatedTo']; type: CustomFieldType }>({ name: '', relatedTo: 'Leads', type: 'Text' })
  return (
    <Modal title="Add Custom Field" onClose={onClose} width={400}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.name) return
          onSave(form)
          onClose()
        }}
      >
        <FormField label="Field Name" required>
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus placeholder="e.g. Contract Length" />
        </FormField>
        <FormField label="Related To">
          <select className={inputClass} value={form.relatedTo} onChange={(e) => setForm({ ...form, relatedTo: e.target.value as CustomField['relatedTo'] })}>
            {(['Leads', 'Deals', 'Contacts', 'Companies'] as CustomField['relatedTo'][]).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Field Type">
          <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CustomFieldType })}>
            {FIELD_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Add Field
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Picking a skin. Each option is shown as the thing it produces rather than described in
 * words — a name and a paragraph can't tell you what an interface will feel like, and a
 * three-colour tile can.
 */
function AppearanceTab() {
  const { themeId, setTheme, theme } = useTheme()
  const { celebrate } = useAppStore()
  const [sound, setSound] = useState(celebrationSoundEnabled)
  return (
    <Card>
      <CardHeader title="Appearance" subtitle={`Choose how ${theme.productName} looks. This changes nothing but the styling, and applies to you only.`} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        {THEMES.map((t) => {
          const selected = t.id === themeId
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              aria-pressed={selected}
              className={`text-left rounded-xl border p-3 transition-colors ${
                selected ? 'border-gold-500 ring-1 ring-gold-500/40 bg-gold-500/5' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span
                className="flex h-20 rounded-lg overflow-hidden border border-black/5"
                style={{ backgroundColor: t.swatch.surface }}
                aria-hidden="true"
              >
                <span className="w-1/3 flex flex-col justify-between p-1.5" style={{ backgroundColor: t.swatch.ground }}>
                  <span className="block h-1.5 w-8 rounded-full" style={{ backgroundColor: t.swatch.accent }} />
                  <span className="block h-1 w-6 rounded-full bg-white/25" />
                </span>
                <span className="flex-1 p-2 flex flex-col gap-1.5">
                  <span className="block h-2.5 w-2/3 rounded" style={{ backgroundColor: t.swatch.ground, opacity: 0.85 }} />
                  <span className="block h-1.5 w-1/2 rounded bg-black/10" />
                  <span className="mt-auto block h-1.5 w-1/3 rounded-full" style={{ backgroundColor: t.swatch.accent }} />
                </span>
              </span>
              <span className="flex items-center justify-between gap-2 mt-2.5">
                <span className="text-sm font-semibold text-slate-700">{t.name}</span>
                {selected && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gold-600">
                    <Check size={12} /> Selected
                  </span>
                )}
              </span>
              <span className="block text-xs text-slate-400 mt-0.5">{t.description}</span>
            </button>
          )
        })}
      </div>

      {/* A way to fire the celebration without closing a real deal. It exists because "I can't
          see it" and "it isn't working" look identical from here, and one button settles it —
          it also lets someone show the team what they're working towards. */}
      <div className="mt-6 pt-5 border-t border-slate-100">
        <p className="text-sm font-medium text-slate-600">Celebration</p>
        <p className="text-xs text-slate-400 mt-0.5 mb-2.5 max-w-md">
          The bird takes off when a deal is won, a mandate is signed, or a lead becomes a client. Every{' '}
          {MANDATE_MILESTONE_EVERY} mandates and every {DEAL_MILESTONE_EVERY} deals you close in a sales month, it
          comes back bigger and with a sound. If your device has Reduce Motion switched on, you'll get the wording
          without the flight.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => celebrate({ message: 'Mandate signed', intensity: 'win' })}
            className="text-sm font-medium px-3.5 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Preview a win
          </button>
          <button
            type="button"
            onClick={() => celebrate({ message: `${MANDATE_MILESTONE_EVERY} mandates this month`, intensity: 'milestone' })}
            className="text-sm font-medium px-3.5 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Preview a milestone
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !sound
              setSound(next)
              setCelebrationSoundEnabled(next)
            }}
            aria-pressed={sound}
            className={`inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border transition-colors ${
              sound ? 'border-gold-500 bg-gold-500/5 text-gold-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            {sound ? <Volume2 size={14} /> : <VolumeX size={14} />}
            Milestone sound {sound ? 'on' : 'off'}
          </button>
        </div>
      </div>
    </Card>
  )
}

function StringListTab({ title, initial }: { title: string; initial: string[] }) {
  const [items, setItems] = useState<string[]>(initial)
  const [value, setValue] = useState('')
  return (
    <Card>
      <CardHeader title={title} />
      <div className="flex flex-wrap gap-2 mb-4">
        {items.map((item) => (
          <span key={item} className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-600 text-sm font-medium px-3 py-1.5 rounded-full">
            {item}
            <button onClick={() => setItems((prev) => prev.filter((x) => x !== item))} className="text-slate-400 hover:text-red-500">
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!value.trim() || items.includes(value.trim())) return
          setItems((prev) => [...prev, value.trim()])
          setValue('')
        }}
        className="flex gap-2"
      >
        <input className={inputClass} placeholder={`Add ${title.toLowerCase().slice(0, -1)}`} value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="submit" className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 shrink-0">
          <Plus size={15} /> Add
        </button>
      </form>
      {title === 'Lead Sources' && (
        <p className="text-xs text-slate-400 mt-3">Also used across Industries such as: {industries.slice(0, 4).join(', ')}…</p>
      )}
    </Card>
  )
}

const NOTIFICATION_TYPES = [
  'New lead assigned',
  'Task due',
  'Task overdue',
  'Meeting starting',
  'Proposal viewed',
  'Proposal accepted',
  'Deal inactive',
  'Deal moved',
  'Deal won',
  'Lead reassigned',
]

function NotificationsTab() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, true])))
  return (
    <Card>
      <CardHeader title="Notifications" subtitle="Choose which events notify you" />
      <div className="divide-y divide-slate-50">
        {NOTIFICATION_TYPES.map((t) => (
          <div key={t} className="flex items-center justify-between py-2.5">
            <span className="text-sm text-slate-700">{t}</span>
            <Toggle checked={enabled[t]} onChange={(v) => setEnabled((prev) => ({ ...prev, [t]: v }))} />
          </div>
        ))}
      </div>
    </Card>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`w-10 h-5.5 rounded-full transition-colors relative shrink-0 ${checked ? 'bg-brand-600' : 'bg-slate-200'}`}
      style={{ height: 22 }}
    >
      <span className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[19px]' : 'translate-x-0.5'}`} style={{ width: 18, height: 18 }} />
    </button>
  )
}

const INTEGRATIONS = [
  { name: 'Google Calendar', desc: 'Sync meetings and tasks to Google Calendar' },
  { name: 'Outlook Calendar', desc: 'Sync meetings and tasks to Outlook' },
  { name: 'WhatsApp', desc: 'Log WhatsApp conversations with leads' },
  { name: 'Website Forms', desc: 'Auto-capture leads from your website' },
  { name: 'Google Ads', desc: 'Import leads from Google Ads campaigns' },
]

function IntegrationsTab() {
  const [connected, setConnected] = useState<Record<string, boolean>>({})
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <EmailIntegrationCard />
      <BuzzBoxIntegrationCard />
      {INTEGRATIONS.map((i) => (
        <Card key={i.name} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">{i.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{i.desc}</p>
            </div>
            <button
              onClick={() => setConnected((prev) => ({ ...prev, [i.name]: !prev[i.name] }))}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg shrink-0 ${connected[i.name] ? 'bg-[var(--tint-green)] text-[var(--c-green)]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            >
              {connected[i.name] ? 'Connected' : 'Connect'}
            </button>
          </div>
        </Card>
      ))}
    </div>
  )
}

type BuzzBoxExtension = { extension: string; name: string; email: string }

/**
 * BuzzBox Cloud PABX — click to dial.
 *
 * Two halves. An Administrator connects the firm's BuzzBox login once (the password is stored
 * encrypted server-side and never comes back to the browser). Then each person picks which
 * extension is theirs, and every phone number in the app becomes a button that rings that
 * extension and bridges the call, logging it on the record it was dialled from.
 */
function BuzzBoxIntegrationCard() {
  const { session, currentUser, reloadProfile } = useAuth()
  const { users, updateUser } = useAppStore()
  const { status, loading, refresh } = useBuzzBox()
  const accessToken = session?.access_token
  const isAdmin = currentUser?.role === 'Administrator'

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ identity: '', password: '', organisationId: '' })
  const [orgChoices, setOrgChoices] = useState<{ organisationId: number; name: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [extensions, setExtensions] = useState<BuzzBoxExtension[] | null>(null)
  const [extensionsError, setExtensionsError] = useState<string | null>(null)
  const [savingFor, setSavingFor] = useState<string | null>(null)

  const connected = !!status?.connected

  useEffect(() => {
    if (!accessToken || !connected) {
      setExtensions(null)
      return
    }
    let active = true
    fetch('/api/buzzbox/extensions', { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!active) return
        if (!res.ok) {
          setExtensionsError(body.error ?? 'Could not load extensions from BuzzBox.')
          setExtensions([])
        } else {
          setExtensionsError(null)
          setExtensions(body.extensions ?? [])
        }
      })
      .catch(() => {
        if (!active) return
        setExtensionsError('Could not reach the server.')
        setExtensions([])
      })
    return () => {
      active = false
    }
  }, [accessToken, connected])

  async function handleConnect(e: FormEvent) {
    e.preventDefault()
    if (!accessToken) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/buzzbox/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          identity: form.identity.trim(),
          password: form.password,
          organisationId: form.organisationId.trim() || undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 409 && Array.isArray(body.organisations)) {
        // More than one PABX organisation behind this login — ask which, then resubmit.
        setOrgChoices(body.organisations)
        setForm((f) => ({ ...f, organisationId: String(body.organisations[0]?.organisationId ?? '') }))
        setError(body.error ?? null)
        return
      }
      if (!res.ok) {
        setError(body.error ?? 'Could not connect BuzzBox.')
        return
      }
      setShowForm(false)
      setOrgChoices(null)
      setForm({ identity: '', password: '', organisationId: '' })
      await refresh()
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDisconnect() {
    if (!accessToken) return
    if (!confirm('Disconnect BuzzBox? Click-to-dial will stop for everyone; phone numbers go back to opening the device dialler.')) return
    await fetch('/api/buzzbox/disconnect', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } })
    await refresh()
  }

  async function setExtensionFor(userId: string, extension: string) {
    setSavingFor(userId)
    updateUser(userId, { buzzboxExtension: extension || undefined })
    // updateUser is optimistic and fire-and-forget; give the write a moment to land before
    // re-reading, so the status (and therefore every PhoneLink) reflects the new extension.
    await new Promise((resolve) => setTimeout(resolve, 400))
    if (userId === currentUser?.id) {
      reloadProfile()
      await refresh()
    }
    setSavingFor(null)
  }

  const extensionOptions = extensions ?? []

  const activeUsers = users.filter((u) => u.status === 'Active')

  return (
    <Card className="p-4 md:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
            <PhoneCall size={16} />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">BuzzBox Cloud (PABX click-to-dial)</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {loading
                ? 'Checking connection…'
                : connected
                ? `Connected as ${status?.identity}${status?.organisationName ? ` · ${status.organisationName}` : ''} (organisation ${status?.organisationId})`
                : 'Click any phone number to ring your extension and bridge the call, logged as a Call on the record'}
            </p>
          </div>
        </div>
        {!loading && !connected && !showForm && isAdmin && (
          <button
            onClick={() => setShowForm(true)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg shrink-0 bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center gap-1.5"
          >
            <Link2 size={13} /> Connect
          </button>
        )}
        {connected && isAdmin && (
          <button
            onClick={handleDisconnect}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 flex items-center gap-1.5 shrink-0"
          >
            <Unlink size={13} /> Disconnect
          </button>
        )}
      </div>

      {!loading && !connected && !isAdmin && (
        <p className="text-xs text-slate-400 mt-3">Ask an administrator to connect the firm's BuzzBox account here.</p>
      )}

      {showForm && !connected && isAdmin && (
        <form onSubmit={handleConnect} className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormField label="BuzzBox login (identity)" required>
            <input className={inputClass} autoComplete="off" placeholder="admin@yourfirm.co.za" value={form.identity} onChange={(e) => setForm({ ...form, identity: e.target.value })} required />
          </FormField>
          <FormField label="Password" required>
            <input className={inputClass} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </FormField>
          {orgChoices ? (
            <FormField label="Organisation" required>
              <select className={inputClass} value={form.organisationId} onChange={(e) => setForm({ ...form, organisationId: e.target.value })}>
                {orgChoices.map((o) => (
                  <option key={o.organisationId} value={o.organisationId}>
                    {o.name} ({o.organisationId})
                  </option>
                ))}
              </select>
            </FormField>
          ) : (
            <FormField label="Organisation ID (optional)">
              <input className={inputClass} placeholder="Found automatically when the login has one organisation" value={form.organisationId} onChange={(e) => setForm({ ...form, organisationId: e.target.value })} />
            </FormField>
          )}
          <p className="text-xs text-slate-400 md:col-span-2 -mt-1">
            The same login you use for the BuzzBox portal. It is stored encrypted on the server and is never sent to anyone's browser.
          </p>
          {error && <p className="text-xs text-red-600 md:col-span-2">{error}</p>}
          <div className="md:col-span-2 flex items-center gap-2">
            <button type="submit" disabled={submitting} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
              {submitting ? 'Connecting…' : 'Connect BuzzBox'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setError(null); setOrgChoices(null) }} className="text-xs font-medium px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
              Cancel
            </button>
          </div>
        </form>
      )}

      {connected && currentUser && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
            <FormField label="Your extension">
              <ExtensionPicker value={currentUser.buzzboxExtension} options={extensionOptions} saving={savingFor === currentUser.id} onChange={(ext) => void setExtensionFor(currentUser.id, ext)} />
            </FormField>
            <p className="text-xs text-slate-400">
              {status?.extension
                ? `Clicking a number rings extension ${status.extension} first; pick up and BuzzBox dials the number.`
                : 'Until you pick an extension, phone numbers open your device’s own dialler.'}
            </p>
          </div>
          {extensionsError && <p className="text-xs text-amber-600">{extensionsError} You can still type an extension number.</p>}

          {isAdmin && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-2">Everyone’s extensions</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                      <th className="font-medium px-2 py-1.5">Person</th>
                      <th className="font-medium px-2 py-1.5 w-72">Extension</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeUsers.map((u) => (
                      <tr key={u.id} className="border-b border-slate-50">
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <UserAvatar userId={u.id} size={22} />
                            <span className="text-slate-700">{u.name}</span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <ExtensionPicker value={u.buzzboxExtension} options={extensionOptions} saving={savingFor === u.id} onChange={(ext) => void setExtensionFor(u.id, ext)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

/** Pick an extension from BuzzBox's list, or type one when the list could not be loaded. */
function ExtensionPicker({ value, options, saving, onChange }: { value?: string; options: BuzzBoxExtension[]; saving: boolean; onChange: (extension: string) => void }) {
  if (options.length === 0) {
    return (
      <input
        className={inputClass}
        placeholder="e.g. 201"
        defaultValue={value ?? ''}
        disabled={saving}
        onBlur={(e) => {
          const next = e.target.value.trim()
          if (next !== (value ?? '')) onChange(next)
        }}
      />
    )
  }
  const known = options.some((x) => x.extension === value)
  return (
    <select className={inputClass} value={value ?? ''} disabled={saving} onChange={(e) => onChange(e.target.value)}>
      <option value="">— No extension (use device dialler) —</option>
      {value && !known && <option value={value}>{value} (not in BuzzBox list)</option>}
      {options.map((x) => (
        <option key={x.extension} value={x.extension}>
          {x.name ? `${x.extension} — ${x.name}` : x.extension}
        </option>
      ))}
    </select>
  )
}

type EmailStatus = { connected: boolean; email?: string; lastSyncedAt?: string | null }

function EmailIntegrationCard() {
  const { session } = useAuth()
  const { refreshSyncedData } = useAppStore()
  const accessToken = session?.access_token
  const [status, setStatus] = useState<EmailStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', smtpHost: '', smtpPort: '587', imapHost: '', imapPort: '993' })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken) return
    fetch('/api/email/status', { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((res) => res.json())
      .then((body) => setStatus(body))
      .catch(() => setStatus({ connected: false }))
      .finally(() => setLoading(false))
  }, [accessToken])

  async function handleConnect(e: FormEvent) {
    e.preventDefault()
    if (!accessToken) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/email/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          smtpHost: form.smtpHost.trim(),
          smtpPort: Number(form.smtpPort),
          imapHost: form.imapHost.trim(),
          imapPort: Number(form.imapPort),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Could not connect that mailbox.')
        setSubmitting(false)
        return
      }
      setStatus({ connected: true, email: form.email.trim(), lastSyncedAt: null })
      setShowForm(false)
      setForm({ email: '', password: '', smtpHost: '', smtpPort: '587', imapHost: '', imapPort: '993' })
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDisconnect() {
    if (!accessToken) return
    if (!confirm('Disconnect this mailbox? Sending and automatic email logging will stop.')) return
    await fetch('/api/email/disconnect', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } })
    setStatus({ connected: false })
  }

  async function handleSync() {
    if (!accessToken) return
    setSyncing(true)
    setSyncMessage(null)
    try {
      const res = await fetch('/api/email/sync', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSyncMessage(body.error ?? 'Sync failed.')
      } else {
        setSyncMessage(`Synced — ${body.logged ?? 0} new message${body.logged === 1 ? '' : 's'} logged.`)
        setStatus((prev) => (prev ? { ...prev, lastSyncedAt: new Date().toISOString() } : prev))
        // Sync writes the new Activities and notifications server-side, so this session
        // is holding stale data until it re-reads them — without this a just-synced email
        // only appeared on the client/lead after a full page refresh.
        await refreshSyncedData()
      }
    } catch {
      setSyncMessage('Could not reach the server.')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Card className="p-4 md:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-[var(--tint-green)] text-[var(--c-green)] flex items-center justify-center shrink-0">
            <Mail size={16} />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">Email (SMTP / IMAP)</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {loading
                ? 'Checking connection…'
                : status?.connected
                ? `Connected as ${status.email}`
                : 'Send email and automatically log matching replies as CRM activity'}
            </p>
            {status?.connected && status.lastSyncedAt && (
              <p className="text-xs text-slate-400 mt-0.5">Last synced {new Date(status.lastSyncedAt).toLocaleString()}</p>
            )}
          </div>
        </div>
        {!loading && !status?.connected && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg shrink-0 bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center gap-1.5"
          >
            <Link2 size={13} /> Connect
          </button>
        )}
        {status?.connected && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> Sync now
            </button>
            <button
              onClick={handleDisconnect}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 flex items-center gap-1.5"
            >
              <Unlink size={13} /> Disconnect
            </button>
          </div>
        )}
      </div>

      {syncMessage && <p className="text-xs text-slate-500 mt-2">{syncMessage}</p>}

      {showForm && !status?.connected && (
        <form onSubmit={handleConnect} className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormField label="Email Address" required>
            <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </FormField>
          <FormField label="Password" required>
            <input className={inputClass} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </FormField>
          <FormField label="SMTP Host" required>
            <input className={inputClass} placeholder="mail.yourdomain.co.za" value={form.smtpHost} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} required />
          </FormField>
          <FormField label="SMTP Port" required>
            <input className={inputClass} type="number" value={form.smtpPort} onChange={(e) => setForm({ ...form, smtpPort: e.target.value })} required />
          </FormField>
          <FormField label="IMAP Host" required>
            <input className={inputClass} placeholder="mail.yourdomain.co.za" value={form.imapHost} onChange={(e) => setForm({ ...form, imapHost: e.target.value })} required />
          </FormField>
          <FormField label="IMAP Port" required>
            <input className={inputClass} type="number" value={form.imapPort} onChange={(e) => setForm({ ...form, imapPort: e.target.value })} required />
          </FormField>
          <p className="text-xs text-slate-400 md:col-span-2 -mt-1">
            Find these under Email Accounts → Connect Devices (or Configure Mail Client) in ConsoleH / your webmail control panel.
          </p>
          {error && <p className="text-xs text-red-600 md:col-span-2">{error}</p>}
          <div className="md:col-span-2 flex items-center gap-2">
            <button type="submit" disabled={submitting} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
              {submitting ? 'Connecting…' : 'Connect Mailbox'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setError(null) }} className="text-xs font-medium px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
              Cancel
            </button>
          </div>
        </form>
      )}
    </Card>
  )
}
