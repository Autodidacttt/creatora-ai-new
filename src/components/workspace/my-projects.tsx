"use client";

import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { FolderKanban } from "lucide-react";
import { useDb } from "@/features/session";
import { getMyProjects } from "@/services/workspace";
import { SegmentedTabs } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { InfiniteSentinel } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";
import { ProjectCard } from "./project-card";

type Filter = "active" | "completed" | "closed";

/** Creator: every campaign they're hired on (and sprint entries), with the next step highlighted. */
export function MyProjects() {
  const db = useDb();
  const [filter, setFilter] = useState<Filter>("active");
  const q = useInfiniteQuery({
    queryKey: ["my-projects", filter],
    queryFn: ({ pageParam }) => getMyProjects(db, filter, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <SegmentedTabs size="sm" value={filter} onChange={setFilter}
        items={[{ value: "active", label: "Active" }, { value: "completed", label: "Completed" }, { value: "closed", label: "Closed" }]} />
      {q.isPending && <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-56 rounded-[1.75rem]" />)}</div>}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isSuccess && items.length === 0 && (
        <EmptyState icon={<FolderKanban />}
          title={filter === "active" ? "No active projects yet" : filter === "completed" ? "Nothing completed yet" : "No closed projects"}
          description={filter === "active" ? "When a brand hires you — or you enter a 48-hour sprint — the project shows up here with everything you need to deliver." : undefined}
          action={filter === "active" ? <Link href="/opportunities" className={buttonVariants({ variant: "primary" })}>Find briefs</Link> : undefined} />
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((p) => <ProjectCard key={p.id} p={p} view="creator" href={`/opportunities/projects/${p.id}`} />)}
      </div>
      {q.hasNextPage && <InfiniteSentinel onVisible={() => !q.isFetchingNextPage && q.fetchNextPage()} loading={q.isFetchingNextPage} />}
    </div>
  );
}
