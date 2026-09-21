const PDFDocument=require('pdfkit');

const COLORS={ primary:'#1e3a8a',accent:'#2563eb',text:'#172033',muted:'#64748b',line:'#cbd5e1',header:'#e2e8f0',danger:'#b91c1c' };
const display=value => value===null || value===undefined || value==='' ? '-' : String(value);

function renderPdf(model) {
  return new Promise((resolve,reject) => {
    const doc=new PDFDocument({ size:'A4',layout:'landscape',margin:40,bufferPages:true,info:{ Title:`Managed Services Report - ${model.customer.name}`,Author:'SolutionsHub',Subject:`${model.period.from} to ${model.period.to}` } });
    const chunks=[];doc.on('data',chunk => chunks.push(chunk));doc.on('error',reject);doc.on('end',() => resolve(Buffer.concat(chunks)));
    const pageWidth=doc.page.width-doc.page.margins.left-doc.page.margins.right;
    const ensureSpace=height => { if (doc.y+height>doc.page.height-doc.page.margins.bottom-18) doc.addPage(); };
    const heading=value => { ensureSpace(42);doc.moveDown(.5).font('Helvetica-Bold').fontSize(16).fillColor(COLORS.primary).text(value).moveDown(.4); };
    const paragraph=value => { doc.font('Helvetica').fontSize(10).fillColor(COLORS.text).text(display(value),{ lineGap:2 }).moveDown(.5); };
    const table=(title,headers,rows) => {
      heading(title);
      if (!rows.length) return paragraph('No matching records.');
      const widths=headers.map(() => pageWidth/headers.length),padding=4;
      const drawRow=(values,isHeader=false) => {
        doc.font(isHeader?'Helvetica-Bold':'Helvetica').fontSize(isHeader?8:7);
        const heights=values.map((value,index) => doc.heightOfString(display(value),{ width:widths[index]-padding*2,lineGap:1 }));
        const height=Math.max(isHeader?20:17,...heights.map(value => value+padding*2));ensureSpace(height);
        const y=doc.y;
        values.forEach((value,index) => {
          const x=doc.page.margins.left+widths.slice(0,index).reduce((sum,width) => sum+width,0);
          doc.rect(x,y,widths[index],height).fillAndStroke(isHeader?COLORS.header:'#ffffff',COLORS.line);
          doc.fillColor(COLORS.text).text(display(value),x+padding,y+padding,{ width:widths[index]-padding*2,lineGap:1 });
        });
        doc.y=y+height;
      };
      drawRow(headers,true);rows.forEach(row => drawRow(row));doc.moveDown(.5);
    };
    const n=model.narratives;
    doc.moveDown(5).font('Helvetica-Bold').fontSize(28).fillColor(COLORS.accent).text('Managed Services Report',{ align:'center' }).moveDown(.6);
    doc.fontSize(22).fillColor(COLORS.text).text(model.customer.name,{ align:'center' }).moveDown(.5);
    doc.font('Helvetica').fontSize(12).text(`Reporting period: ${model.period.from} to ${model.period.to}`,{ align:'center' }).moveDown(.4);
    doc.fillColor(COLORS.muted).text(`Generated ${new Date(model.generated_at).toLocaleDateString('en-GB')}`,{ align:'center' }).moveDown(2);
    doc.font('Helvetica-Bold').fillColor(COLORS.danger).text('Confidential',{ align:'center' });doc.addPage();

    const builders={
      executive_summary:() => { heading('Executive Summary');paragraph(n.executive_summary || 'No executive summary provided.');if (n.key_highlights) { heading('Key Highlights');paragraph(n.key_highlights); }if (n.major_changes) { heading('Major Changes');paragraph(n.major_changes); } },
      service_overview:() => table('Service Overview',['Current / period measure','Value'],[['Open tickets now',model.overview.tickets?.open_now ?? 'Excluded'],['Pending tickets now',model.overview.tickets?.pending_now ?? 'Excluded'],['Service activities',model.overview.activities.activities],['Service hours',model.overview.activities.hours],['Open tasks now',model.overview.tasks.open_now],['Active projects now',model.overview.projects.active_now],['Maintenance Visits in period',model.overview.visits.visits_period],['Open recommendations now',model.overview.recommendations.open_now]]),
      ticket_summary:() => { if (!model.tickets.enabled) return;const current=model.tickets.analytics.current,period=model.tickets.analytics.period;table('Ticket Summary',['Measure','Value'],[['Open backlog',current.total_open],['Created during period',period.created],['Resolved during period',period.resolved],['Closed during period',period.closed],['Rejected during period',period.rejected],['SLA breaches during period',period.sla_breaches]]);table('Open Tickets by Status',['Status','Count'],current.statuses.map(row => [row.name,row.count]));table('Open Ticket Aging',['Age','Count'],current.aging.map(row => [row.name,row.count])); },
      open_tickets:() => { if (model.tickets.enabled) table('Open Tickets',['Ticket','Subject','Status','Priority','Owner','Created'],model.tickets.open.rows.map(row => [row.ticket_number,row.subject,row.normalized_status,row.normalized_priority,row.owner_name,row.created_at_external])); },
      period_tickets:() => { if (model.tickets.enabled) table('Tickets Created During Period',['Ticket','Subject','Status','Priority','Owner','Created'],model.tickets.period.rows.map(row => [row.ticket_number,row.subject,row.normalized_status,row.normalized_priority,row.owner_name,row.created_at_external])); },
      service_activities:() => { if (model.activities.enabled) table('Service Activities',['Date','Reference','Activity','Engineer','Category','Hours'],model.activities.rows.map(row => [row.activity_date,row.activity_reference,row.title,row.engineer_name,row.category_name,Math.round(Number(row.duration_minutes || 0)/6)/10])); },
      tasks:() => { if (model.tasks.enabled) table('Tasks',['Task','Project','Engineer','Status','Priority','Due'],model.tasks.rows.map(row => [row.title,row.project_title,row.assigned_to_name,row.status,row.priority,row.deadline])); },
      projects:() => { if (model.projects.enabled) table('Projects',['Project','Status','Priority','Progress','Deadline'],model.projects.rows.map(row => [row.title,row.status,row.priority,`${row.completion_pct}%`,row.deadline])); },
      maintenance_visits:() => { if (model.maintenance_visits.enabled) table('Maintenance Visits',['Date','Visit','Engineer','Status','Report sent','Recommendations'],model.maintenance_visits.rows.map(row => [row.scheduled_date,row.title,row.engineer_name,row.status,row.report_sent_to_customer?'Yes':'No',row.recommendation_count])); },
      recommendations:() => { if (model.recommendations.enabled) table('Recommendations',['Finding','Recommendation','Risk','Status','Owner','Due'],model.recommendations.rows.map(row => [row.finding,row.recommendation,row.risk_level,row.status,row.owner_name,row.due_date])); },
      risks:() => { heading('Risks / Concerns');paragraph(n.risks_concerns || 'No risks or concerns provided.'); },
      upcoming_work:() => { heading('Upcoming Work');paragraph(n.upcoming_activities || 'No upcoming activities provided.'); },
      management_notes:() => { heading('Management Notes');paragraph(n.management_notes || 'No management notes provided.'); },
    };
    model.sections.forEach(section => builders[section]?.());
    const range=doc.bufferedPageRange();
    for (let index=0;index<range.count;index++) {
      doc.switchToPage(index);doc.save().font('Helvetica').fontSize(8).fillColor(COLORS.muted);
      doc.text(`Confidential - Page ${index+1} of ${range.count}`,doc.page.margins.left,doc.page.height-25,{ width:pageWidth,align:'center',lineBreak:false });doc.restore();
    }
    doc.end();
  });
}

module.exports={ renderPdf };
