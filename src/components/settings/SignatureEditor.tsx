import { useRef, useState } from 'react'
import { AlignLeft, AlignCenter, AlignRight, ImageUp, X } from 'lucide-react'
import { inputClass } from '../ui/Modal'
import { supabase } from '../../lib/supabase'
import type { ID } from '../../types'

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/gif']
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MIN_WIDTH = 60
const MAX_WIDTH = 400
const DEFAULT_WIDTH = 160

export interface SignatureValue {
  text: string
  imageUrl?: string
  imageWidth?: number
  imageAlign?: 'left' | 'center' | 'right'
}

/**
 * Text + optional image email signature editor, shared between a person's own
 * Profile settings and an Administrator editing someone else's on their behalf.
 * The image uploads straight to the public 'email-signatures' Storage bucket
 * under the browser's current session -- Storage RLS allows a write either to
 * the caller's own "<user_id>/..." folder or, for an Administrator, any folder.
 */
export function SignatureEditor({ userId, value, onChange }: { userId: ID; value: SignatureValue; onChange: (patch: Partial<SignatureValue>) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Please choose a JPEG, PNG, or GIF image. PDFs can\'t be embedded inline in an email, so they don\'t work as a signature image.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('That image is larger than 2MB -- please use a smaller file.')
      return
    }

    setUploading(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${userId}/signature.${ext}`
      const { error: uploadError } = await supabase.storage.from('email-signatures').upload(path, file, { upsert: true, cacheControl: '3600' })
      if (uploadError) {
        setError(uploadError.message)
        return
      }
      const { data } = supabase.storage.from('email-signatures').getPublicUrl(path)
      onChange({ imageUrl: `${data.publicUrl}?v=${Date.now()}`, imageWidth: value.imageWidth ?? DEFAULT_WIDTH, imageAlign: value.imageAlign ?? 'left' })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <label className="block mb-3.5">
        <span className="block text-xs font-medium text-slate-500 mb-1.5">Email Signature Text</span>
        <textarea
          className={inputClass}
          rows={4}
          placeholder={'e.g.\nStephan Bredell\nBredell Ferreira · 082 000 0000'}
          value={value.text}
          onChange={(e) => onChange({ text: e.target.value })}
        />
      </label>

      <div className="mb-1.5 flex items-center justify-between">
        <span className="block text-xs font-medium text-slate-500">Signature Image (optional)</span>
      </div>

      {value.imageUrl ? (
        <div className="border border-slate-200 rounded-lg p-3 space-y-3">
          <div className={`flex ${value.imageAlign === 'right' ? 'justify-end' : value.imageAlign === 'center' ? 'justify-center' : 'justify-start'}`}>
            <img src={value.imageUrl} alt="Signature" style={{ width: value.imageWidth ?? DEFAULT_WIDTH, maxWidth: '100%' }} />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 shrink-0">Size</span>
            <input
              type="range"
              min={MIN_WIDTH}
              max={MAX_WIDTH}
              step={10}
              value={value.imageWidth ?? DEFAULT_WIDTH}
              onChange={(e) => onChange({ imageWidth: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="text-xs text-slate-400 w-10 text-right shrink-0">{value.imageWidth ?? DEFAULT_WIDTH}px</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Position</span>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              {([
                ['left', AlignLeft],
                ['center', AlignCenter],
                ['right', AlignRight],
              ] as const).map(([align, Icon]) => (
                <button
                  key={align}
                  type="button"
                  onClick={() => onChange({ imageAlign: align })}
                  className={`p-1.5 ${(value.imageAlign ?? 'left') === align ? 'bg-brand-600 text-white' : 'bg-white text-slate-400 hover:bg-slate-50'}`}
                  title={`Align ${align}`}
                >
                  <Icon size={14} />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onChange({ imageUrl: undefined, imageWidth: undefined, imageAlign: undefined })}
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
            >
              <X size={12} /> Remove image
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
        >
          <ImageUp size={14} /> {uploading ? 'Uploading…' : 'Upload Image'}
        </button>
      )}
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif" className="hidden" onChange={handleFileSelected} />
      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
      <p className="text-xs text-slate-400 mt-1.5">
        JPEG, PNG, or GIF only (max 2MB) -- PDFs can't render inline in an email client. Appended under the signature text once your inbox is
        connected — see Settings → Integrations.
      </p>
    </div>
  )
}
