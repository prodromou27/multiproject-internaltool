import{k as e}from"./index-C7r02gSw.js";import{f as l}from"./vendor-react-NspP1A8c.js";import{q as d,L as f}from"./vendor-lucide-DOVm7Xk3.js";const u=[{id:"closing",title:"Closing Ticket",color:"#22c55e",bg:"#f0fdf4",body:`As no further actions are required, we will proceed with closing this ticket.
In case you need any further assistance, you can always reopen this ticket by replying to this email.`},{id:"chargeable",title:"Chargeable Task",color:"#f59e0b",bg:"#fffbeb",body:`We would like to inform you that the requested service is out of the scope of our contract, thus please approve X hour in order to schedule this task.



Task Description:
Responsible engineer:
Estimated required hours:
Requested by:



Service hours will be billed on actual time spent on service and our mutually agreed rates.`},{id:"crm",title:"CRM - Chargeable",color:"#6366f1",bg:"#eef2ff",body:`Ticket #
Requester:
Product:`},{id:"late",title:"Late Response",color:"#ef4444",bg:"#fef2f2",body:"I hope my email finds you well. We received no response from you since our last update. We will proceed with closing this ticket per company policy. You can always reply to this email to re-open the ticket to further assist you."},{id:"upgrade",title:"Notification of Asset Upgrade",color:"#3b82f6",bg:"#eff6ff",body:`Subject: Notification of Asset Upgrade

Dear Team,

I am writing to inform you of an upcoming asset upgrade for the below customer, [Customer Name]. The details of the upgrade are as follows:

Project Name:	
Asset:	
Responsible Engineer:	
Date:	
Time:	

If you have any questions or need further information, please do not hesitate to contact me.

Kind regards,`}];function p({tpl:o}){const[s,r]=l.useState(!1);function n(){const i=()=>{r(!0),setTimeout(()=>r(!1),2e3)};navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(o.body).then(i).catch(()=>a(o.body,i)):a(o.body,i)}function a(i,c){const t=document.createElement("textarea");t.value=i,t.style.cssText="position:fixed;top:0;left:0;opacity:0;pointer-events:none",document.body.appendChild(t),t.focus(),t.select();try{document.execCommand("copy"),c()}catch{}document.body.removeChild(t)}return e.jsxs("div",{className:"card",style:{marginBottom:16,borderLeft:`3px solid ${o.color}`},children:[e.jsxs("div",{className:"flex items-center justify-between mb-12",children:[e.jsxs("div",{className:"flex-center gap-10",children:[e.jsx("div",{style:{width:10,height:10,borderRadius:"50%",background:o.color,flexShrink:0}}),e.jsx("span",{style:{fontWeight:700,fontSize:14,color:"var(--gray-900)"},children:o.title})]}),e.jsx("button",{onClick:n,className:"btn btn-sm",style:{display:"inline-flex",alignItems:"center",gap:5,background:s?"#f0fdf4":"var(--gray-50)",color:s?"#16a34a":"var(--gray-600)",border:`1px solid ${s?"#bbf7d0":"var(--gray-200)"}`,transition:"all .15s"},children:s?e.jsxs(e.Fragment,{children:[e.jsx(d,{size:13})," Copied!"]}):e.jsxs(e.Fragment,{children:[e.jsx(f,{size:13})," Copy"]})})]}),e.jsx("pre",{style:{background:o.bg,border:`1px solid ${o.color}22`,borderRadius:8,padding:"12px 14px",fontSize:13,color:"var(--gray-700)",lineHeight:1.65,whiteSpace:"pre-wrap",wordBreak:"break-word",fontFamily:"inherit",margin:0},children:o.body})]})}function g(){return e.jsxs("div",{className:"page",children:[e.jsx("div",{className:"page-header",children:e.jsxs("div",{children:[e.jsx("h1",{className:"page-title",children:"Customer Responses"}),e.jsx("div",{className:"page-subtitle",children:"Ready-to-use email templates — click Copy then paste into your email"})]})}),e.jsx("div",{style:{maxWidth:720},children:u.map(o=>e.jsx(p,{tpl:o},o.id))})]})}export{g as default};
