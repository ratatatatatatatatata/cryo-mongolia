import assert from "node:assert/strict";
import test from "node:test";
import {
  createSupabaseAdapter,
  mapEntitlements,
  mapPayments,
  mapVisits,
} from "../src/api/supabase-adapter.js";

test("remote mappers preserve operational status and package availability", () => {
  const entitlements = mapEntitlements([
    {
      id: 1,
      name: "Current",
      status: "active",
      starts_on: "2000-01-01",
      expires_on: "2999-12-31",
      customer_entitlements: [
        { id: 11, total_quantity: 5, used_quantity: 1, remaining_quantity: 4, services: { name: "Cryo" } },
      ],
    },
    {
      id: 2,
      name: "Future",
      status: "active",
      starts_on: "2999-01-01",
      expires_on: "2999-12-31",
      customer_entitlements: [
        { id: 12, total_quantity: 3, used_quantity: 0, remaining_quantity: 3, services: { name: "Future" } },
      ],
    },
  ]);
  assert.equal(entitlements[0].available, true);
  assert.equal(entitlements[0].status, "active");
  assert.equal(entitlements[1].available, false);
  assert.equal(entitlements[1].status, "scheduled");

  const visits = mapVisits([{ id: 1, visited_at: "2026-09-01", status: "cancelled", visit_services: [] }]);
  assert.equal(visits[0].status, "cancelled");

  const payments = mapPayments([
    { id: 1, paid_at: "2026-09-01", amount: 10, method: "qpay", payment_type: "refund" },
    { id: 2, paid_at: "2026-09-01", amount: 5, method: "cash", payment_type: "adjustment" },
  ]);
  assert.deepEqual(payments.map((item) => item.status), ["refunded", "adjusted"]);
});

test("remote customer update omits trigger-owned updated_by and uses tab-scoped auth storage", async () => {
  let updatePayload;
  let clientOptions;
  const storage = {};
  const customerRow = {
    id: 5,
    full_name: "Demo User",
    phone: "99000001",
    email: "demo@example.invalid",
    notes: null,
    created_at: "2026-09-01",
    updated_at: "2026-09-01",
  };
  const builder = {
    update(payload) {
      updatePayload = payload;
      return this;
    },
    eq() { return this; },
    is() { return this; },
    select() { return this; },
    async single() { return { data: customerRow, error: null }; },
  };
  const adapter = createSupabaseAdapter({
    sessionStorage: storage,
    clientFactory(_url, _key, options) {
      clientOptions = options;
      return { from: () => builder };
    },
  });
  await adapter.configure({
    supabaseUrl: "https://abcdefghijk.supabase.co",
    publishableKey: "sb_publishable_example",
  });
  await adapter.updateCustomer("5", {
    firstName: "User",
    lastName: "Demo",
    phone: "99000001",
    email: "demo@example.invalid",
    note: "",
  });
  assert.equal(Object.hasOwn(updatePayload, "updated_by"), false);
  assert.equal(clientOptions.auth.detectSessionInUrl, true);
  assert.equal(clientOptions.auth.storage, storage);
});

test("therapist detail adapter skips payment table entirely", async () => {
  let paymentsSelected = false;
  const profile = {
    id: "user-1",
    email: "therapist@example.invalid",
    full_name: "Demo Therapist",
    role: "therapist",
    status: "active",
  };
  const customer = {
    id: 10,
    full_name: "Demo Customer",
    phone: "99000001",
    email: "customer@example.invalid",
    notes: null,
    created_at: "2026-09-01",
    updated_at: "2026-09-01",
    customer_packages: [],
    visits: [],
  };
  const chain = (terminal, terminalName) => ({
    select() { return this; },
    eq() { return this; },
    is() { return this; },
    [terminalName]: async () => ({ data: terminal, error: null }),
  });
  const client = {
    auth: {
      async getSession() {
        return { data: { session: { user: { id: "user-1", email: profile.email } } }, error: null };
      },
    },
    from(table) {
      if (table === "staff_profiles") return chain(profile, "maybeSingle");
      if (table === "customers") return chain(customer, "single");
      if (table === "payments") {
        paymentsSelected = true;
        throw new Error("payments must not be queried");
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  const adapter = createSupabaseAdapter({ clientFactory: () => client, sessionStorage: {} });
  await adapter.configure({
    supabaseUrl: "https://abcdefghijk.supabase.co",
    publishableKey: "sb_publishable_example",
  });
  await adapter.getSession();
  const result = await adapter.getCustomer("10");
  assert.equal(paymentsSelected, false);
  assert.equal(result.payments, null);
});

