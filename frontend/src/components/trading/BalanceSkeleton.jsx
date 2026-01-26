import { Skeleton } from '../ui/skeleton';

export default function BalanceSkeleton() {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-8 w-20" />
      </div>
      
      {/* Balance items */}
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => (
          <div key={`balance-${i}`} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center space-x-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div>
                <Skeleton className="h-4 w-16 mb-1" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <div className="text-right">
              <Skeleton className="h-5 w-20 mb-1" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
      
      {/* Total balance skeleton */}
      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-6 w-28" />
        </div>
      </div>
    </div>
  );
}
