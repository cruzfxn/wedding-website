import { withSupabase } from "npm:@supabase/server@1";

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    let body: { requestId?: unknown };
    try { body = await request.json(); }
    catch (_) { return json({ error: "Invalid JSON body" }, 400); }

    if (typeof body.requestId !== "string" || !requestIdPattern.test(body.requestId)) {
      return json({ error: "A valid request ID is required" }, 400);
    }

    // The database function rechecks auth.uid() against private.admin_users and
    // deletes the request plus its audit rows in one transaction. The caller JWT
    // is forwarded by the authenticated Supabase client; no service key is used.
    const { data: deleted, error } = await context.supabase.rpc("delete_invitation_request", {
      p_request_id: body.requestId
    });
    if (error) {
      if (error.code === "42501") return json({ error: "Administrator access required" }, 403);
      if (error.code === "P0002") return json({ error: "The request was not found or has already been deleted." }, 404);
      if (error.code === "22023") return json({ error: "A valid request ID is required" }, 400);
      return json({ error: "The request and its history could not be deleted. Please refresh and try again." }, 500);
    }
    if (deleted !== true) return json({ error: "The request deletion could not be confirmed." }, 500);
    return json({ deleted: true, requestId: body.requestId });
  })
};
