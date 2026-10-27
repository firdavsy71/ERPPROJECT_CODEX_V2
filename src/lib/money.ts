import Decimal from "decimal.js";
const MoneyDecimal=Decimal.clone({precision:40});
export function discountedLineTotal(
  quantity: Decimal.Value,
  price: Decimal.Value,
  discount: Decimal.Value = "0",
) {
  return new MoneyDecimal(quantity)
    .mul(price)
    .mul(new MoneyDecimal(100).minus(discount))
    .div(100)
    .toDecimalPlaces(2)
    .toFixed(2);
}
