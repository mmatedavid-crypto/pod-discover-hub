export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted/50 ${className}`} />;
}

export function PodcastDetailSkeleton() {
  return (
    <div className="container mx-auto py-10">
      <div className="flex flex-col sm:flex-row gap-6">
        <Skeleton className="w-40 h-40 shrink-0 rounded-md" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <div className="flex gap-3 mt-4">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
      </div>
      <div className="mt-10 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="h-16 w-16 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EpisodeDetailSkeleton() {
  return (
    <div className="container mx-auto py-10 max-w-3xl space-y-4">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-9 w-5/6" />
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-40 w-full rounded-md mt-6" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-10/12" />
    </div>
  );
}
