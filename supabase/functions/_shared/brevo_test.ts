import { sendBrevoEmail } from "./brevo.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test("Brevo approval email includes a stable idempotency key and reports provider acceptance", async () => {
  let request: Request | undefined;
  const result = await sendBrevoEmail({
    apiKey: "test-api-key",
    senderEmail: "wedding@example.test",
    senderName: "Wedding",
    recipientEmail: "designated-test@example.test",
    recipientName: "Test Guest",
    subject: "Approval test",
    htmlContent: "<p>Test</p>",
    textContent: "Test",
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    fetcher: async (input, init) => {
      request = new Request(input, init);
      return Response.json({ messageId: "test-message-id" }, { status: 201 });
    }
  });
  assertEquals(result, { state: "accepted", messageId: "test-message-id" });
  assertEquals(request?.headers.get("api-key"), "test-api-key");
  const body = await request!.json();
  assertEquals(body.to[0].email, "designated-test@example.test");
  assertEquals(body.headers.IdempotencyKey, "00000000-0000-4000-8000-000000000001");
});

Deno.test("Brevo transport and server failures are reported as uncertain, never accepted", async () => {
  const input = {
    apiKey: "test-api-key",
    senderEmail: "wedding@example.test",
    senderName: "Wedding",
    recipientEmail: "designated-test@example.test",
    recipientName: "Test Guest",
    subject: "Approval test",
    htmlContent: "<p>Test</p>",
    textContent: "Test",
    idempotencyKey: "00000000-0000-4000-8000-000000000002"
  };
  const network = await sendBrevoEmail({ ...input, fetcher: async () => { throw new Error("network"); } });
  const server = await sendBrevoEmail({ ...input, fetcher: async () => new Response("error", { status: 503 }) });
  const client = await sendBrevoEmail({ ...input, fetcher: async () => new Response("invalid", { status: 400 }) });
  assertEquals(network.state, "unknown");
  assertEquals(server.state, "unknown");
  assertEquals(client.state, "failed");
});
