import { createClient } from "@supabase/supabase-js";
import { businessDate } from "../utils.js";

const SAFE_ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: "Нэвтрэх хугацаа дууссан байна.",
  ENTITLEMENT_NOT_AVAILABLE: "Энэ багцын эрх одоо ашиглах боломжгүй байна.",
  INSUFFICIENT_ENTITLEMENT: "Багцын үлдэгдэл хүрэлцэхгүй байна.",
  INVALID_QUANTITY: "Үйлчилгээний тоо буруу байна.",
  NOTES_TOO_LONG: "Тэмдэглэл зөвшөөрөгдөх хэмжээнээс урт байна.",
  NOT_AUTHORIZED: "Энэ үйлдлийг хийх эрх хүрэлцэхгүй байна.",
  CUSTOMER_NOT_FOUND: "Үйлчлүүлэгч олдсонгүй.",
  INVALID_PACKAGE_NAME: "Багцын нэр буруу байна.",
  INVALID_PACKAGE_DATES: "Багцын эхлэх, дуусах огноо буруу байна.",
  INVALID_PRICE: "Багцын үнэ буруу байна.",
  ENTITLEMENTS_REQUIRED: "Дор хаяж нэг үйлчилгээний эрх сонгоно уу.",
  INVALID_ENTITLEMENT_COUNT: "Багц дахь эрхийн тоо зөвшөөрөгдөх хэмжээнд биш байна.",
  INVALID_ENTITLEMENTS: "Сонгосон үйлчилгээ эсвэл эрхийн тоо буруу байна.",
  LAST_OWNER_REQUIRED: "Системд дор хаяж нэг идэвхтэй эзэмшигч үлдэх ёстой.",
  CANNOT_SUSPEND_SELF: "Өөрийн эрхийг өөрөө түдгэлзүүлэх боломжгүй.",
  ROLE_NOT_ALLOWED: "Энэ түвшний эрхийг олгох боломжгүй.",
  INVALID_ACCESS_UPDATE: "Ажилтны эрх эсвэл төлөв буруу байна.",
  STAFF_NOT_FOUND: "Ажилтан олдсонгүй.",
  ACCESS_UPDATE_FAILED: "Ажилтны эрх шинэчилж чадсангүй.",
  INVALID_INVITE: "Урилгын мэдээлэл дутуу эсвэл буруу байна.",
  INVITE_FAILED: "Урилга үүсгэж чадсангүй. Имэйл бүртгэлтэй эсэхийг шалгана уу.",
  PROFILE_SETUP_FAILED: "Урилга үүссэн ч ажилтны профайл бэлтгэгдсэнгүй. Админ шалгана уу.",
  MFA_REQUIRED: "Энэ үйлдэлд хоёр шатлалт баталгаажуулалт шаардлагатай.",
  EMAIL_NOT_CONFIRMED: "Ажилтны имэйл хараахан баталгаажаагүй байна.",
  CANNOT_CHANGE_SELF: "Өөрийн эрх эсвэл төлөвийг өөрчлөх боломжгүй.",
  NO_ACCESS_CHANGE: "Эрх эсвэл төлөвт өөрчлөлт ороогүй байна.",
  RATE_LIMITED: "Хэт олон хүсэлт илгээлээ. Түр хүлээгээд дахин оролдоно уу.",
  INVITE_ALREADY_PENDING: "Энэ имэйлд хүчинтэй урилга аль хэдийн хүлээгдэж байна.",
  INVITE_IN_PROGRESS: "Урилга илгээгдэж байна. Түр хүлээгээд энэ цонхноос дахин оролдоно уу.",
  IDEMPOTENCY_CONFLICT: "Урилгын хүсэлтийн давхардал илэрлээ. Мэдээллээ шалгана уу.",
  IDEMPOTENCY_RETIRED: "Энэ хуучин урилгын хүсэлт хаагдсан байна. Шинээр урилгаа илгээнэ үү.",
  STAFF_ALREADY_EXISTS: "Энэ имэйлтэй ажилтан системд бүртгэлтэй байна.",
  INVITE_RECONCILIATION_REQUIRED: "Урилга үүссэн ч бүртгэлийг админ шалгаж нийцүүлэх шаардлагатай.",
  INVITE_PROVIDER_FAILED: "Имэйл үйлчилгээ түр доголдлоо. Дараа дахин оролдоно уу.",
});

