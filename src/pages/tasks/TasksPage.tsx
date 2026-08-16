import { useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { Card } from '../../components/ui/Card'
import { PriorityBadge, TaskStatusBadge } from '../../components/ui/Badge'
import { UserAvatar } from '../../components/ui/Avatar'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { currentUser, formatDate, TODAY, users } from '../../data/mockData'
import type { Task, TaskPriority, TaskType } from '../../types'

const VIEWS = ['My Tasks', 'Team Tasks', 'Overdue', 'Today', 'Tomorrow', 'This Week', 'Completed'] as const
type View = (typeof VIEWS)[number]
const reps = users.filter((u) => u.role.includes('Sales') || u.role === 'Administrator')

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function TasksPage() {
  const { tasks, updateTask, addTask } = useAppStore()
  const [view, setView] = useState<View>('My Tasks')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [rescheduleTask, setRescheduleTask] = useState<Task | null>(null)

  const today = startOfDay(TODAY)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const weekEnd = new Date(today)
  weekEnd.setDate(weekEnd.getDate() + 7)

  const filtered = useMemo(() => {
    let list = [...tasks]
    switch (view) {
      case 'My Tasks':
        list = list.filter((t) => t.ownerId === currentUser.id && t.status !== 'Completed' && t.status !== 'Cancelled')
        break
      case 'Team Tasks':
        list = list.filter((t) => t.status !== 'Completed' && t.status !== 'Cancelled')
        break
      case 'Overdue':
        list = list.filter((t) => new Date(t.dueDate) < today && t.status !== 'Completed' && t.status !== 'Cancelled')
        break
      case 'Today':
        list = list.filter((t) => startOfDay(new Date(t.dueDate)).getTime() === today.getTime())
        break
      case 'Tomorrow':
        list = list.filter((t) => startOfDay(new Date(t.dueDate)).getTime() === tomorrow.getTime())
        break
      case 'This Week':
        list = list.filter((t) => new Date(t.dueDate) >= today && new Date(t.dueDate) <= weekEnd)
        break
      case 'Completed':
        list = list.filter((t) => t.status === 'Completed')
        break
    }
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((t) => t.title.toLowerCase().includes(q) || (t.relatedToLabel ?? '').toLowerCase().includes(q))
    }
    return list.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
  }, [tasks, view, search, today, tomorrow, weekEnd])

  const counts = useMemo(() => {
    const overdue = tasks.filter((t) => new Date(t.dueDate) < today && t.status !== 'Completed' && t.status !== 'Cancelled').length
    const dueToday = tasks.filter((t) => startOfDay(new Date(t.dueDate)).getTime() === today.getTime() && t.status !== 'Completed').length
    return { overdue, dueToday }
  }, [tasks, today])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-slate-400">Overdue</p>
          <p className="text-xl font-bold text-[#794234] mt-1">{counts.overdue}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-400">Due Today</p>
          <p className="text-xl font-bold text-slate-800 mt-1">{counts.dueToday}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-400">Open Tasks</p>
          <p className="text-xl font-bold text-slate-800 mt-1">{tasks.filter((t) => t.status !== 'Completed' && t.status !== 'Cancelled').length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-400">Completed</p>
          <p className="text-xl font-bold text-[#406d58] mt-1">{tasks.filter((t) => t.status === 'Completed').length}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`text-sm font-medium px-3 py-1.5 rounded-lg ${view === v ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {v}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 w-64">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks..." className="text-sm outline-none flex-1 min-w-0" />
        </div>
        <span className="text-xs text-slate-400">{filtered.length} tasks</span>
        <button onClick={() => setAddOpen(true)} className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
          <Plus size={15} /> Add Task
        </button>
      </div>

      <Card padded={false}>
        <div className="divide-y divide-slate-50">
          {filtered.map((t) => {
            const overdue = new Date(t.dueDate) < today && t.status !== 'Completed' && t.status !== 'Cancelled'
            return (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                <input
                  type="checkbox"
                  checked={t.status === 'Completed'}
                  onChange={(e) => updateTask(t.id, { status: e.target.checked ? 'Completed' : 'Not Started', completedAt: e.target.checked ? new Date().toISOString() : undefined })}
                  className="w-4 h-4 accent-brand-600 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium truncate ${t.status === 'Completed' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{t.title}</p>
                  <p className="text-xs text-slate-400">
                    {t.type} {t.relatedToLabel ? `· ${t.relatedToLabel}` : ''}
                  </p>
                </div>
                <PriorityBadge priority={t.priority} />
                <TaskStatusBadge status={t.status} />
                <span className={`text-xs font-medium w-24 text-right shrink-0 ${overdue ? 'text-[#794234]' : 'text-slate-500'}`}>{formatDate(t.dueDate)}</span>
                <UserAvatar userId={t.ownerId} size={24} />
                <button onClick={() => setRescheduleTask(t)} className="text-xs font-medium text-brand-600 hover:underline shrink-0">
                  Reschedule
                </button>
              </div>
            )
          })}
          {filtered.length === 0 && <p className="text-center text-slate-400 text-sm py-10">No tasks in this view.</p>}
        </div>
      </Card>

      {addOpen && <AddTaskModal onClose={() => setAddOpen(false)} onSave={(input) => addTask(input)} />}
      {rescheduleTask && (
        <RescheduleModal task={rescheduleTask} onClose={() => setRescheduleTask(null)} onSave={(dueDate) => updateTask(rescheduleTask.id, { dueDate })} />
      )}
    </div>
  )
}

function AddTaskModal({ onClose, onSave }: { onClose: () => void; onSave: (input: Partial<Task> & { title: string; dueDate: string }) => void }) {
  const [form, setForm] = useState({ title: '', type: 'Follow-up' as TaskType, priority: 'Medium' as TaskPriority, ownerId: currentUser.id, date: '', time: '09:00' })
  return (
    <Modal title="Add Task" onClose={onClose} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.title || !form.date) return
          onSave({ title: form.title, type: form.type, priority: form.priority, ownerId: form.ownerId, dueDate: new Date(`${form.date}T${form.time}`).toISOString() })
          onClose()
        }}
      >
        <FormField label="Task Title" required>
          <input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required autoFocus />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Type">
            <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as TaskType })}>
              {(['Call', 'Follow-up', 'Email', 'Proposal', 'Meeting', 'WhatsApp', 'Research', 'Internal task', 'Other'] as TaskType[]).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Priority">
            <select className={inputClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
              {(['Low', 'Medium', 'High', 'Urgent'] as TaskPriority[]).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Date" required>
            <input type="date" className={inputClass} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </FormField>
          <FormField label="Time">
            <input type="time" className={inputClass} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Owner">
          <select className={inputClass} value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Add Task
          </button>
        </div>
      </form>
    </Modal>
  )
}

function RescheduleModal({ task, onClose, onSave }: { task: Task; onClose: () => void; onSave: (dueDate: string) => void }) {
  const d = new Date(task.dueDate)
  const [date, setDate] = useState(d.toISOString().slice(0, 10))
  const [time, setTime] = useState(d.toTimeString().slice(0, 5))
  return (
    <Modal title="Reschedule Task" onClose={onClose} width={360}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave(new Date(`${date}T${time}`).toISOString())
          onClose()
        }}
      >
        <p className="text-sm text-slate-600 mb-3">{task.title}</p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="New Date" required>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
          </FormField>
          <FormField label="Time">
            <input type="time" className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} />
          </FormField>
        </div>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}
