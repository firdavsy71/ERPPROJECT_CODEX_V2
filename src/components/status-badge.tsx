const labels: Record<string, [string, string]> = {
  Draft: ["Черновик", "Qoralama"],
  Pending: ["Ожидает", "Kutilmoqda"],
  Confirmed: ["Подтверждено", "Tasdiqlangan"],
  "In Progress": ["В работе", "Jarayonda"],
  "In Production": ["В производстве", "Ishlab chiqarishda"],
  Completed: ["Завершено", "Yakunlangan"],
  Cancelled: ["Отменено", "Bekor qilingan"],
  Shipped: ["Отгружено", "Jo‘natilgan"],
  Paid: ["Оплачено", "To‘langan"],
  Unpaid: ["Не оплачено", "To‘lanmagan"],
  "Partially Paid": ["Частично оплачено", "Qisman to‘langan"],
  "Partially Shipped": ["Частично отгружено", "Qisman jo‘natilgan"],
  Active: ["Активно", "Faol"],
  Archived: ["В архиве", "Arxivlangan"],
  Approved: ["Утверждено", "Tasdiqlangan"],
  Rejected: ["Отклонено", "Rad etilgan"],
  Received: ["Получено", "Qabul qilingan"],
  Planned: ["Запланировано", "Rejalashtirilgan"],
  "Ready for Shipment": ["Готово к отгрузке", "Jo‘natishga tayyor"],
  "Quality Control": ["Контроль качества", "Sifat nazorati"],
  "Awaiting Production": [
    "Ожидает производства",
    "Ishlab chiqarish kutilmoqda",
  ],
  Overdue: ["Просрочено", "Muddati o‘tgan"],
  "Low Stock": ["Низкий остаток", "Kam qoldiq"],
  Delivered: ["Доставлено", "Yetkazilgan"],
  Ordered: ["Заказано", "Buyurtma berilgan"],
};

export function statusLabel(status: string, locale: string = "en") {
  return locale === "ru"
    ? (labels[status]?.[0] ?? status)
    : locale === "uz"
      ? (labels[status]?.[1] ?? status)
      : status;
}

export function StatusBadge({
  status,
  locale = "en",
}: {
  status: string;
  locale?: string;
}) {
  const tone = [
    "Completed",
    "Paid",
    "Received",
    "Ready for Shipment",
    "Active",
    "Approved",
    "Delivered",
  ].includes(status)
    ? "success"
    : ["Cancelled", "Rejected", "Overdue", "Exception", "Revoked"].includes(
          status,
        )
      ? "danger"
      : [
            "Low Stock",
            "Pending",
            "Partially Paid",
            "Awaiting Production",
            "Quality Control",
          ].includes(status)
        ? "warning"
        : [
              "In Progress",
              "In Production",
              "Planned",
              "Shipped",
              "Confirmed",
              "Ordered",
              "Partially Shipped",
            ].includes(status)
          ? "info"
          : "neutral";
  return (
    <span className={`badge status-badge status-${tone}`}>
      <span className="status-dot" aria-hidden="true" />
      {statusLabel(status, locale)}
    </span>
  );
}
