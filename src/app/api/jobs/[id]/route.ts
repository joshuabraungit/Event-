import * as repo from "@/lib/repo";
import { json, notFound } from "@/lib/http";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = repo.getJob((await params).id);
  return job ? json({ job }) : notFound("Job not found");
}
