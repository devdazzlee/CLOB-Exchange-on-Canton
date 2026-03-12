import { Skeleton } from '../ui/skeleton';

export default function MarketDataSkeleton() {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {/* Price info */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
        
        {/* 24h change */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
        
        {/* 24h volume */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
        
        {/* 24h high/low */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <div className="space-y-1">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-28" />
          </div>
        </div>
      </div>
    </div>
  );
}
