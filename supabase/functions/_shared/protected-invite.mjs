const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "private, no-store"
};

const json = (body, status = 200) => Response.json(body, { status, headers: corsHeaders });

function logFailure(stage, error) {
  const diagnostic = { stage };
  if (typeof error?.code === "string" && /^[A-Z0-9]{4,8}$/.test(error.code)) diagnostic.code = error.code;
  if (Number.isInteger(error?.status)) diagnostic.httpStatus = error.status;
  if (typeof error?.name === "string") diagnostic.errorType = error.name;
  console.error("Protected invitation request failed", diagnostic);
}

export function createProtectedInviteHandler({ checkStatus, readImage, inviteDetails }) {
  return async request => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const receiptHash = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!/^[a-f0-9]{64}$/.test(receiptHash)) return json({ error: "Invitation access unavailable" }, 401);

    let status;
    try {
      status = await checkStatus(receiptHash);
    } catch (error) {
      logFailure("check_approval", error);
      if (error?.code === "P0002") return json({ error: "Invitation access unavailable" }, 403);
      return json({ error: "Invitation access could not be verified" }, 503);
    }
    if (status !== "approved") return json({ error: "Invitation access requires an approved request" }, 403);

    if (new URL(request.url).searchParams.get("asset") === "invite.png") {
      try {
        const image = await readImage();
        return new Response(image, { headers: { ...corsHeaders, "Content-Type": "image/png" } });
      } catch (error) {
        logFailure("load_invite_asset", error);
        return json({ error: "Invitation image is unavailable" }, 503);
      }
    }
    return json(inviteDetails);
  };
}
