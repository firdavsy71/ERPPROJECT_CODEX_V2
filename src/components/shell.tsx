"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  ShoppingBag,
  Users,
  Shirt,
  Factory,
  Layers,
  Boxes,
  Package,
  ShoppingCart,
  Truck,
  Receipt,
  ChartNoAxesCombined,
  Contact,
  Settings,
  PanelLeftClose,
  Sun,
  Moon,
  LogOut,
  Menu,
  X,
  Scissors,
  ClipboardList,
  ShieldCheck,
  Paintbrush,
  Wrench,
  RotateCcw,
  Handshake,
  Coins,
  type LucideIcon,
} from "lucide-react";
import { nav } from "@/lib/modules";
import { canReadModule, type Role } from "@/lib/permissions";
import { logoutAction } from "@/app/actions";
import { useLocale, useTranslations } from "next-intl";
import { LanguageSelector } from "@/components/language-selector";
import { CommandPalette } from "@/components/command-palette";
const icons: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  sales: ShoppingBag,
  customers: Users,
  products: Shirt,
  manufacturing: Factory,
  boms: Layers,
  materials: Package,
  inventory: Boxes,
  purchases: ShoppingCart,
  suppliers: Handshake,
  invoices: Receipt,
  reports: ChartNoAxesCombined,
  employees: Contact,
  settings: Settings,
  specifications: ClipboardList,
  branding: Paintbrush,
  "fabric-rolls": Layers,
  cutting: Scissors,
  "production-operations": Factory,
  outsourcing: Handshake,
  subcontractors: Users,
  pricing: Coins,
  quotations: ClipboardList,
  deliveries: Truck,
  returns: RotateCcw,
  repairs: Wrench,
  compliance: ShieldCheck,
  "supplier-performance": ChartNoAxesCombined,
};
const groups = [
  ["Overview", "Обзор", "Umumiy", ["dashboard"]],
  [
    "Commercial",
    "Продажи",
    "Savdo",
    [
      "sales",
      "customers",
      "quotations",
      "pricing",
      "invoices",
      "branding",
      "deliveries",
      "returns",
    ],
  ],
  [
    "Manufacturing",
    "Производство",
    "Ishlab chiqarish",
    [
      "manufacturing",
      "boms",
      "specifications",
      "cutting",
      "production-operations",
      "outsourcing",
      "subcontractors",
      "repairs",
      "compliance",
    ],
  ],
  [
    "Inventory",
    "Склад и закупки",
    "Ombor va xaridlar",
    [
      "materials",
      "fabric-rolls",
      "inventory",
      "purchases",
      "suppliers",
      "supplier-performance",
    ],
  ],
  [
    "Management",
    "Управление",
    "Boshqaruv",
    ["products", "employees", "reports", "settings"],
  ],
] as const;
export function Shell({
  children,
  name,
  role,
  initialTheme = "light",
}: {
  children: React.ReactNode;
  name: string;
  role: string;
  initialTheme?: "light" | "dark";
}) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const locale = useLocale();
  const words =
    locale === "ru"
      ? {
          search: "Поиск в системе",
          logout: "Выйти",
          menu: "Открыть навигацию",
          close: "Закрыть навигацию",
          theme: "Переключить тему",
          skip: "Перейти к содержимому",
        }
      : locale === "uz"
        ? {
            search: "Tizimda qidirish",
            logout: "Chiqish",
            menu: "Menyuni ochish",
            close: "Menyuni yopish",
            theme: "Mavzuni almashtirish",
            skip: "Mazmunga o'tish",
          }
        : {
            search: "Search workspace",
            logout: "Sign out",
            menu: "Open navigation",
            close: "Close navigation",
            theme: "Switch color theme",
            skip: "Skip to content",
          };
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState(initialTheme);
  const [themeError, setThemeError] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const active = pathname.split("/")[1];
  useEffect(() => {
    drawer.current?.close();
  }, [pathname]);
  async function changeTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeError(false);
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      const response = await fetch("/api/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: next }),
      });
      if (!response.ok) throw new Error("theme");
    } catch {
      setThemeError(true);
    }
  }
  function navigation(mobile = false) {
    return (
      <>
        <Link
          href="/dashboard"
          className="brand"
          aria-label="Workwear ERP"
          onClick={() => drawer.current?.close()}
        >
          <span className="brand-icon">
            <Layers size={23} />
          </span>
          <span className="nav-label">
            workwear<span className="brand-sub">OPERATING SYSTEM</span>
          </span>
        </Link>
        {mobile && (
          <button
            className="icon-button mobile-nav-close"
            aria-label={words.close}
            onClick={() => drawer.current?.close()}
          >
            <X size={20} />
          </button>
        )}
        <nav aria-label={words.menu}>
          {groups.map((group) => {
            const paths = group[3].filter((path) =>
              canReadModule(role as Role, path),
            );
            if (!paths.length) return null;
            return (
              <div className="nav-group" key={group[0]}>
                <p className="nav-section-label">
                  {group[locale === "ru" ? 1 : locale === "uz" ? 2 : 0]}
                </p>
                {paths.map((path) => {
                  const Icon = icons[path] ?? Layers;
                  return (
                    <Link
                      key={path}
                      href={`/${path}`}
                      title={t(path)}
                      aria-label={t(path)}
                      aria-current={active === path ? "page" : undefined}
                      className={active === path ? "active" : ""}
                      onClick={() => drawer.current?.close()}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span className="nav-label">{t(path)}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <LanguageSelector />
          <div className="nav-footer-user">
            <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
            <div className="nav-label">
              <strong>{name}</strong>
              <small>{role}</small>
            </div>
          </div>
          <form action={logoutAction}>
            <button
              className="icon-button"
              title={words.logout}
              aria-label={words.logout}
            >
              <LogOut size={18} />
              <span className="nav-label">{words.logout}</span>
            </button>
          </form>
        </div>
      </>
    );
  }
  return (
    <div className={`app ${collapsed ? "collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">
        {words.skip}
      </a>
      <aside className="sidebar desktop-sidebar">{navigation()}</aside>
      <dialog
        ref={drawer}
        className="mobile-nav"
        aria-label={words.menu}
        onClick={(event) => {
          if (event.target === event.currentTarget) drawer.current?.close();
        }}
      >
        <aside className="sidebar">{navigation(true)}</aside>
      </dialog>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label={words.menu}
              aria-haspopup="dialog"
              onClick={() => drawer.current?.showModal()}
            >
              <Menu size={20} />
            </button>
            <button
              className="icon-button desktop-collapse"
              aria-label="Toggle sidebar"
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              <PanelLeftClose size={20} />
            </button>
            <Link href="/dashboard" className="breadcrumb-home">
              ERP
            </Link>
            <span aria-hidden="true">/</span>
            <strong>
              {nav.some(([path]) => path === active)
                ? t(active)
                : t("dashboard")}
            </strong>
          </div>
          <div className="topbar-right">
            <CommandPalette role={role as Role} label={words.search} />
            <button
              className="icon-button"
              aria-label={words.theme}
              title={words.theme}
              onClick={changeTheme}
            >
              {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <details className="user-menu">
              <summary aria-label={name}>
                <span className="avatar small">
                  {name.slice(0, 1).toUpperCase()}
                </span>
              </summary>
              <div className="user-menu-content">
                <strong>{name}</strong>
                <small>{role}</small>
                {canReadModule(role as Role, "settings") && (
                  <Link href="/settings">{t("settings")}</Link>
                )}
                <form action={logoutAction}>
                  <button type="submit">
                    <LogOut size={16} />
                    {words.logout}
                  </button>
                </form>
              </div>
            </details>
          </div>
        </header>
        {themeError && (
          <p role="status" className="theme-error">
            {locale === "ru"
              ? "Не удалось сохранить тему."
              : locale === "uz"
                ? "Mavzuni saqlab bo'lmadi."
                : "Theme preference could not be saved."}
          </p>
        )}
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="page-footer">
          <span>WORKWEAR / ERP</span>
          <span>Manufacturing · Inventory · Commerce</span>
        </footer>
      </div>
    </div>
  );
}
