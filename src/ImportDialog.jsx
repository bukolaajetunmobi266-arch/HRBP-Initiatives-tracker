import React, { useState } from 'react'
import { supabase } from './supabaseClient'
import { parseImportFile } from './importExcel'

export default function ImportDialog({ profiles, onCancel, onDone }) {
  const [parsed, setParsed] = useState(null)
  const [importing, setImporting] = useState(false)
  const [fileErr, setFileErr] = useState('')

  const handleFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setFileErr('')
    try {
      const buf = await file.arrayBuffer()
      const result = parseImportFile(buf, profiles)
      if (!result.deliverables.length && !result.actions.length) {
        setFileErr("Couldn't find any rows to import. Make sure you're using the template's sheet names (\"Deliverables\" / \"Action Items\") and haven't left only the example row.")
        setParsed(null)
        return
      }
      setParsed(result)
    } catch (err) {
      setFileErr('Could not read that file. Make sure it\'s a .xlsx file based on the template.')
    }
  }

  const runImport = async () => {
    setImporting(true)
    const { deliverables, actions } = parsed

    for (const d of deliverables) {
      const { _comment, ...payload } = d
      const { data, error } = await supabase.from('deliverables').insert(payload).select().single()
      if (error) continue
      if (_comment && data) {
        await supabase.from('comments').insert({ deliverable_id: data.id, author_id: (await supabase.auth.getUser()).data.user.id, text: _comment })
      }
    }
    if (actions.length) {
      await supabase.from('key_actions').insert(actions)
    }
    setImporting(false)
    onDone()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 50 }}>
      <div style={{ background: 'var(--bg2)', color: 'var(--tx1)', borderRadius: 12, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', padding: 20 }}>
        <p style={{ fontSize: 15, fontWeight: 500, margin: '0 0 12px' }}>Import from Excel</p>

        {!parsed && (
          <>
            <p style={{ fontSize: 13, color: 'var(--tx2)', margin: '0 0 12px' }}>
              Upload a file based on the import template — a "Deliverables" sheet, and optionally an "Action Items" sheet.
            </p>
            <input type="file" accept=".xlsx" onChange={handleFile} style={{ fontSize: 13 }} />
            {fileErr && <p style={{ fontSize: 12, color: 'var(--dgr-tx)', marginTop: 10 }}>{fileErr}</p>}
          </>
        )}

        {parsed && (
          <>
            <div style={{ background: 'var(--acc-bg)', color: 'var(--acc-tx)', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 10 }}>
              Ready to import <strong>{parsed.deliverables.length}</strong> deliverable{parsed.deliverables.length === 1 ? '' : 's'}
              {parsed.actions.length > 0 && <> and <strong>{parsed.actions.length}</strong> action item{parsed.actions.length === 1 ? '' : 's'}</>}.
            </div>
            {(parsed.deliverableErrors.length > 0 || parsed.actionErrors.length > 0) && (
              <div style={{ background: 'var(--wrn-bg)', color: 'var(--wrn-tx)', borderRadius: 8, padding: '10px 12px', fontSize: 12, marginBottom: 10, maxHeight: 140, overflowY: 'auto' }}>
                <p style={{ margin: '0 0 6px', fontWeight: 500 }}>{parsed.deliverableErrors.length + parsed.actionErrors.length} row(s) skipped:</p>
                {[...parsed.deliverableErrors, ...parsed.actionErrors].map((e, i) => <div key={i} style={{ marginBottom: 4 }}>{e}</div>)}
              </div>
            )}
            <p style={{ fontSize: 12, color: 'var(--txm)', marginBottom: 16 }}>This adds to your existing tracker — it doesn't replace anything already there.</p>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onCancel} disabled={importing} style={{ fontSize: 13, background: 'var(--bg2)', border: '0.5px solid var(--bds)', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', color: 'var(--tx1)' }}>Cancel</button>
          {parsed && (
            <button onClick={runImport} disabled={importing} style={{ fontSize: 13, background: 'var(--acc-fill)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>
              {importing ? 'Importing…' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