function apiError(error, fallback = "Backend хүсэлт амжилтгүй боллоо.") {
  const serverCode = String(error?.message ?? "").trim();
  const authRequired = error?.status === 401 || error?.statusCode === 401;
  const code = authRequired ? "AUTH_REQUIRED" : serverCode in SAFE_ERROR_MESSAGES ? serverCode : error?.code;
  const safeMessage = SAFE_ERROR_MESSAGES[code] ?? fallback;
  const result = new Error(safeMessage);
  result.code = code || "BACKEND_ERROR";
  return result;
}

function unwrap({ data, error }, fallback) {
  if (error) throw apiError(error, fallback);
  return data;
}

async function invokeStaffFunction(supabase, body, fallback) {
  const { data, error } = await supabase.functions.invoke("manage-staff", { body });
  let serverCode = data?.error;
  if (error && !serverCode && error.context?.clone) {
    try {
      serverCode = (await error.context.clone().json())?.error;
    } catch {
      serverCode = null;
    }
  }
  if (error || serverCode) throw apiError({ ...error, message: serverCode ?? error?.message }, fallback);
  return data;
}

function splitFullName(value) {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { lastName: "", firstName: parts[0] ?? "" };
  return { lastName: parts[0], firstName: parts.slice(1).join(" ") };
}

function profileToUser(profile, authUser) {
  const names = splitFullName(profile?.full_name || authUser?.user_metadata?.full_name || "");
  return {
    id: profile?.id ?? authUser?.id,
    ...names,
    email: profile?.email ?? authUser?.email ?? "",
    role: profile?.role ?? "viewer",
    status: profile?.status ?? "invited",
  };
}

function packageState(pack, remaining) {
  const today = businessDate();
  if (remaining <= 0 || pack.status === "completed") return { status: "completed", available: false };
  if (pack.status !== "active") return { status: pack.status, available: false };
  if (pack.starts_on && pack.starts_on > today) return { status: "scheduled", available: false };
  if (pack.expires_on && pack.expires_on < today) return { status: "expired", available: false };
  return { status: "active", available: true };
}

export function customerSummary(row) {
  const names = splitFullName(row.full_name);
  const entitlements = (row.customer_packages ?? [])
    .filter((pack) => !pack.archived_at && pack.status === "active")
    .flatMap((pack) =>
      (pack.customer_entitlements ?? []).map((item) => {
        const state = packageState(pack, Number(item.remaining_quantity));
        return {
          id: String(item.id),
          totalCount: item.total_quantity,
          usedCount: item.used_quantity,
          remainingCount: item.remaining_quantity,
          available: state.available,
        };
      }),
    );
  return {
    id: String(row.id),
    ...names,
    phone: row.phone ?? "",
    email: row.email ?? "",
    note: row.notes ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    entitlements,
  };
}

export function mapEntitlements(packages = []) {
  return packages
    .filter((pack) => !pack.archived_at && !["cancelled", "draft"].includes(pack.status))
    .flatMap((pack) =>
      (pack.customer_entitlements ?? []).map((item) => {
        const state = packageState(pack, Number(item.remaining_quantity));
        return {
          id: String(item.id),
          name: item.services?.name ? `${pack.name} · ${item.services.name}` : pack.name,
          totalCount: item.total_quantity,
          usedCount: item.used_quantity,
          startsOn: pack.starts_on,
          expiresAt: pack.expires_on,
          status: state.status,
          available: state.available,
        };
      }),
    );
}

export function mapVisits(visits = []) {
  return visits
    .filter((visit) => !visit.archived_at)
    .flatMap((visit) => {
      const lines = visit.visit_services?.length ? visit.visit_services : [null];
      return lines.map((line) => ({
        id: line ? `${visit.id}-${line.id}` : String(visit.id),
        occurredAt: visit.visited_at,
        serviceName: line?.services?.name ?? "Ерөнхий үйлчилгээ",
        staffName: line?.performed_by_profile?.full_name ?? "—",
        status: visit.status,
        note: visit.notes ?? "",
      }));
    });
}

export function mapPayments(rows = []) {
  return rows.map((payment) => ({
    id: String(payment.id),
    paidAt: payment.paid_at,
    amount: Number(payment.amount),
    method: payment.method,
    status:
      payment.payment_type === "refund"
        ? "refunded"
        : payment.payment_type === "adjustment"
          ? "adjusted"
          : "paid",
    reference: payment.external_reference ?? "",
  }));
}

