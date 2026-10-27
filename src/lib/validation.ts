import { z } from "zod";
export const amount = z
  .string()
  .regex(
    /^\d{1,12}(\.\d{1,2})?$/,
    "Use a positive decimal amount with up to two decimal places",
  );
export const quantity = z
  .string()
  .regex(
    /^\d{1,12}(\.\d{1,4})?$/,
    "Use a quantity with up to four decimal places",
  )
  .refine((v) => Number(v) > 0, "Quantity must be greater than zero");
export const lineSchema = z.object({
  itemId: z.uuid(),
  quantity,
  price: amount,
  discount: amount.default("0"),
});
export const orderSchema = z.object({
  partyId: z.uuid(),
  currency: z.enum(["UZS", "USD"]),
  date: z.iso.date().optional().or(z.literal("")),
  lines: z.array(lineSchema).min(1).max(100),
});
