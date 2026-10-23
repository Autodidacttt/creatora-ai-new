"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Layers, Search, X } from "lucide-react";
import Link from "next/link";
import { useDb, useMe } from "@/features/session";
import { useLookups } from "@/hooks/use-lookups";
import { useDebounced } from "@/hooks/use-debounce";
import { filtersFromParams, filtersToParams, searchCreators, type CreatorFilters } from "@/services/discovery";
import { FilterPanel } from "@/components/discovery/filter-panel";
import { EmptyResults } from "@/components/discovery/empty-results";
import { CreatorResultCard } from "@/components/discovery/creator-card";
import { AiFinder } from "@/components/discovery/ai-finder";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { InfiniteSentinel } from "@/components/ui/misc";
import { Select } from "@/components/ui/field";
import { buttonVariants } from "@/components/ui/button";

export default function DiscoverPage() {
  const db = useDb();
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const lookups = useLookups();
  const filters = useMemo(() => filtersFromParams(new URLSearchParams(params.toString())), [params]);
  const [q, setQ] = useState(filters.q);
  // URL -> search box (back/forward, chip removal): derived during render, not in an effect
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (filters.q !== syncedQ) {
    setSyncedQ(filters.q);
    setQ(filters.q);
  }
  const debouncedQ = useDebounced(q, 350);

  const update = (patch: Partial<CreatorFilters>) => {
    const next = filtersToParams({ ...filters, ...patch });
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  // Debounced search box -> URL
  useEffect(() => {
    if (debouncedQ !== filters.q) update({ q: debouncedQ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const results = useInfiniteQuery({
    queryKey: ["search", filters],
    queryFn: ({ pageParam }) => searchCreators(db, filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage,
  });
  const items = results.data?.pages.flatMap((p) => p.items) ?? [];
  const total = results.data?.pages[0]?.total ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Discover</p>
          <h1 className="display text-3xl sm:text-4xl">Find AI creators</h1>
        </div>
        <Link href="/swipe" className={buttonVariants({ variant: "glass" })}><Layers /> Swipe mode</Link>
      </div>

      {/* Brands: AI Creator Finder above the classic filters */}
      {me.role === "brand" && <AiFinder />}

      <div className="glass sticky top-[4.5rem] z-20 space-y-3 rounded-[2rem] p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex h-12 flex-1 items-center gap-3 rounded-full bg-card px-4 shadow-sm focus-within:ring-4 focus-within:ring-amber/30">
            <Search className="size-4 text-ink-3" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, tool, skill or project — e.g. “Runway fashion”"
              aria-label="Search creators"
              className="w-full bg-transparent text-sm focus:outline-none"
            />
            {q && <button aria-label="Clear search" onClick={() => setQ("")}><X className="size-4 text-ink-3" /></button>}
          </label>
          <Select aria-label="Sort by" value={filters.sort} onChange={(e) => update({ sort: e.target.value as CreatorFilters["sort"] })} className="h-12 rounded-full sm:w-48">
            <option value="best">Best match</option>
            <option value="newest">Newest</option>
            <option value="followers">Most followed</option>
          </Select>
        </div>
        {lookups.data && <FilterPanel lookups={lookups.data} filters={filters} onChange={update} />}
      </div>

      <p className="text-sm text-ink-2" aria-live="polite">
        {results.isPending ? "Searching…" : results.isError ? "" : `${total} creator${total === 1 ? "" : "s"}`}
      </p>

      {results.isPending && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-96 rounded-[2rem]" />)}</div>
      )}
      {results.isError && <ErrorState error={results.error} onRetry={() => results.refetch()} />}
      {results.isSuccess && items.length === 0 && lookups.data && (
        <EmptyResults filters={filters} lookups={lookups.data} onChange={update} />
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((c) => <CreatorResultCard key={c.id} creator={c} highlightTools={filters.tools} />)}
      </div>
      {results.hasNextPage && <InfiniteSentinel onVisible={() => !results.isFetchingNextPage && results.fetchNextPage()} loading={results.isFetchingNextPage} />}
    </div>
  );
}