export function createSupabaseAdapter({
  clientFactory = createClient,
  sessionStorage = globalThis.sessionStorage,
} = {}) {
  let client = null;
  let activeRole = null;

  const requireClient = () => {
    if (!client) throw new Error("Supabase adapter тохируулагдаагүй байна.");
    return client;
  };

  const loadProfile = async (authUser, { allowInvited = false } = {}) => {
    const supabase = requireClient();
    const profile = unwrap(
      await supabase
        .from("staff_profiles")
        .select("id,email,full_name,role,status")
        .eq("id", authUser.id)
        .maybeSingle(),
      "Ажилтны эрхийн мэдээлэл олдсонгүй.",
    );
    if (!profile || profile.status === "suspended" || (profile.status !== "active" && !allowInvited)) {
      const error = new Error(
        profile?.status === "suspended"
          ? "Таны ажилтны эрх түдгэлзсэн байна."
          : "Ажилтны эрх хараахан идэвхжээгүй байна.",
      );
      error.code = "STAFF_INACTIVE";
      throw error;
    }
    const user = profileToUser(profile, authUser);
    activeRole = user.role;
    return user;
  };

  const adapter = {
    mode: "remote",

    async configure({ supabaseUrl, publishableKey }) {
      client = clientFactory(supabaseUrl, publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: sessionStorage,
          storageKey: "cryo-erp-auth",
        },
        global: { headers: { "X-Client-Info": "cryo-mongolia-erp/0.1.0" } },
      });
    },

    async getSession() {
      const supabase = requireClient();
      const { data, error } = await supabase.auth.getSession();
      if (error) throw apiError(error, "Нэвтрэх төлөв шалгаж чадсангүй.");
      if (!data.session?.user) return null;
      return { user: await loadProfile(data.session.user, { allowInvited: true }) };
    },

    async signIn({ email, password }) {
      const supabase = requireClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: String(email ?? "").trim().toLowerCase(),
        password: String(password ?? ""),
      });
      if (error || !data.user) throw apiError(error, "Имэйл эсвэл нууц үг буруу байна.");
      try {
        return { user: await loadProfile(data.user) };
      } catch (profileError) {
        await supabase.auth.signOut({ scope: "local" });
        throw profileError;
      }
    },

    async signOut() {
      const { error } = await requireClient().auth.signOut({ scope: "local" });
      if (error) throw apiError(error, "Системээс гарч чадсангүй.");
      activeRole = null;
    },

    async completeInvite({ password }) {
      const supabase = requireClient();
      const { data, error } = await supabase.auth.updateUser({ password: String(password ?? "") });
      if (error || !data.user) throw apiError(error, "Нууц үг тохируулж чадсангүй.");
      return { user: await loadProfile(data.user, { allowInvited: true }) };
    },

    async getMfaStatus() {
      const supabase = requireClient();
      const assurance = unwrap(
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        "MFA төлөв шалгаж чадсангүй.",
      );
      const factors = unwrap(await supabase.auth.mfa.listFactors(), "MFA бүртгэл шалгаж чадсангүй.");
      const verifiedFactor = factors.totp?.find((factor) => factor.status === "verified") ?? null;
      return {
        currentLevel: assurance.currentLevel,
        nextLevel: assurance.nextLevel,
        verifiedFactor: verifiedFactor
          ? { id: verifiedFactor.id, friendlyName: verifiedFactor.friendly_name }
          : null,
      };
    },

    async beginMfaEnrollment() {
      const data = unwrap(
        await requireClient().auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "CRYO ERP",
        }),
        "Authenticator бүртгэлийг эхлүүлж чадсангүй.",
      );
      const qrCode = String(data.totp?.qr_code ?? "");
      if (!qrCode.startsWith("data:image/svg+xml")) {
        throw new Error("Authenticator QR мэдээлэл буруу ирлээ.");
      }
      return { factorId: data.id, qrCode, secret: String(data.totp?.secret ?? "") };
    },

    async verifyMfaChallenge({ factorId, code }) {
      return unwrap(
        await requireClient().auth.mfa.challengeAndVerify({
          factorId: String(factorId ?? ""),
          code: String(code ?? "").replace(/\s/g, ""),
        }),
        "Authenticator код буруу эсвэл хугацаа дууссан байна.",
      );
    },

    async getDashboard() {
      const supabase = requireClient();
      const metricsRows = unwrap(
        await supabase.rpc("dashboard_metrics"),
        "Хянах самбарын үзүүлэлт авч чадсангүй.",
      );
      const recentRows = unwrap(
        await supabase
          .from("visits")
          .select(
            "id,customer_id,visited_at,status,customers(full_name),visit_services(id,services(name),performed_by_profile:staff_profiles!visit_services_performed_by_fkey(full_name))",
          )
          .is("archived_at", null)
          .order("visited_at", { ascending: false })
          .limit(5),
        "Сүүлийн үйлчилгээ авч чадсангүй.",
      );
      const metrics = metricsRows?.[0] ?? {};
      const recentVisits = recentRows.flatMap((visit) => {
        const lines = visit.visit_services?.length ? visit.visit_services : [null];
        return lines.map((line) => ({
          id: line ? `${visit.id}-${line.id}` : String(visit.id),
          customerId: String(visit.customer_id),
          customerName: visit.customers?.full_name ?? "Нэргүй",
          serviceName: line?.services?.name ?? "Ерөнхий үйлчилгээ",
          staffName: line?.performed_by_profile?.full_name ?? "—",
          occurredAt: visit.visited_at,
          status: visit.status,
        }));
      });
      return {
        metrics: {
          customerCount: Number(metrics.active_customers ?? 0),
          activePackageCount: Number(metrics.active_packages ?? 0),
          todayVisitCount: Number(metrics.today_visits ?? 0),
          expiringPackageCount: Number(metrics.expiring_packages ?? 0),
        },
        recentVisits,
      };
    },

    async searchCustomers(query, limit = 8) {
      const rows = unwrap(
        await requireClient().rpc("search_customers", {
          search_term: String(query ?? "").trim(),
          result_limit: Math.min(100, Math.max(1, Number(limit) || 8)),
        }),
        "Үйлчлүүлэгч хайж чадсангүй.",
      );
      return rows.map(customerSummary);
    },

    async listCustomers({ query = "", page = 1, pageSize = 25 } = {}) {
      const supabase = requireClient();
      const normalizedQuery = String(query).trim();
      const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));
      const safePage = Math.max(1, Number(page) || 1);
      if (normalizedQuery && normalizedQuery.length < 2) {
        return { items: [], total: 0, page: safePage, pageSize: safePageSize, truncated: false, queryTooShort: true };
      }
      let ids = null;
      let truncated = false;
      if (normalizedQuery) {
        const results = await adapter.searchCustomers(normalizedQuery, 100);
        ids = results.map((item) => item.id);
        truncated = ids.length === 100;
        if (!ids.length) return { items: [], total: 0 };
      }

      const from = (safePage - 1) * safePageSize;
      const to = from + safePageSize - 1;

      let request = supabase
        .from("customers")
        .select(
          "id,full_name,phone,email,notes,created_at,updated_at,customer_packages(id,status,starts_on,expires_on,archived_at,customer_entitlements(id,total_quantity,used_quantity,remaining_quantity))",
          { count: "exact" },
        )
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .range(from, to);
      if (ids) request = request.in("id", ids);
      const { data, error, count } = await request;
      if (error) throw apiError(error, "Үйлчлүүлэгчийн жагсаалт авч чадсангүй.");
      return {
        items: data.map(customerSummary),
        total: ids ? ids.length : count ?? data.length,
        page: safePage,
        pageSize: safePageSize,
        truncated,
      };
    },

    async getCustomer(customerId) {
      const supabase = requireClient();
      const customer = unwrap(
        await supabase
          .from("customers")
          .select(
            "id,full_name,phone,email,notes,created_at,updated_at,customer_packages(id,name,status,starts_on,expires_on,archived_at,customer_entitlements(id,total_quantity,used_quantity,remaining_quantity,services(name))),visits(id,visited_at,status,notes,archived_at,visit_services(id,services(name),performed_by_profile:staff_profiles!visit_services_performed_by_fkey(full_name)))",
          )
          .eq("id", customerId)
          .is("archived_at", null)
          .single(),
        "Үйлчлүүлэгчийн мэдээлэл авч чадсангүй.",
      );
      let payments = null;
      if (["owner", "admin", "manager", "reception"].includes(activeRole)) {
        payments = unwrap(
          await supabase
            .from("payments")
            .select("id,paid_at,payment_type,method,amount,external_reference,sales!inner(customer_id)")
            .eq("sales.customer_id", customerId)
            .order("paid_at", { ascending: false })
            .limit(100),
          "Төлбөрийн түүх авч чадсангүй.",
        );
      }
      return {
        ...customerSummary(customer),
        entitlements: mapEntitlements(customer.customer_packages),
        visits: mapVisits(customer.visits),
        payments: payments ? mapPayments(payments) : null,
      };
    },

    async createCustomer(input) {
      const fullName = `${String(input.lastName ?? "").trim()} ${String(input.firstName ?? "").trim()}`.trim();
      const row = unwrap(
        await requireClient()
          .from("customers")
          .insert({
            full_name: fullName,
            phone: String(input.phone ?? "").trim() || null,
            email: String(input.email ?? "").trim().toLowerCase() || null,
            notes: String(input.note ?? "").trim() || null,
          })
          .select("id,full_name,phone,email,notes,created_at,updated_at")
          .single(),
        "Үйлчлүүлэгч бүртгэж чадсангүй.",
      );
      return customerSummary(row);
    },

    async updateCustomer(customerId, input) {
      const fullName = `${String(input.lastName ?? "").trim()} ${String(input.firstName ?? "").trim()}`.trim();
      const row = unwrap(
        await requireClient()
          .from("customers")
          .update({
            full_name: fullName,
            phone: String(input.phone ?? "").trim() || null,
            email: String(input.email ?? "").trim().toLowerCase() || null,
            notes: String(input.note ?? "").trim() || null,
          })
          .eq("id", customerId)
          .is("archived_at", null)
          .select("id,full_name,phone,email,notes,created_at,updated_at")
          .single(),
        "Үйлчлүүлэгчийн мэдээлэл шинэчилж чадсангүй.",
      );
      return customerSummary(row);
    },

    async listServices() {
      const rows = unwrap(
        await requireClient()
          .from("services")
          .select("id,name,category")
          .eq("is_active", true)
          .order("category", { ascending: true })
          .order("name", { ascending: true }),
        "Үйлчилгээний жагсаалт авч чадсангүй.",
      );
      return rows.map((row) => ({ id: String(row.id), name: row.name, category: row.category }));
    },

    async createCustomerPackage(input) {
      const entitlements = Array.isArray(input.entitlements) ? input.entitlements : [];
      const packageId = unwrap(
        await requireClient().rpc("create_customer_package", {
          p_customer_id: Number(input.customerId),
          p_package_name: String(input.name ?? "").trim(),
          p_purchased_at: input.purchasedAt || null,
          p_starts_on: input.startsOn,
          p_expires_on: input.expiresOn || null,
          p_price: input.price === "" || input.price == null ? null : Number(input.price),
          p_entitlement_items: entitlements.map((item) => ({
            service_id: Number(item.serviceId),
            quantity: Number(item.quantity),
          })),
          p_notes: String(input.notes ?? "").trim() || null,
          p_package_template_id: null,
        }),
        "Багцын эрх үүсгэж чадсангүй.",
      );
      return { id: String(packageId) };
    },

    async consumeEntitlement({ entitlementId, quantity = 1, note = "" }) {
      return unwrap(
        await requireClient().rpc("consume_entitlement", {
          entitlement_id: Number(entitlementId),
          quantity: Number(quantity),
          used_at: new Date().toISOString(),
          notes: String(note ?? "").trim() || null,
        }),
        "Үйлчилгээний эрх хасаж чадсангүй.",
      );
    },

    async listStaff() {
      const rows = unwrap(
        await requireClient()
          .from("staff_profiles")
          .select("id,email,full_name,role,status")
          .order("full_name", { ascending: true }),
        "Ажилтны жагсаалт авч чадсангүй.",
      );
      return rows.map((row) => profileToUser(row));
    },

    async inviteStaff(input) {
      const fullName = `${String(input.lastName ?? "").trim()} ${String(input.firstName ?? "").trim()}`.trim();
      return invokeStaffFunction(
        requireClient(),
        {
          action: "invite",
          email: String(input.email ?? "").trim().toLowerCase(),
          fullName,
          role: String(input.role ?? "staff"),
          idempotencyKey: String(input.idempotencyKey ?? ""),
        },
        "Ажилтны урилга үүсгэж чадсангүй.",
      );
    },

    async updateStaffAccess(input) {
      return invokeStaffFunction(
        requireClient(),
        {
          action: "update_access",
          targetUserId: String(input.staffId ?? ""),
          role: String(input.role ?? "viewer"),
          status: String(input.status ?? "invited"),
          reason: String(input.reason ?? "").trim(),
        },
        "Ажилтны эрх шинэчилж чадсангүй.",
      );
    },
  };

  return adapter;
}
