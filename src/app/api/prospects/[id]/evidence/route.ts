import * as repo from "@/lib/repo";
import { json, notFound, parseBody } from "@/lib/http";
import { addManualEvidence } from "@/lib/research";
import { manualEvidenceSchema } from "@/lib/validation";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  if (!repo.getProspect(id)) return notFound("Prospect not found");
  const body = await parseBody(req, manualEvidenceSchema);
  if ("error" in body) return body.error;
  const evidence = addManualEvidence(id, body.data);
  return json({ evidence, prospect: repo.getProspect(id) }, 201);
}
