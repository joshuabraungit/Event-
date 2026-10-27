import * as repo from "@/lib/repo";
import { badRequest, json, notFound, parseBody } from "@/lib/http";
import { refreshProspect } from "@/lib/research";
import { evidencePatchSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** Set or clear the user-controlled flags (conflicting, inaccessible), then rescore. */
export async function PATCH(req: Request, { params }: Ctx) {
  const e = repo.getEvidence((await params).id);
  if (!e) return notFound("Evidence not found");
  const body = await parseBody(req, evidencePatchSchema);
  if ("error" in body) return body.error;
  const userFlags = body.data.flags ?? [];
  const kept = e.flags.filter((f) => f !== "conflicting" && f !== "inaccessible");
  repo.saveEvidence({ ...e, flags: [...kept, ...userFlags] });
  const prospect = refreshProspect(e.prospectId);
  return json({ evidence: repo.getEvidence(e.id), prospect });
}

/** Only evidence you added by hand can be deleted; provider evidence can be flagged instead. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const e = repo.getEvidence((await params).id);
  if (!e) return notFound("Evidence not found");
  if (e.verification !== "user_provided") return badRequest("Only evidence you added can be deleted. Flag it instead.");
  repo.deleteEvidence(e.id);
  return json({ prospect: refreshProspect(e.prospectId) });
}
