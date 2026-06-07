import React, { useState, useRef, useCallback } from 'react';
import { Upload } from 'lucide-react';
import { Modal } from './Shared';

async function downloadWithAuth(url) {
  const token = localStorage.getItem('token');
  const res = await fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  if (!res.ok) throw new Error('Could not download template');
  const blob = await res.blob();
  const parts = url.split('/');
  const name  = parts[parts.length - 1].replace('download', 'template.xlsx');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name.includes('.') ? name : name + '.xlsx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/**
 * Reusable Excel / CSV import modal.
 *
 * Props:
 *  - title          string   Modal heading
 *  - templateUrl    string   URL to download the .xlsx template
 *  - importFn       fn(File) → Promise<{imported,skipped,errors}>
 *  - onClose        fn()
 *  - onDone         fn()     called after a successful import so parent can refresh
 *  - columns        string[] Human-readable list of expected columns (shown as hint)
 */
export default function ImportModal({ title, templateUrl, importFn, onClose, onDone, columns = [] }) {
  const [file,         setFile]         = useState(null);
  const [dragging,     setDragging]     = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [downloading,  setDownloading]  = useState(false);
  const [result,       setResult]       = useState(null);
  const [error,        setError]        = useState('');
  const inputRef = useRef(null);

  const accept = '.xlsx,.xlsm,.csv';

  const handleFile = useCallback((f) => {
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['xlsx','xlsm','csv'].includes(ext)) {
      setError('Unsupported file type. Please use .xlsx, .xlsm or .csv');
      return;
    }
    setFile(f);
    setResult(null);
    setError('');
  }, []);

  // Drag-and-drop handlers
  const onDragOver  = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = ()  => setDragging(false);
  const onDrop      = (e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); };
  const onInputChange = (e) => handleFile(e.target.files[0]);

  const handleImport = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const res = await importFn(file);
      if (res.error) { setError(res.error); return; }
      setResult(res);
      if (res.imported > 0) onDone();
    } catch (e) {
      setError(e.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <Modal onClose={onClose}>
      <div style={{ minWidth: 420, maxWidth: 560 }}>
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}><Upload size={18} /> {title}</h2>
        </div>

        {/* Template download */}
        <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Step 1 — Download the template</div>
          <button
            className="btn btn-ghost btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            disabled={downloading}
            onClick={async () => {
              setDownloading(true);
              try { await downloadWithAuth(templateUrl); }
              catch (e) { setError(e.message); }
              finally { setDownloading(false); }
            }}
          >
            {downloading ? '⏳ Downloading…' : '⬇ Download Template (.xlsx)'}
          </button>
          {columns.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gray-500)' }}>
              <strong>Columns:</strong>&nbsp;
              {columns.map((c, i) => (
                <span key={c}>
                  <code style={{ background: 'var(--gray-100)', padding: '1px 4px', borderRadius: 3 }}>
                    {c}
                  </code>
                  {i < columns.length - 1 ? ', ' : ''}
                </span>
              ))}
              <span style={{ marginLeft: 4 }}>(<span style={{ color: 'var(--danger)' }}>*</span> = required)</span>
            </div>
          )}
        </div>

        {/* File drop zone */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Step 2 — Upload your file</div>
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            style={{
              border: `2px dashed ${dragging ? 'var(--primary)' : 'var(--gray-300)'}`,
              borderRadius: 8,
              padding: '28px 16px',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragging ? 'var(--primary-light, #e8f0fe)' : 'var(--gray-50)',
              transition: 'all 0.15s',
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              style={{ display: 'none' }}
              onChange={onInputChange}
            />
            {file ? (
              <div>
                <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
                <div style={{ fontWeight: 600 }}>{file.name}</div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 4 }}>
                  {(file.size / 1024).toFixed(1)} KB — click to change
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 28, marginBottom: 6 }}>📂</div>
                <div style={{ fontWeight: 600 }}>Drop file here or click to browse</div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 4 }}>
                  Supported: .xlsx, .xlsm, .csv
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="alert alert-danger" style={{ marginBottom: 16, fontSize: 13 }}>
            ⚠ {error}
          </div>
        )}

        {/* Result summary */}
        {result && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              display: 'flex', gap: 12, marginBottom: result.errors?.length ? 12 : 0
            }}>
              <div style={{ flex: 1, background: '#d1fae5', borderRadius: 8, padding: '10px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#065f46' }}>{result.imported}</div>
                <div style={{ fontSize: 11, color: '#065f46', fontWeight: 600 }}>Imported</div>
              </div>
              <div style={{ flex: 1, background: result.skipped ? '#fef3c7' : '#f0fdf4', borderRadius: 8, padding: '10px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: result.skipped ? '#92400e' : '#166534' }}>{result.skipped}</div>
                <div style={{ fontSize: 11, color: result.skipped ? '#92400e' : '#166534', fontWeight: 600 }}>Skipped / Errors</div>
              </div>
            </div>
            {result.errors?.length > 0 && (
              <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--gray-50)', position: 'sticky', top: 0 }}>
                      <th style={{ padding: '6px 10px', textAlign: 'left', width: 60 }}>Row</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((e, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--gray-100)' }}>
                        <td style={{ padding: '5px 10px', color: 'var(--gray-500)' }}>{e.row}</td>
                        <td style={{ padding: '5px 10px', color: 'var(--danger)' }}>{e.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {result ? (
            <>
              <button className="btn btn-ghost" onClick={reset}>Import Another</button>
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleImport}
                disabled={!file || loading}
              >
                {loading ? '⏳ Importing…' : '⬆ Import'}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
