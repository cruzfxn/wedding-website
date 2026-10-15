import { createClient } from "npm:@supabase/supabase-js@2";
import { createProtectedInviteHandler } from "../_shared/protected-invite.mjs";

const inviteDetails = {
  message: "Together with our families, we joyfully invite you to witness the union of",
  details: [
    "Tuesday, 22nd December 2026 · 9:00 AM",
    "St. Michael's Cathedral, Abuja",
    "",
    "Reception to follow at 1:00 PM",
    "Grand Ballroom, Landmark Event Centre"
  ],
  dressCode: "Dress Code: Aso Ebi — Emerald & Gold"
};
// Gateway JWT verification must stay disabled for this function because the
// Authorization Bearer value is a receipt hash, not a Supabase Auth JWT. This
// handler independently checks that receipt and current approval on each GET.
Deno.serve(createProtectedInviteHandler({
  checkStatus: async receiptHash => {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anonKey) {
      const error = new Error("Invitation database client is not configured");
      error.code = "CONFIG_MISSING";
      throw error;
    }
    const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: status, error } = await supabase.rpc("check_guest_request", { p_receipt_hash: receiptHash });
    if (error) throw error;
    return status;
  },
  readImage: () => Deno.readFile("./invite.png"),
  inviteDetails
}));
