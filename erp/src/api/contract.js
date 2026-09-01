export const REQUIRED_ADAPTER_METHODS = Object.freeze([
  "getSession",
  "signIn",
  "signOut",
  "completeInvite",
  "getMfaStatus",
  "beginMfaEnrollment",
  "verifyMfaChallenge",
  "getDashboard",
  "searchCustomers",
  "listCustomers",
  "getCustomer",
  "createCustomer",
  "updateCustomer",
  "listServices",
  "createCustomerPackage",
  "consumeEntitlement",
  "listStaff",
  "inviteStaff",
  "updateStaffAccess",
]);

export function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") {
    return { valid: false, missing: [...REQUIRED_ADAPTER_METHODS] };
  }

  const missing = REQUIRED_ADAPTER_METHODS.filter((method) => typeof adapter[method] !== "function");
  return { valid: missing.length === 0, missing };
}

export function adapterContractError(missing) {
  const error = new Error(
    `CRYO_ERP_ADAPTER дутуу байна: ${missing.join(", ")}. Backend adapter-аа холбоно уу.`,
  );
  error.code = "ADAPTER_INCOMPLETE";
  return error;
}
