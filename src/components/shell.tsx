"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
  ArrowUpRight,
} from "lucide-react";
import { nav } from "@/lib/modules";
import { can, type Role } from "@/lib/permissions";
import { logoutAction } from "@/app/actions";
const icons = [
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
];
export function Shell({
  children,
  name,
  role,
}: {
  children: React.ReactNode;
  name: string;
  role: string;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(false);
  const active = pathname.split("/")[1];
  return (
    <div
      className={`app ${collapsed ? "collapsed" : ""} ${dark ? "dark" : ""}`}
    >
      <aside className="sidebar">
        <Link href="/dashboard" className="brand">
          <span className="brand-icon">
            <Layers size={23} />
          </span>
          <span>
            workwear<span className="brand-sub">OPERATING SYSTEM</span>
          </span>
        </Link>
        <div className="workspace">
          <span className="workspace-icon">W</span>
          <div>
            <strong>Workwear ERP</strong>
            <small>Manufacturing workspace</small>
          </div>
          <ArrowUpRight size={14} />
        </div>
        <p className="nav-heading">WORKSPACE</p>
        <nav>
          {nav.map(([path, label], i) => {
            if (
              (path === "pricing" || path === "quotations") &&
              !can(role as Role, path)
            )
              return null;
            if (path === "branding" && !can(role as Role, "branding.read"))
              return null;
            const Icon = icons[i] ?? Layers;
            return (
              <Link
                key={path}
                href={`/${path}`}
                title={label}
                className={active === path ? "active" : ""}
              >
                <Icon size={18} />
                <span>{label}</span>
                {active === path && <span className="nav-dot" />}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{name}</strong>
            <small>{role}</small>
          </div>
          <form action={logoutAction}>
            <button title="Sign out">
              <LogOut size={17} />
            </button>
          </form>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              aria-label="Toggle sidebar"
              onClick={() => setCollapsed(!collapsed)}
            >
              <PanelLeftClose size={19} />
            </button>
            <span>Workspace</span>
            <span>/</span>
            <strong>
              {nav.find((n) => n[0] === active)?.[1] ?? "Overview"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="live-dot" /> <span>Live workspace</span>
            <button
              aria-label="Toggle color theme"
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <span className="avatar small">
              {name.slice(0, 1).toUpperCase()}
            </span>
          </div>
        </header>
        <main>{children}</main>
        <footer className="page-footer">
          <span>Workwear ERP · Built for the way you make.</span>
          <span>Connected operations</span>
        </footer>
      </div>
    </div>
  );
}
