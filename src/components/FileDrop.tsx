import { useRef, useState } from 'react'
import { IconUpload } from './icons'
import { btnPrimary, card } from './ui'

/**
 * Drag-and-drop on the Mac, file picker on iPhone and iPad. The input has no `accept`
 * filter on purpose: iOS greys out extensions it does not know, such as .vkx.
 */
export function FileDrop({ onFiles, compact }: { onFiles: (files: File[]) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const files = [...e.dataTransfer.files]
        if (files.length) onFiles(files)
      }}
      className={`${card} ${over ? 'ring-2 ring-[var(--series-1)]' : ''} flex flex-col items-center gap-2 px-5 ${compact ? 'py-4' : 'py-7'} text-center`}
    >
      {!compact && (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-accent">
          <IconUpload />
        </span>
      )}
      <p className="font-semibold">Carica le tue uscite</p>
      <p className="max-w-md text-sm text-ink-2">
        File GPX (Apple Watch, iPhone, Strava), VKX o CSV (Vakaros). Puoi sceglierne più di uno insieme
        <span className="hidden md:inline"> o trascinarli qui</span>.
      </p>
      <button type="button" className={`${btnPrimary} mt-1`} onClick={() => input.current?.click()}>
        Scegli i file
      </button>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </div>
  )
}
