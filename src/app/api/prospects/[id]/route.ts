import * as repo from "@/lib/repo";
import { json, notFound, parseBody } from "@/lib/http";
import { prospectPatchSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const p = repo.getProspect((await params).id);
  return p ? json({ prospect: { ...p, evidence: repo.listEvidence(p.id) } }) : notFound("Prospect not found");
}

export async function PATCH(req: Request, { params }: Ctx) {
  const p = repo.getProspect((await params).id);
  if (!p) return notFound("Prospect not found");
  const body = await parseBody(req, prospectPatchSchema);
  if ("error" in body) return body.error;
  const patch = body.data;
  const next = { ...p, ...patch };
  if (patch.outreachDraft !== undefined && patch.outreachDraft !== p.outreachDraft) next.outreachEdited = true;
  return json({ prospect: repo.saveProspect(next) });
}
