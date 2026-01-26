import { Skeleton } from '../ui/skeleton';

export default function OrderFormSkeleton() {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>

      {/* Trading Pair Selection */}
      <div className="space-y-2 mb-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-full" />
      </div>

      {/* Order Type and Mode */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <div className="flex gap-2">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 flex-1" />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <div className="flex gap-2">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 flex-1" />
          </div>
        </div>
      </div>

      {/* Price */}
      <div className="space-y-2 mb-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-10 w-full" />
      </div>

      {/* Quantity */}
      <div className="space-y-2 mb-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="flex gap-2">
          {[25, 50, 75, 100].map((percent) => (
            <Skeleton key={percent} className="h-8 flex-1" />
          ))}
        </div>
      </div>

      {/* Order Summary */}
      <div className="p-4 bg-muted rounded-lg space-y-2 mb-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Skeleton className="h-3 w-24 mb-1" />
            <Skeleton className="h-5 w-20" />
          </div>
          <div>
            <Skeleton className="h-3 w-20 mb-1" />
            <Skeleton className="h-5 w-24" />
          </div>
          <div>
            <Skeleton className="h-3 w-20 mb-1" />
            <Skeleton className="h-5 w-16" />
          </div>
          <div>
            <Skeleton className="h-3 w-24 mb-1" />
            <Skeleton className="h-4 w-12" />
          </div>
        </div>
      </div>

      {/* Submit Button */}
      <Skeleton className="h-12 w-full" />

      {/* Advanced Options */}
      <div className="mt-4">
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  );
}
