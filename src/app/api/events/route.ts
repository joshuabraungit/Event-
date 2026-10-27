import * as repo from "@/lib/repo";
import { json, parseBody } from "@/lib/http";
import { eventInputSchema } from "@/lib/validation";

export async function GET() {
  return json({ events: repo.listEvents() });
}

export async function POST(req: Request) {
  const body = await parseBody(req, eventInputSchema);
  if ("error" in body) return body.error;
  return json({ event: repo.createEvent(body.data) }, 201);
}
