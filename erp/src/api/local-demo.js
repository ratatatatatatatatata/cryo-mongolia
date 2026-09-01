import { demoCustomers, demoServices, demoStaff } from "../data/demo.js";
import { businessDate, deepClone, fullName, remainingCount } from "../utils.js";

function createId(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}-${suffix}`;
}

function requireValue(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} заавал бөглөнө үү.`);
  return normalized;
}

function roleFromDemoEmail(email) {
  const prefix = email.split("@")[0].toLowerCase();
  if (prefix === "owner" || prefix === "admin") return prefix;
  if (prefix === "manager") return "manager";
  if (prefix === "reception") return "reception";
  return "staff";
}

export function createLocalDemoAdapter({ delayMs = 70 } = {}) {
  let session = null;
  let customers = deepClone(demoCustomers);
  let staff = deepClone(demoStaff);

  const delay = async () => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  };

  const requireSession = () => {
    if (!session) {
      const error = new Error("Нэвтрэх хугацаа дууссан байна.");
      error.code = "AUTH_REQUIRED";
      throw error;
    }
  };

  const findCustomer = (customerId) => {
    const customer = customers.find((item) => item.id === customerId);
    if (!customer) throw new Error("Үйлчлүүлэгч олдсонгүй.");
    return customer;
  };

  return {
    mode: "local-demo",

    async getSession() {
      await delay();
      return deepClone(session);
    },

    async signIn({ email, password }) {
      await delay();
      const normalizedEmail = requireValue(email, "Имэйл").toLowerCase();
      if (!normalizedEmail.endsWith("@example.invalid")) {
        throw new Error("Local demo-д зөвхөн @example.invalid хаяг ашиглана.");
      }
      if (String(password ?? "").length < 8) {
        throw new Error("Нууц үг 8-аас доошгүй тэмдэгт байна.");
      }

      const role = roleFromDemoEmail(normalizedEmail);
      session = {
        user: {
          id: `local-${role}`,
          firstName: "Демо",
          lastName: role === "owner" ? "Эзэмшигч" : "Ажилтан",
          email: normalizedEmail,
          role,
        },
        localOnly: true,
      };
      return deepClone(session);
    },

    async signOut() {
      await delay();
      session = null;
    },

    async completeInvite() {
      requireSession();
      return deepClone(session);
    },

    async getMfaStatus() {
      requireSession();
      return { currentLevel: "aal2", nextLevel: "aal2", verifiedFactor: { id: "local-demo-mfa" } };
    },

    async beginMfaEnrollment() {
      requireSession();
      throw new Error("Local demo горимд MFA үйлчилгээ дуудагдахгүй.");
    },

    async verifyMfaChallenge() {
      requireSession();
      return { currentLevel: "aal2" };
    },

    async getDashboard() {
      requireSession();
      await delay();
      const allVisits = customers.flatMap((customer) =>
        customer.visits.map((visit) => ({ ...visit, customerId: customer.id, customerName: fullName(customer) })),
      );
      const activeEntitlements = customers
        .flatMap((customer) => customer.entitlements)
        .filter((item) => item.status === "active" && remainingCount(item) > 0);
      const now = new Date();
      const today = businessDate(now);
      const expiryLimit = businessDate(new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000));

      return deepClone({
        metrics: {
          customerCount: customers.length,
          activePackageCount: activeEntitlements.length,
          todayVisitCount: allVisits.filter(
            (visit) => visit.status === "completed" && businessDate(visit.occurredAt) === today,
          ).length,
          expiringPackageCount: activeEntitlements.filter((item) => {
            const expiresOn = item.expiresAt ? businessDate(item.expiresAt) : "";
            return expiresOn && expiresOn >= today && expiresOn <= expiryLimit;
          }).length,
        },
        recentVisits: allVisits
          .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
          .slice(0, 5),
      });
    },

    async searchCustomers(query, limit = 8) {
      requireSession();
      await delay();
      const term = String(query ?? "").trim().toLowerCase();
      if (term.length < 2) return [];
      return deepClone(
        customers
          .filter((customer) =>
            [fullName(customer), customer.phone, customer.email].some((value) =>
              String(value ?? "").toLowerCase().includes(term),
            ),
          )
          .slice(0, Math.min(100, Math.max(1, Number(limit) || 8)))
          .map(({ id, firstName, lastName, phone, email }) => ({ id, firstName, lastName, phone, email })),
      );
    },

    async listCustomers({ query = "", page = 1, pageSize = 25 } = {}) {
      requireSession();
      await delay();
      const term = String(query).trim().toLowerCase();
      const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));
      const safePage = Math.max(1, Number(page) || 1);
      if (term && term.length < 2) {
        return { items: [], total: 0, page: safePage, pageSize: safePageSize, truncated: false, queryTooShort: true };
      }
      const items = !term
        ? customers
        : customers.filter((customer) =>
            [fullName(customer), customer.phone, customer.email].some((value) =>
              String(value ?? "").toLowerCase().includes(term),
            ),
          );
      const from = (safePage - 1) * safePageSize;
      return deepClone({
        items: items.slice(from, from + safePageSize),
        total: items.length,
        page: safePage,
        pageSize: safePageSize,
        truncated: false,
      });
    },

    async getCustomer(customerId) {
      requireSession();
      await delay();
      return deepClone(findCustomer(customerId));
    },

    async createCustomer(input) {
      requireSession();
      await delay();
      const now = new Date().toISOString();
      const customer = {
        id: createId("demo-customer"),
        firstName: requireValue(input.firstName, "Нэр"),
        lastName: requireValue(input.lastName, "Овог"),
        phone: requireValue(input.phone, "Утас"),
        email: String(input.email ?? "").trim(),
        note: String(input.note ?? "").trim(),
        createdAt: now,
        updatedAt: now,
        entitlements: [],
        visits: [],
        payments: [],
      };
      customers = [customer, ...customers];
      return deepClone(customer);
    },

    async updateCustomer(customerId, input) {
      requireSession();
      await delay();
      const customer = findCustomer(customerId);
      customer.firstName = requireValue(input.firstName, "Нэр");
      customer.lastName = requireValue(input.lastName, "Овог");
      customer.phone = requireValue(input.phone, "Утас");
      customer.email = String(input.email ?? "").trim();
      customer.note = String(input.note ?? "").trim();
      customer.updatedAt = new Date().toISOString();
      return deepClone(customer);
    },

    async listServices() {
      requireSession();
      await delay();
      return deepClone(demoServices);
    },

    async createCustomerPackage(input) {
      requireSession();
      await delay();
      const customer = findCustomer(input.customerId);
      const items = Array.isArray(input.entitlements) ? input.entitlements : [];
      if (!items.length) throw new Error("Дор хаяж нэг үйлчилгээний эрх сонгоно уу.");
      const packageName = requireValue(input.name, "Багцын нэр");
      const created = [];
      for (const item of items) {
        const service = demoServices.find((candidate) => candidate.id === item.serviceId);
        const quantity = Number(item.quantity);
        if (!service || !Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
          throw new Error("Үйлчилгээ эсвэл эрхийн тоо буруу байна.");
        }
        created.push({
          id: createId("demo-entitlement"),
          name: `${packageName} · ${service.name}`,
          totalCount: quantity,
          usedCount: 0,
          expiresAt: input.expiresOn ? `${input.expiresOn}T15:59:59.000Z` : null,
          status: "active",
        });
      }
      customer.entitlements.unshift(...created);
      customer.updatedAt = new Date().toISOString();
      return deepClone({ id: createId("demo-package"), entitlements: created });
    },

    async consumeEntitlement({ customerId, entitlementId, quantity = 1, note = "" }) {
      requireSession();
      await delay();
      const customer = findCustomer(customerId);
      const entitlement = customer.entitlements.find((item) => item.id === entitlementId);
      if (!entitlement) throw new Error("Багцын эрх олдсонгүй.");
      const amount = Number(quantity);
      if (!Number.isInteger(amount) || amount < 1) throw new Error("Зөв тоо оруулна уу.");
      if (remainingCount(entitlement) < amount) throw new Error("Багцын үлдэгдэл хүрэлцэхгүй байна.");

      entitlement.usedCount += amount;
      if (remainingCount(entitlement) === 0) entitlement.status = "completed";
      customer.visits.unshift({
        id: createId("demo-visit"),
        occurredAt: new Date().toISOString(),
        serviceName: entitlement.name,
        staffName: fullName(session.user),
        status: "completed",
        note: String(note).trim(),
      });
      customer.updatedAt = new Date().toISOString();
      return deepClone(customer);
    },

    async listStaff() {
      requireSession();
      await delay();
      return deepClone(staff);
    },

    async inviteStaff(input) {
      requireSession();
      await delay();
      const email = requireValue(input.email, "Имэйл").toLowerCase();
      if (!email.endsWith("@example.invalid")) {
        throw new Error("Local demo урилга @example.invalid хаягтай байна.");
      }
      if (staff.some((item) => item.email === email)) throw new Error("Энэ имэйл бүртгэлтэй байна.");
      const invited = {
        id: createId("demo-staff"),
        firstName: String(input.firstName ?? "").trim() || "Уригдсан",
        lastName: String(input.lastName ?? "").trim() || "Ажилтан",
        email,
        role: String(input.role ?? "staff"),
        status: "invited",
      };
      staff = [...staff, invited];
      return deepClone(invited);
    },

    async updateStaffAccess(input) {
      requireSession();
      await delay();
      if (String(input.reason ?? "").trim().length < 3) {
        throw new Error("Эрх өөрчилсөн шалтгааныг 3-аас доошгүй тэмдэгтээр бичнэ үү.");
      }
      const target = staff.find((item) => item.id === input.staffId);
      if (!target) throw new Error("Ажилтан олдсонгүй.");
      const nextRole = String(input.role ?? "viewer");
      const nextStatus = String(input.status ?? "invited");
      const removesActiveOwner =
        target.role === "owner" &&
        target.status === "active" &&
        (nextRole !== "owner" || nextStatus !== "active");
      if (removesActiveOwner) {
        const activeOwners = staff.filter(
          (item) => item.role === "owner" && item.status === "active",
        ).length;
        if (activeOwners <= 1) throw new Error("Системд дор хаяж нэг идэвхтэй эзэмшигч үлдэх ёстой.");
      }
      target.role = nextRole;
      target.status = nextStatus;
      return deepClone(target);
    },
  };
}
