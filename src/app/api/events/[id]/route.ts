import * as repo from "@/lib/repo";
import { json, notFound, parseBody } from "@/lib/http";
import { eventInputSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const event = repo.getEvent((await params).id);
  return event ? json({ event }) : notFound("Event not found");
}

export async function PUT(req: Request, { params }: Ctx) {
  const body = await parseBody(req, eventInputSchema);
  if ("error" in body) return body.error;
  const event = repo.updateEvent((await params).id, body.data);
  return event ? json({ event }) : notFound("Event not found");
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return repo.deleteEvent((await params).id) ? json({ ok: true }) : notFound("Event not found");
}
