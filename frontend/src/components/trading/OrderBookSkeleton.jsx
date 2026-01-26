import { Skeleton } from '../ui/skeleton';

export default function OrderBookSkeleton() {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-8 w-20" />
      </div>
      
      {/* Order book headers */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-xs text-muted-foreground">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
      
      {/* Sell orders skeleton */}
      <div className="space-y-2 mb-4">
        {[...Array(8)].map((_, i) => (
          <div key={`sell-${i}`} className="grid grid-cols-3 gap-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ))}
      </div>
      
      {/* Spread skeleton */}
      <div className="border-t border-b border-border py-2 mb-4">
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      </div>
      
      {/* Buy orders skeleton */}
      <div className="space-y-2">
        {[...Array(8)].map((_, i) => (
          <div key={`buy-${i}`} className="grid grid-cols-3 gap-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
