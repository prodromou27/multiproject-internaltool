import { useState, useRef, useCallback } from 'react';
import { Upload } from 'lucide-react';
import { Modal } from './Shared';

async function downloadWithAuth(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
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
      <div className="u-8ad2dda">
        {/* Header */}
        <div className="mb-20">
          <h2 className="u-31afecb"><Upload size={18} /> {title}</h2>
        </div>

        {/* Template download */}
        <div className="u-7505550">
          <div className="u-26bc431">Step 1 — Download the template</div>
          <button
            className="btn btn-ghost btn-sm inline-flex items-center gap-6"
           
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
            <div className="u-84faa37">
              <strong>Columns:</strong>&nbsp;
              {columns.map((c, i) => (
                <span key={c}>
                  <code className="u-59f3af2">
                    {c}
                  </code>
                  {i < columns.length - 1 ? ', ' : ''}
                </span>
              ))}
              <span className="u-46cec89">(<span className="u-497726e">*</span> = required)</span>
            </div>
          )}
        </div>

        {/* File drop zone */}
        <div className="mb-16">
          <div className="u-fcbd5e4">Step 2 — Upload your file</div>
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className="u-e4ae2d3" style={{ border: `2px dashed ${dragging ? 'var(--primary)' : 'var(--gray-300)'}`, background: dragging ? 'var(--primary-light, #e8f0fe)' : 'var(--gray-50)' }}
          >
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              className="u-6b99de8"
              onChange={onInputChange}
            />
            {file ? (
              <div>
                <div className="u-9ff9df9">📄</div>
                <div className="font-semibold">{file.name}</div>
                <div className="u-4687662">
                  {(file.size / 1024).toFixed(1)} KB — click to change
                </div>
              </div>
            ) : (
              <div>
                <div className="u-9ff9df9">📂</div>
                <div className="font-semibold">Drop file here or click to browse</div>
                <div className="u-4687662">
                  Supported: .xlsx, .xlsm, .csv
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="alert alert-danger u-5f7bb55">
            ⚠ {error}
          </div>
        )}

        {/* Result summary */}
        {result && (
          <div className="mb-16">
            <div className="u-abc9d35" style={{ marginBottom: result.errors?.length ? 12 : 0 }}>
              <div className="u-6396897">
                <div className="u-4b6bd12">{result.imported}</div>
                <div className="u-9f239db">Imported</div>
              </div>
              <div className="u-0ced26f" style={{ background: result.skipped ? '#fef3c7' : '#f0fdf4' }}>
                <div className="u-86ecc8d" style={{ color: result.skipped ? '#92400e' : '#166534' }}>{result.skipped}</div>
                <div className="u-0907ca8" style={{ color: result.skipped ? '#92400e' : '#166534' }}>Skipped / Errors</div>
              </div>
            </div>
            {result.errors?.length > 0 && (
              <div className="u-5524431">
                <table className="u-a55f31d">
                  <thead>
                    <tr className="u-d2a4809">
                      <th className="u-bcf0f56">Row</th>
                      <th className="u-2a9ffb1">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((e, i) => (
                      <tr key={i} className="u-5e0211f">
                        <td className="u-e3294d8">{e.row}</td>
                        <td className="u-f92cc01">{e.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="u-309cf47">
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
