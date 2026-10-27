import * as repo from "@/lib/repo";
import { json, notFound, parseBody } from "@/lib/http";
import { addManualBrand } from "@/lib/research";
import { addBrandSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const id = (await params).id;
  if (!repo.getEvent(id)) return notFound("Event not found");
  return json({ prospects: repo.listProspects(id) });
}

/** Add a brand by hand. It gets researched on the next live run, and you can add evidence to it now. */
export async function POST(req: Request, { params }: Ctx) {
  const id = (await params).id;
  if (!repo.getEvent(id)) return notFound("Event not found");
  const body = await parseBody(req, addBrandSchema);
  if ("error" in body) return body.error;
  return json({ prospect: addManualBrand(id, body.data) }, 201);
}
