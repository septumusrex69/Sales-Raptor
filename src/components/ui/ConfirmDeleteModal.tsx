import { Modal } from './Modal'

export function ConfirmDeleteModal({
  title,
  itemLabel,
  onClose,
  onConfirm,
}: {
  title: string
  itemLabel: string
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal title={title} onClose={onClose} width={380}>
      <p className="text-sm text-slate-600">
        Delete <span className="font-medium text-slate-800">{itemLabel}</span>? This can't be undone.
      </p>
      <div className="flex justify-end gap-2 mt-5 pt-3 border-t border-slate-100">
        <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm()
            onClose()
          }}
          className="text-sm font-medium px-3.5 py-2 rounded-lg bg-[#794234] text-white hover:bg-[#622f24]"
        >
          Delete
        </button>
      </div>
    </Modal>
  )
}
