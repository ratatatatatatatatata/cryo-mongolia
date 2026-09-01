export const demoCustomers = [
  {
    id: "demo-customer-1",
    firstName: "Саруул",
    lastName: "Жишээ",
    phone: "99000001",
    email: "saruul@example.invalid",
    note: "Зөвхөн localhost дээр харагдах зохиомол бүртгэл.",
    createdAt: "2026-07-03T02:00:00.000Z",
    updatedAt: "2026-08-27T07:30:00.000Z",
    entitlements: [
      {
        id: "demo-entitlement-1",
        name: "Крио сэргээх багц",
        totalCount: 10,
        usedCount: 4,
        expiresAt: "2026-12-31T15:59:59.000Z",
        status: "active",
      },
      {
        id: "demo-entitlement-2",
        name: "Хэвлийн хэсэгчилсэн үйлчилгээ",
        totalCount: 5,
        usedCount: 5,
        expiresAt: "2026-10-15T15:59:59.000Z",
        status: "completed",
      },
    ],
    visits: [
      {
        id: "demo-visit-1",
        occurredAt: "2026-08-27T07:30:00.000Z",
        serviceName: "Крио сэргээх багц",
        staffName: "Демо Ажилтан",
        status: "completed",
        note: "Туршилтын тэмдэглэл",
      },
      {
        id: "demo-visit-2",
        occurredAt: "2026-08-20T06:00:00.000Z",
        serviceName: "Крио сэргээх багц",
        staffName: "Демо Ажилтан",
        status: "completed",
        note: "",
      },
    ],
    payments: [
      {
        id: "demo-payment-1",
        paidAt: "2026-08-18T04:20:00.000Z",
        amount: 350000,
        method: "QPay",
        status: "paid",
        reference: "DEMO-0001",
      },
    ],
  },
  {
    id: "demo-customer-2",
    firstName: "Тэмүүлэн",
    lastName: "Туршилт",
    phone: "88000002",
    email: "temuulen@example.invalid",
    note: "Бодит үйлчлүүлэгчийн мэдээлэл биш.",
    createdAt: "2026-08-01T03:10:00.000Z",
    updatedAt: "2026-08-29T03:15:00.000Z",
    entitlements: [
      {
        id: "demo-entitlement-3",
        name: "Бүтэн биеийн үйлчилгээ",
        totalCount: 8,
        usedCount: 2,
        expiresAt: "2027-01-20T15:59:59.000Z",
        status: "active",
      },
    ],
    visits: [
      {
        id: "demo-visit-3",
        occurredAt: "2026-08-29T03:15:00.000Z",
        serviceName: "Бүтэн биеийн үйлчилгээ",
        staffName: "Демо Менежер",
        status: "completed",
        note: "",
      },
    ],
    payments: [
      {
        id: "demo-payment-2",
        paidAt: "2026-08-01T03:10:00.000Z",
        amount: 480000,
        method: "Карт",
        status: "paid",
        reference: "DEMO-0002",
      },
    ],
  },
  {
    id: "demo-customer-3",
    firstName: "Номин",
    lastName: "Загвар",
    phone: "77000003",
    email: "nomin@example.invalid",
    note: "",
    createdAt: "2026-08-12T09:00:00.000Z",
    updatedAt: "2026-08-12T09:00:00.000Z",
    entitlements: [],
    visits: [],
    payments: [],
  },
];

export const demoStaff = [
  {
    id: "demo-staff-owner",
    firstName: "Демо",
    lastName: "Эзэмшигч",
    email: "owner@example.invalid",
    role: "owner",
    status: "active",
  },
  {
    id: "demo-staff-manager",
    firstName: "Демо",
    lastName: "Менежер",
    email: "manager@example.invalid",
    role: "manager",
    status: "active",
  },
  {
    id: "demo-staff-employee",
    firstName: "Демо",
    lastName: "Ажилтан",
    email: "staff@example.invalid",
    role: "staff",
    status: "active",
  },
];

export const demoServices = [
  { id: "demo-service-cryo", name: "Крио сэргээх үйлчилгээ", category: "cryo" },
  { id: "demo-service-body", name: "Бүтэн биеийн үйлчилгээ", category: "body" },
  { id: "demo-service-zone", name: "Хэсэгчилсэн үйлчилгээ", category: "zone" },
];
