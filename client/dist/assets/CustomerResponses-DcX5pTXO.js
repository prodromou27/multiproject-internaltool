import{r as e}from"./rolldown-runtime-hePW80VL.js";import{u as t}from"./vendor-react-B9350QRY.js";import{_ as n}from"./vendor-charts-CA9Ff00H.js";import{$t as r,Lt as i}from"./vendor-lucide-CmgzE5mI.js";var a=e(n(),1),o=t(),s=[{id:`closing`,title:`Closing Ticket`,color:`#22c55e`,bg:`#f0fdf4`,body:`As no further actions are required, we will proceed with closing this ticket.
In case you need any further assistance, you can always reopen this ticket by replying to this email.`},{id:`chargeable`,title:`Chargeable Task`,color:`#f59e0b`,bg:`#fffbeb`,body:`We would like to inform you that the requested service is out of the scope of our contract, thus please approve X hour in order to schedule this task.



Task Description:
Responsible engineer:
Estimated required hours:
Requested by:



Service hours will be billed on actual time spent on service and our mutually agreed rates.`},{id:`crm`,title:`CRM - Chargeable`,color:`#6366f1`,bg:`#eef2ff`,body:`Ticket #
Requester:
Product:`},{id:`late`,title:`Late Response`,color:`#ef4444`,bg:`#fef2f2`,body:`I hope my email finds you well. We received no response from you since our last update. We will proceed with closing this ticket per company policy. You can always reply to this email to re-open the ticket to further assist you.`},{id:`upgrade`,title:`Notification of Asset Upgrade`,color:`#3b82f6`,bg:`#eff6ff`,body:`Subject: Notification of Asset Upgrade

Dear Team,

I am writing to inform you of an upcoming asset upgrade for the below customer, [Customer Name]. The details of the upgrade are as follows:

Project Name:	
Asset:	
Responsible Engineer:	
Date:	
Time:	

If you have any questions or need further information, please do not hesitate to contact me.

Kind regards,`}];function c({tpl:e}){let[t,n]=(0,a.useState)(!1);function s(){let t=()=>{n(!0),setTimeout(()=>n(!1),2e3)};navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(e.body).then(t).catch(()=>c(e.body,t)):c(e.body,t)}function c(e,t){let n=document.createElement(`textarea`);n.value=e,n.style.cssText=`position:fixed;top:0;left:0;opacity:0;pointer-events:none`,document.body.appendChild(n),n.focus(),n.select();try{document.execCommand(`copy`),t()}catch{}document.body.removeChild(n)}return(0,o.jsxs)(`div`,{className:`card u-87c136d`,style:{borderLeft:`3px solid ${e.color}`},children:[(0,o.jsxs)(`div`,{className:`flex items-center justify-between mb-12`,children:[(0,o.jsxs)(`div`,{className:`flex-center gap-10`,children:[(0,o.jsx)(`div`,{className:`u-2dcdba7`,style:{background:e.color}}),(0,o.jsx)(`span`,{className:`u-e6cd714`,children:e.title})]}),(0,o.jsx)(`button`,{onClick:s,className:`btn btn-sm u-145410d`,style:{background:t?`#f0fdf4`:`var(--gray-50)`,color:t?`#16a34a`:`var(--gray-600)`,border:`1px solid ${t?`#bbf7d0`:`var(--gray-200)`}`},children:t?(0,o.jsxs)(o.Fragment,{children:[(0,o.jsx)(r,{size:13}),` Copied!`]}):(0,o.jsxs)(o.Fragment,{children:[(0,o.jsx)(i,{size:13}),` Copy`]})})]}),(0,o.jsx)(`pre`,{className:`u-1465002`,style:{background:e.bg,border:`1px solid ${e.color}22`},children:e.body})]})}function l(){return(0,o.jsxs)(`div`,{className:`page`,children:[(0,o.jsx)(`div`,{className:`page-header`,children:(0,o.jsxs)(`div`,{children:[(0,o.jsx)(`h1`,{className:`page-title`,children:`Customer Responses`}),(0,o.jsx)(`div`,{className:`page-subtitle`,children:`Ready-to-use email templates — click Copy then paste into your email`})]})}),(0,o.jsx)(`div`,{className:`u-b12974c`,children:s.map(e=>(0,o.jsx)(c,{tpl:e},e.id))})]})}export{l as default};