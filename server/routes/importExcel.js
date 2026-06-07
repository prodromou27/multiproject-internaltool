const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const ExcelJS  = require('exceljs');
const db       = require('../db');
const { requireAuth } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Normalise ARGB → RGB (strip the 2-char alpha prefix only when 8 chars long)
function normRgb(rgb) {
  if (!rgb) return '';
  const s = String(rgb).toUpperCase();
  return s.length === 8 ? s.slice(2) : s;
}

// Returns solid-fill background colour as 6-char RGB hex, or '' if none.
// ExcelJS uses 1-based row/col addressing.
function getCellBg(ws, row, col) {
  const cell = ws.getCell(row, col);
  if (cell?.fill?.type === 'pattern' && cell.fill.pattern === 'solid') {
    return normRgb(cell.fill.fgColor?.argb || '');
  }
  return '';
}

function getCellVal(ws, row, col) {
  const cell = ws.getCell(row, col);
  if (!cell) return '';
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v.richText) return v.richText.map(rt => rt.text || '').join('');
  if (typeof v === 'object' && v.formula !== undefined) return v.result ?? '';
  return v;
}

async function parseEffortSheet(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  // Prefer "Solutions" sheet, fall back to first sheet
  const ws = wb.getWorksheet('Solutions') || wb.worksheets[0];
  if (!ws || !ws.dimensions) return { tasks: [], meta: {} };

  const { top: firstRow, bottom: lastRow } = ws.dimensions;

  // Extract metadata from header rows (1-based rows 6-15, equivalent to 0-based 5-14)
  const meta = {};
  const metaKeys = {
    'Customer Name':          'customer',
    'Q - Reference':          'reference',
    'Project Name':           'projectName',
    'Date of Completion':     'completionDate',
    'Presales Engineer Owner':'owner',
  };
  for (let R = 6; R <= 15; R++) {
    const key = String(getCellVal(ws, R, 1) || '').trim();   // col A
    const val = getCellVal(ws, R, 2);                         // col B
    if (metaKeys[key] && val) {
      meta[metaKeys[key]] = val instanceof Date
        ? val.toISOString().slice(0, 10)
        : String(val).trim();
    }
  }

  const tasks = [];
  let currentProduct    = null;
  let currentSubProduct = null;
  let currentTaskGroup  = null;

  for (let R = firstRow; R <= lastRow; R++) {
    // ExcelJS columns: A=1, B=2, C=3, D=4, E=5, F=6
    const colA_val = getCellVal(ws, R, 1);
    const colB_val = getCellVal(ws, R, 2);
    const colC_val = getCellVal(ws, R, 3);
    const colD_val = getCellVal(ws, R, 4);
    const colE_val = getCellVal(ws, R, 5);
    const colF_val = getCellVal(ws, R, 6);

    if (!colC_val) continue;
    const colC_str = String(colC_val).replace(/[\t\r\n]+/g, ' ').trim();
    if (!colC_str) continue;

    const colA_bg = getCellBg(ws, R, 1);
    const colC_bg = getCellBg(ws, R, 3);

    // Product/category header row: col C has amber/orange background (EDC297)
    if (colC_bg === 'EDC297') {
      currentProduct    = colC_str;
      currentSubProduct = null;
      currentTaskGroup  = null;
      continue;
    }

    // Task group row: col A has grey background (D9D9D9) and no hours in col D
    if (colA_bg === 'D9D9D9' && !colD_val) {
      currentTaskGroup = colC_str;
      continue;
    }

    // Sub-product header: col A empty, col B has dept, col C has value, no D/E/F
    if (!colA_val && !colD_val && colC_bg !== 'FFEB9C' && colA_bg !== 'D9D9D9') {
      if (currentProduct !== null) {
        currentSubProduct = colC_str;
        continue;
      }
    }

    // Subtask/work-item row: col C has yellow background (FFEB9C)
    if (colC_bg === 'FFEB9C' && colC_str) {
      const qty        = colD_val !== '' ? Number(colD_val) || 1 : 1;
      const workHrs    = colE_val !== '' ? parseFloat(String(colE_val)) : 0;
      const nonWorkHrs = colF_val !== '' ? parseFloat(String(colF_val)) : 0;

      tasks.push({
        product:         currentProduct     || '',
        subProduct:      currentSubProduct  || '',
        taskGroup:       currentTaskGroup   || '',
        taskCode:        String(colA_val    || '').trim(),
        department:      String(colB_val    || '').trim(),
        title:           colC_str,
        qty:             isNaN(qty)         ? 1 : qty,
        workingHours:    isNaN(workHrs)     ? 0 : workHrs,
        nonWorkingHours: isNaN(nonWorkHrs)  ? 0 : nonWorkHrs,
      });
    }
  }

  return { tasks, meta };
}

function canManage(req) {
  return ['manager', 'planner'].includes(req.user?.role);
}

// POST /api/projects/:id/import-excel/preview
// Parses the uploaded .xlsx and returns extracted tasks (no DB writes)
router.post('/:id/import-excel/preview', requireAuth, upload.single('file'), async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Forbidden' });
  if (!req.file)       return res.status(400).json({ error: 'No file uploaded' });

  const projectId = parseInt(req.params.id);
  const project   = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const { tasks, meta } = await parseEffortSheet(req.file.buffer);
    res.json({ tasks, meta, count: tasks.length });
  } catch (err) {
    console.error('Excel parse error:', err);
    res.status(400).json({ error: 'Failed to parse Excel file. Please ensure it is a valid .xlsx file.' });
  }
});

// POST /api/projects/:id/import-excel/confirm
// Inserts the selected tasks into the DB
router.post('/:id/import-excel/confirm', requireAuth, (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Forbidden' });

  const projectId = parseInt(req.params.id);
  const project   = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { tasks } = req.body;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({ error: 'No tasks provided' });
  }

  const insert = db.prepare(`
    INSERT INTO tasks (project_id, title, description, status, priority, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 'open', 'medium', ?, datetime('now'), datetime('now'))
  `);

  const doInsert = db.transaction((list) => {
    let created = 0;
    for (const t of list) {
      const title = String(t.title || '').trim();
      if (!title) continue;

      insert.run(projectId, title, null, req.user.id);
      created++;
    }
    return created;
  });

  const created = doInsert(tasks);
  res.json({ created, message: `${created} task${created !== 1 ? 's' : ''} imported successfully` });
});

module.exports = router;
