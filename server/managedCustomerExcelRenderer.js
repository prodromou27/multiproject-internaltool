const ExcelJS=require('exceljs');
const { PRODUCT_NAME }=require('./product');
const { tableFor }=require('./reportTables');

const safe=value => typeof value==='string' && /^[=+\-@]/.test(value) ? `'${value}` : value ?? '';
const included=(model,key) => model.sections.includes(key);

function addSheet(workbook,name,columns,rows) {
  const sheet=workbook.addWorksheet(name,{ views:[{ state:'frozen',ySplit:1 }] });
  sheet.columns=columns.map(([header,key,width]) => ({ header,key,width }));
  for (const row of rows) sheet.addRow(Object.fromEntries(columns.map(([,key]) => [key,safe(row[key])])));
  sheet.getRow(1).font={ bold:true,color:{ argb:'FFFFFFFF' } };sheet.getRow(1).fill={ type:'pattern',pattern:'solid',fgColor:{ argb:'FF1D4ED8' } };sheet.getRow(1).alignment={ vertical:'middle' };
  sheet.autoFilter={ from:'A1',to:{ row:1,column:columns.length } };sheet.eachRow(row => { row.alignment={ vertical:'top',wrapText:true }; });
  return sheet;
}

// A report table (see reportTables.js) as a sheet; `prefix` adds a leading column.
function addTableSheet(workbook,name,tables,prefix) {
  const columns=[...(prefix ? [[prefix.label,'__prefix',18]] : []),...tables[0].columns.map((column,index) => [column.label,`c${index}`,column.width])];
  const rows=tables.flatMap(table => table.rows.map(values => ({ ...(prefix ? { __prefix:prefix.value(table) } : {}),...Object.fromEntries(values.map((value,index) => [`c${index}`,value])) })));
  return addSheet(workbook,name,columns,rows);
}

function addChartSheet(workbook,analytics) {
  const sheet=workbook.addWorksheet('Charts',{ views:[{ state:'frozen',ySplit:1 }] });sheet.columns=[{ width:24 },{ width:18 },{ width:18 }];
  let row=1;
  const header=(title,labels) => { sheet.getCell(row,1).value=title;sheet.getCell(row,1).font={ bold:true,size:14,color:{ argb:'FF1D4ED8' } };row++;labels.forEach((label,index) => { sheet.getCell(row,index+1).value=label;sheet.getCell(row,index+1).font={ bold:true,color:{ argb:'FFFFFFFF' } };sheet.getCell(row,index+1).fill={ type:'pattern',pattern:'solid',fgColor:{ argb:'FF1D4ED8' } }; });row++; };
  const bars=(title,label,rows) => { header(title,[label,'Count']);const start=row;rows.forEach(item => { sheet.getCell(row,1).value=item.name;sheet.getCell(row,2).value=Number(item.count);row++; });if (row>start) sheet.addConditionalFormatting({ ref:`B${start}:B${row-1}`,rules:[{ type:'dataBar',cfvo:[{ type:'min' },{ type:'max' }],color:'FF2563EB',showValue:true }] });row+=2; };
  header('Ticket Throughput Trend',['Bucket start','Created','Resolved']);const trendStart=row;
  analytics.trend.points.forEach(point => { sheet.getCell(row,1).value=point.date;sheet.getCell(row,2).value=point.created;sheet.getCell(row,3).value=point.resolved;row++; });
  if (row>trendStart) { sheet.addConditionalFormatting({ ref:`B${trendStart}:B${row-1}`,rules:[{ type:'dataBar',cfvo:[{ type:'min' },{ type:'max' }],color:'FF2563EB',showValue:true }] });sheet.addConditionalFormatting({ ref:`C${trendStart}:C${row-1}`,rules:[{ type:'dataBar',cfvo:[{ type:'min' },{ type:'max' }],color:'FF16A34A',showValue:true }] }); }
  row+=2;bars('Open Tickets by Status','Status',analytics.current.statuses);bars('Open Tickets by Priority','Priority',analytics.current.priorities);bars('Open Ticket Aging','Age',analytics.current.aging);
}

async function renderExcel(model) {
  const workbook=new ExcelJS.Workbook();workbook.creator=PRODUCT_NAME;workbook.created=new Date(model.generated_at);workbook.title=`Managed Services Report - ${model.customer.name}`;
  const summary=[
    { measure:'Customer',value:model.customer.name },{ measure:'Period',value:`${model.period.from} to ${model.period.to}` },{ measure:'Open tickets now',value:model.overview.tickets?.open_now ?? 'Excluded' },{ measure:'Pending tickets now',value:model.overview.tickets?.pending_now ?? 'Excluded' },{ measure:'Tickets created during period',value:model.overview.tickets?.created_period ?? 'Excluded' },{ measure:'Tickets resolved during period',value:model.overview.tickets?.resolved_period ?? 'Excluded' },{ measure:'Service activities',value:model.overview.activities.activities },{ measure:'Service hours',value:model.overview.activities.hours },{ measure:'Open tasks now',value:model.overview.tasks.open_now },{ measure:'Active projects now',value:model.overview.projects.active_now },{ measure:'Maintenance Visits during period',value:model.overview.visits.visits_period },{ measure:'Open recommendations now',value:model.overview.recommendations.open_now },
  ];
  addSheet(workbook,'Summary',[['Measure','measure',34],['Value','value',42]],summary);
  if (model.tickets.enabled && included(model,'ticket_summary')) addChartSheet(workbook,model.tickets.analytics);
  const table=key => (included(model,key) ? tableFor(model,key,'spreadsheet') : null);
  // Open and period tickets share one sheet while they show the same columns.
  const tickets=[table('open_tickets'),table('period_tickets')].filter(Boolean);
  const sets={ 'Open Tickets':'Open backlog','Tickets Created During Period':'Created in period' };
  const sameColumns=tickets.length===2 && tickets[0].columns.map(c => c.key).join()===tickets[1].columns.map(c => c.key).join();
  if (tickets.length===1 || sameColumns) addTableSheet(workbook,'Tickets',tickets,{ label:'Report set',value:t => sets[t.title] });
  else for (const ticketTable of tickets) addTableSheet(workbook,ticketTable.title,[ticketTable]);
  for (const key of ['service_activities','tasks','projects','maintenance_visits','changes','resolved_tickets','assets','recommendations']) {
    const sheet=table(key);if (sheet) addTableSheet(workbook,sheet.sheet,[sheet]);
  }
  return workbook.xlsx.writeBuffer();
}

module.exports={ renderExcel,safe };
