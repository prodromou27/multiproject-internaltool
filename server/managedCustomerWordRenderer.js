const { AlignmentType,Document,Footer,HeadingLevel,PageBreak,PageNumber,Packer,Paragraph,Table,TableCell,TableRow,TextRun,WidthType }=require('docx');
const { PRODUCT_NAME }=require('./product');
const { TABLES,tableFor }=require('./reportTables');

const text=value => value===null || value===undefined || value==='' ? '—' : String(value);
const title=value => new Paragraph({ text:value,heading:HeadingLevel.HEADING_1,spacing:{ before:260,after:140 } });
const paragraph=value => new Paragraph({ children:[new TextRun(text(value))],spacing:{ after:120 } });
const cell=(value,bold=false) => new TableCell({ children:[new Paragraph({ children:[new TextRun({ text:text(value),bold })] })] });
const table=(headers,rows) => new Table({ width:{ size:100,type:WidthType.PERCENTAGE },rows:[new TableRow({ tableHeader:true,children:headers.map(value => cell(value,true)) }),...rows.map(row => new TableRow({ children:row.map(value => cell(value)) }))] });
const addTable=(children,heading,headers,rows) => { children.push(title(heading));children.push(rows.length ? table(headers,rows) : paragraph('No matching records.')); };
const chartRows=rows => { const max=Math.max(1,...rows.map(row => Number(row.count)));return rows.map(row => [row.name,'#'.repeat(Math.max(1,Math.round(Number(row.count)/max*20))),row.count]); };
const trendRows=points => { const recent=points.slice(-16),max=Math.max(1,...recent.flatMap(point => [point.created,point.resolved]));return recent.map(point => [point.date,'#'.repeat(Math.round(point.created/max*16)),point.created,'#'.repeat(Math.round(point.resolved/max*16)),point.resolved]); };

function buildDocument(model) {
  const n=model.narratives,children=[
    new Paragraph({ alignment:AlignmentType.CENTER,spacing:{ before:1500,after:300 },children:[new TextRun({ text:'Managed Services Report',bold:true,size:44,color:'1D4ED8' })] }),
    new Paragraph({ alignment:AlignmentType.CENTER,spacing:{ after:220 },children:[new TextRun({ text:model.customer.name,bold:true,size:34 })] }),
    new Paragraph({ alignment:AlignmentType.CENTER,spacing:{ after:120 },children:[new TextRun({ text:`Reporting period: ${model.period.from} to ${model.period.to}`,size:24 })] }),
    new Paragraph({ alignment:AlignmentType.CENTER,spacing:{ after:900 },children:[new TextRun({ text:`Generated ${new Date(model.generated_at).toLocaleDateString('en-GB')}`,size:20,color:'64748B' })] }),
    new Paragraph({ alignment:AlignmentType.CENTER,children:[new TextRun({ text:'Confidential',bold:true,color:'B91C1C' })] }),
    new Paragraph({ children:[new PageBreak()] }),
  ];
  const builders={
    executive_summary:() => { children.push(title('Executive Summary'),paragraph(n.executive_summary || 'No executive summary provided.'));if (n.key_highlights) children.push(new Paragraph({ text:'Key Highlights',heading:HeadingLevel.HEADING_2 }),paragraph(n.key_highlights));if (n.major_changes) children.push(new Paragraph({ text:'Major Changes',heading:HeadingLevel.HEADING_2 }),paragraph(n.major_changes)); },
    service_overview:() => addTable(children,'Service Overview',['Current / period measure','Value'],[['Open tickets now',model.overview.tickets?.open_now ?? 'Excluded'],['Pending tickets now',model.overview.tickets?.pending_now ?? 'Excluded'],['Service activities',model.overview.activities.activities],['Service hours',model.overview.activities.hours],['Open tasks now',model.overview.tasks.open_now],['Active projects now',model.overview.projects.active_now],['Maintenance Visits in period',model.overview.visits.visits_period],['Open recommendations now',model.overview.recommendations.open_now]]),
    ticket_summary:() => { if (!model.tickets.enabled) return;const { current,period,trend }=model.tickets.analytics;addTable(children,'Ticket Summary',['Measure','Value'],[['Open backlog',current.total_open],['Created during period',period.created],['Resolved during period',period.resolved],['Closed during period',period.closed],['Rejected during period',period.rejected],['SLA breaches during period',period.sla_breaches]]);addTable(children,'Ticket Throughput Trend',['Bucket','Created','Count','Resolved','Count'],trendRows(trend.points));addTable(children,'Open Tickets by Status',['Status','Distribution','Count'],chartRows(current.statuses));addTable(children,'Open Tickets by Priority',['Priority','Distribution','Count'],chartRows(current.priorities));addTable(children,'Open Ticket Aging',['Age','Distribution','Count'],chartRows(current.aging)); },
    risks:() => children.push(title('Risks / Concerns'),paragraph(n.risks_concerns || 'No risks or concerns provided.')),
    upcoming_work:() => children.push(title('Upcoming Work'),paragraph(n.upcoming_activities || 'No upcoming activities provided.')),
    management_notes:() => children.push(title('Management Notes'),paragraph(n.management_notes || 'No management notes provided.')),
  };
  // The data tables, with the report template's columns, sorting and row limit.
  for (const key of Object.keys(TABLES)) builders[key]=() => { const data=tableFor(model,key);if (data) addTable(children,data.title,data.columns.map(c => c.label),data.rows); };
  for (const section of model.sections) builders[section]?.();
  return new Document({ creator:PRODUCT_NAME,title:`Managed Services Report - ${model.customer.name}`,description:`${model.period.from} to ${model.period.to}`,styles:{ default:{ document:{ run:{ font:'Aptos',size:20 },paragraph:{ spacing:{ line:276 } } } },paragraphStyles:[{ id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,run:{ size:30,bold:true,color:'1E3A8A' } },{ id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,run:{ size:24,bold:true,color:'334155' } }] },sections:[{ footers:{ default:new Footer({ children:[new Paragraph({ alignment:AlignmentType.CENTER,children:[new TextRun({ text:'Confidential · Page ',color:'64748B' }),new TextRun({ children:[PageNumber.CURRENT],color:'64748B' })] })] }) },children }] });
}

async function renderWord(model) { return Packer.toBuffer(buildDocument(model)); }

module.exports={ buildDocument,renderWord };
