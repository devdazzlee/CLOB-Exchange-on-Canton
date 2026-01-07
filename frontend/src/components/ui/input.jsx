import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-12 w-full rounded-md border border-input bg-[#1E2329] px-4 py-3",
        "text-[#EAECEF] text-sm font-medium",
        "placeholder:text-[#848E9C]",
        "focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "transition-all duration-200",
        // Remove number input arrows/spinners
        "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
