import { notFound } from "next/navigation";
import EventForm from "@/components/EventForm";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const event = repo.getEvent((await params).id);
  if (!event) notFound();
  return (
    <>
      <h1>Edit event</h1>
      <p className="muted">Changes apply to the next research run. Existing scores stay until you run research again.</p>
      <EventForm event={event} />
    </>
  );
}
