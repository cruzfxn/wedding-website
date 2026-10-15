export type BrevoSendResult =
  | { state: "accepted"; messageId: string }
  | { state: "failed" | "unknown"; errorCode: string };

export type BrevoSendInput = {
  apiKey: string;
  senderEmail: string;
  senderName: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  idempotencyKey: string;
  fetcher?: typeof fetch;
};

export async function sendBrevoEmail(input: BrevoSendInput): Promise<BrevoSendResult> {
  const fetcher = input.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": input.apiKey
      },
      body: JSON.stringify({
        sender: { email: input.senderEmail, name: input.senderName },
        to: [{ email: input.recipientEmail, name: input.recipientName }],
        subject: input.subject,
        htmlContent: input.htmlContent,
        textContent: input.textContent,
        headers: { IdempotencyKey: input.idempotencyKey }
      })
    });
  } catch (_) {
    return { state: "unknown", errorCode: "brevo_network_error" };
  }

  if (response.status !== 201) {
    if (response.status >= 500 || response.status === 408 || response.status === 429) {
      return { state: "unknown", errorCode: "brevo_http_" + response.status };
    }
    return { state: "failed", errorCode: "brevo_http_" + response.status };
  }

  try {
    const payload = await response.json();
    if (typeof payload.messageId === "string" && payload.messageId.length > 0) {
      return { state: "accepted", messageId: payload.messageId };
    }
  } catch (_) {
    // A 201 without a parseable message ID is ambiguous: don't report success or retry.
  }
  return { state: "unknown", errorCode: "brevo_invalid_success_response" };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]!);
}
