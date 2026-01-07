import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Check } from "lucide-react";

const SelectContext = React.createContext({});

const Select = ({ value, onValueChange, children }) => {
  const [open, setOpen] = React.useState(false);
  const selectRef = React.useRef(null);

  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (selectRef.current && !selectRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <SelectContext.Provider value={{ value, onValueChange, open, setOpen }}>
      <div ref={selectRef} className="relative">
        {children}
      </div>
    </SelectContext.Provider>
  );
};

const SelectTrigger = React.forwardRef(({ className, children, ...props }, ref) => {
  const { open, setOpen } = React.useContext(SelectContext);
  
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => setOpen(!open)}
      className={cn(
        "flex h-12 w-full items-center justify-between rounded-md border border-input",
        "bg-[#1E2329] px-4 py-3 text-sm font-medium text-[#EAECEF]",
        "focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "transition-all duration-200",
        open && "ring-2 ring-primary border-primary",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDown className={cn(
        "h-4 w-4 text-muted-foreground transition-transform duration-200",
        open && "rotate-180"
      )} />
    </button>
  );
});
SelectTrigger.displayName = "SelectTrigger";

const SelectValue = ({ placeholder, children }) => {
  const { value } = React.useContext(SelectContext);

  return (
    <span className={cn(!value && "text-muted-foreground")}>
      {value ? children : placeholder}
    </span>
  );
};

const SelectContent = React.forwardRef(({ className, children, ...props }, ref) => {
  const { open } = React.useContext(SelectContext);
  
  if (!open) return null;
  
  return (
    <div
      ref={ref}
      className={cn(
        "absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-input",
        "bg-[#1E2329] shadow-lg animate-in fade-in-0 zoom-in-95",
        className
      )}
      {...props}
    >
      <div className="p-1">
        {children}
      </div>
    </div>
  );
});
SelectContent.displayName = "SelectContent";

const SelectItem = React.forwardRef(({ className, value, disabled = false, children, ...props }, ref) => {
  const { value: selectedValue, onValueChange, setOpen } = React.useContext(SelectContext);
  const isSelected = selectedValue === value;
  
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onValueChange(value);
        setOpen(false);
      }}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded-sm px-3 py-2.5",
        "text-sm text-[#EAECEF] outline-none transition-colors",
        "hover:bg-[#2B3139] focus:bg-[#2B3139]",
        isSelected && "bg-primary/10 text-primary",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
        className
      )}
      {...props}
    >
      <span className="flex-1 text-left">{children}</span>
      {isSelected && (
        <Check className="h-4 w-4 text-primary" />
      )}
    </button>
  );
});
SelectItem.displayName = "SelectItem";

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
