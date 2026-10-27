import EventForm from "@/components/EventForm";

export default function NewEventPage() {
  return (
    <>
      <h1>New event</h1>
      <p className="muted">The more specific the description and audience, the better the matches.</p>
      <EventForm />
    </>
  );
}
