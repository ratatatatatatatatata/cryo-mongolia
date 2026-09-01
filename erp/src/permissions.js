const ROLE_ALIASES = Object.freeze({
  administrator: "admin",
  employee: "staff",
  receptionist: "reception",
});

const PERMISSIONS = Object.freeze({
  owner: new Set([
    "dashboard:view",
    "customers:view",
    "customers:create",
    "customers:edit",
    "packages:create",
    "entitlements:consume",
    "payments:view",
    "staff:view",
    "staff:invite",
    "staff:update",
  ]),
  admin: new Set([
    "dashboard:view",
    "customers:view",
    "customers:create",
    "customers:edit",
    "packages:create",
    "entitlements:consume",
    "payments:view",
    "staff:view",
    "staff:invite",
    "staff:update",
  ]),
  manager: new Set([
    "dashboard:view",
    "customers:view",
    "customers:create",
    "customers:edit",
    "packages:create",
    "entitlements:consume",
    "payments:view",
    "staff:view",
  ]),
  reception: new Set([
    "dashboard:view",
    "customers:view",
    "customers:create",
    "customers:edit",
    "packages:create",
    "entitlements:consume",
    "payments:view",
  ]),
  staff: new Set(["dashboard:view", "customers:view", "entitlements:consume"]),
  therapist: new Set(["dashboard:view", "customers:view", "entitlements:consume"]),
  accountant: new Set(),
  auditor: new Set(["staff:view"]),
  viewer: new Set(),
});

export const ROLE_LABELS = Object.freeze({
  owner: "Эзэмшигч",
  admin: "Админ",
  manager: "Менежер",
  reception: "Ресепшн",
  staff: "Ажилтан",
  therapist: "Терапист",
  accountant: "Нягтлан",
  auditor: "Аудитор",
  viewer: "Харах эрхтэй",
});

export function normalizeRole(role) {
  const normalized = String(role ?? "").trim().toLowerCase();
  return ROLE_ALIASES[normalized] ?? (PERMISSIONS[normalized] ? normalized : "viewer");
}

export function can(role, permission) {
  return PERMISSIONS[normalizeRole(role)]?.has(permission) ?? false;
}

export function visibleNavigation(role) {
  const items = [
    { href: "#/dashboard", label: "Хянах самбар", icon: "grid", permission: "dashboard:view" },
    { href: "#/customers", label: "Үйлчлүүлэгчид", icon: "users", permission: "customers:view" },
    { href: "#/staff", label: "Ажилтнууд", icon: "staff", permission: "staff:view" },
  ];
  return items.filter((item) => can(role, item.permission));
}
