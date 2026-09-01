import assert from "node:assert/strict";
import test from "node:test";
import {
  customerDetailView,
  customersView,
  mfaVerifyForm,
  packageForm,
  shellView,
  staffView,
} from "../src/views.js";

const customer = {
  id: "customer-1",
  firstName: "Жишээ",
  lastName: "Хүн",
  phone: "99000001",
  email: "person@example.invalid",
  entitlements: [
    {
      id: "entitlement-1",
      name: "Демо багц",
      totalCount: 5,
      usedCount: 1,
      status: "active",
    },
  ],
  visits: [],
  payments: [],
};

test("restricted shell does not render customer search or navigation", () => {
  const html = shellView({
    user: { firstName: "Viewer", role: "viewer" },
    activePath: "/dashboard",
    content: "restricted",
  });
  assert.equal(html.includes("global-search-input"), false);
  assert.equal(html.includes("#/customers"), false);
});

test("customer detail actions follow operational role permissions", () => {
  const viewer = customerDetailView(customer, "viewer");
  assert.equal(viewer.includes('data-action="package-add"'), false);
  assert.equal(viewer.includes('data-action="consume"'), false);
  assert.equal(viewer.includes('data-action="customer-edit"'), false);

  const reception = customerDetailView(customer, "reception");
  assert.equal(reception.includes('data-action="package-add"'), true);
  assert.equal(reception.includes('data-action="consume"'), true);
  assert.equal(reception.includes('data-action="customer-edit"'), true);
  assert.equal(reception.includes("payments-panel"), true);
  assert.equal(customerDetailView(customer, "therapist").includes("payments-panel"), false);
});

test("customer list requires two characters for non-empty searches", () => {
  const html = customersView({
    result: { items: [], total: 0, queryTooShort: true },
    query: "С",
    role: "reception",
  });
  assert.ok(html.includes('minlength="2"'));
  assert.ok(html.includes("2-оос доошгүй тэмдэг"));
});

test("staff access UI hides forbidden admin and self edits", () => {
  const staff = [
    {
      id: "owner-1",
      firstName: "Active",
      lastName: "Owner",
      email: "owner@example.invalid",
      role: "owner",
      status: "active",
    },
    {
      id: "admin-1",
      firstName: "Team",
      lastName: "Admin",
      email: "admin@example.invalid",
      role: "admin",
      status: "active",
    },
  ];
  assert.equal(staffView(staff, "admin", "admin-1").includes('data-action="staff-edit"'), false);

  const ownerHtml = staffView(staff, "owner", "owner-1");
  assert.equal(ownerHtml.includes('data-staff-id="owner-1"'), false);
  assert.equal(ownerHtml.includes('data-staff-id="admin-1"'), true);
});

test("form option and MFA image values are escaped", () => {
  const packageHtml = packageForm("customer-1", [
    { id: 'x"><script>', name: "<b>Unsafe</b>" },
  ]);
  assert.equal(packageHtml.includes("<script>"), false);
  assert.ok(packageHtml.includes("&lt;b&gt;Unsafe&lt;/b&gt;"));

  const boundaryHtml = packageForm("customer-1", [], new Date("2026-09-01T16:00:00.000Z"));
  assert.ok(boundaryHtml.includes('name="startsOn" type="date" value="2026-09-02"'));
  assert.ok(boundaryHtml.includes('name="expiresOn" type="date" min="2026-09-02"'));

  const mfaHtml = mfaVerifyForm({
    factorId: 'factor"><script>',
    qrCode: 'data:image/svg+xml,&quot; onerror=&quot;alert(1)',
    secret: "<unsafe>",
  });
  assert.equal(mfaHtml.includes("<unsafe>"), false);
  assert.equal(mfaHtml.includes("<script>"), false);
});
