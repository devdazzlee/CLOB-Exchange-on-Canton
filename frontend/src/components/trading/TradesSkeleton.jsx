import { Skeleton } from '../ui/skeleton';

export default function TradesSkeleton({ limit = 10 }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-20" />
      </div>
      
      {/* Trades header */}
      <div className="grid grid-cols-4 gap-2 mb-3 text-xs text-muted-foreground">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
      
      {/* Trades list skeleton */}
      <div className="space-y-2">
        {[...Array(limit)].map((_, i) => (
          <div key={`trade-${i}`} className="grid grid-cols-4 gap-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
