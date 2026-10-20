import { MessageCircle } from "lucide-react";

export default function InboxIndex() {
  return (
    <div className="grid h-full place-items-center text-center">
      <div>
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-amber-soft"><MessageCircle className="size-6" /></div>
        <h2 className="display mt-3 text-xl">Your conversations</h2>
        <p className="mt-1 max-w-xs text-sm text-ink-2">Pick a conversation, or press “Contact” on any creator or brand profile to start one.</p>
      </div>
    </div>
  );
}
