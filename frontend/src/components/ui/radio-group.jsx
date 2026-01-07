import * as React from "react";
import { cn } from "@/lib/utils";

const RadioGroup = React.forwardRef(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("flex gap-4", className)}
      role="radiogroup"
      {...props}
    />
  );
});
RadioGroup.displayName = "RadioGroup";

const RadioGroupItem = React.forwardRef(
  ({ className, value, checked, onChange, children, variant = "default", ...props }, ref) => {
    const variants = {
      default: "border-primary data-[state=checked]:bg-primary data-[state=checked]:border-primary",
      success: "border-success data-[state=checked]:bg-success data-[state=checked]:border-success",
      danger: "border-destructive data-[state=checked]:bg-destructive data-[state=checked]:border-destructive",
    };

    return (
      <label className="flex items-center gap-2 cursor-pointer group">
        <button
          ref={ref}
          type="button"
          role="radio"
          aria-checked={checked}
          data-state={checked ? "checked" : "unchecked"}
          onClick={() => onChange?.(value)}
          className={cn(
            "h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all duration-200",
            "hover:border-opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background",
            checked 
              ? variants[variant] 
              : "border-muted-foreground bg-transparent",
            className
          )}
          {...props}
        >
          {checked && (
            <span className="h-2 w-2 rounded-full bg-white" />
          )}
        </button>
        {children && (
          <span className={cn(
            "text-sm font-medium transition-colors",
            checked 
              ? variant === "success" 
                ? "text-success" 
                : variant === "danger" 
                  ? "text-destructive" 
                  : "text-foreground"
              : "text-muted-foreground group-hover:text-foreground"
          )}>
            {children}
          </span>
        )}
      </label>
    );
  }
);
RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };

