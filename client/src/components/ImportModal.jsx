import { useState, useRef, useCallback } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, FolderOpen, Upload } from 'lucide-react';
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

const CORRECTION_COLUMNS = row => Object.keys(row.values || {});
const csvCell = value => (/[",\n;]/.test(String(value ?? '')) ? `"${String(value ?? '').replace(/"/g, '""')}"` : String(value ?? ''));

// The refused rows as a CSV to fix and import again: their columns as given, plus why.
function downloadCorrections(preview, fileName) {
  const rows = preview.rows.filter(r => r.action === 'error');
  const columns = [...new Set(rows.flatMap(CORRECTION_COLUMNS))];
  const lines = [[...columns, 'error', 'file_row'].map(csvCell).join(',')]
    .concat(rows.map(r => [...columns.map(c => r.values?.[c] ?? ''), r.error, r.row].map(csvCell).join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `${fileName.replace(/\.[^.]+$/, '')}-corrections.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

const ACTION_LABEL = { create: 'New', update: 'Update', unchanged: 'Already there', error: 'Not imported' };

// What the import would do, before anything changes.
function ImportPreview({ preview, fileName, noun, updates, onUpdates, unchangedLabel = 'already up to date', listUnchanged = false }) {
  const { counts } = preview;
  const [one, many] = noun;
  const plural = n => `${n} ${n === 1 ? one : many}`;
  const listed = preview.rows.filter(r => listUnchanged || r.action !== 'unchanged').slice(0, 200);
  return (
    <div className="mb-16" aria-label="Import preview" role="region">
      <p className="text-sm" style={{ margin: '0 0 8px' }}>
        {[counts.create && `${plural(counts.create)} to add`, counts.update && `${plural(counts.update)} to update`, counts.unchanged && `${counts.unchanged} ${unchangedLabel}`, counts.errors && `${counts.errors} row${counts.errors === 1 ? '' : 's'} with problems${counts.duplicates ? ` (${counts.duplicates} duplicate${counts.duplicates === 1 ? '' : 's'})` : ''}`].filter(Boolean).join(' · ') || 'Nothing to import.'}
      </p>
      {listed.length > 0 && (
        <div className="u-5524431">
          <table className="u-a55f31d">
            <thead><tr className="u-d2a4809"><th className="u-bcf0f56">Row</th><th className="u-2a9ffb1">Name</th><th className="u-2a9ffb1">Result</th><th className="u-2a9ffb1">Details</th></tr></thead>
            <tbody>{listed.map(r => (
              <tr key={r.row} className="u-5e0211f">
                <td className="u-e3294d8">{r.row}</td>
                <td className="u-f92cc01">{r.name || '—'}</td>
                <td className="u-f92cc01">{ACTION_LABEL[r.action]}</td>
                <td className="u-f92cc01">{r.action === 'error' || r.action === 'unchanged' ? r.error || '' : r.action === 'update' ? r.changes.map(c => `${c.field}: ${c.from || '—'} → ${c.to}`).join('; ') : r.error || ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {counts.errors > 0 && (
        <button type="button" className="btn btn-ghost btn-sm inline-flex items-center gap-6" style={{ marginTop: 8 }} onClick={() => downloadCorrections(preview, fileName)}>
          <Download size={14} aria-hidden="true" /> Download rows to correct (.csv)
        </button>
      )}
      {counts.update > 0 && (
        <label className="import-option" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={updates} onChange={e => onUpdates(e.target.checked)} />
          <span>Also update the {plural(counts.update)} listed as Update<small>Left unticked, existing {many} are not changed.</small></span>
        </label>
      )}
    </div>
  );
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
 *  - hint           node     Optional note under the columns (what values mean)
 *  - option         { label, help } Optional checkbox; its value goes to importFn(file, { option })
 *  - previewFn      fn(File) → Promise<preview>  Optional: the import is reviewed first; its
 *                   updates are confirmed separately, and the commit is bound to the preview
 *                   (importFn(file, { option, previewToken })).
 *  - noun           [singular, plural] for the preview ('customer', 'customers')
 */
export default function ImportModal({ title, templateUrl, importFn, previewFn, noun = ['record', 'records'], unchangedLabel, listUnchanged, onClose, onDone, columns = [], hint, option }) {
  const [file,         setFile]         = useState(null);
  const [dragging,     setDragging]     = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [downloading,  setDownloading]  = useState(false);
  const [result,       setResult]       = useState(null);
  const [error,        setError]        = useState('');
  const [optionOn,     setOptionOn]     = useState(false);
  const [preview,      setPreview]      = useState(null);
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
    setPreview(null);
    setOptionOn(false);
    setError('');
  }, []);

  const handlePreview = async () => {
    if (!file) return;
    setLoading(true); setError('');
    try { setPreview(await previewFn(file)); setOptionOn(false); }
    catch (e) { setError(e.message || 'Could not read the file'); }
    finally { setLoading(false); }
  };

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
      const res = await importFn(file, { option: optionOn, previewToken: preview?.token });
      if (res.error) { setError(res.error); return; }
      setResult(res);
      if (res.imported > 0 || res.updated > 0) onDone();
    } catch (e) {
      // Changed since the review: show the new review instead of importing.
      if (e.code === 'IMPORT_CHANGED' && e.preview) { setPreview(e.preview); setOptionOn(false); }
      setError(e.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setPreview(null);
    setOptionOn(false);
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
            <Download size={14} aria-hidden="true" /> {downloading ? 'Downloading…' : 'Download template (.xlsx)'}
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
          {hint && <div className="u-84faa37">{hint}</div>}
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
                <div className="u-9ff9df9"><FileSpreadsheet size={28} aria-hidden="true" /></div>
                <div className="font-semibold">{file.name}</div>
                <div className="u-4687662">
                  {(file.size / 1024).toFixed(1)} KB — click to change
                </div>
              </div>
            ) : (
              <div>
                <div className="u-9ff9df9"><FolderOpen size={28} aria-hidden="true" /></div>
                <div className="font-semibold">Drop file here or click to browse</div>
                <div className="u-4687662">
                  Supported: .xlsx, .xlsm, .csv
                </div>
              </div>
            )}
          </div>
        </div>

        {preview && !result && <ImportPreview preview={preview} fileName={file?.name || 'import'} noun={noun} unchangedLabel={unchangedLabel} listUnchanged={listUnchanged} updates={optionOn} onUpdates={setOptionOn} />}

        {option && !result && !previewFn && (
          <label className="import-option">
            <input type="checkbox" checked={optionOn} onChange={e => setOptionOn(e.target.checked)} />
            <span>{option.label}{option.help && <small>{option.help}</small>}</span>
          </label>
        )}

        {/* Error */}
        {error && (
          <div className="alert alert-danger u-5f7bb55">
            <AlertTriangle size={14} aria-hidden="true" /> {error}
          </div>
        )}

        {/* Result summary */}
        {result && (
          <div className="mb-16">
            {result.skipped > 0 && (result.imported > 0 || result.updated > 0) && <p className="text-sm" role="status"><strong>Partly imported:</strong> the rows below were not imported; everything else was.</p>}
            <div className={["u-abc9d35", (result.errors?.length ? 'u-da12f28' : 'u-ef0b7a1')].filter(Boolean).join(' ')}>
              <div className="u-6396897">
                <div className="u-4b6bd12">{result.imported}</div>
                <div className="u-9f239db">Imported</div>
              </div>
              {result.updated != null && <div className="u-6396897">
                <div className="u-4b6bd12">{result.updated}</div>
                <div className="u-9f239db">Updated</div>
              </div>}
              <div className={["u-0ced26f", (result.skipped ? 'u-a342d80' : 'u-725d2d4')].filter(Boolean).join(' ')}>
                <div className={["u-86ecc8d", (result.skipped ? 'u-91ee9a7' : 'u-d311ded')].filter(Boolean).join(' ')}>{result.skipped}</div>
                <div className={["u-0907ca8", (result.skipped ? 'u-91ee9a7' : 'u-d311ded')].filter(Boolean).join(' ')}>Skipped / Errors</div>
              </div>
            </div>
            {(result.managed > 0 || result.contracts > 0) && <p className="text-sm">{[result.managed > 0 && `${result.managed} marked as managed`, result.contracts > 0 && `${result.contracts} contract${result.contracts === 1 ? '' : 's'} added or updated`].filter(Boolean).join('; ')}.</p>}
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
              {previewFn && !preview ? (
                <button className="btn btn-primary" onClick={handlePreview} disabled={!file || loading}>
                  {loading ? 'Reading…' : 'Review import'}
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={handleImport}
                  disabled={!file || loading || (preview && !preview.counts.create && !(optionOn && preview.counts.update))}
                >
                  <Upload size={14} aria-hidden="true" /> {loading ? 'Importing…' : preview ? `Import ${[preview.counts.create && `${preview.counts.create} new`, optionOn && preview.counts.update && `${preview.counts.update} updated`].filter(Boolean).join(' and ') || ''}`.trim() : 'Import'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
