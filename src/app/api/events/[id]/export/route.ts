import * as repo from "@/lib/repo";
import { prospectsToCsv } from "@/lib/csv";
import { notFound } from "@/lib/http";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const event = repo.getEvent(id);
  if (!event) return notFound("Event not found");
  const idsParam = new URL(req.url).searchParams.get("ids");
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : undefined;
  const csv = prospectsToCsv(repo.listProspectsWithEvidence(id, ids));
  const slug = event.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-sponsor-prospects.csv"`,
    },
  });
}
