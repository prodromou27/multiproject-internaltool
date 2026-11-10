const db=require('./db');
const managedCustomers=require('./managedCustomerService');
const reportData=require('./managedReportData');
const insights=require('./reportInsights');

// A customer report must list everything in the period, not a first page.
const REPORT_ROW_LIMIT=2000;

const SECTION_KEYS=Object.freeze(['executive_summary','service_overview','ticket_summary','open_tickets','period_tickets','service_activities','tasks','projects','maintenance_visits','recommendations','risks','upcoming_work','management_notes','changes','resolved_tickets','assets','lifecycle','advisories']);
const OPT_IN_SECTIONS=Object.freeze(['lifecycle','advisories']);
const NARRATIVE_KEYS=Object.freeze(['executive_summary','key_highlights','risks_concerns','major_changes','upcoming_activities','management_notes']);

function validateSections(value) {
  // Lifecycle and advisories are added only when asked for (Customer 360 → Reports ticks them).
  if (value===undefined) return SECTION_KEYS.filter(key => !OPT_IN_SECTIONS.includes(key));
  if (!Array.isArray(value) || value.length>SECTION_KEYS.length || value.some(key => typeof key!=='string' || !SECTION_KEYS.includes(key)) || new Set(value).size!==value.length) throw Object.assign(new Error('Invalid report sections'),{ status:400 });
  return value;
}

function validateNarratives(value) {
  if (value===undefined) return {};
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key => !NARRATIVE_KEYS.includes(key))) throw Object.assign(new Error('Invalid report narratives'),{ status:400 });
  const result={};
  for (const key of NARRATIVE_KEYS) {
    if (value[key]===undefined) continue;
    if (typeof value[key]!=='string' || value[key].length>10000) throw Object.assign(new Error(`Invalid ${key}`),{ status:400 });
    result[key]=value[key].trim();
  }
  return result;
}

// `prebuilt` passes lifecycle/advisories already built for the same period, so they are not built twice.
async function buildReportModel({ customerId,from,to,sections,narratives,prebuilt={} },store=db) {
  const selectedSections=validateSections(sections),safeNarratives=validateNarratives(narratives);
  const config=await store.prepare(`SELECT mc.include_in_managed_services_reports,tc.enabled AS ticket_integration_enabled,tc.include_in_reporting AS tickets_in_reporting
    FROM managed_customer_configurations mc JOIN customers c ON c.id=mc.customer_id
    LEFT JOIN customer_ticketing_configurations tc ON tc.customer_id=mc.customer_id AND tc.provider_type='request_tracker'
    WHERE mc.customer_id=? AND mc.managed_services_enabled=1 AND c.active=1`).get(customerId);
  if (!config) return null;
  if (!config.include_in_managed_services_reports) throw Object.assign(new Error('This customer is excluded from Managed Services reports'),{ status:409 });
  const [overview,ticketAnalytics,periodTickets,openTickets,activities,work,serviceReview]=await Promise.all([
    managedCustomers.getOverview(customerId,from,to,store),
    managedCustomers.getTicketAnalytics(customerId,from,to,store),
    managedCustomers.listTickets(customerId,{ from,to,page:1,pageSize:100,offset:0 },store),
    managedCustomers.listTickets(customerId,{ group:'open',page:1,pageSize:100,offset:0 },store),
    managedCustomers.getActivities(customerId,from,to,{ page:1,pageSize:REPORT_ROW_LIMIT,offset:0 },store),
    managedCustomers.getWork(customerId,from,to,store),
    managedCustomers.getServiceReview(customerId,from,to,store),
  ]);
  const ticketsEnabled=!!config.ticket_integration_enabled && config.tickets_in_reporting!==0;
  const [changes,resolvedTickets,assets,lifecycle,advisories]=await Promise.all([
    reportData.getChanges(customerId,from,to,store),
    ticketsEnabled ? reportData.getResolvedTickets(customerId,from,to,store) : [],
    reportData.getAssets(customerId,to,store),
    // Built only when chosen (reportInsights.js).
    !selectedSections.includes('lifecycle') ? null : prebuilt.lifecycle!==undefined ? prebuilt.lifecycle : insights.getLifecycle(customerId,to,store),
    !selectedSections.includes('advisories') ? null : prebuilt.advisories!==undefined ? prebuilt.advisories : insights.getAdvisories(from,to,store).then(result => ({ ...result,notice:insights.ADVISORY_NOTICE })),
  ]);
  return {
    schema_version:1,
    generated_at:new Date().toISOString(),
    customer:{ id:overview.customer.id,name:overview.customer.name,responsible_team:overview.customer.responsible_team || null,service_manager:overview.customer.service_manager || null,reporting_frequency:overview.customer.reporting_frequency || null },
    period:{ from,to },
    sections:selectedSections,
    narratives:safeNarratives,
    overview:{ tickets:ticketsEnabled?overview.tickets:null,activities:overview.activities,tasks:overview.tasks,projects:overview.projects,visits:overview.visits,recommendations:overview.recommendations },
    tickets:{ enabled:ticketsEnabled,analytics:ticketsEnabled?ticketAnalytics:null,open:ticketsEnabled?openTickets:{ rows:[],total:0 },period:ticketsEnabled?periodTickets:{ rows:[],total:0 } },
    activities,
    tasks:work.tasks,
    projects:work.projects,
    maintenance_visits:serviceReview.visits,
    recommendations:serviceReview.recommendations,
    changes,
    resolved_tickets:resolvedTickets,
    assets,
    lifecycle,
    advisories,
    truncation:{ open_tickets:ticketsEnabled && openTickets.total>openTickets.rows.length,period_tickets:ticketsEnabled && periodTickets.total>periodTickets.rows.length,activities:activities.total>activities.rows.length,tasks:Number(work.tasks.summary.total || 0)>work.tasks.rows.length,projects:Number(work.projects.summary.total || 0)>work.projects.rows.length,recommendations:Number(serviceReview.recommendations.summary.total || 0)>serviceReview.recommendations.rows.length },
  };
}

module.exports={ SECTION_KEYS,NARRATIVE_KEYS,validateSections,validateNarratives,buildReportModel };
