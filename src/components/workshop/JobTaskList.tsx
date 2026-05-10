'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

/**
 * JobTaskList — repair tasks checklist.
 *
 * Step 4 status: FULLY INTERACTIVE (toggle/inline edit/add/delete).
 * Step 5 status: drag-to-reorder via @dnd-kit/sortable.
 *
 * State pattern:
 *   - `tasks` is local, seeded from props.
 *   - All mutations are OPTIMISTIC: local state updates first, then the
 *     PATCH/POST/DELETE fires; on success we call router.refresh() so
 *     the server props stay in sync. On failure we revert and surface
 *     the error.
 *   - `propsKey` (hash of relevant fields) drives re-sync from server
 *     props on the next render after router.refresh — without
 *     clobbering an in-flight optimistic update.
 *
 * API endpoints (built in Step 1):
 *   POST   /api/cases/[id]/tasks                       { title, notes? }
 *   PATCH  /api/cases/[id]/tasks/[taskId]              { title?, notes?, completed?, order? }
 *   DELETE /api/cases/[id]/tasks/[taskId]
 */

export type JobTask = {
  id:            string
  title:         string
  notes:         string | null
  order:         number
  completedAt:   string | null
  completedById: string | null
  completedBy:   { id: string; name: string } | null
}

type Props = {
  caseId:        string
  tasks:         JobTask[]
  currentUserId: string
  /** Step 3 read-only mode. Ignored in Step 4 — keeping the prop so the
   *  Step 3 callsite still typechecks without a code edit. */
  readOnly?:     boolean
}

