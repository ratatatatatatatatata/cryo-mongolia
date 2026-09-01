import "@supabase/functions-js/edge-runtime.d.ts"
import { withSupabase } from "@supabase/server"
import type { Database, StaffRole, StaffStatus } from "../_shared/database.types.ts"

const allowedOrigins = new Set([
  "https://cryomongolia.mn",
  "https://www.cryomongolia.mn",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
])

const allowedRoles = new Set([
  "owner",
  "admin",
  "manager",
  "reception",
  "therapist",
  "accountant",
  "auditor",
  "viewer",
])

type Claims = { id?: string; sub?: string; email?: string; aal?: string }

function corsHeaders(req: Request): HeadersInit | null {
  const origin = req.headers.get("origin")
  if (origin && !allowedOrigins.has(origin)) return null
  return {
    "Access-Control-Allow-Origin": origin ?? "https://cryomongolia.mn",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  }
}

function json(req: Request, body: unknown, status = 200): Response {
  const cors = corsHeaders(req)
  const headers = new Headers(cors ?? undefined)
  headers.set("Content-Type", "application/json; charset=utf-8")
  headers.set("Cache-Control", "no-store")
  return new Response(JSON.stringify(body), { status, headers })
}

function withCors(req: Request, response: Response): Response {
  const headers = new Headers(response.headers)
  const cors = corsHeaders(req)
  if (cors) {
    for (const [key, value] of Object.entries(cors)) headers.set(key, value)
  }
  headers.set("Cache-Control", "no-store")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function isEmail(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 3
    && value.length <= 320
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function safeText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null
  const result = value.trim()
  return result.length >= min && result.length <= max ? result : null
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

const authenticatedHandler = withSupabase<Database>({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") return json(req, { error: "METHOD_NOT_ALLOWED" }, 405)

  const userClaims = ctx.userClaims as Claims | undefined
  const jwtClaims = ctx.jwtClaims as Claims | undefined
  const callerId = jwtClaims?.sub ?? userClaims?.id
  if (!callerId) return json(req, { error: "UNAUTHORIZED" }, 401)
  if (jwtClaims?.aal !== "aal2") return json(req, { error: "MFA_REQUIRED" }, 403)

  const { data: caller, error: callerError } = await ctx.supabase
    .from("staff_profiles")
    .select("id, role, status")
    .eq("id", callerId)
    .single()

  if (callerError || !caller || caller.status !== "active" || !["owner", "admin"].includes(caller.role)) {
    return json(req, { error: "FORBIDDEN" }, 403)
  }

  let body: Record<string, unknown>
  try {
    const bytes = new Uint8Array(await req.arrayBuffer())
    if (bytes.byteLength > 8192) return json(req, { error: "PAYLOAD_TOO_LARGE" }, 413)
    body = JSON.parse(new TextDecoder().decode(bytes))
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_BODY")
  } catch {
    return json(req, { error: "INVALID_JSON" }, 400)
  }

  if (body.action === "invite") {
    const email = isEmail(body.email) ? body.email.trim().toLowerCase() : null
    const fullName = safeText(body.fullName, 2, 160)
    const role = typeof body.role === "string" && allowedRoles.has(body.role)
      ? body.role as StaffRole
      : null
    const idempotencyKey = isUuid(body.idempotencyKey) ? body.idempotencyKey.toLowerCase() : null

    if (!email || !fullName || !role || !idempotencyKey) {
      return json(req, { error: "INVALID_INVITE" }, 400)
    }
    if (caller.role !== "owner" && ["owner", "admin"].includes(role)) {
      return json(req, { error: "ROLE_NOT_ALLOWED" }, 403)
    }

    const attemptToken = crypto.randomUUID()
    const { data: reservedRows, error: reserveError } = await ctx.supabaseAdmin.rpc("reserve_staff_invite", {
      p_idempotency_key: idempotencyKey,
      p_attempt_token: attemptToken,
      p_email: email,
      p_full_name: fullName,
      p_intended_role: role,
      p_invited_by: callerId,
    })

    if (reserveError) {
      const knownStatus = new Map([
        ["INVALID_INVITE", 400],
        ["IDEMPOTENCY_CONFLICT", 409],
        ["IDEMPOTENCY_RETIRED", 409],
        ["INVITE_ALREADY_PENDING", 409],
        ["INVITE_IN_PROGRESS", 409],
        ["STAFF_ALREADY_EXISTS", 409],
        ["ROLE_NOT_ALLOWED", 403],
        ["NOT_AUTHORIZED", 403],
        ["RATE_LIMITED", 429],
      ])
      const message = String(reserveError.message ?? "")
      const code = [...knownStatus.keys()].find((candidate) => message.includes(candidate))
      return json(req, { error: code ?? "INVITE_STATE_FAILED" }, code ? (knownStatus.get(code) ?? 500) : 500)
    }

    const reserved = reservedRows?.[0]
    if (!reserved) return json(req, { error: "INVITE_STATE_FAILED" }, 500)

    if (["sent", "linked", "accepted"].includes(reserved.invite_status)) {
      return json(req, {
        ok: true,
        invite: {
          id: reserved.invite_id,
          email,
          fullName,
          role,
          status: reserved.invite_status,
          staffId: reserved.auth_user_id,
        },
      })
    }

    if (!reserved.should_send) {
      if (reserved.invite_status === "sending") {
        return json(req, { error: "INVITE_IN_PROGRESS" }, 409)
      }
      return json(req, { error: "INVITE_STATE_FAILED" }, 500)
    }

    if (reserved.reservation_token !== attemptToken) {
      return json(req, { error: "INVITE_STATE_FAILED" }, 500)
    }

    let invitedUserId = reserved.auth_user_id
    let emailConfirmed = false
    let inviteError: { status?: number } | null = null

    if (invitedUserId) {
      const recoveryResult = await ctx.supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo: "https://cryomongolia.mn/erp/",
      })
      inviteError = recoveryResult.error
    } else {
      const inviteResult = await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
        redirectTo: "https://cryomongolia.mn/erp/",
      })
      inviteError = inviteResult.error
      invitedUserId = inviteResult.data.user?.id ?? null
      emailConfirmed = Boolean(inviteResult.data.user?.email_confirmed_at)
    }

    if (inviteError || !invitedUserId) {
      const providerStatus = inviteError?.status ?? 500
      const failureCode = providerStatus === 429
        ? "AUTH_RATE_LIMITED"
        : providerStatus === 422
          ? "AUTH_INVITE_CONFLICT"
          : providerStatus >= 500
            ? "AUTH_PROVIDER_FAILED"
            : "AUTH_INVITE_FAILED"
      const { data: failed, error: failError } = await ctx.supabaseAdmin.rpc("fail_staff_invite", {
        p_invite_id: reserved.invite_id,
        p_attempt_token: attemptToken,
        p_error_code: failureCode,
      })
      if (failError || failed !== true) {
        return json(req, { error: "INVITE_RECONCILIATION_REQUIRED" }, 500)
      }
      if (providerStatus === 429) return json(req, { error: "RATE_LIMITED" }, 429)
      if (providerStatus >= 500) return json(req, { error: "INVITE_PROVIDER_FAILED" }, 502)
      return json(req, { error: "INVITE_FAILED" }, providerStatus === 422 ? 409 : 400)
    }

    const { data: finalizedStatus, error: linkedError } = await ctx.supabaseAdmin.rpc("finalize_staff_invite", {
      p_invite_id: reserved.invite_id,
      p_auth_user_id: invitedUserId,
      p_attempt_token: attemptToken,
      p_email_confirmed: emailConfirmed,
    })

    if (linkedError || !finalizedStatus) {
      return json(req, { error: "INVITE_RECONCILIATION_REQUIRED" }, 500)
    }

    return json(req, {
      ok: true,
      invite: {
        id: reserved.invite_id,
        email,
        fullName,
        role,
        status: finalizedStatus,
        staffId: invitedUserId,
      },
    }, 201)
  }

  if (body.action === "update_access") {
    const targetUserId = safeText(body.targetUserId, 30, 80)
    const role = typeof body.role === "string" && allowedRoles.has(body.role)
      ? body.role as StaffRole
      : null
    const status = typeof body.status === "string" && ["invited", "active", "suspended"].includes(body.status)
      ? body.status as StaffStatus
      : null
    const reason = safeText(body.reason, 3, 1000)

    if (!targetUserId || !role || !status || !reason) {
      return json(req, { error: "INVALID_ACCESS_UPDATE" }, 400)
    }

    const { data: updatedRows, error: updateError } = await ctx.supabase.rpc("update_staff_access", {
      p_target_user_id: targetUserId,
      p_role: role,
      p_status: status,
      p_reason: reason,
    })

    if (updateError) {
      const knownStatus = new Map([
        ["STAFF_NOT_FOUND", 404],
        ["LAST_OWNER_REQUIRED", 409],
        ["NO_ACCESS_CHANGE", 409],
        ["EMAIL_NOT_CONFIRMED", 409],
        ["CANNOT_CHANGE_SELF", 409],
        ["ROLE_NOT_ALLOWED", 403],
        ["MFA_REQUIRED", 403],
        ["NOT_AUTHORIZED", 403],
        ["RATE_LIMITED", 429],
      ])
      const code = String(updateError.message ?? "ACCESS_UPDATE_FAILED")
      return json(req, { error: knownStatus.has(code) ? code : "ACCESS_UPDATE_FAILED" }, knownStatus.get(code) ?? 500)
    }

    const updated = updatedRows?.[0]
    if (!updated) return json(req, { error: "ACCESS_UPDATE_FAILED" }, 500)
    return json(req, { ok: true, staff: updated })
  }

  return json(req, { error: "UNKNOWN_ACTION" }, 400)
})

export default {
  async fetch(req: Request): Promise<Response> {
    const cors = corsHeaders(req)
    if (!cors) return new Response("Forbidden origin", { status: 403 })
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
    return withCors(req, await authenticatedHandler(req))
  },
}
