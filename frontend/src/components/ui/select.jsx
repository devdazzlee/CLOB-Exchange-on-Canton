import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { ChevronDown, Check } from "lucide-react";

const SelectContext = React.createContext(null);

const Select = ({ value, onValueChange, children }) => {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState({}); // value -> label
  const [triggerRect, setTriggerRect] = React.useState(null);
  const selectRef = React.useRef(null);
  const triggerRef = React.useRef(null);

  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (selectRef.current && !selectRef.current.contains(event.target) && 
          !document.getElementById('select-portal-root')?.contains(event.target)) {
        setOpen(false);
      }
    };
    
    const handleScroll = () => {
      if (open) setOpen(false); // standard UX: close on main scroll
    };

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("scroll", handleScroll, true);
    }
    
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  const updateTriggerRect = React.useCallback(() => {
    if (triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    }
  }, []);

  const registerItem = React.useCallback((itemValue, label) => {
    setItems((prev) => {
      if (prev[itemValue] === label) return prev;
      return { ...prev, [itemValue]: label };
    });
  }, []);

  return (
    <SelectContext.Provider value={{ 
      value, onValueChange, open, setOpen, items, registerItem, 
      triggerRef, triggerRect, updateTriggerRect 
    }}>
      <div ref={selectRef} className="relative inline-block w-full">
        {children}
      </div>
    </SelectContext.Provider>
  );
};

const SelectTrigger = React.forwardRef(({ className, children, ...props }, ref) => {
  const { open, setOpen, triggerRef, updateTriggerRect } = React.useContext(SelectContext);
  
  const handleOpen = () => {
    updateTriggerRect();
    setOpen(!open);
  };

  return (
    <button
      ref={(node) => {
        triggerRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      type="button"
      onClick={handleOpen}
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
      <div className="flex-1 text-left">{children}</div>
      <ChevronDown className={cn(
        "h-4 w-4 text-muted-foreground transition-transform duration-200 flex-shrink-0 ml-2",
        open && "rotate-180"
      )} />
    </button>
  );
});
SelectTrigger.displayName = "SelectTrigger";

const SelectValue = ({ placeholder, className }) => {
  const { value, items } = React.useContext(SelectContext);
  const label = value ? items?.[value] : null;
  return (
    <span className={cn("text-white", !value && "text-muted-foreground", className)}>
      {value ? (label ?? value) : placeholder}
    </span>
  );
};

const SelectContent = React.forwardRef(({ className, align = "start", sideOffset = 4, collisionPadding = 12, children, ...props }, ref) => {
  const { open, triggerRect } = React.useContext(SelectContext);
  
  if (!open || !triggerRect) return null;
  
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
  
  // Base style
  const contentStyle = {
    position: 'fixed',
    top: `${triggerRect.bottom + sideOffset}px`,
    minWidth: `${triggerRect.width}px`,
    zIndex: 9999,
  };

  // Senior Fix: Viewport-aware horizontal alignment
  if (align === "end") {
    const rightSide = viewportWidth - triggerRect.right;
    contentStyle.right = `${Math.max(collisionPadding, rightSide)}px`;
  } else {
    contentStyle.left = `${Math.max(collisionPadding, triggerRect.left)}px`;
    
    // Safety check for right-edge collision
    const estimatedWidth = 160; 
    if (triggerRect.left + estimatedWidth > viewportWidth - collisionPadding) {
      contentStyle.left = 'auto';
      contentStyle.right = `${collisionPadding}px`;
    }
  }

  // Senior Fix: Vertical flip if near bottom
  const estimatedHeight = 220;
  if (triggerRect.bottom + sideOffset + estimatedHeight > viewportHeight - collisionPadding) {
    contentStyle.top = 'auto';
    contentStyle.bottom = `${viewportHeight - triggerRect.top + sideOffset}px`;
  }

  return createPortal(
    <div
      id="select-portal-root"
      ref={ref}
      style={contentStyle}
      className={cn(
        "overflow-hidden rounded-md border border-[#2B3139]",
        "bg-[#1E2329] shadow-2xl animate-in fade-in-0 zoom-in-95",
        className
      )}
      {...props}
    >
      <div className="p-1 max-h-[300px] overflow-y-auto custom-scrollbar">
        {children}
      </div>
    </div>,
    document.body
  );
});
SelectContent.displayName = "SelectContent";

const SelectItem = React.forwardRef(
  ({ className, value, disabled = false, children, ...props }, ref) => {
    const { value: selectedValue, onValueChange, setOpen, registerItem } =
      React.useContext(SelectContext);

    const isSelected = selectedValue === value;

    React.useEffect(() => {
      const label = typeof children === "string" ? children : (Array.isArray(children) ? children.join("") : String(value));
      registerItem?.(value, label);
    }, [value, children, registerItem]);

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
          "relative flex w-full cursor-pointer select-none items-center rounded-sm px-3 py-2",
          "text-sm text-[#EAECEF] outline-none transition-colors justify-between",
          "hover:bg-[#2B3139] focus:bg-[#2B3139]",
          isSelected && "bg-primary/10 text-primary",
          disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
          className
        )}
        {...props}
      >
        <span className="flex-1 text-left truncate">{children}</span>
        {isSelected && <Check className="h-4 w-4 text-primary flex-shrink-0" />}
      </button>
    );
  }
);
SelectItem.displayName = "SelectItem";

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
