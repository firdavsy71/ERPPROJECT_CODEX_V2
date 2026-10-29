"use client";
import {useState} from "react";
import {useLocale} from "next-intl";
export function ReportFilters({reports,warehouses}:{reports:{value:string;label:string}[];warehouses:{id:string;name:string}[]}) {
  const locale=useLocale();
  const labels=locale==="ru"?{title:"Экспорт с фильтрами",report:"Отчёт",from:"С даты",to:"По дату",warehouse:"Склад",all:"Все склады",download:"Скачать CSV",basis:"Период — дата создания в часовом поясе компании. Остатки показывают текущее состояние."}:locale==="uz"?{title:"Filtrlangan eksport",report:"Hisobot",from:"Boshlanish",to:"Tugash",warehouse:"Ombor",all:"Barcha omborlar",download:"CSV yuklash",basis:"Davr kompaniya vaqt zonasidagi yaratilgan sanaga tegishli. Qoldiqlar joriy holatni ko‘rsatadi."}:{title:"Filtered export",report:"Report",from:"From date",to:"To date",warehouse:"Warehouse",all:"All warehouses",download:"Download CSV",basis:"Period uses creation date in the company timezone. Stock reports show current balances."};
  const [report,setReport]=useState(reports[0]?.value??"sales");
  const snapshot=["inventory","materials"].includes(report);
  const warehouse=["inventory","materials","movements"].includes(report);
  return <section className="detail-card"><h2>{labels.title}</h2><p className="muted">{labels.basis}</p><form action="/api/reports" method="get"><div className="form-grid"><label className="field"><span>{labels.report}</span><select name="report" value={report} onChange={e=>setReport(e.target.value)}>{reports.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select></label><label className="field"><span>{labels.from}</span><input type="date" name="from" disabled={snapshot}/></label><label className="field"><span>{labels.to}</span><input type="date" name="to" disabled={snapshot}/></label><label className="field"><span>{labels.warehouse}</span><select name="warehouseId" disabled={!warehouse}><option value="">{labels.all}</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label></div><button className="btn btn-primary" type="submit">{labels.download}</button></form></section>;
}
