import { sha256Text, stableStringify } from "./hash.mjs";

export function buildSaleCandidateFingerprint({ date, customerHmac, serviceKey, amountCanonical, paymentMethod }) {
  return stableStringify({
    amountCanonical: amountCanonical ?? null,
    customerHmac: customerHmac ?? null,
    date: date ?? null,
    paymentMethod: paymentMethod ?? null,
    serviceKey: serviceKey ?? null,
  });
}

export function clusterDuplicateCandidates(records, { fingerprint = (record) => record.fingerprint } = {}) {
  const groups = new Map();
  for (const record of records) {
    if (!record?.sourceKey) throw new TypeError("each duplicate candidate must have sourceKey");
    const key = fingerprint(record);
    if (key === null || key === undefined || key === "") continue;
    const serialized = typeof key === "string" ? key : stableStringify(key);
    if (!groups.has(serialized)) groups.set(serialized, []);
    groups.get(serialized).push(record.sourceKey);
  }

  return [...groups.values()]
    .filter((sourceKeys) => sourceKeys.length > 1)
    .map((sourceKeys) => {
      const sorted = [...sourceKeys].sort();
      return {
        candidateId: sha256Text(sorted.join("|")),
        sourceKeys: sorted,
        count: sorted.length,
        decision: "manual_review",
        autoMerged: false,
      };
    })
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId));
}
