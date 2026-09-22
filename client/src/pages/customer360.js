export const CUSTOMER_360_SECTIONS=Object.freeze([
  { id:'overview',label:'Overview',roles:['manager'] },
  { id:'activities',label:'Service Activities',roles:['manager','engineer','planner'] },
  { id:'projects',label:'Projects',roles:['manager','engineer','planner'] },
  { id:'tasks',label:'Tasks',roles:['manager','engineer'] },
  { id:'maintenance-visits',label:'Maintenance Visits',roles:['manager','engineer','planner'] },
  { id:'recommendations',label:'Recommendations',roles:['manager','engineer','planner'] },
  { id:'assets',label:'Assets',roles:['manager'] },
  { id:'timeline',label:'Timeline',roles:['manager','engineer','planner'] },
  { id:'service-configuration',label:'Service Configuration',roles:['manager'] },
]);

export function customer360Sections(user) {
  return CUSTOMER_360_SECTIONS.filter(section => !section.pending && section.roles.includes(user?.role));
}

export function customer360Section(user,requested) {
  const available=customer360Sections(user);
  const aliases={ 'managed-services':'service-configuration' };
  const normalized=aliases[requested] || requested;
  return available.some(section => section.id===normalized) ? normalized : user?.role==='manager' ? 'overview' : 'activities';
}
