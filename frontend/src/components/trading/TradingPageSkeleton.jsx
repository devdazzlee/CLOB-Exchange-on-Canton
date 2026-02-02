import { Skeleton } from '../ui/skeleton';
import { Card, CardContent, CardHeader } from '../ui/card';

/**
 * Full Trading Page Skeleton - matches the actual layout
 */
export default function TradingPageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-48" />
        <div className="flex items-center space-x-2">
          <Skeleton className="h-2 w-2 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      
      {/* Order Form Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-8 w-24" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Pair selector */}
            <Skeleton className="h-10 w-full" />
            
            {/* Buy/Sell buttons */}
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
            
            {/* Order type tabs */}
            <div className="flex gap-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
            </div>
            
            {/* Price input */}
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-12 w-full" />
            </div>
            
            {/* Quantity input */}
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-12 w-full" />
            </div>
            
            {/* Submit button */}
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      </div>

      {/* Price Chart */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <Skeleton className="h-6 w-28 mb-2" />
                <div className="flex items-center gap-3">
                  <Skeleton className="h-8 w-32" />
                  <Skeleton className="h-6 w-16" />
                </div>
              </div>
              <div className="hidden md:flex items-center gap-4">
                <div className="border-l border-border pl-4">
                  <Skeleton className="h-3 w-16 mb-1" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <div>
                  <Skeleton className="h-3 w-16 mb-1" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <div>
                  <Skeleton className="h-3 w-16 mb-1" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-48" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Skeleton className="w-full h-[400px]" />
        </CardContent>
      </Card>

      {/* Order Book and Trades Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Order Book */}
        <Card className="lg:col-span-2 bg-card/50 border-border/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-40" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-8 w-8" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Spread */}
            <Skeleton className="h-16 w-full mb-4" />
            
            {/* Order book columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Sells */}
              <div className="space-y-2">
                <Skeleton className="h-5 w-24 mb-3" />
                <div className="space-y-1">
                  {[...Array(8)].map((_, i) => (
                    <Skeleton key={`sell-${i}`} className="h-8 w-full" />
                  ))}
                </div>
              </div>
              {/* Buys */}
              <div className="space-y-2">
                <Skeleton className="h-5 w-24 mb-3" />
                <div className="space-y-1">
                  {[...Array(8)].map((_, i) => (
                    <Skeleton key={`buy-${i}`} className="h-8 w-full" />
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Market Data + Recent Trades */}
        <div className="space-y-6">
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex justify-between">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </CardContent>
          </Card>
          
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <Skeleton className="h-5 w-28" />
            </CardHeader>
            <CardContent className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Active Orders */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
