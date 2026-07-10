import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import BackLink from '../../components/BackLink'
import {
  getScheduleBlocks,
  createScheduleBlock,
  updateScheduleBlock,
  deleteScheduleBlock,
} from '../../api/scheduleBlocks'
import type { ScheduleBlock } from '../../types'

function formatRange(b: ScheduleBlock): string {
  const start = new Date(b.start_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const end = new Date(b.end_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${start} – ${end}`
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toIso(localDateTime: string): string | null {
  const d = new Date(localDateTime)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export default function ScheduleBlocksPage() {
  const qc = useQueryClient()
  const [label, setLabel] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')

  const { data: blocks = [] } = useQuery<ScheduleBlock[]>({
    queryKey: ['schedule-blocks'],
    queryFn: getScheduleBlocks,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['schedule-blocks'] })

  const createMutation = useMutation({
    mutationFn: () => {
      const start = toIso(startTime)
      const end = toIso(endTime)
      if (!start || !end) throw new Error('Enter a valid start and end time')
      if (end <= start) throw new Error('End time must be after start time')
      return createScheduleBlock({ label: label.trim(), start_time: start, end_time: end })
    },
    onSuccess: () => {
      invalidate()
      setLabel('')
      setStartTime('')
      setEndTime('')
      setError(null)
    },
    onError: e => setError(e instanceof Error ? e.message : 'Failed to create block'),
  })

  const updateMutation = useMutation({
    mutationFn: (id: string) => {
      const start = toIso(editStart)
      const end = toIso(editEnd)
      if (!start || !end) throw new Error('Enter a valid start and end time')
      if (end <= start) throw new Error('End time must be after start time')
      return updateScheduleBlock(id, { label: editLabel.trim(), start_time: start, end_time: end })
    },
    onSuccess: () => {
      invalidate()
      setEditingId(null)
      setError(null)
    },
    onError: e => setError(e instanceof Error ? e.message : 'Failed to update block'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteScheduleBlock(id),
    onSuccess: invalidate,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!label.trim() || !startTime || !endTime) return
    setError(null)
    createMutation.mutate()
  }

  const startEdit = (b: ScheduleBlock) => {
    setEditingId(b.id)
    setEditLabel(b.label)
    setEditStart(toLocalInput(b.start_time))
    setEditEnd(toLocalInput(b.end_time))
    setError(null)
  }

  const sorted = [...blocks].sort((a, b) => a.start_time.localeCompare(b.start_time))

  return (
    <div className="p-4 mt-2 space-y-6">
      <div className="flex items-center gap-2">
        <BackLink to="/manage" label="Manage" />
      </div>
      <h2 className="text-xl font-bold text-slate-800">Schedule Blocks</h2>
      <p className="text-sm text-gray-500 -mt-4">
        Lunch, group photo, or other event-wide breaks. No match will be estimated to start
        during a block — it's pushed to resume right when the block ends.
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Add Block</p>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Label</label>
          <input
            required
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            maxLength={100}
            placeholder="e.g. Lunch Break"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 bg-white"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Start</label>
            <input
              required
              type="datetime-local"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 bg-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">End</label>
            <input
              required
              type="datetime-local"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 bg-white"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={createMutation.isPending || !label.trim() || !startTime || !endTime}
          className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-40 hover:bg-blue-700 transition-colors"
        >
          {createMutation.isPending ? 'Adding…' : 'Add Block'}
        </button>
      </form>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Blocks</p>
        {sorted.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No schedule blocks yet.</p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            {sorted.map(b =>
              editingId === b.id ? (
                <div key={b.id} className="px-4 py-3 space-y-3">
                  <input
                    type="text"
                    value={editLabel}
                    onChange={e => setEditLabel(e.target.value)}
                    maxLength={100}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 bg-white"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="datetime-local"
                      value={editStart}
                      onChange={e => setEditStart(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 bg-white"
                    />
                    <input
                      type="datetime-local"
                      value={editEnd}
                      onChange={e => setEditEnd(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 bg-white"
                    />
                  </div>
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateMutation.mutate(b.id)}
                      disabled={updateMutation.isPending}
                      className="flex-1 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setEditingId(null); setError(null) }}
                      className="flex-1 py-1.5 rounded-lg bg-gray-100 text-slate-700 text-xs font-semibold hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div key={b.id} className="px-4 py-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{b.label}</p>
                    <p className="text-xs text-gray-400">{formatRange(b)}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => startEdit(b)}
                      className="text-xs text-blue-600 font-semibold hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete "${b.label}"? This cannot be undone.`)) {
                          deleteMutation.mutate(b.id)
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      className="text-xs text-red-600 font-semibold hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
