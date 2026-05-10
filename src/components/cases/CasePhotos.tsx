'use client'
import { useState, useEffect } from 'react'
import PhotoGallery from '@/components/ui/PhotoGallery'

type Photo = {
  id:        string
  photoType: string
  viewUrl:   string
  caption?:  string | null
  createdAt: string
}

export default function CasePhotos({ caseId }: { caseId: string }) {
  const [photos,  setPhotos]  = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/cases/${caseId}/photos`)
      .then(r => r.json())
      .then(d => setPhotos(Array.isArray(d.data) ? d.data : []))
      .catch(() => setPhotos([]))
      .finally(() => setLoading(false))
  }, [caseId])

  if (loading) {
    return (
      <div style={{
        padding: '20px', background: 'var(--bg-surface)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
        fontSize: 12, color: 'var(--text-faint)', textAlign: 'center',
      }}>
        Loading photos…
      </div>
    )
  }

  return <PhotoGallery photos={photos} title="Case photos" />
}