function fmtTime(iso: string): string {
  // Manual HH:MM — no toLocaleString (hydration safety per project rules).
  const d = new Date(iso)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

export default function JobTaskList({
  caseId,
  tasks: tasksFromServer,
  currentUserId,
}: Props) {
  const router = useRouter()

  /* Local state — see header comment. */
  const [tasks, setTasks]     = useState<JobTask[]>(tasksFromServer)
  const [error, setError]     = useState<string | null>(null)
  const [adding, setAdding]   = useState(false)

  // Hash of the server's task list — when it changes, re-sync from props.
  // Excludes ephemeral fields so a no-op refresh doesn't clobber.
  const propsKey = useMemo(
    () =>
      tasksFromServer
        .map(
          (t) =>
            `${t.id}:${t.order}:${t.title}:${t.notes ?? ''}:${t.completedAt ?? ''}`,
        )
        .join('|'),
    [tasksFromServer],
  )

  // Re-sync from server props when the propsKey changes. We use the
  // "store the previous prop in state" pattern from the React docs
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  // Compared to a useEffect-based sync this avoids the cascading-render
  // trap that `react-hooks/set-state-in-effect` flags; compared to a
  // ref-based guard it avoids touching refs during render which
  // `react-hooks/refs` flags. Calling setState during render with a
  // change-guard is the documented React-supported way to do this.
  const [prevPropsKey, setPrevPropsKey] = useState(propsKey)
  if (prevPropsKey !== propsKey) {
    setPrevPropsKey(propsKey)
    setTasks(tasksFromServer)
  }

  const total     = tasks.length
  const completed = tasks.filter((t) => !!t.completedAt).length
  const pct       = total === 0 ? 0 : Math.round((completed / total) * 100)

  /* ─── Sensors for dnd-kit ─────────────────────────────────────────── */
  // PointerSensor with a small distance gate so a click on the handle
  // doesn't accidentally start a drag for a single-pixel mouse jitter.
  const sensors = useSensors(
    useSensor(PointerSensor,  { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  /* ─── Mutations ───────────────────────────────────────────────────── */

  async function patchTask(
    id: string,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    setError(null)
    const res = await fetch(`/api/cases/${caseId}/tasks/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setError(b.error ?? 'Failed to update task')
      return false
    }
    return true
  }

  async function toggleTask(t: JobTask) {
    const nextDone = !t.completedAt
    // Optimistic
    setTasks((prev) =>
      prev.map((p) =>
        p.id === t.id
          ? {
              ...p,
              completedAt:   nextDone ? new Date().toISOString() : null,
              completedById: nextDone ? currentUserId : null,
              completedBy:   nextDone
                ? { id: currentUserId, name: 'You' }
                : null,
            }
          : p,
      ),
    )
    const ok = await patchTask(t.id, { completed: nextDone })
    if (ok) router.refresh()
    else    setTasks(tasksFromServer) // revert
  }

  async function saveTitle(t: JobTask, title: string) {
    const trimmed = title.trim()
    if (trimmed === '' || trimmed === t.title) return // no-op
    setTasks((prev) =>
      prev.map((p) => (p.id === t.id ? { ...p, title: trimmed } : p)),
    )
    const ok = await patchTask(t.id, { title: trimmed })
    if (ok) router.refresh()
    else    setTasks(tasksFromServer)
  }

  async function saveNotes(t: JobTask, notes: string) {
    const trimmed = notes.trim()
    const next: string | null = trimmed === '' ? null : trimmed
    if (next === (t.notes ?? null)) return
    setTasks((prev) =>
      prev.map((p) => (p.id === t.id ? { ...p, notes: next } : p)),
    )
    const ok = await patchTask(t.id, { notes: next })
    if (ok) router.refresh()
    else    setTasks(tasksFromServer)
  }

  async function deleteTask(t: JobTask) {
    if (t.completedAt) {
      // Spec: confirm before deleting a completed task.
      if (!window.confirm(`Delete the completed task "${t.title}"? This can't be undone.`)) {
        return
      }
    }
    // Optimistic remove
    setTasks((prev) => prev.filter((p) => p.id !== t.id))
    setError(null)
    const res = await fetch(`/api/cases/${caseId}/tasks/${t.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
    } else {
      const b = await res.json().catch(() => ({}))
      setError(b.error ?? 'Failed to delete task')
      setTasks(tasksFromServer)
    }
  }

  async function addTask(title: string) {
    const trimmed = title.trim()
    if (!trimmed) return
    setAdding(true)
    setError(null)
    try {
      const res = await fetch(`/api/cases/${caseId}/tasks`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title: trimmed }),
      })
      if (res.ok) {
        const json = await res.json().catch(() => ({}))
        const created = json?.data?.task as JobTask | undefined
        if (created) {
          setTasks((prev) => [...prev, created])
        }
        router.refresh()
      } else {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? 'Failed to add task')
      }
    } finally {
      setAdding(false)
    }
  }

  /* ─── Drag-to-reorder ─────────────────────────────────────────────── */

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return

    const fromIdx = tasks.findIndex((t) => t.id === active.id)
    const toIdx   = tasks.findIndex((t) => t.id === over.id)
    if (fromIdx < 0 || toIdx < 0) return

    // Optimistic local reorder.
    const next = arrayMove(tasks, fromIdx, toIdx).map((t, i) => ({ ...t, order: i }))
    setTasks(next)

    // Persist — server PATCH reindexes the siblings.
    void patchTask(active.id as string, { order: toIdx }).then((ok) => {
      if (ok) router.refresh()
      else    setTasks(tasksFromServer)
    })
  }

  /* ─── Render ──────────────────────────────────────────────────────── */

  return (
    <div
      style={{
        background:    'var(--surface)',
        border:        '1px solid var(--border)',
        borderRadius:  'var(--radius-lg)',
        padding:       '16px 18px',
        boxShadow:     'var(--card-sh)',
      }}
    >
      {/* Header + progress */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="eyebrow" style={{ color: 'var(--text)', opacity: 0.7 }}>
          Repair tasks · {completed} of {total} complete
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--sub)' }}>
          {pct}%
        </div>
      </div>
      <div
        style={{
          height:       6,
          borderRadius: 999,
          background:   'var(--s2)',
          overflow:     'hidden',
          marginBottom: total === 0 ? 0 : 12,
        }}
        aria-hidden
      >
        <div
          style={{
            width:      `${pct}%`,
            height:     '100%',
            background: pct === 100 ? 'var(--green)' : 'var(--accent)',
            transition: 'width .2s ease',
          }}
        />
      </div>

      {error && (
        <div
          style={{
            fontSize:     12,
            color:        'var(--red-text)',
            background:   'var(--red-bg)',
            padding:      '8px 10px',
            borderRadius: 6,
            marginBottom: 8,
          }}
        >
          {error}
        </div>
      )}

      {/* Task rows */}
      {total === 0 ? (
        <EmptyTasks />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={tasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {tasks.map((t) => (
                <SortableTaskRow
                  key={t.id}
                  task={t}
                  onToggle={() => toggleTask(t)}
                  onSaveTitle={(v) => saveTitle(t, v)}
                  onSaveNotes={(v) => saveNotes(t, v)}
                  onDelete={() => deleteTask(t)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {/* Add task */}
      <AddTaskRow onAdd={addTask} adding={adding} />
    </div>
  )
}

/* ─── Sortable task row ──────────────────────────────────────────────── */

function SortableTaskRow({
  task,
  onToggle,
  onSaveTitle,
  onSaveNotes,
  onDelete,
}: {
  task:        JobTask
  onToggle:    () => void
  onSaveTitle: (v: string) => void
  onSaveNotes: (v: string) => void
  onDelete:    () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity:   isDragging ? 0.5 : 1,
  }

  const done = !!task.completedAt

  /* Inline title edit. Drafts are re-synced from props using the
   * "store previous prop in state" pattern from the React docs — the
   * useEffect-based sync trips `react-hooks/set-state-in-effect` and
   * the ref-based guard trips `react-hooks/refs`. */
  const [editing,    setEditing]    = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const [prevTitle,  setPrevTitle]  = useState(task.title)
  if (prevTitle !== task.title) {
    setPrevTitle(task.title)
    setTitleDraft(task.title)
  }

  /* Notes expand + edit */
  const [notesOpen,  setNotesOpen]  = useState(false)
  const [notesDraft, setNotesDraft] = useState(task.notes ?? '')
  const [prevNotes,  setPrevNotes]  = useState(task.notes)
  if (prevNotes !== task.notes) {
    setPrevNotes(task.notes)
    setNotesDraft(task.notes ?? '')
  }

  function commitTitle() {
    setEditing(false)
    if (titleDraft.trim() && titleDraft.trim() !== task.title) {
      onSaveTitle(titleDraft)
    } else {
      setTitleDraft(task.title) // revert blank/no-op
    }
  }

  function commitNotes() {
    if ((notesDraft.trim() || null) !== (task.notes ?? null)) {
      onSaveNotes(notesDraft)
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={{
        ...style,
        display:      'flex',
        gap:          10,
        alignItems:   'flex-start',
        padding:      '10px 12px',
        border:       '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        background:   done ? 'var(--green-bg)' : 'var(--surface)',
      }}
      {...attributes}
    >
      {/* Drag handle */}
      <span
        ref={setActivatorNodeRef}
        {...listeners}
        aria-label="Drag to reorder"
        title="Drag to reorder"
        style={{
          color:      'var(--text-faint)',
          cursor:     'grab',
          display:    'inline-flex',
          alignItems: 'center',
          paddingTop: 2,
          touchAction:'none',
        }}
      >
        <DragIcon />
      </span>

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={done}
        onChange={onToggle}
        style={{ marginTop: 3, cursor: 'pointer' }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title — inline edit */}
        {editing ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                ;(e.target as HTMLInputElement).blur()
              } else if (e.key === 'Escape') {
                setTitleDraft(task.title)
                setEditing(false)
              }
            }}
            style={{ fontSize: 13, fontWeight: 500, width: '100%' }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Click to edit"
            style={{
              all:           'unset',
              cursor:        'text',
              fontSize:       13,
              fontWeight:     500,
              color:          done ? 'var(--green-text)' : 'var(--text)',
              textDecoration: done ? 'line-through' : 'none',
              lineHeight:     1.4,
              wordBreak:      'break-word',
              display:        'inline-block',
              maxWidth:       '100%',
            }}
          >
            {task.title}
          </button>
        )}

        {/* Notes — expand on click */}
        {notesOpen ? (
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={() => {
              commitNotes()
              if (!notesDraft.trim()) setNotesOpen(false)
            }}
            placeholder="Notes (optional) — saves on blur"
            rows={2}
            style={{
              width:      '100%',
              fontSize:   12,
              lineHeight: 1.5,
              marginTop:  6,
              resize:     'vertical',
              minHeight:  44,
            }}
            autoFocus
          />
        ) : task.notes ? (
          <button
            type="button"
            onClick={() => setNotesOpen(true)}
            title="Click to edit notes"
            style={{
              all:        'unset',
              cursor:     'text',
              fontSize:   12,
              color:      done ? 'var(--green-text)' : 'var(--sub)',
              opacity:    done ? 0.85 : 1,
              marginTop:  3,
              whiteSpace: 'pre-wrap',
              lineHeight: 1.5,
              display:    'inline-block',
              maxWidth:   '100%',
            }}
          >
            {task.notes}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setNotesOpen(true)}
            style={{
              all:        'unset',
              cursor:     'pointer',
              fontSize:   11,
              color:      'var(--text-faint)',
              marginTop:  3,
              display:    'inline-flex',
              alignItems: 'center',
              gap:        4,
            }}
            title="Add notes"
          >
            <PlusIcon size={10} /> Add notes
          </button>
        )}

        {done && task.completedAt && (
          <div
            style={{
              fontSize:   11,
              color:      'var(--green-text)',
              marginTop:  4,
              opacity:    0.85,
            }}
          >
            ✓ by {task.completedBy?.name ?? 'someone'} at {fmtTime(task.completedAt)}
          </div>
        )}
      </div>

      {/* Delete */}
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete task"
        title={done ? 'Delete (will confirm)' : 'Delete'}
        style={{
          all:           'unset',
          cursor:        'pointer',
          color:         'var(--text-faint)',
          padding:       4,
          borderRadius:  4,
          display:       'inline-flex',
        }}
      >
        <TrashIcon />
      </button>
    </li>
  )
}

/* ─── Add task row ───────────────────────────────────────────────────── */

function AddTaskRow({
  onAdd,
  adding,
}: {
  onAdd:  (title: string) => void
  adding: boolean
}) {
  const [open,  setOpen]  = useState(false)
  const [title, setTitle] = useState('')
  const inputRef          = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function submit() {
    if (!title.trim()) {
      setOpen(false)
      return
    }
    onAdd(title)
    setTitle('')
    // Keep the input open so the user can fire off several tasks fast.
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          all:            'unset',
          marginTop:      10,
          width:          '100%',
          textAlign:      'center',
          padding:        '12px 14px',
          border:         '1px dashed var(--border2)',
          borderRadius:   'var(--radius-md)',
          color:          'var(--sub)',
          fontSize:       13,
          cursor:         'pointer',
          display:        'inline-flex',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            6,
          boxSizing:      'border-box',
        }}
      >
        <PlusIcon /> Add task
      </button>
    )
  }

  return (
    <div
      style={{
        marginTop:    10,
        padding:      10,
        border:       '1px dashed var(--border2)',
        borderRadius: 'var(--radius-md)',
        display:      'flex',
        gap:          8,
      }}
    >
      <input
        ref={inputRef}
        type="text"
        placeholder="Task title (e.g. Replace front brake pads)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            setTitle('')
            setOpen(false)
          }
        }}
        disabled={adding}
        style={{ flex: 1, fontSize: 13 }}
      />
      <button
        type="button"
        onClick={submit}
        disabled={adding || !title.trim()}
        style={{
          all:          'unset',
          cursor:       adding || !title.trim() ? 'not-allowed' : 'pointer',
          padding:      '0 14px',
          background:   'var(--accent)',
          color:        '#fff',
          fontSize:     13,
          fontWeight:   500,
          borderRadius: 'var(--radius-md)',
          opacity:      adding || !title.trim() ? 0.5 : 1,
          display:      'inline-flex',
          alignItems:   'center',
        }}
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => { setTitle(''); setOpen(false) }}
        disabled={adding}
        style={{
          all:          'unset',
          cursor:       'pointer',
          padding:      '0 10px',
          color:        'var(--sub)',
          fontSize:     12,
          display:      'inline-flex',
          alignItems:   'center',
        }}
      >
        Cancel
      </button>
    </div>
  )
}

function EmptyTasks() {
  return (
    <div
      style={{
        padding:    '14px 12px 4px',
        fontSize:   13,
        color:      'var(--sub)',
        lineHeight: 1.5,
      }}
    >
      No tasks yet. Add the steps for this repair below — every task must be
      ticked off before you can send the case to QC.
    </div>
  )
}

/* ─── Icons ──────────────────────────────────────────────────────────── */

function DragIcon() {
  return (
    <svg width={12} height={16} viewBox="0 0 12 16" fill="currentColor" aria-hidden>
      <circle cx="3"  cy="3"  r="1.4" />
      <circle cx="9"  cy="3"  r="1.4" />
      <circle cx="3"  cy="8"  r="1.4" />
      <circle cx="9"  cy="8"  r="1.4" />
      <circle cx="3"  cy="13" r="1.4" />
      <circle cx="9"  cy="13" r="1.4" />
    </svg>
  )
}

function PlusIcon({ size = 14 }: { size?: number } = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5"  y1="12" x2="19" y2="12" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}
