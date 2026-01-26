import { Skeleton } from '../ui/skeleton';

export default function OrdersSkeleton({ limit = 5 }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-20" />
      </div>
      
      {/* Orders header */}
      <div className="grid grid-cols-6 gap-2 mb-3 text-xs text-muted-foreground">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
      
      {/* Orders list skeleton */}
      <div className="space-y-2">
        {[...Array(limit)].map((_, i) => (
          <div key={`order-${i}`} className="grid grid-cols-6 gap-2 items-center">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
