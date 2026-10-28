import { or, ilike, desc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { canReadModule, type Actor } from "@/lib/permissions";
export type SearchResult = {id:string;label:string;detail:string;href:string;group:string};
export async function searchRecords(actor: Actor, term: string): Promise<SearchResult[]> {
  const q = term.trim().slice(0,100);
  if (q.length < 2) return [];
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const batches: Promise<SearchResult[]>[] = [];
  if (canReadModule(actor.role,"products")) batches.push(db().select({id:s.products.id,name:s.products.name,sku:s.products.sku}).from(s.products).where(or(ilike(s.products.name,pattern),ilike(s.products.sku,pattern))).orderBy(desc(s.products.createdAt)).limit(6).then(rows=>rows.map(r=>({id:r.id,label:r.name,detail:r.sku,href:`/products/${r.id}`,group:"Products"}))));
  if (canReadModule(actor.role,"customers")) batches.push(db().select({id:s.customers.id,name:s.customers.name}).from(s.customers).where(ilike(s.customers.name,pattern)).limit(6).then(rows=>rows.map(r=>({id:r.id,label:r.name,detail:"Customer",href:`/customers/${r.id}`,group:"Customers"}))));
  if (canReadModule(actor.role,"sales")) batches.push(db().select({id:s.sales.id,number:s.sales.number,status:s.sales.status}).from(s.sales).where(ilike(s.sales.number,pattern)).limit(6).then(rows=>rows.map(r=>({id:r.id,label:r.number,detail:r.status,href:`/sales/${r.id}`,group:"Sales orders"}))));
  if (canReadModule(actor.role,"manufacturing")) batches.push(db().select({id:s.manufacturing.id,number:s.manufacturing.number,status:s.manufacturing.status}).from(s.manufacturing).where(ilike(s.manufacturing.number,pattern)).limit(6).then(rows=>rows.map(r=>({id:r.id,label:r.number,detail:r.status,href:`/manufacturing/${r.id}`,group:"Manufacturing"}))));
  if (canReadModule(actor.role,"materials")) batches.push(db().select({id:s.materials.id,name:s.materials.name,sku:s.materials.sku}).from(s.materials).where(or(ilike(s.materials.name,pattern),ilike(s.materials.sku,pattern))).limit(6).then(rows=>rows.map(r=>({id:r.id,label:r.name,detail:r.sku,href:`/materials/${r.id}`,group:"Materials"}))));
  return (await Promise.all(batches)).flat();
}
