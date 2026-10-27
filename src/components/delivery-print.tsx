"use client";
export function DeliveryPrint() {
  return (
    <button className="btn btn-outline no-print" onClick={() => window.print()}>
      Print picking / packing list
    </button>
  );
}
