import { withSupabase } from "npm:@supabase/server@1";
import { escapeHtml, sendBrevoEmail } from "../_shared/brevo.ts";

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    let body: { mode?: string; requestId?: string };
    try { body = await request.json(); }
    catch (_) { return json({ error: "Invalid JSON body" }, 400); }

    const mode = body.mode ?? "approve";
    if (!new Set(["approve", "retry", "test"]).has(mode)) return json({ error: "Invalid action" }, 400);
    const { data: isAdmin, error: adminError } = await context.supabase.rpc("is_invitation_admin");
    if (adminError || isAdmin !== true) return json({ error: "Administrator access required" }, 403);

    if (mode === "test") {
      const apiKey = Deno.env.get("BREVO_API_KEY");
      const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL");
      const senderName = Deno.env.get("BREVO_SENDER_NAME") ?? "Subuola & Olaoluwa";
      const testRecipient = Deno.env.get("BREVO_TEST_RECIPIENT");
      if (!apiKey || !senderEmail || !testRecipient) return json({ error: "Brevo test credentials, sender, and designated test recipient must be configured" }, 503);
      const result = await sendBrevoEmail({
        apiKey, senderEmail, senderName, recipientEmail: testRecipient, recipientName: "Test recipient",
        subject: "Wedding approval email test",
        htmlContent: "<p>This is a test of the wedding invitation approval email. No guest request was approved.</p>",
        textContent: "This is a test of the wedding invitation approval email. No guest request was approved.",
        idempotencyKey: crypto.randomUUID()
      });
      return result.state === "accepted"
        ? json({ testEmailStatus: "accepted_by_brevo", deliveryConfirmed: false, messageId: result.messageId })
        : json({ testEmailStatus: result.state, errorCode: result.errorCode, deliveryConfirmed: false }, result.state === "failed" ? 502 : 503);
    }

    if (!body.requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) {
      return json({ error: "A valid request ID is required" }, 400);
    }
    if (mode === "approve") {
      const { error } = await context.supabase.rpc("set_invitation_request_status", {
        p_request_id: body.requestId,
        p_status: "approved"
      });
      if (error) return json({ error: "The request could not be approved" }, error.code === "42501" ? 403 : 400);
    }

    const apiKey = Deno.env.get("BREVO_API_KEY");
    const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL");
    const senderName = Deno.env.get("BREVO_SENDER_NAME") ?? "Subuola & Olaoluwa";
    if (!apiKey || !senderEmail) {
      return json({ approvalStatus: mode === "approve" ? "approved" : "unchanged", emailStatus: "not_sent_configuration_missing", deliveryConfirmed: false }, 503);
    }

    const { data: claimed, error: claimError } = await context.supabase.rpc("claim_approval_email", {
      p_request_id: body.requestId,
      p_retry_failed: mode === "retry"
    });
    if (claimError) return json({ approvalStatus: mode === "approve" ? "approved" : "unchanged", emailStatus: "not_processed", error: "Approval email could not be claimed" }, 503);
    const event = Array.isArray(claimed) ? claimed[0] : null;
    if (!event) return json({ approvalStatus: mode === "approve" ? "approved" : "unchanged", emailStatus: "not_queued", deliveryConfirmed: false }, 503);
    if (!event.claimed_now) {
      return json({
        approvalStatus: event.request_status,
        emailStatus: event.outbox_state,
        emailAcceptedByBrevo: event.outbox_state === "accepted",
        deliveryConfirmed: false
      });
    }

    const name = typeof event.recipient_name === "string" ? event.recipient_name : "Guest";
    const escapedName = escapeHtml(name);
    const textContent = `Dear ${name}, your invitation request has been approved by Subuola and Olaoluwa. To access the invitation, return using the private RSVP receipt link you saved after submitting your request. For your security, the receipt is not included in this email. If you no longer have the receipt, please contact the couple.`;
    const htmlContent = `<p>Dear ${escapedName},</p><p>Your invitation request has been approved by Subuola and Olaoluwa.</p><p>To access the invitation, return using the private RSVP receipt link you saved after submitting your request. For your security, the receipt is not included in this email. If you no longer have the receipt, please contact the couple.</p><p>With love,<br>Subuola &amp; Olaoluwa</p>`;
    const sent = await sendBrevoEmail({
      apiKey, senderEmail, senderName,
      recipientEmail: event.recipient_email,
      recipientName: name,
      subject: "Your wedding invitation request is approved",
      htmlContent,
      textContent,
      idempotencyKey: event.event_id
    });
    const { error: completeError } = await context.supabase.rpc("complete_approval_email", {
      p_event_id: event.event_id,
      p_state: sent.state,
      p_provider_message_id: sent.state === "accepted" ? sent.messageId : null,
      p_error_code: sent.state === "accepted" ? null : sent.errorCode
    });
    if (completeError) return json({ approvalStatus: "approved", emailStatus: "unknown", deliveryConfirmed: false, error: "Email outcome could not be saved; it will not be resent automatically" }, 503);
    if (sent.state === "accepted") return json({ approvalStatus: "approved", emailStatus: "accepted_by_brevo", deliveryConfirmed: false, messageId: sent.messageId });
    return json({ approvalStatus: "approved", emailStatus: sent.state, deliveryConfirmed: false, errorCode: sent.errorCode }, sent.state === "failed" ? 502 : 503);
  })
};
