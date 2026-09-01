import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDemoAdapter } from "../src/api/local-demo.js";

async function signedInDemo(email = "owner@example.invalid") {
  const adapter = createLocalDemoAdapter({ delayMs: 0 });
  const session = await adapter.signIn({ email, password: "demo-passphrase" });
  return { adapter, session };
}

test("local adapter starts signed out and accepts only fictional demo email addresses", async () => {
  const adapter = createLocalDemoAdapter({ delayMs: 0 });
  assert.equal(await adapter.getSession(), null);
  await assert.rejects(
    () => adapter.signIn({ email: "person@example.com", password: "demo-passphrase" }),
    /@example\.invalid/,
  );
  await assert.rejects(
    () => adapter.signIn({ email: "owner@example.invalid", password: "short" }),
    /8-аас доошгүй/,
  );
});

test("dashboard, global search, and customer list return isolated demo data", async () => {
  const { adapter, session } = await signedInDemo();
  assert.equal(session.user.role, "owner");
  const dashboard = await adapter.getDashboard();
  assert.ok(dashboard.metrics.customerCount >= 3);
  assert.ok(dashboard.recentVisits.length > 0);
  const matches = await adapter.searchCustomers("Саруул");
  assert.equal(matches.length, 1);
  matches[0].firstName = "changed-outside";
  const secondRead = await adapter.searchCustomers("Саруул");
  assert.notEqual(secondRead[0].firstName, "changed-outside");
  const tooShort = await adapter.listCustomers({ query: "С" });
  assert.equal(tooShort.queryTooShort, true);
  assert.equal(tooShort.items.length, 0);
});

test("local privileged flow reports AAL2 without creating a real factor", async () => {
  const { adapter } = await signedInDemo();
  const status = await adapter.getMfaStatus();
  assert.equal(status.currentLevel, "aal2");
  assert.equal(status.verifiedFactor.id, "local-demo-mfa");
});

test("customer create and update flow is functional", async () => {
  const { adapter } = await signedInDemo();
  const created = await adapter.createCustomer({
    firstName: "Шинэ",
    lastName: "Демо",
    phone: "99000009",
    email: "new@example.invalid",
    note: "Зохиомол",
  });
  assert.match(created.id, /^demo-customer-/);
  const updated = await adapter.updateCustomer(created.id, {
    ...created,
    firstName: "Зассан",
  });
  assert.equal(updated.firstName, "Зассан");
  const list = await adapter.listCustomers({ query: "Зассан" });
  assert.equal(list.total, 1);
});

test("consume entitlement is atomic from the adapter caller perspective", async () => {
  const { adapter } = await signedInDemo("staff@example.invalid");
  const before = await adapter.getCustomer("demo-customer-1");
  const entitlement = before.entitlements.find((item) => item.id === "demo-entitlement-1");
  const usedBefore = entitlement.usedCount;
  const visitsBefore = before.visits.length;
  const after = await adapter.consumeEntitlement({
    customerId: before.id,
    entitlementId: entitlement.id,
    quantity: 2,
    note: "Demo service",
  });
  assert.equal(after.entitlements.find((item) => item.id === entitlement.id).usedCount, usedBefore + 2);
  assert.equal(after.visits.length, visitsBefore + 1);
  await assert.rejects(
    () =>
      adapter.consumeEntitlement({
        customerId: before.id,
        entitlementId: entitlement.id,
        quantity: 999,
      }),
    /хүрэлцэхгүй/,
  );
});

test("customer package flow adds selected service entitlement", async () => {
  const { adapter } = await signedInDemo();
  const services = await adapter.listServices();
  assert.ok(services.length > 0);
  const customerBefore = await adapter.getCustomer("demo-customer-3");
  await adapter.createCustomerPackage({
    customerId: customerBefore.id,
    name: "Шинэ демо багц",
    startsOn: "2026-09-01",
    expiresOn: "2026-12-01",
    entitlements: [{ serviceId: services[0].id, quantity: 4 }],
  });
  const customerAfter = await adapter.getCustomer(customerBefore.id);
  assert.equal(customerAfter.entitlements.length, customerBefore.entitlements.length + 1);
  assert.equal(customerAfter.entitlements[0].totalCount, 4);
});

test("staff invite hook and sign-out guard work in local mode", async () => {
  const { adapter } = await signedInDemo();
  const invited = await adapter.inviteStaff({
    firstName: "Урилга",
    lastName: "Демо",
    email: "invite@example.invalid",
    role: "manager",
  });
  assert.equal(invited.status, "invited");
  assert.equal((await adapter.listStaff()).some((item) => item.email === invited.email), true);
  await adapter.signOut();
  await assert.rejects(() => adapter.listCustomers(), /Нэвтрэх хугацаа/);
});

test("staff access hook prevents removal of the last active owner", async () => {
  const { adapter } = await signedInDemo();
  await assert.rejects(
    () =>
      adapter.updateStaffAccess({
        staffId: "demo-staff-owner",
        role: "manager",
        status: "active",
        reason: "Демо өөрчлөлт",
      }),
    /дор хаяж нэг идэвхтэй эзэмшигч/,
  );
  const updated = await adapter.updateStaffAccess({
    staffId: "demo-staff-manager",
    role: "reception",
    status: "active",
    reason: "Демо өөрчлөлт",
  });
  assert.equal(updated.role, "reception");
});
