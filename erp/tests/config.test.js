import assert from "node:assert/strict";
import test from "node:test";
import {
  enableLocalDemo,
  isEmbeddedWindow,
  isLocalHost,
  readRuntimeConfig,
  validateSupabaseBrowserConfig,
} from "../src/config.js";

function legacyJwt(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.signature`;
}

function memorySessionStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("runtime config is missing by default and exposes demo only on localhost", () => {
  const storage = memorySessionStorage();
  const result = readRuntimeConfig({
    windowLike: {},
    locationLike: { hostname: "localhost" },
    sessionStorageLike: storage,
  });
  assert.equal(result.status, "missing");
  assert.equal(result.canUseLocalDemo, true);
  assert.equal(isLocalHost({ hostname: "cryo.example" }), false);
});

test("committed null placeholders remain a secure setup state", () => {
  const result = validateSupabaseBrowserConfig({
    supabaseUrl: null,
    supabasePublishableKey: null,
  });
  assert.equal(result.status, "missing");
});

test("frame detection fails closed for embedded or unreadable window parents", () => {
  const topLevel = {};
  topLevel.top = topLevel;
  topLevel.self = topLevel;
  assert.equal(isEmbeddedWindow(topLevel), false);

  const embedded = { top: {}, self: {} };
  assert.equal(isEmbeddedWindow(embedded), true);

  const unreadable = { self: {} };
  Object.defineProperty(unreadable, "top", { get: () => { throw new Error("cross-origin"); } });
  assert.equal(isEmbeddedWindow(unreadable), true);
});

test("local demo cannot be enabled on a public hostname", () => {
  const storage = memorySessionStorage();
  enableLocalDemo(storage);
  const result = readRuntimeConfig({
    windowLike: {},
    locationLike: { hostname: "cryo.example" },
    sessionStorageLike: storage,
  });
  assert.equal(result.status, "missing");
  assert.equal(result.canUseLocalDemo, false);
});

test("local demo is session-scoped on localhost", () => {
  const storage = memorySessionStorage();
  enableLocalDemo(storage);
  const result = readRuntimeConfig({
    windowLike: {},
    locationLike: { hostname: "127.0.0.1" },
    sessionStorageLike: storage,
  });
  assert.deepEqual(result, { status: "ready", mode: "local-demo", localOnly: true });
});

test("publishable and legacy anon browser keys are accepted", () => {
  const publishable = validateSupabaseBrowserConfig({
    supabaseUrl: "https://abcdefghijk.supabase.co/path",
    supabasePublishableKey: "sb_publishable_example_key",
  });
  assert.equal(publishable.status, "ready");
  assert.equal(publishable.supabaseUrl, "https://abcdefghijk.supabase.co");

  const legacy = validateSupabaseBrowserConfig({
    supabaseUrl: "https://abcdefghijk.supabase.co",
    supabaseAnonKey: legacyJwt("anon"),
  });
  assert.equal(legacy.status, "ready");
});

test("secret, elevated JWT, non-HTTPS, and unrelated keys are rejected", () => {
  const base = { supabaseUrl: "https://abcdefghijk.supabase.co" };
  const secretLikeKey = [["sb", "secret"].join("_"), "example"].join("_");
  assert.equal(
    validateSupabaseBrowserConfig({ ...base, supabasePublishableKey: secretLikeKey }).status,
    "invalid",
  );
  const elevatedRole = ["service", "role"].join("_");
  assert.equal(
    validateSupabaseBrowserConfig({ ...base, supabaseAnonKey: legacyJwt(elevatedRole) }).status,
    "invalid",
  );
  assert.equal(
    validateSupabaseBrowserConfig({ ...base, supabasePublishableKey: "random-key" }).status,
    "invalid",
  );
  assert.equal(
    validateSupabaseBrowserConfig({
      supabaseUrl: "http://abcdefghijk.supabase.co",
      supabasePublishableKey: "sb_publishable_example_key",
    }).status,
    "invalid",
  );
});
