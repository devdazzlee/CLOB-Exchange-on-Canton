import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A custom Shadcn-style Slider component.
 * Mimics Radix UI Slider but implemented as a controlled native range input 
 * with a custom visual track and thumb for premium look and feel.
 */
const Slider = React.forwardRef(({ className, min = 0, max = 100, step = 1, value, onValueChange, ...props }, ref) => {
  const [internalValue, setInternalValue] = React.useState(Array.isArray(value) ? value[0] : value || 0);

  // Sync internal value if external value changes
  React.useEffect(() => {
    const val = Array.isArray(value) ? value[0] : value;
    if (val !== undefined) setInternalValue(val);
  }, [value]);

  const handleChange = (e) => {
    const newValue = parseFloat(e.target.value);
    setInternalValue(newValue);
    if (onValueChange) {
      onValueChange(Array.isArray(value) ? [newValue] : newValue);
    }
  };

  const percentage = ((internalValue - min) / (max - min)) * 100;

  return (
    <div className={cn("relative flex w-full touch-none select-none items-center group", className)}>
      {/* Background Track */}
      <div className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary">
        {/* Filled Track */}
        <div 
          className="absolute h-full bg-primary transition-all duration-150" 
          style={{ width: `${percentage}%` }}
        />
      </div>
      
      {/* Invisible Native Input (for accessibility and touch/drag handling) */}
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={internalValue}
        onChange={handleChange}
        className="absolute h-1.5 w-full cursor-pointer opacity-0 z-10"
        {...props}
      />

      {/* Visual Thumb (moves with the value) */}
      <div 
        className={cn(
          "pointer-events-none absolute h-4 w-4 rounded-full border-2 border-primary bg-[#0d1117]",
          "ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2",
          "focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          "group-hover:scale-110 shadow-[0_0_8px_rgba(108,92,231,0.5)]"
        )}
        style={{ 
          left: `calc(${percentage}% - 8px)`,
          transition: 'left 0.1s linear'
        }}
      />
    </div>
  );
});

Slider.displayName = "Slider";

export { Slider };
