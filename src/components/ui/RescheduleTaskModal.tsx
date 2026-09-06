import { useState } from 'react'
import { Modal, FormField, inputClass } from './Modal'
import type { Task } from '../../types'

export function RescheduleTaskModal({ task, onClose, onSave }: { task: Task; onClose: () => void; onSave: (dueDate: string) => void }) {
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
        {task.autoRescheduledFrom && (
          <p className="text-xs text-[var(--c-gold)] bg-[var(--tint-gold)] rounded-lg px-2.5 py-1.5 mb-3">
            This task was missed and auto-moved to today. Pick a new date to reschedule it properly.
          </p>
        )}
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
