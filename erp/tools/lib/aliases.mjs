import { sha256Text } from "./hash.mjs";

export function canonicalizeServiceLabel(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("mn-MN")
    .replace(/[“”„"'’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshtein(left, right) {
  const a = [...left];
  const b = [...right];
  const previous = b.map((_, index) => index + 1);
  previous.unshift(0);

  for (let i = 0; i < a.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + (a[i] === b[j] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

function similarity(left, right) {
  if (left === right) return 1;
  const length = Math.max([...left].length, [...right].length);
  if (length === 0) return 1;
  return 1 - levenshtein(left, right) / length;
}

export function buildServiceAliasCandidates(entries, { threshold = 0.86, includeRaw = false } = {}) {
  const normalized = entries
    .map((entry) => ({ ...entry, canonical: canonicalizeServiceLabel(entry.label) }))
    .filter((entry) => entry.sourceKey && entry.canonical)
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  const candidates = [];

  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex += 1) {
      const left = normalized[leftIndex];
      const right = normalized[rightIndex];
      const score = similarity(left.canonical, right.canonical);
      if (score < threshold) continue;
      const sourceKeys = [left.sourceKey, right.sourceKey].sort();
      const candidate = {
        candidateId: sha256Text(sourceKeys.join("|")),
        sourceKeys,
        reason: score === 1 ? "same_normalized_label" : "similar_normalized_label",
        similarity: Number(score.toFixed(4)),
        decision: "manual_review",
      };
      if (includeRaw) candidate.labels = [left.label, right.label];
      candidates.push(candidate);
    }
  }

  return candidates.sort((left, right) => left.candidateId.localeCompare(right.candidateId));
}
