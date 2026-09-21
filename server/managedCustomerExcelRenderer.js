const ExcelJS=require('exceljs');

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
  const workbook=new ExcelJS.Workbook();workbook.creator='SolutionsHub';workbook.created=new Date(model.generated_at);workbook.title=`Managed Services Report - ${model.customer.name}`;
  const summary=[
    { measure:'Customer',value:model.customer.name },{ measure:'Period',value:`${model.period.from} to ${model.period.to}` },{ measure:'Open tickets now',value:model.overview.tickets?.open_now ?? 'Excluded' },{ measure:'Pending tickets now',value:model.overview.tickets?.pending_now ?? 'Excluded' },{ measure:'Tickets created during period',value:model.overview.tickets?.created_period ?? 'Excluded' },{ measure:'Tickets resolved during period',value:model.overview.tickets?.resolved_period ?? 'Excluded' },{ measure:'Service activities',value:model.overview.activities.activities },{ measure:'Service hours',value:model.overview.activities.hours },{ measure:'Open tasks now',value:model.overview.tasks.open_now },{ measure:'Active projects now',value:model.overview.projects.active_now },{ measure:'Maintenance Visits during period',value:model.overview.visits.visits_period },{ measure:'Open recommendations now',value:model.overview.recommendations.open_now },
  ];
  addSheet(workbook,'Summary',[['Measure','measure',34],['Value','value',42]],summary);
  if (model.tickets.enabled && included(model,'ticket_summary')) addChartSheet(workbook,model.tickets.analytics);
  if (model.tickets.enabled && (included(model,'open_tickets') || included(model,'period_tickets'))) {
    const ticketRows=[...(included(model,'open_tickets')?model.tickets.open.rows.map(row => ({ ...row,report_set:'Open backlog' })):[]),...(included(model,'period_tickets')?model.tickets.period.rows.map(row => ({ ...row,report_set:'Created in period' })):[])];
    addSheet(workbook,'Tickets',[['Report set','report_set',18],['Ticket','ticket_number',14],['Subject','subject',42],['Status','normalized_status',16],['Priority','normalized_priority',14],['Owner','owner_name',20],['Created','created_at_external',22],['Updated','updated_at_external',22],['Resolved','resolved_at_external',22],['SLA breached','sla_breached',14]],ticketRows);
  }
  if (model.activities.enabled && included(model,'service_activities')) addSheet(workbook,'Activities',[['Date','activity_date',14],['Reference','activity_reference',18],['Activity','title',42],['Engineer','engineer_name',22],['Category','category_name',20],['Minutes','duration_minutes',12],['Location','work_location',14],['Billing','billable_classification',22],['Ticket','ticket_reference',16]],model.activities.rows);
  if (model.tasks.enabled && included(model,'tasks')) addSheet(workbook,'Tasks',[['Task','title',42],['Project','project_title',32],['Engineer','assigned_to_name',22],['Status','status',18],['Priority','priority',14],['Due','deadline',14],['Updated','updated_at',22]],model.tasks.rows);
  if (model.projects.enabled && included(model,'projects')) addSheet(workbook,'Projects',[['Project','title',42],['Status','status',18],['Priority','priority',14],['Progress %','completion_pct',14],['Tasks','task_count',10],['Done','done_count',10],['Deadline','deadline',14],['Closed','closed_at',22]],model.projects.rows);
  if (model.maintenance_visits.enabled && included(model,'maintenance_visits')) addSheet(workbook,'Maintenance Visits',[['Date','scheduled_date',14],['Visit','title',42],['Engineer','engineer_name',22],['Status','status',18],['Report prepared','report_sent',16],['Sent to customer','report_sent_to_customer',18],['Recommendations','recommendation_count',18]],model.maintenance_visits.rows);
  if (model.recommendations.enabled && included(model,'recommendations')) addSheet(workbook,'Recommendations',[['Finding','finding',40],['Recommendation','recommendation',50],['Risk','risk_level',14],['Status','status',20],['Owner','owner_name',22],['Due','due_date',14],['Source visit','source_visit_title',30]],model.recommendations.rows);
  return workbook.xlsx.writeBuffer();
}

module.exports={ renderExcel,safe };
