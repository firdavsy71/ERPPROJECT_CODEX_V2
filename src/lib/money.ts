import Decimal from "decimal.js";
export function discountedLineTotal(
  quantity: Decimal.Value,
  price: Decimal.Value,
  discount: Decimal.Value = "0",
) {
  return new Decimal(quantity)
    .mul(price)
    .mul(new Decimal(100).minus(discount))
    .div(100)
    .toDecimalPlaces(2)
    .toFixed(2);
}
