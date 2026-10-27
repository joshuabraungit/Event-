"use client";

import { useRouter } from "next/navigation";

export default function DeleteEventButton({ id }: { id: string }) {
  const router = useRouter();
  async function remove() {
    if (!confirm("Delete this event and all its prospects, evidence and notes? This can't be undone.")) return;
    const res = await fetch(`/api/events/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else alert("Couldn't delete the event.");
  }
  return (
    <button className="danger" onClick={remove}>
      Delete
    </button>
  );
}
