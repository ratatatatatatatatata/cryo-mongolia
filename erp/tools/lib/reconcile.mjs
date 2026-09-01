function toInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`);
  return value;
}

function toBigInt(value, label) {
  try {
    return BigInt(value ?? 0);
  } catch {
    throw new TypeError(`${label} must be an integer-compatible value`);
  }
}

export function buildReconciliationSummary({ rows, sales = null, packages = null, inventory = null }) {
  const eligible = toInteger(rows.eligible, "rows.eligible");
  const imported = toInteger(rows.imported, "rows.imported");
  const quarantined = toInteger(rows.quarantined, "rows.quarantined");
  const ignored = toInteger(rows.ignored, "rows.ignored");
  const hasDeferred = rows.deferred !== undefined;
  const deferred = hasDeferred ? toInteger(rows.deferred, "rows.deferred") : 0;
  const checks = [
    {
      code: "row_accounting",
      passed: eligible === imported + quarantined + ignored + deferred,
      severity: "blocking",
    },
  ];

  if (sales) {
    const gross = toBigInt(sales.grossMinor, "sales.grossMinor");
    const discount = toBigInt(sales.discountMinor, "sales.discountMinor");
    const net = toBigInt(sales.netMinor, "sales.netMinor");
    const payments = toBigInt(sales.paymentMinor, "sales.paymentMinor");
    const outstanding = toBigInt(sales.outstandingMinor, "sales.outstandingMinor");
    checks.push(
      { code: "sales_net", passed: gross - discount === net, severity: "blocking" },
      { code: "payment_balance", passed: payments + outstanding === net, severity: "blocking" },
    );
  }

  if (packages) {
    const purchased = toInteger(packages.purchased, "packages.purchased");
    const used = toInteger(packages.used, "packages.used");
    const expired = toInteger(packages.expired, "packages.expired");
    const adjusted = Number(packages.adjusted ?? 0);
    const remaining = toInteger(packages.remaining, "packages.remaining");
    if (!Number.isInteger(adjusted)) throw new TypeError("packages.adjusted must be an integer");
    checks.push({ code: "package_balance", passed: purchased - used - expired + adjusted === remaining, severity: "blocking" });
  }

  if (inventory) {
    const opening = toBigInt(inventory.opening, "inventory.opening");
    const receipts = toBigInt(inventory.receipts, "inventory.receipts");
    const issues = toBigInt(inventory.issues, "inventory.issues");
    const adjustments = toBigInt(inventory.adjustments, "inventory.adjustments");
    const closing = toBigInt(inventory.closing, "inventory.closing");
    checks.push({ code: "inventory_balance", passed: opening + receipts - issues + adjustments === closing, severity: "blocking" });
  }

  const counts = { eligible, imported, quarantined, ignored };
  if (hasDeferred) counts.deferred = deferred;
  return {
    status: checks.every((check) => check.passed) ? "pass" : "fail",
    counts,
    checks,
  };
}
