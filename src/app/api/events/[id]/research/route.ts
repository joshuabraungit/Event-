import { z } from "zod";
import * as repo from "@/lib/repo";
import { json, notFound, parseBody } from "@/lib/http";
import { startResearch } from "@/lib/research";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const id = (await params).id;
  if (!repo.getEvent(id)) return notFound("Event not found");
  return json({ job: repo.latestJob(id) });
}

export async function POST(req: Request, { params }: Ctx) {
  const id = (await params).id;
  if (!repo.getEvent(id)) return notFound("Event not found");
  const body = await parseBody(req, z.object({ mode: z.enum(["mock", "live"]) }));
  if ("error" in body) return body.error;
  return json({ job: startResearch(id, body.data.mode) }, 202);
}
