/* Turns a filled Word report into a PDF with LibreOffice, so the PDF of a report
   made from the company's Word template looks like the Word file.

   LibreOffice is in the Docker image (Dockerfile). Elsewhere set SOFFICE_PATH, or
   have `soffice` on the PATH. One conversion runs at a time (LibreOffice does not
   share its profile), each with its own throwaway profile and a time limit. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const TIMEOUT_MS = 120000;
const soffice = () => process.env.SOFFICE_PATH || 'soffice';
let queue = Promise.resolve();

function run(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(soffice(), args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env: { PATH: process.env.PATH, HOME: os.tmpdir(), TMPDIR: os.tmpdir(), LANG: process.env.LANG || 'C.UTF-8' } }); }
    catch (error) { reject(error); return; }
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('LibreOffice took too long')); }, timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`LibreOffice failed (${code}): ${stderr.trim()}`)); });
  });
}

async function convert(docx, { timeoutMs = TIMEOUT_MS } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-pdf-'));
  try {
    const input = path.join(dir, 'report.docx');
    fs.writeFileSync(input, docx);
    const profile = pathToFileURL(path.join(dir, 'profile')).href;
    await run([`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--nolockcheck', '--convert-to', 'pdf', '--outdir', dir, input], timeoutMs);
    const output = path.join(dir, 'report.pdf');
    if (!fs.existsSync(output)) throw new Error('LibreOffice made no PDF');
    return fs.readFileSync(output);
  } catch (error) {
    if (error.code === 'ENOENT') throw Object.assign(new Error('PDFs from the Word template need LibreOffice on the server (it is in the Docker image). Download the Word report instead, or set SOFFICE_PATH.'), { status: 503 });
    throw Object.assign(new Error(`The Word report could not be turned into a PDF. ${error.message}`), { status: 500 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** The PDF of a .docx (Buffer in, Buffer out). Conversions wait their turn. */
function docxToPdf(docx, options) {
  const next = queue.then(() => convert(docx, options));
  queue = next.catch(() => {});
  return next;
}

module.exports = { docxToPdf };
